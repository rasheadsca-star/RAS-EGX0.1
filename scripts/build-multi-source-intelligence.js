/*
EGX Pro Hub V8.10.1 — Multi-Source Intelligence Builder
Builds a per-symbol evidence matrix from Mubasher tools + local market/recommendation data + price audit + news.
*/
const fs=require('fs'), path=require('path');
const RUN_AT=new Date().toISOString();
function read(f,d){try{return JSON.parse(fs.readFileSync(f,'utf8'))}catch{return d}}
function write(f,o){fs.mkdirSync(path.dirname(f),{recursive:true});fs.writeFileSync(f,JSON.stringify(o,null,2),'utf8')}
function n(v){if(v==null||v==='')return null;let s=String(v).replace(/[,%٬،]/g,'').replace(/−/g,'-').trim();let mult=1;if(/[Kk]$/.test(s)){mult=1e3;s=s.slice(0,-1)}if(/[Mm]$/.test(s)){mult=1e6;s=s.slice(0,-1)}if(/[Bb]$/.test(s)){mult=1e9;s=s.slice(0,-1)}s=s.replace(/[^0-9.+\-eE]/g,'');const x=Number(s);return Number.isFinite(x)?x*mult:null}
function sym(v){return String(v||'').toUpperCase().replace(/[^A-Z0-9.]/g,'').trim()}
function rowsOf(x){if(Array.isArray(x))return x;if(Array.isArray(x?.rows))return x.rows;if(Array.isArray(x?.all))return x.all;return[]}
function mapRows(rows){const m={};(rows||[]).forEach(r=>{const k=sym(r.symbol);if(k&&!m[k])m[k]=r});return m}
function latestNewsFor(symbol, news){const items=Array.isArray(news.items)?news.items:[];return items.filter(x=>sym(x.symbol)===symbol).slice(0,5)}
function sourceNums(src){return (src&&Array.isArray(src.numeric)?src.numeric:[]).map(x=>({raw:x.raw,value:n(x.value??x.raw),isPercent:!!x.isPercent})).filter(x=>x.value!=null)}
function percentMax(nums){const p=nums.filter(x=>x.isPercent).map(x=>x.value);return p.length?Math.max(...p):null}
function inferVolume(src){if(!src)return {status:'missing',score:0,headline:'غير متاح'};const nums=sourceNums(src), p=percentMax(nums);let score=55,status='neutral',headline='بيانات حجم متاحة';if(p!=null){if(p>=50){score=92;status='strong';headline='ارتفاع واضح في الحجم'}else if(p>=20){score=78;status='good';headline='حجم أعلى من المتوسط'}else if(p<=-25){score=25;status='weak';headline='حجم أقل من المتوسط'}else{score=58;status='neutral';headline='حجم قريب من المتوسط'}}return{status,score,headline,percentChange:p,source:'Mubasher Volume Monitor'}}
function inferLiquidity(src){if(!src)return {status:'missing',score:0,headline:'غير متاح'};const nums=sourceNums(src);let score=55,status='neutral',headline='بيانات سيولة متاحة';const vals=nums.map(x=>x.value).filter(x=>Math.abs(x)>1000);if(vals.length>=2){const a=vals[vals.length-2], b=vals[vals.length-1];const hi=Math.max(a,b), lo=Math.min(a,b);if(hi>lo*1.2){score=72;status='good';headline='اتجاه سيولة يحتاج مراجعة من الجدول'}else{score=58;status='neutral';headline='سيولة متوازنة تقريبًا'}}return{status,score,headline,source:'Mubasher Liquidity Monitor'}}
function inferSR(src, price){if(!src)return {status:'missing',score:0,headline:'غير متاح'};const nums=sourceNums(src).map(x=>x.value).filter(x=>x>0);let score=60,status='available',headline='دعم ومقاومة متاحة';if(price&&nums.length){const below=nums.filter(x=>x<price).sort((a,b)=>b-a)[0];const above=nums.filter(x=>x>price).sort((a,b)=>a-b)[0];const distSup=below?(price-below)/price*100:null, distRes=above?(above-price)/price*100:null;if(distSup!=null && distSup<1.2){score+=10;headline='قريب من دعم'} if(distRes!=null && distRes<1){score-=10;headline='قريب من مقاومة'} if(distSup!=null && distSup>8){score-=8;headline='بعيد عن الدعم'} return{status,score:Math.max(20,Math.min(90,score)),headline,nearestSupport:below||null,nearestResistance:above||null,distanceToSupportPct:distSup==null?null:Number(distSup.toFixed(2)),distanceToResistancePct:distRes==null?null:Number(distRes.toFixed(2)),source:'Mubasher Support & Resistance'}}return{status,score,headline,source:'Mubasher Support & Resistance'}}
function inferFundamental(src){if(!src)return {status:'missing',score:0,headline:'غير متاح'};const nums=sourceNums(src), pe=nums.find(x=>x.value>0&&x.value<200)?.value;let score=62,status='available',headline='مؤشرات مالية متاحة';if(pe!=null){if(pe>0&&pe<8){score=72;headline='تقييم منخفض نسبيًا'}else if(pe>35){score=42;headline='مضاعف ربحية مرتفع أو يحتاج مراجعة'}else{score=60;headline='مؤشرات مالية متوسطة'}}return{status,score,headline,source:'Mubasher Financial Ratios',sampleRatio:pe??null}}
function priceAuditFor(symbol, audits){let rows=rowsOf(audits);return rows.find(x=>sym(x.symbol)===symbol)||{} }
function priceAllowed(row,audit){const p=n(audit.finalPrice??audit.price??row.price);const state=String(audit.executionState||audit.status||audit.priceStatus||'').toLowerCase();const reason=String(audit.reason||audit.note||'');const precisionRisk=!!audit.precisionRisk || /precision|دقة سعر|غير كاف/i.test(reason) || (p!=null && p<1 && /^\d+\.\d0+$/.test(String(p.toFixed(3))));if(/blocked|reject|محجوب|غير صالح/.test(state)||precisionRisk)return {allowed:false,status:'blocked',reason:precisionRisk?'دقة السعر غير كافية':reason||'السعر غير صالح للتنفيذ'};return {allowed:true,status:'ok',reason:'السعر مقبول مبدئيًا'} }
function main(){
 const rec=read('data/recommendations.json',{}), market=read('data/market.json',{}), cache=read('data/full-market-cache.json',{}), ranking=read('data/final-opportunity-ranking.json',{}), tools=read('data/mubasher-analysis-tools.json',{}), priceAudit=read('data/price-source-audit.json',read('data/price-reconciliation-report.json',{})), news=read('data/news-intelligence.json',{});
 const baseRows=[...rowsOf(rec),...rowsOf(market),...rowsOf(cache),...rowsOf(ranking)].filter(Boolean);
 const baseMap=mapRows(baseRows), toolMap={};(tools.symbols||[]).forEach(x=>{toolMap[sym(x.symbol)]=x});
 const allSymbols=Array.from(new Set([...Object.keys(baseMap),...Object.keys(toolMap)])).filter(Boolean).sort();
 const rows=allSymbols.map(symbol=>{
   const base=baseMap[symbol]||{}, t=toolMap[symbol]||{sources:{}}, audit=priceAuditFor(symbol,priceAudit), p=n(audit.finalPrice??audit.price??base.price), price=priceAllowed({...base,price:p},audit), vol=inferVolume(t.sources.volume), liq=inferLiquidity(t.sources.liquidity), sr=inferSR(t.sources.supportResistance,p), fun=inferFundamental(t.sources.financialRatios), newsRows=latestNewsFor(symbol,news);
   let score=0, evidence=[];
   if(base.symbol){score+=10;evidence.push('بيانات سوق/توصية داخلية')}
   if(price.allowed){score+=22;evidence.push('سعر قابل للتنفيذ مبدئيًا')}else evidence.push('السعر محجوب')
   if(t.sources.volume){score+=14;evidence.push('Volume Monitor')} if(t.sources.liquidity){score+=14;evidence.push('Liquidity Monitor')} if(t.sources.supportResistance){score+=14;evidence.push('Support & Resistance')} if(t.sources.financialRatios){score+=10;evidence.push('Financial Ratios')} if(newsRows.length){score+=6;evidence.push('أخبار مرتبطة')} if((market.generatedAt||cache.generatedAt||ranking.generatedAt))score+=5;
   score += Math.max(-10, Math.min(10, (vol.score-55)/5)); score += Math.max(-8, Math.min(8, (liq.score-55)/6)); score += Math.max(-7, Math.min(7, (sr.score-55)/7)); score += Math.max(-5, Math.min(5, (fun.score-55)/10));
   score=Math.max(0,Math.min(100,Math.round(score)));
   let decision='Watch Only', level='watch', blocks=[];
   if(!price.allowed){decision='Blocked';level='blocked';blocks.push(price.reason)}
   else if(score>=75){decision='Executable Review';level='ok'}
   else if(score>=55){decision='Watch Only';level='watch'}
   else {decision='Insufficient Evidence';level='warn';blocks.push('ضعف أدلة المصادر')}
   const reason=`قوة البيانات ${score}% — ${evidence.join(' + ')||'لا توجد أدلة كافية'}${blocks.length?' | قيود: '+blocks.join('، '):''}`;
   return {symbol,name:base.name_ar||base.name_en||base.name||t.name||symbol,price:p,sourceStrengthScore:score,finalDataDecision:decision,level,executionAllowed:level==='ok',priceStatus:price.status,priceReason:price.reason,volume:vol,liquidity:liq,supportResistance:sr,financial:fun,newsCount:newsRows.length,sources:Object.keys(t.sources||{}),reason,blocks};
 }).sort((a,b)=>b.sourceStrengthScore-a.sourceStrengthScore||a.symbol.localeCompare(b.symbol));
 const summary={total:rows.length, executable:rows.filter(r=>r.executionAllowed).length, watchOnly:rows.filter(r=>r.level==='watch').length, blocked:rows.filter(r=>r.level==='blocked').length, insufficient:rows.filter(r=>r.level==='warn').length, avgScore:Math.round(rows.reduce((s,r)=>s+r.sourceStrengthScore,0)/Math.max(1,rows.length)), sourcesOk:tools.summary?.sourcesOk||0};
 const report={ok:true,engine:'v8_10_1_multi_source_intelligence',generatedAt:RUN_AT,summary,rows,note:'Evidence layer combines Mubasher analysis tools, price audit, local market data, recommendations and news. Public delayed data; not live execution feed.'};
 write('data/multi-source-intelligence.json',report);
 write('data/source-evidence-matrix.json',{ok:true,engine:'v8_10_1_source_evidence_matrix',generatedAt:RUN_AT,summary,rows:rows.map(r=>({symbol:r.symbol,name:r.name,score:r.sourceStrengthScore,decision:r.finalDataDecision,price:r.priceStatus,priceReason:r.priceReason,volume:r.volume.status,liquidity:r.liquidity.status,supportResistance:r.supportResistance.status,financial:r.financial.status,newsCount:r.newsCount,sources:r.sources,reason:r.reason}))});
 console.log('Multi-source intelligence', summary);
}
main();
