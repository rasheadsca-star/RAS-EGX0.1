#!/usr/bin/env node
/*
  EGX Pro Hub V9.2 — Recommendation Safety Governor
  Final hard gate after source evidence.
  It NEVER rewrites price, entry, target, stopLoss, or R/R.
  It only downgrades/blocks unsafe recommendations and writes a safety report.
*/
const fs=require('fs'), path=require('path');
const RUN_AT=new Date().toISOString();
function read(f,d){try{return JSON.parse(fs.readFileSync(f,'utf8'))}catch{return d}}
function write(f,o){fs.mkdirSync(path.dirname(f),{recursive:true});fs.writeFileSync(f,JSON.stringify(o,null,2)+'\n','utf8')}
function sym(v){return String(v||'').toUpperCase().replace(/[^A-Z0-9.]/g,'').trim()}
function n(v){const x=Number(String(v??'').replace(/[,%٬،]/g,''));return Number.isFinite(x)?x:0}
function finite(v){const x=n(v);return Number.isFinite(x)?x:null}
function gradeRank(g){return {P1:4,P2:3,P3:2,Watch:1,Blocked:0}[g]??1}
function unique(a){return Array.from(new Set((a||[]).filter(Boolean)))}
function lower(v){return String(v||'').toLowerCase()}
function preservePlan(r){return {price:r.price,priceDisplay:r.priceDisplay,entryFrom:r.entryFrom,entryTo:r.entryTo,target1:r.target1,target2:r.target2,stopLoss:r.stopLoss,support1:r.support1,resistance1:r.resistance1,rr:r.rr,riskReward:r.riskReward,potentialProfitPct:r.potentialProfitPct,expectedReturnPct:r.expectedReturnPct}}
function decs(v){const s=String(v??'').trim();const m=s.match(/\.(\d+)/);return m?m[1].length:0}
function planCheck(r){
  const p=finite(r.price), e1=finite(r.entryFrom), e2=finite(r.entryTo), t1=finite(r.target1), sl=finite(r.stopLoss);
  const rr=finite(r.rr??r.riskReward);
  const out={ok:true,critical:[],warnings:[]};
  if(!p||p<=0){out.ok=false;out.critical.push('سعر غير صالح');return out}
  if(p<1){const d=Math.max(decs(r.price),decs(r.priceDisplay));if(d<3){out.ok=false;out.critical.push('سعر أقل من جنيه بدقة أقل من 3 خانات')}}
  if(!e1||!e2||e1<=0||e2<=0){out.ok=false;out.critical.push('منطقة دخول غير مكتملة')}
  else{
    if(e1>e2){out.ok=false;out.critical.push('منطقة الدخول مقلوبة')}
    if(e1<p*.70||e2>p*1.30){out.ok=false;out.critical.push('منطقة الدخول بعيدة جدًا عن السعر')}
  }
  if(!t1||t1<=p*1.005){out.ok=false;out.critical.push('هدف 1 لا يعطي هامش ربح كافٍ')}
  if(!sl||sl>=p*.998){out.ok=false;out.critical.push('وقف الخسارة غير صالح')}
  if(rr==null||!Number.isFinite(rr)){out.ok=false;out.critical.push('R/R غير قابل للحساب')}
  else if(rr<0.70){out.ok=false;out.critical.push('R/R أقل من الحد الأدنى')}
  else if(rr>12){out.ok=false;out.critical.push('R/R غير منطقي ويحتاج مراجعة')}
  const pot=finite(r.potentialProfitPct); if(pot!=null && pot>80){out.warnings.push('ربح هدف1 كبير بشكل غير معتاد')}
  return out;
}
function evidenceTextStatus(e){return String(e.finalDataDecision||e.decision||e.level||'')}
function evidenceScore(e){const x=finite(e.sourceStrengthScore??e.score??e.evidenceScore);return x==null?0:x}
function sourceWeak(e){const s=lower([e.finalDataDecision,e.decision,e.level,e.priceStatus,e.reason].join(' '));return /blocked|failed|conflict|watch only|ضعيف|محجوب|تعارض/.test(s)}
function safetyFor(r,e){
  const before=preservePlan(r), blocks=[...(Array.isArray(r.blocks)?r.blocks:[])], warnings=[];
  const pc=planCheck(r); blocks.push(...pc.critical); warnings.push(...pc.warnings);
  const evScore=evidenceScore(e);
  const evDecision=evidenceTextStatus(e)||'Not Available';
  const priceState=lower([r.priceState,r.priceStatus,e.priceStatus].join(' '));
  const originalGrade=String(r.grade||'Watch');
  const prob=n(r.targetProbability||r.probability||r.finalConfidence);
  const score=n(r.finalScore||r.score||prob);
  const exp=finite(r.expectedReturnPct)||0;
  const pot=finite(r.potentialProfitPct)||0;
  const rr=finite(r.rr??r.riskReward)||0;
  if(originalGrade==='Blocked')blocks.push('التصنيف الأصلي محجوب');
  if(r.executionAllowed===false)warnings.push('التنفيذ الأصلي غير مسموح');
  if(/bad|conflict|precision_risk|دقة|تعارض/.test(priceState))blocks.push('السعر غير آمن أو متعارض');
  if(sourceWeak(e))warnings.push('قرار المصادر لا يؤكد التنفيذ');
  if(evScore && evScore<55)blocks.push('قوة أدلة المصادر أقل من الحد الآمن');
  else if(evScore && evScore<70)warnings.push('قوة أدلة المصادر متوسطة فقط');
  if(exp<0)blocks.push('العائد المتوقع سلبي');
  if(pot<=0)blocks.push('لا يوجد ربح هدف واضح');
  if(lower(r.recommendation||r.signal).includes('risk')||String(r.recommendation||'').includes('تخفيف'))blocks.push('إشارة مخاطر أو تخفيف');
  let safetyScore=Math.round(score);
  if(evScore) safetyScore=Math.round(safetyScore*.72+evScore*.28);
  if(warnings.length)safetyScore-=Math.min(12,warnings.length*4);
  if(blocks.length)safetyScore-=Math.min(45,blocks.length*10);
  safetyScore=Math.max(0,Math.min(100,safetyScore));
  let grade='Watch', status='WATCH_ONLY', executionAllowed=false;
  if(blocks.length){grade='Blocked';status='BLOCKED'}
  else if(safetyScore>=82 && prob>=78 && evScore>=70 && rr>=1 && exp>0 && pot>0){grade='P1';status='EXECUTABLE_REVIEW';executionAllowed=true}
  else if(safetyScore>=72 && prob>=68 && evScore>=60 && rr>=0.85 && exp>=0 && pot>0){grade='P2';status='EXECUTABLE_REVIEW';executionAllowed=true}
  else if(safetyScore>=60){grade='P3';status='WATCH_ONLY'}
  else {grade='Watch';status='WATCH_ONLY'}
  return {before,originalGrade,grade,status,executionAllowed,safetyScore,blocks:unique(blocks),warnings:unique(warnings),evScore,evDecision};
}
function main(){
  const ranking=read('data/final-opportunity-ranking.json',{});
  const intel=read('data/multi-source-intelligence.json',{});
  const matrix=read('data/source-evidence-matrix.json',{});
  const im={}; [...(intel.rows||[]),...(matrix.rows||[])].forEach(x=>{const k=sym(x&&x.symbol);if(k)im[k]={...(im[k]||{}),...x}});
  const baseRows=Array.isArray(ranking.rows)?ranking.rows:[];
  const safetyRows=[];
  const rows=baseRows.map(r=>{
    const key=sym(r.symbol), e=im[key]||{};
    const g=safetyFor(r,e);
    const whyExtra=` | حاكم V9.2: ${g.status} | Safety ${g.safetyScore}%${g.blocks.length?' | قيود: '+g.blocks.join('، '):''}${g.warnings.length?' | ملاحظات: '+g.warnings.join('، '):''}`;
    const out={...r,...g.before,preSafetyGrade:r.grade||null,grade:g.grade,targetProbability:Math.max(5,Math.round(n(r.targetProbability||r.probability)||0)),finalScore:g.safetyScore,safetyGovernorStatus:g.status,safetyGovernorScore:g.safetyScore,safetyGovernorDecision:g.grade,safetyBlocks:g.blocks,safetyWarnings:g.warnings,sourceStrengthScore:g.evScore||r.sourceStrengthScore,sourceEvidenceDecision:g.evDecision,executionAllowed:g.executionAllowed,why:String(r.why||r.reason||'')+whyExtra,recommendationSafetyAppliedAt:RUN_AT};
    Object.assign(out,g.before);
    safetyRows.push({symbol:key,name:r.name||r.name_ar||r.name_en||'',previousGrade:g.originalGrade,finalGrade:g.grade,status:g.status,score:g.safetyScore,executionAllowed:g.executionAllowed,sourceStrengthScore:g.evScore,sourceEvidenceDecision:g.evDecision,blocks:g.blocks,warnings:g.warnings,price:r.price,entryFrom:r.entryFrom,entryTo:r.entryTo,target1:r.target1,stopLoss:r.stopLoss,rr:r.rr??r.riskReward,expectedReturnPct:r.expectedReturnPct,potentialProfitPct:r.potentialProfitPct});
    return out;
  }).sort((a,b)=>gradeRank(b.grade)-gradeRank(a.grade)||(n(b.finalScore)-n(a.finalScore))||(n(b.targetProbability)-n(a.targetProbability)));
  const summary={p1:rows.filter(x=>x.grade==='P1').length,p2:rows.filter(x=>x.grade==='P2').length,p3:rows.filter(x=>x.grade==='P3').length,watch:rows.filter(x=>x.grade==='Watch').length,blocked:rows.filter(x=>x.grade==='Blocked').length,executable:rows.filter(x=>x.executionAllowed).length,watchOnly:rows.filter(x=>x.safetyGovernorStatus==='WATCH_ONLY').length,avgSafetyScore:Math.round(safetyRows.reduce((s,x)=>s+(n(x.score)||0),0)/Math.max(1,safetyRows.length)),withSafetyRows:safetyRows.length};
  const enhanced={...ranking,ok:true,engine:'v9_2_recommendation_safety_governor',generatedAt:RUN_AT,total:rows.length,summary,rows,note:'V9.2 safety governor. It blocks or downgrades unsafe recommendations and does not rewrite price, entry, target, stopLoss, or R/R.'};
  write('data/recommendation-safety-governor.json',{ok:true,engine:'v9_2_recommendation_safety_governor',generatedAt:RUN_AT,summary,rows:safetyRows});
  write('data/final-multisource-ranking.json',enhanced);
  write('data/final-opportunity-ranking.json',enhanced);
  console.log('V9.2 recommendation safety governor applied', summary);
}
main();
