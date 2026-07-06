#!/usr/bin/env node
/*
  EGX Pro Hub V9.5 — Safety Governor + Evidence Coverage Booster + Risk-Return Classifier
  Rules:
  1) Never rewrites price, entry, target, stopLoss, or R/R.
  2) Uses stronger evidence from V9.4 to increase confirmed symbols.
  3) Low R/R no longer marks a stock as data-blocked; it becomes WATCH_ONLY unless the plan is invalid.
*/
const fs=require('fs'), path=require('path');
const RUN_AT=new Date().toISOString();
function read(f,d){try{return JSON.parse(fs.readFileSync(f,'utf8'))}catch{return d}}
function write(f,o){fs.mkdirSync(path.dirname(f),{recursive:true});fs.writeFileSync(f,JSON.stringify(o,null,2)+'\n','utf8')}
function sym(v){return String(v||'').toUpperCase().replace(/[^A-Z0-9.]/g,'').trim()}
function n(v){const x=Number(String(v??'').replace(/[,%٬،]/g,''));return Number.isFinite(x)?x:0}
function finite(v){const x=n(v);return Number.isFinite(x)?x:null}
function gradeRank(g){return {P1:4,P2:3,P3:2,Watch:1,Blocked:0}[g]??1}
function statusRank(s){return {EXECUTABLE_REVIEW:4,WATCH_ONLY:2,BLOCKED:0}[s]??1}
function unique(a){return Array.from(new Set((a||[]).filter(Boolean)))}
function lower(v){return String(v||'').toLowerCase()}
function preservePlan(r){return {price:r.price,priceDisplay:r.priceDisplay,entryFrom:r.entryFrom,entryTo:r.entryTo,target1:r.target1,target2:r.target2,stopLoss:r.stopLoss,support1:r.support1,resistance1:r.resistance1,rr:r.rr,riskReward:r.riskReward,potentialProfitPct:r.potentialProfitPct,expectedReturnPct:r.expectedReturnPct}}
function decs(v){const s=String(v??'').trim();const m=s.match(/\.(\d+)/);return m?m[1].length:0}

function entryMid(r){const e1=finite(r.entryFrom), e2=finite(r.entryTo), p=finite(r.price); if(e1&&e2)return (e1+e2)/2; return e2||e1||p||0}
function expectedReturn(r){const e=entryMid(r), t=finite(r.target1); return e&&t?((t-e)/e*100):0}
function extendedReturn(r){const e=entryMid(r), t=finite(r.target2)||finite(r.target1); return e&&t?((t-e)/e*100):0}
function lossToStop(r){const e=entryMid(r), s=finite(r.stopLoss); return e&&s?Math.max(0,(e-s)/e*100):0}
function riskReturnClass(r,e,g){
  const p=finite(r.price)||0, loss=lossToStop(r), rr=finite(r.rr??r.riskReward)||0, ch=Math.abs(finite(r.changePct)||0), ev=evidenceScore(e), val=finite(r.valueTraded)||0, vol=finite(r.volume)||0;
  let score=25;
  if(loss>12)score+=24; else if(loss>8)score+=16; else if(loss>5)score+=9; else if(loss>0&&loss<3)score-=4;
  if(rr<0.65)score+=18; else if(rr<1)score+=8; else if(rr>=1.8)score-=6;
  if(ch>8)score+=20; else if(ch>5)score+=12; else if(ch>3)score+=6;
  if(p>0&&p<1)score+=14; else if(p>0&&p<2)score+=8;
  if(val&&val<1000000)score+=10; else if(val>15000000)score-=6;
  if(vol&&vol<250000)score+=5;
  if(ev&&ev<55)score+=14; else if(ev>=75)score-=8;
  if(g&&g.status==='BLOCKED')score+=34; else if(g&&g.status==='WATCH_ONLY')score+=8; else if(g&&g.status==='EXECUTABLE_REVIEW')score-=8;
  score=Math.max(0,Math.min(100,Math.round(score)));
  let level='LOW', label='منخفضة المخاطر';
  if(score>=78){level='VERY_HIGH';label='عالية جدًا / مضاربية'} else if(score>=58){level='HIGH';label='عالية المخاطر'} else if(score>=36){level='MEDIUM';label='متوسطة المخاطر'}
  const er=expectedReturn(r), xr=extendedReturn(r);
  let type='Balanced';
  if(g&&g.status==='BLOCKED')type='Blocked / No Execution';
  else if(er>=12||xr>=18)type=(level==='LOW'||level==='MEDIUM')?'High Return Candidate':'High Return / High Risk';
  else if(er>=6)type=(level==='LOW')?'Balanced Growth':'Medium Risk Return';
  else if(er>=2)type=(level==='LOW')?'Conservative Opportunity':'Limited Return / Watch';
  else type='Weak Return';
  return {riskScore:score,riskLevel:level,riskLabel:label,riskReturnType:type,expectedReturnPctCalc:er,extendedReturnPctCalc:xr,lossToStopPct:loss};
}

function planCheck(r){
  const p=finite(r.price), e1=finite(r.entryFrom), e2=finite(r.entryTo), t1=finite(r.target1), sl=finite(r.stopLoss);
  const rr=finite(r.rr??r.riskReward);
  const out={ok:true,critical:[],nonExecution:[],warnings:[],rr:rr||0};
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
  else if(rr<0.45){out.ok=false;out.critical.push('R/R شديد الضعف')}
  else if(rr<0.85){out.nonExecution.push('R/R أقل من حد التنفيذ لكنه صالح للمراقبة')}
  else if(rr>12){out.ok=false;out.critical.push('R/R غير منطقي ويحتاج مراجعة')}
  const pot=finite(r.potentialProfitPct); if(pot!=null && pot>80){out.warnings.push('ربح هدف1 كبير بشكل غير معتاد')}
  return out;
}
function evidenceTextStatus(e){return String(e.finalDataDecision||e.decision||e.level||'')}
function evidenceScore(e){const x=finite(e.sourceStrengthScore??e.score??e.evidenceScore);return x==null?0:x}
function evidenceConfirmations(e){return finite(e.confirmationCount)||((Array.isArray(e.confirmationSources)?e.confirmationSources.length:0))||0}
function sourceWeak(e){const s=lower([e.finalDataDecision,e.decision,e.level,e.priceStatus,e.reason].join(' '));return /blocked|failed|conflict|ضعيف|محجوب|تعارض/.test(s)}
function safetyFor(r,e){
  const before=preservePlan(r), blocks=[...(Array.isArray(r.blocks)?r.blocks:[])], warnings=[], nonExecution=[];
  const pc=planCheck(r); blocks.push(...pc.critical); warnings.push(...pc.warnings); nonExecution.push(...pc.nonExecution);
  const evScore=evidenceScore(e);
  const confCount=evidenceConfirmations(e);
  const evDecision=evidenceTextStatus(e)||'Not Available';
  const priceState=lower([r.priceState,r.priceStatus,e.priceStatus].join(' '));
  const originalGrade=String(r.grade||'Watch');
  const prob=n(r.targetProbability||r.probability||r.finalConfidence);
  const score=n(r.finalScore||r.score||prob);
  const exp=finite(r.expectedReturnPct)||0;
  const pot=finite(r.potentialProfitPct)||0;
  const rr=finite(r.rr??r.riskReward)||0;
  if(originalGrade==='Blocked')warnings.push('التصنيف الأصلي كان محجوبًا قبل إعادة التحقق');
  if(r.executionAllowed===false)warnings.push('التنفيذ الأصلي غير مسموح');
  if(/bad|conflict|precision_risk|دقة|تعارض/.test(priceState))blocks.push('السعر غير آمن أو متعارض');
  if(sourceWeak(e))warnings.push('قرار المصادر لا يؤكد التنفيذ الكامل');
  if(evScore && evScore<45)blocks.push('قوة أدلة المصادر منخفضة جدًا');
  else if(evScore && evScore<62)nonExecution.push('قوة أدلة المصادر أقل من حد التنفيذ');
  else if(evScore && evScore<72)warnings.push('قوة أدلة المصادر متوسطة فقط');
  if(confCount && confCount<3)nonExecution.push('عدد التأكيدات أقل من المطلوب للتنفيذ');
  if(exp<0)blocks.push('العائد المتوقع سلبي');
  if(pot<=0)blocks.push('لا يوجد ربح هدف واضح');
  if(lower(r.recommendation||r.signal).includes('risk')||String(r.recommendation||'').includes('تخفيف'))blocks.push('إشارة مخاطر أو تخفيف');
  let safetyScore=Math.round(score);
  if(evScore) safetyScore=Math.round(safetyScore*.64+evScore*.36);
  if(confCount>=4)safetyScore+=3;
  if(warnings.length)safetyScore-=Math.min(10,warnings.length*3);
  if(nonExecution.length)safetyScore-=Math.min(14,nonExecution.length*5);
  if(blocks.length)safetyScore-=Math.min(48,blocks.length*11);
  safetyScore=Math.max(0,Math.min(100,safetyScore));
  let grade='Watch', status='WATCH_ONLY', executionAllowed=false;
  if(blocks.length){grade='Blocked';status='BLOCKED'}
  else if(!nonExecution.length && safetyScore>=82 && prob>=78 && evScore>=72 && confCount>=4 && rr>=1 && exp>0 && pot>0){grade='P1';status='EXECUTABLE_REVIEW';executionAllowed=true}
  else if(!nonExecution.length && safetyScore>=74 && prob>=68 && evScore>=65 && confCount>=4 && rr>=0.85 && exp>=0 && pot>0){grade='P2';status='EXECUTABLE_REVIEW';executionAllowed=true}
  else if(safetyScore>=60){grade='P3';status='WATCH_ONLY'}
  return {before,originalGrade,grade,status,executionAllowed,safetyScore,blocks:unique(blocks),nonExecution:unique(nonExecution),warnings:unique(warnings),evScore,evDecision,confirmationCount:confCount};
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
    const rrClass=riskReturnClass(r,e,g);
    const extra=[`حاكم V9.4: ${g.status}`,`Safety ${g.safetyScore}%`,`Evidence ${g.evScore||0}%`,`Confirmations ${g.confirmationCount||0}`];
    if(g.blocks.length)extra.push('قيود: '+g.blocks.join('، '));
    if(g.nonExecution.length)extra.push('غير تنفيذي الآن: '+g.nonExecution.join('، '));
    if(g.warnings.length)extra.push('ملاحظات: '+g.warnings.join('، '));
    const whyExtra=' | '+extra.join(' | ');
    const out={...r,...g.before,preSafetyGrade:r.grade||null,grade:g.grade,targetProbability:Math.max(5,Math.round(n(r.targetProbability||r.probability)||0)),finalScore:g.safetyScore,safetyGovernorStatus:g.status,safetyGovernorScore:g.safetyScore,safetyGovernorDecision:g.grade,safetyBlocks:g.blocks,safetyNonExecution:g.nonExecution,safetyWarnings:g.warnings,sourceStrengthScore:g.evScore||r.sourceStrengthScore,sourceEvidenceDecision:g.evDecision,sourceConfirmationCount:g.confirmationCount,riskScore:rrClass.riskScore,riskLevel:rrClass.riskLevel,riskLabel:rrClass.riskLabel,riskReturnType:rrClass.riskReturnType,expectedReturnPctCalc:rrClass.expectedReturnPctCalc,extendedReturnPctCalc:rrClass.extendedReturnPctCalc,lossToStopPct:rrClass.lossToStopPct,executionAllowed:g.executionAllowed,why:String(r.why||r.reason||'')+whyExtra,recommendationSafetyAppliedAt:RUN_AT,recommendationSafetyEngine:'v9_5_safety_coverage_risk_return'};
    Object.assign(out,g.before);
    safetyRows.push({symbol:key,name:r.name||r.name_ar||r.name_en||'',previousGrade:g.originalGrade,finalGrade:g.grade,status:g.status,score:g.safetyScore,executionAllowed:g.executionAllowed,sourceStrengthScore:g.evScore,confirmationCount:g.confirmationCount,sourceEvidenceDecision:g.evDecision,blocks:g.blocks,nonExecution:g.nonExecution,warnings:g.warnings,price:r.price,entryFrom:r.entryFrom,entryTo:r.entryTo,target1:r.target1,stopLoss:r.stopLoss,rr:r.rr??r.riskReward,expectedReturnPct:r.expectedReturnPct,potentialProfitPct:r.potentialProfitPct,riskScore:rrClass.riskScore,riskLevel:rrClass.riskLevel,riskLabel:rrClass.riskLabel,riskReturnType:rrClass.riskReturnType,expectedReturnPctCalc:rrClass.expectedReturnPctCalc,extendedReturnPctCalc:rrClass.extendedReturnPctCalc,lossToStopPct:rrClass.lossToStopPct});
    return out;
  }).sort((a,b)=>statusRank(b.safetyGovernorStatus)-statusRank(a.safetyGovernorStatus)||gradeRank(b.grade)-gradeRank(a.grade)||(n(b.finalScore)-n(a.finalScore))||(n(b.targetProbability)-n(a.targetProbability)));
  const summary={p1:rows.filter(x=>x.grade==='P1').length,p2:rows.filter(x=>x.grade==='P2').length,p3:rows.filter(x=>x.grade==='P3').length,watch:rows.filter(x=>x.grade==='Watch').length,blocked:rows.filter(x=>x.grade==='Blocked').length,executable:rows.filter(x=>x.executionAllowed).length,watchOnly:rows.filter(x=>x.safetyGovernorStatus==='WATCH_ONLY').length,avgSafetyScore:Math.round(safetyRows.reduce((s,x)=>s+(n(x.score)||0),0)/Math.max(1,safetyRows.length)),avgSourceStrength:Math.round(safetyRows.reduce((s,x)=>s+(n(x.sourceStrengthScore)||0),0)/Math.max(1,safetyRows.length)),avgConfirmationCount:Number((safetyRows.reduce((s,x)=>s+(n(x.confirmationCount)||0),0)/Math.max(1,safetyRows.length)).toFixed(1)),withSafetyRows:safetyRows.length,lowRisk:safetyRows.filter(x=>x.riskLevel==='LOW').length,mediumRisk:safetyRows.filter(x=>x.riskLevel==='MEDIUM').length,highRisk:safetyRows.filter(x=>x.riskLevel==='HIGH'||x.riskLevel==='VERY_HIGH').length};
  const enhanced={...ranking,ok:true,engine:'v9_5_recommendation_safety_coverage_risk_return',generatedAt:RUN_AT,total:rows.length,summary,rows,note:'V9.5 boosts evidence coverage and classifies risk-return and classifies low R/R as watch-only when the plan is valid; it never rewrites price, entry, target, stopLoss, or R/R.'};
  write('data/recommendation-safety-governor.json',{ok:true,engine:'v9_5_recommendation_safety_coverage_risk_return',generatedAt:RUN_AT,summary,rows:safetyRows});
  write('data/final-multisource-ranking.json',enhanced);
  write('data/final-opportunity-ranking.json',enhanced);
  console.log('V9.4 safety coverage booster applied', summary);
}
main();
