#!/usr/bin/env node
/*
  EGX Pro Hub V9.4 — Evidence Coverage Booster
  Goal: increase confirmed/reliable symbols without weakening execution safety.
  Non-invasive rule: this file NEVER rewrites price, entry, targets or stopLoss.
  It adds internal confirmations from the safe market cache when external sources are missing.
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
function bestEvidence(a,b){return (b&&b.score>a.score)?b:a}
function has(v){return n(v)!=null && n(v)>0}
function decs(v){const s=String(v??'').trim();const m=s.match(/\.(\d+)/);return m?m[1].length:0}

function inferVolume(src){
  if(!src)return {status:'missing',score:0,headline:'غير متاح',source:'Mubasher Volume Monitor'};
  const list=nums(src), pct=percentValues(list); let p=pct.length?Math.max(...pct):null;
  let score=56,status='neutral',headline='بيانات حجم متاحة';
  if(p!=null){ if(p>=50){score=92;status='strong';headline='ارتفاع واضح في الحجم'} else if(p>=20){score=78;status='good';headline='حجم أعلى من المتوسط'} else if(p<=-25){score=25;status='weak';headline='حجم أقل من المتوسط'} else {score=58;status='neutral';headline='حجم قريب من المتوسط'} }
  else if(src.staleFallback){score=48;status='stale';headline='حجم متاح من قراءة سابقة'}
  return {status,score,headline,percentChange:p,source:'Mubasher Volume Monitor'};
}
function inferInternalVolume(base){
  const vol=n(base.volume??base.tradedVolume), value=n(base.valueTraded??base.turnover??base.value), price=n(base.price);
  if(!vol&&!value)return {status:'missing',score:0,headline:'غير متاح داخليًا',source:'Market Cache Volume'};
  let score=50;
  if(vol>=1000000)score+=22; else if(vol>=250000)score+=13; else if(vol>=50000)score+=7;
  if(value>=20000000)score+=22; else if(value>=5000000)score+=12; else if(value>=1000000)score+=7;
  if(price&&price>0)score+=4;
  return {status:score>=72?'good':'available',score:clamp(score,35,88),headline:'تأكيد داخلي من حجم/قيمة التداول في الكاش',source:'Market Cache Volume',volume:vol,valueTraded:value};
}
function inferLiquidity(src){
  if(!src)return {status:'missing',score:0,headline:'غير متاح',source:'Mubasher Liquidity Monitor'};
  const list=nums(src); let score=56,status='neutral',headline='بيانات سيولة متاحة';
  const pct=percentValues(list); if(pct.length){const p=Math.max(...pct); if(p>=30){score=80;status='good';headline='سيولة داعمة'} else if(p<=-25){score=32;status='weak';headline='سيولة ضعيفة أو خارجة'} }
  const vals=list.map(x=>x.value).filter(x=>Math.abs(x)>1000); if(!pct.length && vals.length>=2){const last=vals[vals.length-1], prev=vals[vals.length-2]; if(last>prev*1.2){score=72;status='good';headline='تحسن سيولة نسبي'} else if(last<prev*.75){score=38;status='weak';headline='تراجع سيولة نسبي'}}
  if(src.staleFallback && score>55){score-=10; status='stale'; headline+=' من قراءة سابقة'}
  return {status,score:clamp(score),headline,source:'Mubasher Liquidity Monitor'};
}
function inferInternalLiquidity(base){
  const value=n(base.valueTraded??base.turnover??base.value), vol=n(base.volume??base.tradedVolume);
  if(!value&&!vol)return {status:'missing',score:0,headline:'غير متاح داخليًا',source:'Market Cache Liquidity'};
  let score=45;
  if(value>=50000000)score=88; else if(value>=20000000)score=78; else if(value>=8000000)score=68; else if(value>=2000000)score=58;
  if(vol>=1000000)score+=4;
  return {status:score>=70?'good':'available',score:clamp(score,35,90),headline:'تأكيد داخلي من قيمة التداول المقروءة',source:'Market Cache Liquidity',valueTraded:value};
}
function inferSupportResistance(src, price){
  if(!src)return {status:'missing',score:0,headline:'غير متاح',source:'Mubasher Support & Resistance'};
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
function inferInternalSupportResistance(base){
  const p=n(base.price), s=n(base.support1??base.support??base.s1), r=n(base.resistance1??base.resistance??base.r1), e1=n(base.entryFrom??base.entryLow), e2=n(base.entryTo??base.entryHigh), t=n(base.target1), sl=n(base.stopLoss);
  if(!p)return {status:'missing',score:0,headline:'سعر غير متاح',source:'Market Cache Levels'};
  let score=45, confirmations=[];
  if(s&&s<p){score+=12;confirmations.push('دعم داخلي')}
  if(r&&r>p){score+=10;confirmations.push('مقاومة داخلية')}
  if(e1&&e2&&e1<=e2&&e1>p*.70&&e2<p*1.30){score+=14;confirmations.push('نطاق دخول منطقي')}
  if(t&&t>p*1.005){score+=10;confirmations.push('هدف موجب')}
  if(sl&&sl<p*.998){score+=10;confirmations.push('وقف أسفل السعر')}
  const distSup=s?(p-s)/p*100:null, distRes=r?(r-p)/p*100:null;
  return {status:score>=72?'good':'available',score:clamp(score,25,90),headline:confirmations.length?confirmations.join(' + '):'مستويات داخلية محدودة',nearestSupport:s||null,nearestResistance:r||null,distanceToSupportPct:distSup==null?null:Number(distSup.toFixed(2)),distanceToResistancePct:distRes==null?null:Number(distRes.toFixed(2)),source:'Market Cache Levels'};
}
function inferFinancial(src){
  if(!src)return {status:'missing',score:0,headline:'غير متاح',source:'Mubasher Financial Ratios'};
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
  const precisionRisk=!!audit.precisionRisk || !!row.precisionRisk || /precision|دقة سعر|غير كاف/i.test(reason) || (p!=null && p>0 && p<1 && Math.max(decs(audit.finalPrice??audit.price),decs(row.price))<3);
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
    const externalVolume=inferVolume(t.sources.volume), internalVolume=inferInternalVolume(base), volume=bestEvidence(externalVolume,internalVolume);
    const externalLiquidity=inferLiquidity(t.sources.liquidity), internalLiquidity=inferInternalLiquidity(base), liquidity=bestEvidence(externalLiquidity,internalLiquidity);
    const externalSR=inferSupportResistance(t.sources.supportResistance,p), internalSR=inferInternalSupportResistance({...base,price:p||base.price}), supportResistance=bestEvidence(externalSR,internalSR);
    const financial=inferFinancial(t.sources.financialRatios), newsRows=latestNewsFor(symbol,news);
    const externalSources=Object.keys(t.sources||{}), staleSources=externalSources.filter(k=>t.sources[k]&&t.sources[k].staleFallback);
    const confirmations=[];
    if(base.symbol||base.name_ar||base.price)confirmations.push('market-cache');
    if(price.allowed)confirmations.push('price-ok');
    if(volume.score>=55)confirmations.push(volume.source||'volume');
    if(liquidity.score>=55)confirmations.push(liquidity.source||'liquidity');
    if(supportResistance.score>=55)confirmations.push(supportResistance.source||'support-resistance');
    if(financial.score>=55&&financial.status!=='missing')confirmations.push('financial-ratios');
    if(newsRows.length)confirmations.push('news');
    let score=0,evidence=[];
    if(base.symbol||base.name_ar||base.price){score+=10;evidence.push('سوق داخلي')}
    score+=price.score*0.22; if(price.allowed)evidence.push('سعر آمن'); else evidence.push('سعر غير آمن');
    score+=volume.score*0.15; if(volume.status!=='missing')evidence.push(volume.source||'Volume');
    score+=liquidity.score*0.17; if(liquidity.status!=='missing')evidence.push(liquidity.source||'Liquidity');
    score+=supportResistance.score*0.18; if(supportResistance.status!=='missing')evidence.push(supportResistance.source||'Support/Resistance');
    score+=financial.score*0.08; if(financial.status!=='missing')evidence.push('Financial Ratios');
    score+=Math.min(10,confirmations.length*1.7);
    if(newsRows.length){score+=4;evidence.push('أخبار مرتبطة')}
    if(staleSources.length)score-=Math.min(8,staleSources.length*3);
    score=clamp(score);
    const blocks=[]; if(!price.allowed)blocks.push(price.reason); if(staleSources.length)blocks.push('بعض أدلة مباشر من قراءة سابقة');
    const confirmationCount=Array.from(new Set(confirmations)).length;
    let finalDataDecision='Watch Only', level='watch', executionAllowed=false;
    if(!price.allowed){finalDataDecision='Blocked'; level='blocked'}
    else if(score>=68 && confirmationCount>=4){finalDataDecision='Executable Review'; level='ok'; executionAllowed=true}
    else if(score>=50 && confirmationCount>=3){finalDataDecision='Watch Only'; level='watch'}
    else {finalDataDecision='Insufficient Evidence'; level='warn'; blocks.push('ضعف أدلة المصادر')}
    const reason=`قوة الدليل ${score}% — ${evidence.join(' + ')||'لا توجد أدلة كافية'} | تأكيدات ${confirmationCount}${blocks.length?' | قيود: '+blocks.join('، '):''}`;
    return {symbol,name:base.name_ar||base.name_en||base.name||t.name||symbol,price:p,sourceStrengthScore:score,finalDataDecision,level,executionAllowed,priceStatus:price.status,priceReason:price.reason,volume,liquidity,supportResistance,financial,newsCount:newsRows.length,sources:externalSources,staleSources,confirmationCount,confirmationSources:Array.from(new Set(confirmations)),coverageMode:'v9_4_external_plus_market_cache',reason,blocks:blocks.map(safeText)};
  }).sort((a,b)=>b.sourceStrengthScore-a.sourceStrengthScore||a.symbol.localeCompare(b.symbol));
  const sourcesOk=tools.summary?.sourcesOk||0; const staleFallbackSources=tools.summary?.staleFallbackSources||0; const currentSourcesOk=(tools.summary?.currentSourcesOk!=null)?tools.summary.currentSourcesOk:Math.max(0,sourcesOk-staleFallbackSources);
  const summary={total:rows.length, executable:rows.filter(r=>r.executionAllowed).length, watchOnly:rows.filter(r=>r.level==='watch').length, blocked:rows.filter(r=>r.level==='blocked').length, insufficient:rows.filter(r=>r.level==='warn').length, avgScore:Math.round(rows.reduce((s,r)=>s+r.sourceStrengthScore,0)/Math.max(1,rows.length)),avgConfirmationCount:Number((rows.reduce((s,r)=>s+(r.confirmationCount||0),0)/Math.max(1,rows.length)).toFixed(1)),sourcesOk,currentSourcesOk,staleFallbackSources,marketCacheBoosted:rows.filter(r=>(r.confirmationSources||[]).some(x=>/^Market Cache|market-cache/.test(x))).length};
  const health=sourceHealth(tools,totalUniverse);
  const report={ok:true,engine:'v9_4_evidence_coverage_booster',generatedAt:RUN_AT,summary,sourceHealth:health,rows,note:'V9.4 uses external Mubasher delayed tools plus safe internal market-cache confirmations. It improves coverage without rewriting price, entry, target, stopLoss, or R/R.'};
  write('data/multi-source-intelligence.json',report);
  write('data/source-evidence-matrix.json',{ok:true,engine:'v9_4_source_evidence_matrix',generatedAt:RUN_AT,summary,sourceHealth:health,rows:rows.map(r=>({symbol:r.symbol,name:r.name,score:r.sourceStrengthScore,decision:r.finalDataDecision,price:r.priceStatus,priceReason:r.priceReason,volume:r.volume.status,liquidity:r.liquidity.status,supportResistance:r.supportResistance.status,financial:r.financial.status,newsCount:r.newsCount,sources:r.sources,confirmationCount:r.confirmationCount,confirmationSources:r.confirmationSources,staleSources:r.staleSources,reason:r.reason}))});
  console.log('V9.4 evidence coverage booster', summary);
}
main();
