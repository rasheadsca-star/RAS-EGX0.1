/*
EGX Pro Hub V8.9 — Daily Decision Brief
Builds a compact market-level daily brief from generated public/delayed data.
Portfolio-specific brief remains local in browser because portfolio data is local.
*/
const fs=require("fs");
const path=require("path");
function read(file,fallback){try{return JSON.parse(fs.readFileSync(file,"utf8"))}catch{return fallback}}
function write(file,obj){fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,JSON.stringify(obj,null,2),"utf8")}
function num(v){if(v==null||v==="")return 0;const n=Number(String(v).replace(/[,%٬،]/g,"").replace(/[^\d.+\-eE]/g,""));return isFinite(n)?n:0}
function sclass(r){const s=String(r.signal||r.recommendation||"").toLowerCase();if(s.includes("risk")||s.includes("sell")||s.includes("تخفيف"))return"risk";if(s.includes("buy")||s.includes("شراء"))return"buy";if(s.includes("near")||s.includes("قريب"))return"near";return"watch"}
function rr(r){const p=num(r.price), t=num(r.target1), st=num(r.stopLoss);return p&&t&&st&&p>st?(t-p)/(p-st):0}
function main(){
  const rec=read("data/recommendations.json",{}), rows=Array.isArray(rec.all)?rec.all:[];
  const source=read("data/source-health.json",{}), health=read("data/app-health-status.json",{}), hist=read("data/history-integrity-report.json",{}), alerts=read("data/smart-alert-rules.json",{rules:[]}), acc=read("data/recommendation-accuracy-latest.json",{}), inst=read("data/institutional-score-report.json",{});
  const scored=rows.map(r=>({...r,_rr:rr(r),_conf:num(r.finalConfidence||r.confidence)}));
  const opportunities=scored.filter(r=>sclass(r)!=="risk").sort((a,b)=>{const dc=b._conf-a._conf; return Math.abs(dc)>=3?dc:(dc||b._rr-a._rr)}).slice(0,10).map(r=>({symbol:r.symbol,name:r.name_ar||r.name_en||r.name||"",confidence:r._conf,price:num(r.price),entryFrom:num(r.entryFrom),entryTo:num(r.entryTo),target1:num(r.target1),target2:num(r.target2),stopLoss:num(r.stopLoss),rr:Number(r._rr.toFixed(2)),reason:r.reason||""}));
  const risks=scored.filter(r=>sclass(r)==="risk").sort((a,b)=>b._conf-a._conf).slice(0,10).map(r=>({symbol:r.symbol,name:r.name_ar||r.name_en||r.name||"",recommendation:r.recommendation||"",reason:r.reason||"",price:num(r.price),stopLoss:num(r.stopLoss)}));
  const marketAlerts=(alerts.rules||[]).slice(0,20);
  const avgChange=rows.length?rows.reduce((s,r)=>s+num(r.changePct),0)/rows.length:0;
  const coverage=(source.totalUniverse?Number(((source.cacheRows||rows.length)/source.totalUniverse*100).toFixed(2)):null);
  const state=(source.ok===false||health.ok===false)?"bad":((hist.full50Symbols||0)===0?"warn":"ok");
  const brief={
    ok:true,
    engine:"v8_9_daily_decision_brief",
    generatedAt:new Date().toISOString(),
    state,
    market:{avgChange:Number(avgChange.toFixed(3)),coveragePct:coverage,rows:rows.length},
    dataHealth:{sourceOk:source.ok!==false,appHealthOk:health.ok!==false,cacheRows:source.cacheRows||rows.length,totalUniverse:source.totalUniverse||rows.length,avgDataQuality:source.avgDataQuality||null},
    history:{totalSymbols:hist.totalSymbols||rows.length,full50Symbols:hist.full50Symbols||0,partialSymbols:hist.partialSymbols||0,avgSessions:hist.avgSessions||0},
    accuracy:{accuracyPct:acc.accuracyPct,weightedAccuracyPct:acc.weightedAccuracyPct,total:acc.total},
    institutional:{generatedAt:inst.generatedAt,total:inst.total},
    opportunities,
    risks,
    marketAlerts,
    note:"Public/delayed market brief. Not investment advice. Portfolio-specific alerts are computed locally in the browser."
  };
  write("data/daily-decision-brief.json",brief);
  console.log("Daily decision brief generated", {state, opportunities:opportunities.length, risks:risks.length, alerts:marketAlerts.length});
}
main();
