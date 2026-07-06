#!/usr/bin/env node
/*
  EGX Pro Hub V9.1 — Source Evidence Engine
  Builds an independent evidence matrix from price safety + Mubasher tools + local data + news.
  Non-invasive rule: this file never rewrites price, entry, targets or stops. It only produces evidence.
*/
const fs=require('fs'), path=require('path');
const RUN_AT=new Date().toISOString();
function read(f,d){try{return JSON.parse(fs.readFileSync(f,'utf8'))}catch{return d}}
function write(f,o){fs.mkdirSync(path.dirname(f),{recursive:true});fs.writeFileSync(f,JSON.stringify(o,null,2)+'\n','utf8')}
function n(v){if(v==null||v==='')return null;let s=String(v).replace(/[,%٬،]/g,'').replace(/−/g,'-').trim();let mult=1;if(/[Kk]$/.test(s)){mult=1e3;s=s.slice(0,-1)}if(/[Mm]$/.test(s)){mult=1e6;s=s.slice(0,-1)}if(/[Bb]$/.test(s)){mult=1e9;s=s.slice(0,-1)}s=s.replace(/[^0-9.+\-eE]/g,'');const x=Number(s);return Number.isFinite(x)?x*mult:null}
function sym(v){return String(v||'').toUpperCase().replace(/\.CA$/,'').replace(/[^A-Z0-9.]/g,'').trim()}
function rowsOf(x){if(Array.isArray(x))return x;if(Array.isArray(x?.rows))return x.rows;if(Array.isArray(x?.all))return x.all;if(Array.isArray(x?.data))return x.data;return[]}
function mapRows(rows){const m={};(rows||[]).forEach(r=>{const k=sym(r.symbol||r.ticker||r.code);if(k&&!m[k])m[k]=r});return m}
function priceAuditFor(symbol, audits){return rowsOf(audits).find(x=>sym(x.symbol||x.ticker)===symbol)||{} }
function latestNewsFor(symbol, news){const items=Array.isArray(news.items)?news.items:rowsOf(news);return items.filter(x=>sym(x.symbol||x.ticker||x.relatedSymbol)===symbol || (Array.isArray(x.symbols)&&x.symbols.map(sym).includes(symbol))).slice(0,5)}
function nums(src){return (src&&Array.isArray(src.numeric)?src.numeric:[]).map(x=>({raw:x.raw,value:n(x.value??x.raw),isPercent:!!x.isPercent})).filter(x=>x.value!=null)}
function percentValues(list){return list.filter(x=>x.isPercent).map(x=>x.value).filter(x=>Number.isFinite(x))}
function clamp(x,a=0,b=100){return Math.max(a,Math.min(b,Math.round(x)))}
function safeText(s){return String(s||'').slice(0,350)}
function inferVolume(src){
  if(!src)return {status:'missing',score:0,headline:'غير متاح'};
  const list=nums(src), pct=percentValues(list); let p=pct.length?Math.max(...pct):null;
  let score=56,status='neutral',headline='بيانات حجم متاحة';
  if(p!=null){ if(p>=50){score=92;status='strong';headline='ارتفاع واضح في الحجم'} else if(p>=20){score=78;status='good';headline='حجم أعلى من المتوسط'} else if(p<=-25){score=25;status='weak';headline='حجم أقل من المتوسط'} else {score=58;status='neutral';headline='حجم قريب من المتوسط'} }
  else if(src.staleFallback){score=48;status='stale';headline='حجم متاح من قراءة سابقة'}
  return {status,score,headline,percentChange:p,source:'Mubasher Volume Monitor'};
}
function inferLiquidity(src){
  if(!src)return {status:'missing',score:0,headline:'غير متاح'};
  const list=nums(src); let score=56,status='neutral',headline='بيانات سيولة متاحة';
  const pct=percentValues(list); if(pct.length){const p=Math.max(...pct); if(p>=30){score=80;status='good';headline='سيولة داعمة'} else if(p<=-25){score=32;status='weak';headline='سيولة ضعيفة أو خارجة'} }
  const vals=list.map(x=>x.value).filter(x=>Math.abs(x)>1000); if(!pct.length && vals.length>=2){const last=vals[vals.length-1], prev=vals[vals.length-2]; if(last>prev*1.2){score=72;status='good';headline='تحسن سيولة نسبي'} else if(last<prev*.75){score=38;status='weak';headline='تراجع سيولة نسبي'}}
  if(src.staleFallback && score>55){score-=10; status='stale'; headline+=' من قراءة سابقة'}
  return {status,score:clamp(score),headline,source:'Mubasher Liquidity Monitor'};
}
function inferSupportResistance(src, price){
  if(!src)return {status:'missing',score:0,headline:'غير متاح'};
  const p=n(price); const list=nums(src).map(x=>x.value).filter(x=>x>0); let score=60,status='available',headline='دعم ومقاومة متاحة';
  if(p&&list.length){
    const realistic=list.filter(x=>x>p*.25 && x<p*4);
    const below=realistic.filter(x=>x<p).sort((a,b)=>b-a)[0]||null;
    const above=realistic.filter(x=>x>p).sort((a,b)=>a-b)[0]||null;
    const distSup=below?(p-below)/p*100:null, distRes=above?(above-p)/p*100:null;
    if(distSup!=null && distSup<=1.25){score+=12;headline='قريب من دعم واضح'}
    else if(distSup!=null && distSup<=3){score+=7;headline='فوق دعم قريب'}
    else if(distSup!=null && distSup>8){score-=8;headline='بعيد عن أقرب دعم'}
    if(distRes!=null && distRes<1){score-=10;headline='قريب جدًا من مقاومة'}
    return {status,score:clamp(score,20,92),headline,nearestSupport:below,nearestResistance:above,distanceToSupportPct:distSup==null?null:Number(distSup.toFixed(2)),distanceToResistancePct:distRes==null?null:Number(distRes.toFixed(2)),source:'Mubasher Support & Resistance'};
  }
  if(src.staleFallback){score=50;status='stale';headline='دعم/مقاومة من قراءة سابقة'}
  return {status,score,headline,source:'Mubasher Support & Resistance'};
}
function inferFinancial(src){
  if(!src)return {status:'missing',score:0,headline:'غير متاح'};
  const list=nums(src); let score=60,status='available',headline='مؤشرات مالية متاحة';
  const positive=list.map(x=>x.value).filter(x=>x>0);
  const pe=positive.find(x=>x>0&&x<200)??null;
  if(pe!=null){ if(pe<8){score=72;headline='تقييم منخفض نسبيًا'} else if(pe>35){score=42;headline='مضاعف مرتفع يحتاج مراجعة'} else {score=62;headline='مؤشرات مالية متوسطة'} }
  if(src.staleFallback && score>55){score-=8;status='stale';headline+=' من قراءة سابقة'}
  return {status,score:clamp(score),headline,source:'Mubasher Financial Ratios',sampleRatio:pe};
}
function priceEvidence(row,audit){
  const p=n(audit.finalPrice??audit.price??row.price??row.last??row.close);
  const state=String(audit.executionState||audit.status||audit.priceStatus||'').toLowerCase();
  const reason=String(audit.executionBlockReason||audit.reason||audit.note||'');
  const precisionRisk=!!audit.precisionRisk || !!row.precisionRisk || /precision|دقة سعر|غير كاف/i.test(reason) || (p!=null && p>0 && p<1 && /^0?\.\d{1,2}0?$/.test(String(p)));
  const conflict=!!audit.hasConflict || /conflict|تعارض/i.test(state+reason);
  const stale=!!audit.isStale || /stale|قديم/i.test(state+reason);
  if(precisionRisk)return {allowed:false,status:'blocked',score:5,reason:'دقة السعر أقل من المطلوب للتنفيذ'};
  if(conflict)return {allowed:false,status:'conflict',score:20,reason:'تعارض بين مصادر السعر'};
  if(stale)return {allowed:false,status:'stale',score:35,reason:'السعر قديم أو يحتاج تحديث'};
  if(p==null||p<=0)return {allowed:false,status:'missing',score:0,reason:'السعر غير متاح'};
  return {allowed:true,status:'ok',score:90,reason:'السعر مقبول مبدئيًا'};
}
function sourceHealth(tools, totalUniverse){
  const srcs=Array.isArray(tools.sources)?tools.sources:[];
  return srcs.map(s=>({id:s.id,title:s.title,url:s.url,ok:!!s.ok,currentRunOk:!!s.currentRunOk,staleFallback:!!s.staleFallback,count:s.count||0,coveragePct:totalUniverse?Number(((s.count||0)/totalUniverse*100).toFixed(1)):null,error:s.error||null,note:s.note||''}));
}
function main(){
  const rec=read('data/recommendations.json',{}), market=read('data/market.json',{}), cache=read('data/full-market-cache.json',{}), ranking=read('data/final-opportunity-ranking.json',{}), tools=read('data/mubasher-analysis-tools.json',{}), priceAudit=read('data/price-source-audit.json',read('data/price-reconciliation-report.json',{})), news=read('data/news-intelligence.json',{});
  const baseRows=[...rowsOf(cache),...rowsOf(market),...rowsOf(rec),...rowsOf(ranking)].filter(Boolean);
  const baseMap=mapRows(baseRows); const toolMap={}; (tools.symbols||[]).forEach(x=>{const k=sym(x.symbol); if(k) toolMap[k]=x});
  const allSymbols=Array.from(new Set([...Object.keys(baseMap),...Object.keys(toolMap)])).filter(Boolean).sort();
  const totalUniverse=read('data/source-health.json',{}).totalUniverse || allSymbols.length;
  const rows=allSymbols.map(symbol=>{
    const base=baseMap[symbol]||{}, t=toolMap[symbol]||{sources:{}}, audit=priceAuditFor(symbol,priceAudit), p=n(audit.finalPrice??audit.price??base.price), price=priceEvidence({...base,price:p},audit);
    const volume=inferVolume(t.sources.volume), liquidity=inferLiquidity(t.sources.liquidity), supportResistance=inferSupportResistance(t.sources.supportResistance,p), financial=inferFinancial(t.sources.financialRatios), newsRows=latestNewsFor(symbol,news);
    const sources=Object.keys(t.sources||{}); const staleSources=sources.filter(k=>t.sources[k]&&t.sources[k].staleFallback);
    let score=0, evidence=[];
    if(base.symbol||base.name_ar||base.price){score+=10;evidence.push('سوق داخلي')}
    score+=price.score*0.24; if(price.allowed)evidence.push('سعر آمن'); else evidence.push('سعر غير آمن');
    score+=volume.score*0.16; if(t.sources.volume)evidence.push('Volume');
    score+=liquidity.score*0.16; if(t.sources.liquidity)evidence.push('Liquidity');
    score+=supportResistance.score*0.14; if(t.sources.supportResistance)evidence.push('Support/Resistance');
    score+=financial.score*0.10; if(t.sources.financialRatios)evidence.push('Financial Ratios');
    if(newsRows.length){score+=6;evidence.push('أخبار مرتبطة')}
    score+=Math.min(8,sources.length*2);
    if(staleSources.length)score-=Math.min(12,staleSources.length*4);
    score=clamp(score);
    const blocks=[]; if(!price.allowed)blocks.push(price.reason); if(staleSources.length)blocks.push('بعض أدلة مباشر من قراءة سابقة');
    let finalDataDecision='Watch Only', level='watch', executionAllowed=false;
    if(!price.allowed){finalDataDecision='Blocked'; level='blocked'}
    else if(score>=60 && sources.length>=2){finalDataDecision='Executable Review'; level='ok'; executionAllowed=true}
    else if(score>=45){finalDataDecision='Watch Only'; level='watch'}
    else {finalDataDecision='Insufficient Evidence'; level='warn'; blocks.push('ضعف أدلة المصادر')}
    const reason=`قوة الدليل ${score}% — ${evidence.join(' + ')||'لا توجد أدلة كافية'}${blocks.length?' | قيود: '+blocks.join('، '):''}`;
    return {symbol,name:base.name_ar||base.name_en||base.name||t.name||symbol,price:p,sourceStrengthScore:score,finalDataDecision,level,executionAllowed,priceStatus:price.status,priceReason:price.reason,volume,liquidity,supportResistance,financial,newsCount:newsRows.length,sources,staleSources,reason,blocks:blocks.map(safeText)};
  }).sort((a,b)=>b.sourceStrengthScore-a.sourceStrengthScore||a.symbol.localeCompare(b.symbol));
  const sourcesOk=tools.summary?.sourcesOk||0; const staleFallbackSources=tools.summary?.staleFallbackSources||0; const currentSourcesOk=(tools.summary?.currentSourcesOk!=null)?tools.summary.currentSourcesOk:Math.max(0,sourcesOk-staleFallbackSources);
  const summary={total:rows.length, executable:rows.filter(r=>r.executionAllowed).length, watchOnly:rows.filter(r=>r.level==='watch').length, blocked:rows.filter(r=>r.level==='blocked').length, insufficient:rows.filter(r=>r.level==='warn').length, avgScore:Math.round(rows.reduce((s,r)=>s+r.sourceStrengthScore,0)/Math.max(1,rows.length)), sourcesOk, currentSourcesOk, staleFallbackSources};
  const health=sourceHealth(tools,totalUniverse);
  const report={ok:true,engine:'v9_1_source_evidence_engine',generatedAt:RUN_AT,summary,sourceHealth:health,rows,note:'V9.1 evidence layer. External public delayed sources confirm/downgrade/block only; price and trading plan remain controlled by the safe price/ranking engine.'};
  write('data/multi-source-intelligence.json',report);
  write('data/source-evidence-matrix.json',{ok:true,engine:'v9_1_source_evidence_matrix',generatedAt:RUN_AT,summary,sourceHealth:health,rows:rows.map(r=>({symbol:r.symbol,name:r.name,score:r.sourceStrengthScore,decision:r.finalDataDecision,price:r.priceStatus,priceReason:r.priceReason,volume:r.volume.status,liquidity:r.liquidity.status,supportResistance:r.supportResistance.status,financial:r.financial.status,newsCount:r.newsCount,sources:r.sources,staleSources:r.staleSources,reason:r.reason}))});
  console.log('V9.1 source evidence', summary);
}
main();
