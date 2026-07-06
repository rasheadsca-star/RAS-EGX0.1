/*
EGX Pro Hub V8.10.2 — Apply Multi-Source Intelligence to Ranking without losing trade plan
Applies data evidence gates to final ranking. The ranking engine may nominate; this gate decides if it is executable, watch-only, or blocked.
*/
const fs=require('fs'), path=require('path');
const RUN_AT=new Date().toISOString();
function read(f,d){try{return JSON.parse(fs.readFileSync(f,'utf8'))}catch{return d}}
function write(f,o){fs.mkdirSync(path.dirname(f),{recursive:true});fs.writeFileSync(f,JSON.stringify(o,null,2),'utf8')}
function sym(v){return String(v||'').toUpperCase().replace(/[^A-Z0-9.]/g,'').trim()}
function n(v){const x=Number(String(v??'').replace(/[,%٬،]/g,''));return Number.isFinite(x)?x:0}
function gradeRank(g){return {P1:4,P2:3,P3:2,Watch:1,Blocked:0}[g]??1}
function main(){
 const ranking=read('data/final-opportunity-ranking.json',{}), intel=read('data/multi-source-intelligence.json',{});
 const im={};(intel.rows||[]).forEach(x=>im[sym(x.symbol)]=x);
 const baseRows=Array.isArray(ranking.rows)?ranking.rows:[];
 const rows=baseRows.map(r=>{
   const key=sym(r.symbol), e=im[key]||{}, blocks=[...(Array.isArray(r.blocks)?r.blocks:[])];
   let grade=String(r.grade||'Watch'), prob=n(r.targetProbability||r.probability), score=n(r.finalScore||r.score), executable=true;
   const dataScore=n(e.sourceStrengthScore);
   if(e.level==='blocked'||e.executionAllowed===false&&/blocked/i.test(String(e.finalDataDecision||''))){blocks.push(e.priceReason||'محجوب من بوابة المصادر'); grade='Blocked'; prob=Math.min(prob,35); score=Math.min(score,35); executable=false;}
   else if(dataScore && dataScore<45){blocks.push('ضعف أدلة المصادر'); if(grade==='P1'||grade==='P2')grade='Watch'; prob=Math.min(prob,55); score=Math.min(score,55); executable=false;}
   else if(dataScore && dataScore<60){blocks.push('أدلة مصادر غير كافية للتنفيذ'); if(grade==='P1')grade='P2'; score=Math.min(score,70); executable=false;}
   if(e.liquidity&&/weak|negative|out/i.test(String(e.liquidity.status))){blocks.push('سيولة غير داعمة'); if(grade==='P1')grade='P2';}
   if(e.volume&&/weak/i.test(String(e.volume.status))){blocks.push('حجم تداول ضعيف'); if(grade==='P1')grade='P2';}
   const whyExtra=e.reason?` | أدلة المصادر: ${e.reason}`:'';
   return {...r,preMultiSourceGrade:r.grade||null,grade,targetProbability:Math.max(5,Math.round(prob)),finalScore:Math.max(0,Math.round(score)),entryFrom:n(r.entryFrom),entryTo:n(r.entryTo),target1:n(r.target1),target2:n(r.target2),stopLoss:n(r.stopLoss),support1:n(r.support1),resistance1:n(r.resistance1),sourceStrengthScore:(e.sourceStrengthScore==null?null:dataScore),multiSourceDecision:e.finalDataDecision||'Not Available',executionAllowed:executable && grade!=='Blocked',evidenceSources:e.sources||[],blocks:Array.from(new Set(blocks.filter(Boolean))),why:String(r.why||r.reason||'')+whyExtra};
 }).sort((a,b)=>gradeRank(b.grade)-gradeRank(a.grade)||(n(b.finalScore)-n(a.finalScore))||(n(b.targetProbability)-n(a.targetProbability)));
 const summary={p1:rows.filter(x=>x.grade==='P1').length,p2:rows.filter(x=>x.grade==='P2').length,p3:rows.filter(x=>x.grade==='P3').length,watch:rows.filter(x=>x.grade==='Watch').length,blocked:rows.filter(x=>x.grade==='Blocked').length,withSourceEvidence:rows.filter(x=>x.sourceStrengthScore!=null).length};
 const enhanced={...ranking,ok:true,engine:'v8_10_2_multisource_enhanced_final_opportunity_ranking_plan_safe',generatedAt:RUN_AT,total:rows.length,summary,rows,note:'Final ranking after Multi-Source Intelligence Gate. Data evidence can downgrade or block weak/unsafe recommendations.'};
 write('data/final-multisource-ranking.json',enhanced);
 write('data/final-opportunity-ranking.json',enhanced);
 console.log('Applied multi-source ranking gate', summary);
}
main();
