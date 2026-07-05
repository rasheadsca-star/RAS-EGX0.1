#!/usr/bin/env node
/*
  EGX Pro Hub V8.9.6 — Final Opportunity Ranking with Execution Price Guard
*/
const fs=require("fs"),path=require("path");
function read(f,d){try{return JSON.parse(fs.readFileSync(f,"utf8"))}catch{return d}}
function write(f,o){fs.mkdirSync(path.dirname(f),{recursive:true});fs.writeFileSync(f,JSON.stringify(o,null,2)+"\n","utf8")}
function num(v){if(v==null||v==="")return 0;const n=Number(String(v).replace(/[,%٬،]/g,"").replace(/[^\d.+\-eE]/g,""));return isFinite(n)?n:0}
function round(n,dp=2){const m=10**dp;return Math.round(num(n)*m)/m}
function fmtPrice(v){const n=num(v);return n>0&&n<1?n.toFixed(3):String(round(n,2))}
function sclass(r){const s=String(r.signal||r.recommendation||r.action||"").toLowerCase();if(/risk|sell|تخفيف|مخاطر|بيع|خروج/.test(s))return"risk";if(/buy|شراء|دخول|فرصة/.test(s))return"buy";if(/near|قريب/.test(s))return"near";return"watch"}
function rr(r){const p=num(r.price),t=num(r.target1),st=num(r.stopLoss);return p&&t&&st&&p>st?(t-p)/(p-st):0}
function potential(r){const p=num(r.price),t=num(r.target1);return p&&t?(t-p)/p*100:0}
function riskPct(r){const p=num(r.price),st=num(r.stopLoss);return p&&st?Math.max(0,(p-st)/p*100):8}
function expected(r,prob){return(prob/100)*Math.max(0,potential(r))-(1-prob/100)*riskPct(r)}
function liq(r){return Math.max(0,Math.min(100,Math.log10((num(r.valueTraded)||num(r.turnover)||1)+1)*12))}
function entryQ(r){const p=num(r.price),e1=num(r.entryFrom||r.entryHigh),e2=num(r.entryTo||r.entryLow);if(!p||!e1||!e2)return 45;if(p>=Math.min(e1,e2)*.99&&p<=Math.max(e1,e2)*1.01)return 90;if(p<Math.min(e1,e2)&&p>=Math.min(e1,e2)*.97)return 70;if(p>Math.max(e1,e2)*1.04)return 35;return 55}
function main(){
 const rec=read("data/recommendations.json",{}),prices=read("data/price-reconciliation-report.json",{rows:[]}),hist=read("data/history-backfill-plan.json",{rows:[]});
 const pm={},hm={};(prices.rows||[]).forEach(x=>pm[String(x.symbol||"").toUpperCase()]=x);(hist.rows||[]).forEach(x=>hm[String(x.symbol||"").toUpperCase()]=x);
 const base=Array.isArray(rec.all)?rec.all:[];
 const rows=base.map(r=>{
  const key=String(r.symbol||"").toUpperCase(),pr=pm[key]||{},hs=hm[key]||{};
  const price=num(pr.finalPrice)||num(r.price);
  const row={...r,price};
  const precisionRisk=pr.precisionRisk===true||pr.isExecutionSafe===false&&String(pr.executionBlockReason||"").includes("دقة");
  let prob=(num(r.finalConfidence)||0)*.45+(num(r.dataQualityScore)||70)*.12+liq(row)*.12+entryQ(row)*.16+Math.max(0,Math.min(100,rr(row)*28))*.10;
  const gain=potential(row);if(gain>18)prob-=8;else if(gain>10)prob-=3;else if(gain>3)prob+=3;
  const blocks=[];
  if(pr.hasConflict){prob-=18;blocks.push("تعارض سعر")}
  if(pr.isStale){prob-=8;blocks.push("سعر قديم")}
  if(precisionRisk){prob-=40;blocks.push("دقة سعر غير كافية")}
  if(rr(row)<.7)blocks.push("R/R ضعيف");
  if(gain<=0)blocks.push("لا يوجد ربح واضح");
  if(sclass(row)==="risk"){prob-=28;blocks.push("إشارة مخاطر")}
  prob=Math.max(5,Math.min(95,Math.round(prob)));
  const exp=expected(row,prob),rrVal=rr(row),sessions=num(hs.sessionsAvailable);
  let grade="Watch";
  if(precisionRisk||blocks.includes("تعارض سعر")||blocks.includes("إشارة مخاطر"))grade="Blocked";
  else if(prob>=78&&exp>0&&rrVal>=1&&blocks.length===0)grade="P1";
  else if(prob>=68&&exp>0&&rrVal>=.8&&!blocks.includes("تعارض سعر"))grade="P2";
  else if(prob>=58&&exp>=-1)grade="P3";
  let finalScore=Math.max(0,Math.min(100,Math.round(prob+Math.max(-2,Math.min(4,gain/4))+Math.max(-3,Math.min(3,exp/3))+Math.max(-2,Math.min(3,(rrVal-1)*2))+(sessions<15?-2:0))));
  if(precisionRisk)finalScore=Math.min(finalScore,49);
  const priceWord=precisionRisk?"دقة غير كافية":pr.hasConflict?"متعارض":pr.isStale?"قديم":"مدقق";
  const why=`احتمال الهدف ${prob}% | ربح هدف1 ${gain.toFixed(1)}% | عائد متوقع ${exp.toFixed(1)}% | R/R ${rrVal.toFixed(2)} | السعر ${priceWord} | تاريخ ${sessions}/50${blocks.length?" | قيود: "+blocks.join("، "):""}`;
  return {
    symbol:key,name:r.name_ar||r.name_en||r.name||"",grade,finalScore,
    targetProbability:prob,potentialProfitPct:Number(gain.toFixed(2)),expectedReturnPct:Number(exp.toFixed(2)),rr:Number(rrVal.toFixed(2)),
    price,priceDisplay:fmtPrice(price),
    priceState:precisionRisk?"precision_risk":pr.hasConflict?"conflict":pr.isStale?"stale":"ok",
    precisionRisk,executionAllowed:grade!=="Blocked"&&!precisionRisk,
    executionBlockReason:precisionRisk?"لا توصية تنفيذية حتى تأكيد السعر بثلاث خانات عشرية من مصدر تفصيلي":(grade==="Blocked"?"توجد قيود تمنع التنفيذ":""),
    sourceUsed:pr.sourceUsed||null,historySessions:sessions,confidence:num(r.finalConfidence),blocks,why
  }
 }).sort((a,b)=>({P1:4,P2:3,P3:2,Watch:1,Blocked:0}[b.grade]-{P1:4,P2:3,P3:2,Watch:1,Blocked:0}[a.grade])||b.targetProbability-a.targetProbability||b.expectedReturnPct-a.expectedReturnPct||b.rr-a.rr);
 const summary={p1:rows.filter(x=>x.grade==="P1").length,p2:rows.filter(x=>x.grade==="P2").length,p3:rows.filter(x=>x.grade==="P3").length,blocked:rows.filter(x=>x.grade==="Blocked").length,precisionBlocked:rows.filter(x=>x.precisionRisk).length};
 write("data/final-opportunity-ranking.json",{ok:true,engine:"v8_9_6_final_ranking_execution_price_guard",generatedAt:new Date().toISOString(),total:rows.length,summary,rows,note:"Execution ranking blocks sub-1 EGP rounded prices until exact 0.001 precision is confirmed."});
 console.log("Final ranking",{total:rows.length,...summary});
}
main();
