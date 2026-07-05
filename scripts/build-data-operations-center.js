/*
EGX Pro Hub V9.8 — Data Operations Center
Builds a single operational status report across sources, price reconciliation, history, ranking, alerts, and regression.
*/
const fs=require("fs"), path=require("path");
function read(f,d){try{return JSON.parse(fs.readFileSync(f,"utf8"))}catch{return d}}
function write(f,o){fs.mkdirSync(path.dirname(f),{recursive:true});fs.writeFileSync(f,JSON.stringify(o,null,2),"utf8")}
function num(v){const n=Number(v);return isFinite(n)?n:0}
function stateFromScore(score){return score>=85?"ok":score>=60?"warn":"bad"}
function main(){
  const source=read("data/source-health.json",{}), fetchVerify=read("data/workflow-source-verification.json",{}), fetchStatus=read("data/fetch-status.json",{}), sourceFetchReport=read("data/source-fetch-report.json",{}), price=read("data/price-reconciliation-report.json",{summary:{}}), hist=read("data/history-backfill-plan.json",{}), ranking=read("data/final-opportunity-ranking.json",{summary:{}}), alerts=read("data/alert-decision-center.json",{summary:{}}), reg=read("data/app-regression-report.json",{});
  const checks=[];
  const coverage=num(source.universeCoveragePct||source.coveragePct||0);
  checks.push({id:"fetcher",name:"جلب البيانات",state:(fetchStatus.realFetch||fetchVerify.realFetch||sourceFetchReport.realFetch)?"ok":"warn",value:fetchStatus.mode||fetchVerify.fetchMode||"unknown",message:(fetchStatus.realFetch||fetchVerify.realFetch||sourceFetchReport.realFetch)?"الجلب العام/الخارجي مضبوط":"لا يوجد جلب خارجي مؤكد؛ قد تكون البيانات من ملفات حالية",action:(fetchStatus.realFetch||fetchVerify.realFetch)?"متابعة":"افتح تحقق الجلب واضبط EGX_MARKET_JSON_URL"});
  checks.push({id:"coverage",name:"تغطية السوق",state:coverage>=95?"ok":coverage>=80?"warn":"bad",value:`${coverage.toFixed(1)}%`,message:coverage>=95?"تغطية السوق جيدة":"التغطية أقل من المطلوب",action:coverage>=95?"متابعة":"راجع مصدر البيانات أو Workflow"});
  const conflicts=num(price.summary?.conflict), stale=num(price.summary?.stale);
  checks.push({id:"price",name:"تدقيق الأسعار",state:conflicts>0?"bad":stale>0?"warn":"ok",value:`${conflicts} تعارض / ${stale} قديم`,message:conflicts>0?"يوجد تعارض أسعار مؤثر":stale>0?"بعض الأسعار قديمة":"الأسعار الداخلية متسقة",action:conflicts>0?"افتح تدقيق الأسعار":stale>0?"شغّل Workflow":"متابعة"});
  const total=num(hist.totalSymbols), full=num(hist.full50Symbols), avg=num(hist.avgSessions);
  checks.push({id:"history",name:"ذاكرة 50 جلسة",state:total&&full/total>=.5?"ok":avg>=15?"warn":"bad",value:`${full}/${total} مكتمل`,message:`متوسط الجلسات ${avg.toFixed(1)} / 50`,action:avg<15?"شغّل history_maintenance أو استيراد Backfill":"استمر في التراكم"});
  const p1=num(ranking.summary?.p1), blocked=num(ranking.summary?.blocked);
  checks.push({id:"ranking",name:"محرك الأولويات",state:p1>0?"ok":blocked>0?"warn":"bad",value:`P1 ${p1} / مقيّد ${blocked}`,message:p1>0?"يوجد فرص قابلة للمراجعة":"لا توجد P1 واضحة الآن",action:"افتح محرك الأولويات"});
  const critical=num(alerts.summary?.critical), warning=num(alerts.summary?.warning);
  checks.push({id:"alerts",name:"مركز التنبيهات",state:critical>0?"bad":warning>0?"warn":"ok",value:`عاجل ${critical} / مهم ${warning}`,message:critical>0?"ابدأ بالتنبيهات العاجلة":warning>0?"راجع التنبيهات المهمة":"لا توجد تنبيهات مؤثرة",action:"افتح مركز التنبيهات"});
  const failures=num(reg.failed||reg.failures||0);
  checks.push({id:"regression",name:"فحص الثبات",state:failures>0?"bad":"ok",value:`${failures} فشل`,message:failures>0?"يوجد فحص فاشل":"لا توجد أخطاء فحص معروفة",action:failures>0?"افتح فحص الثبات":"متابعة"});
  const bad=checks.filter(x=>x.state==="bad").length, warn=checks.filter(x=>x.state==="warn").length, ok=checks.filter(x=>x.state==="ok").length, score=Math.max(0,100-bad*18-warn*7);
  write("data/data-operations-center.json",{ok:true,engine:"v9_8_data_operations_center",generatedAt:new Date().toISOString(),score,state:stateFromScore(score),summary:{ok,warn,bad,total:checks.length},checks,note:"Single operational center for data health, price reconciliation, history, ranking, alerts, and regression."});
  console.log("Data operations center", {score,ok,warn,bad});
}
main();
