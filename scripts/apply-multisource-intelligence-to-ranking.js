#!/usr/bin/env node
/*
  EGX Pro Hub V9.1 — Apply Source Evidence Gate
  Non-invasive: never recalculates price, entry, target, stopLoss or R/R.
  It only downgrades grade/probability/score or blocks execution if source evidence is weak.
*/
const fs=require('fs'), path=require('path');
const RUN_AT=new Date().toISOString();
function read(f,d){try{return JSON.parse(fs.readFileSync(f,'utf8'))}catch{return d}}
function write(f,o){fs.mkdirSync(path.dirname(f),{recursive:true});fs.writeFileSync(f,JSON.stringify(o,null,2)+'\n','utf8')}
function sym(v){return String(v||'').toUpperCase().replace(/[^A-Z0-9.]/g,'').trim()}
function n(v){const x=Number(String(v??'').replace(/[,%٬،]/g,''));return Number.isFinite(x)?x:0}
function gradeRank(g){return {P1:4,P2:3,P3:2,Watch:1,Blocked:0}[g]??1}
function unique(a){return Array.from(new Set((a||[]).filter(Boolean)))}
function lower(v){return String(v||'').toLowerCase()}
function preservePlan(r){
  return {
    price:r.price, priceDisplay:r.priceDisplay,
    entryFrom:r.entryFrom, entryTo:r.entryTo,
    target1:r.target1, target2:r.target2,
    stopLoss:r.stopLoss,
    support1:r.support1, resistance1:r.resistance1,
    rr:r.rr, riskReward:r.riskReward,
    potentialProfitPct:r.potentialProfitPct, expectedReturnPct:r.expectedReturnPct
  };
}
function main(){
  const ranking=read('data/final-opportunity-ranking.json',{}), intel=read('data/multi-source-intelligence.json',{});
  const im={}; (intel.rows||[]).forEach(x=>im[sym(x.symbol)]=x);
  const baseRows=Array.isArray(ranking.rows)?ranking.rows:[];
  const rows=baseRows.map(r=>{
    const key=sym(r.symbol), e=im[key]||{}, before=preservePlan(r);
    const blocks=[...(Array.isArray(r.blocks)?r.blocks:[])];
    let grade=String(r.grade||'Watch'), prob=n(r.targetProbability||r.probability), score=n(r.finalScore||r.score), executionAllowed=(r.executionAllowed!==false && grade!=='Blocked');
    const dataScore=(e.sourceStrengthScore==null||e.sourceStrengthScore==='')?null:n(e.sourceStrengthScore);
    const decision=String(e.finalDataDecision||e.decision||'Not Available');
    if(e.level==='blocked'||/blocked/i.test(decision)||lower(e.priceStatus).includes('blocked')||lower(e.priceStatus).includes('conflict')){
      blocks.push(e.priceReason||'محجوب من بوابة مصادر البيانات'); grade='Blocked'; prob=Math.min(prob||35,35); score=Math.min(score||35,35); executionAllowed=false;
    }else if(dataScore!=null && dataScore<45){
      blocks.push('ضعف أدلة المصادر'); if(grade==='P1'||grade==='P2')grade='Watch'; prob=Math.min(prob||55,55); score=Math.min(score||55,55); executionAllowed=false;
    }else if(dataScore!=null && dataScore<60){
      blocks.push('أدلة مصادر غير كافية للتنفيذ'); if(grade==='P1')grade='P2'; score=Math.min(score||70,70); executionAllowed=false;
    }
    if(e.liquidity && /weak|negative|out|ضعيف/i.test(String(e.liquidity.status||e.liquidity))){blocks.push('السيولة لا تؤكد التوصية'); if(grade==='P1')grade='P2'}
    if(e.volume && /weak|ضعيف/i.test(String(e.volume.status||e.volume))){blocks.push('حجم التداول لا يؤكد التوصية'); if(grade==='P1')grade='P2'}
    if(Array.isArray(e.staleSources)&&e.staleSources.length){blocks.push('بعض أدلة المصادر من قراءة سابقة')}
    const whyExtra=e.reason?` | أدلة V9.1: ${e.reason}`:'';
    const out={...r,...before,preSourceEvidenceGrade:r.grade||null,grade,targetProbability:Math.max(5,Math.round(prob||0)),finalScore:Math.max(0,Math.round(score||0)),sourceStrengthScore:dataScore,sourceEvidenceDecision:decision,multiSourceDecision:decision,executionAllowed:executionAllowed && grade!=='Blocked',evidenceSources:e.sources||[],staleEvidenceSources:e.staleSources||[],blocks:unique(blocks),why:String(r.why||r.reason||'')+whyExtra,sourceEvidenceAppliedAt:RUN_AT};
    // hard assertion: keep plan fields identical to the incoming ranking object
    Object.assign(out,before);
    return out;
  }).sort((a,b)=>gradeRank(b.grade)-gradeRank(a.grade)||(n(b.finalScore)-n(a.finalScore))||(n(b.targetProbability)-n(a.targetProbability)));
  const summary={p1:rows.filter(x=>x.grade==='P1').length,p2:rows.filter(x=>x.grade==='P2').length,p3:rows.filter(x=>x.grade==='P3').length,watch:rows.filter(x=>x.grade==='Watch').length,blocked:rows.filter(x=>x.grade==='Blocked').length,withSourceEvidence:rows.filter(x=>x.sourceStrengthScore!=null).length,avgSourceEvidence:Math.round(rows.reduce((s,x)=>s+(n(x.sourceStrengthScore)||0),0)/Math.max(1,rows.filter(x=>x.sourceStrengthScore!=null).length))};
  const enhanced={...ranking,ok:true,engine:'v9_1_source_evidence_gated_final_ranking',generatedAt:RUN_AT,total:rows.length,summary,rows,note:'V9.1 source evidence gate. It may downgrade or block recommendations, but it does not rewrite price, entry, target, stopLoss, or R/R.'};
  write('data/final-multisource-ranking.json',enhanced);
  write('data/final-opportunity-ranking.json',enhanced);
  console.log('V9.1 source evidence applied', summary);
}
main();
