#!/usr/bin/env node
/* EGX Pro Hub V9.8 — Apply Evidence Coverage Loop to Ranking
   Non-invasive: never rewrites price, entry, target, stopLoss, or R/R. */
const fs=require('fs'), path=require('path');
const RUN_AT=new Date().toISOString();
function read(f,d){try{return JSON.parse(fs.readFileSync(f,'utf8'))}catch{return d}}
function write(f,o){fs.mkdirSync(path.dirname(f),{recursive:true});fs.writeFileSync(f,JSON.stringify(o,null,2)+'\n','utf8')}
function rowsOf(x){if(Array.isArray(x))return x;if(Array.isArray(x?.rows))return x.rows;if(Array.isArray(x?.all))return x.all;if(Array.isArray(x?.data))return x.data;return[]}
function sym(v){return String(v||'').toUpperCase().replace(/\.CA$/,'').replace(/[^A-Z0-9.]/g,'').trim()}
function num(v){if(v==null||v==='')return null;let s=String(v).replace(/[,%٬،]/g,'').replace(/−/g,'-').trim().replace(/[^0-9.+\-eE]/g,'');const n=Number(s);return Number.isFinite(n)?n:null}
function finite(v){const x=num(v);return x!=null&&Number.isFinite(x)?x:null}
function rrValue(r){const p=finite(r.price),t=finite(r.target1),sl=finite(r.stopLoss); if(!p||!t||!sl||p<=sl)return finite(r.rr??r.riskReward)||0; return (t-p)/(p-sl)}
function planValid(r){const p=finite(r.price),e1=finite(r.entryFrom),e2=finite(r.entryTo),t=finite(r.target1),sl=finite(r.stopLoss);return !!(p&&e1&&e2&&t&&sl&&e1<=e2&&e1>=p*.70&&e2<=p*1.30&&t>p*1.005&&sl<p*.998)}
function statusRank(s){s=String(s||'').toUpperCase(); if(s==='EXECUTABLE_REVIEW')return 3; if(s==='WATCH_ONLY')return 2; if(s.includes('READY'))return 1; return 0}
function gradeRank(g){g=String(g||''); return {P1:5,P2:4,P3:3,Watch:2,Blocked:0}[g]??1}
function isSourceOnlyBlock(r){const txt=JSON.stringify([r.safetyBlocks,r.safetyNonExecution,r.safetyWarnings,r.blocks,r.why,r.reason].filter(Boolean)).toLowerCase(); return /(source|evidence|مصادر|أدلة|تأكيدات|confirmation)/i.test(txt) && !/(سعر غير آمن|السعر غير آمن|هدف|وقف|r\/r|مخاطر|تخفيف|price conflict|precision)/i.test(txt)}
function main(){
 const ranking=read('data/final-opportunity-ranking.json',{}); const evidence=read('data/source-evidence-matrix.json',{}); const em={}; rowsOf(evidence).forEach(x=>{const k=sym(x.symbol); if(k)em[k]=x});
 const baseRows=rowsOf(ranking); const rows=baseRows.map(r=>{const k=sym(r.symbol); const e=em[k]||{}; const score=num(e.sourceStrengthScore||e.evidenceScore)||0; const conf=num(e.confirmationCount)||0; const evDecision=e.finalDataDecision||e.decision||e.coverageStatus||'NO_EVIDENCE'; let out={...r,sourceStrengthScore:score||r.sourceStrengthScore,sourceConfirmationCount:conf,sourceEvidenceDecision:evDecision,coverageStatus:e.coverageStatus||evDecision,coverageReason:e.exclusionReason||e.reason||'',coverageLoopAppliedAt:RUN_AT,coverageLoopEngine:'v9_8_coverage_loop_apply'};
   const valid=planValid(r), rr=rrValue(r), prob=num(r.targetProbability||r.probability||r.finalConfidence)||0;
   let safety= num(r.safetyGovernorScore||r.finalScore||r.score||prob)||0; if(score)safety=Math.round(safety*.70+score*.30); out.safetyGovernorScore=safety; out.finalScore=safety;
   if(/READY|TRUSTED/.test(String(evDecision)) && score>=70 && valid && rr>=0.85 && prob>=65 && String(r.safetyGovernorStatus||'')!=='BLOCKED'){
     if(safety>=82){out.grade='P1'; out.safetyGovernorStatus='EXECUTABLE_REVIEW'; out.executionAllowed=true;}
     else if(safety>=74){out.grade='P2'; out.safetyGovernorStatus='EXECUTABLE_REVIEW'; out.executionAllowed=true;}
     else {out.grade=out.grade==='Blocked'?'P3':(out.grade||'P3'); out.safetyGovernorStatus='WATCH_ONLY'; out.executionAllowed=false;}
   } else if(/READY|TRUSTED|WATCH/.test(String(evDecision)) && String(out.grade)==='Blocked' && isSourceOnlyBlock(r) && valid){
     out.grade='P3'; out.safetyGovernorStatus='WATCH_ONLY'; out.executionAllowed=false; out.why=String(out.why||r.reason||'')+' | V9.8: خرج من الحجب الكامل إلى مراقبة فقط بعد توفر أدلة كافية للتحليل.';
   } else if(!/READY|TRUSTED/.test(String(evDecision))){
     out.executionAllowed=false; if(String(out.grade)==='P1'||String(out.grade)==='P2')out.grade='P3'; out.safetyGovernorStatus='WATCH_ONLY';
   }
   return out;
 }).sort((a,b)=>statusRank(b.safetyGovernorStatus)-statusRank(a.safetyGovernorStatus)||gradeRank(b.grade)-gradeRank(a.grade)||(num(b.finalScore)-num(a.finalScore))||(num(b.sourceStrengthScore)-num(a.sourceStrengthScore)));
 const summary={total:rows.length,executable:rows.filter(x=>x.executionAllowed).length,watchOnly:rows.filter(x=>x.safetyGovernorStatus==='WATCH_ONLY').length,blocked:rows.filter(x=>String(x.grade)==='Blocked'||x.safetyGovernorStatus==='BLOCKED').length,analysisReady:rows.filter(x=>/READY|TRUSTED/.test(String(x.sourceEvidenceDecision))).length,avgSourceStrength:Math.round(rows.reduce((s,x)=>s+(num(x.sourceStrengthScore)||0),0)/Math.max(1,rows.length)),coverageTargetPct:evidence.summary?.targetCoveragePct||80,coveragePct:evidence.summary?.reliableCoveragePct||0};
 const out={...ranking,ok:true,engine:'v9_8_final_ranking_with_coverage_loop',generatedAt:RUN_AT,summary,rows,note:'V9.8 applies iterative coverage evidence. It increases analysis coverage and moves source-only blocked symbols to watch when valid, but execution remains guarded by plan/RR/safety.'};
 write('data/final-multisource-ranking.json',out); write('data/final-opportunity-ranking.json',out); write('data/coverage-loop-application-report.json',{ok:true,engine:'v9_8_coverage_loop_apply',generatedAt:RUN_AT,summary,rows:rows.map(x=>({symbol:x.symbol,name:x.name||x.name_ar,grade:x.grade,status:x.safetyGovernorStatus,executionAllowed:x.executionAllowed,sourceStrengthScore:x.sourceStrengthScore,confirmationCount:x.sourceConfirmationCount,coverageStatus:x.coverageStatus,reason:x.coverageReason}))});
 console.log('V9.8 coverage applied', summary);
}
main();
