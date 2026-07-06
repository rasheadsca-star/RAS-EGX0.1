#!/usr/bin/env node
/*
  EGX Pro Hub V8.10.2 — Final Opportunity Ranking Plan Restore + HARD Price Gate
*/
const fs=require("fs"),path=require("path");
function read(f,d){try{return JSON.parse(fs.readFileSync(f,"utf8"))}catch{return d}}
function write(f,o){fs.mkdirSync(path.dirname(f),{recursive:true});fs.writeFileSync(f,JSON.stringify(o,null,2)+"\n","utf8")}
function num(v){if(v==null||v==="")return 0;const n=Number(String(v).replace(/[,%٬،]/g,"").replace(/[^\d.+\-eE]/g,""));return isFinite(n)?n:0}
function round(n,dp=2){const m=10**dp;return Math.round(num(n)*m)/m}
function fmtPrice(v){const n=num(v);return n>0&&n<1?n.toFixed(3):String(round(n,2))}
function pickNum(...vals){for(const v of vals){const x=num(v);if(x>0)return x}return 0}
function planFromRow(r,price){
  const p=num(price)||num(r.price)||0;
  let e1=pickNum(r.entryFrom,r.entryLow,r.entry_from);
  let e2=pickNum(r.entryTo,r.entryHigh,r.entry_to);
  if(e1&&e2&&e1>e2){const t=e1;e1=e2;e2=t}
  if(!e1&&p)e1=p*0.985;
  if(!e2&&p)e2=p*1.005;
  let s1=pickNum(r.support1,r.support,r.s1);
  let r1=pickNum(r.resistance1,r.resistance,r.r1);
  let t1=pickNum(r.target1,r.t1,r1);
  let t2=pickNum(r.target2,r.t2);
  let stop=pickNum(r.stopLoss,r.stop_loss,r.sl,s1);
  if(p){
    if(!t1||t1<=p)t1=p*1.035;
    if(!t2||t2<=t1)t2=Math.max(p*1.07,t1*1.025);
    if(!stop||stop>=p)stop=p*0.95;
    if(!s1||s1>=p)s1=Math.min(stop,p*0.97);
    if(!r1||r1<=p)r1=t1;
  }
  return {
    entryFrom:round(e1, p>0&&p<1?3:2), entryTo:round(e2, p>0&&p<1?3:2),
    target1:round(t1, p>0&&p<1?3:2), target2:round(t2, p>0&&p<1?3:2),
    stopLoss:round(stop, p>0&&p<1?3:2), support1:round(s1, p>0&&p<1?3:2), resistance1:round(r1, p>0&&p<1?3:2)
  };
}
function sclass(r){const s=String(r.signal||r.recommendation||r.action||"").toLowerCase();if(/risk|sell|تخفيف|مخاطر|بيع|خروج/.test(s))return"risk";if(/buy|شراء|دخول|فرصة/.test(s))return"buy";if(/near|قريب/.test(s))return"near";return"watch"}
function rr(r){const p=num(r.price),t=num(r.target1),st=num(r.stopLoss);return p&&t&&st&&p>st?(t-p)/(p-st):0}
function potential(r){const p=num(r.price),t=num(r.target1);return p&&t?(t-p)/p*100:0}
function riskPct(r){const p=num(r.price),st=num(r.stopLoss);return p&&st?Math.max(0,(p-st)/p*100):8}
function expected(r,prob){return(prob/100)*Math.max(0,potential(r))-(1-prob/100)*riskPct(r)}
function liq(r){return Math.max(0,Math.min(100,Math.log10((num(r.valueTraded)||num(r.turnover)||1)+1)*12))}

function subPoundRoundedRisk(price,row={},pr={}){
  const p=Number(price);
  if(!Number.isFinite(p)||p<=0||p>=1)return false;
  if(pr.precisionRisk===true)return true;
  if(pr.isExecutionSafe===false && /دقة|precision|decimal|rounded/i.test(String(pr.executionBlockReason||pr.precisionReason||'')))return true;
  const centGrid=Math.abs(p*100-Math.round(p*100))<1e-8;
  const texts=[row.priceDisplay,row.finalPriceDisplay,row.priceText,row.rawPrice,row.price,row.last,row.close,pr.finalPriceDisplay,pr.finalPrice].filter(v=>v!==undefined&&v!==null).map(v=>String(v).trim());
  const textRounded=texts.some(t=>{const c=t.replace(/,/g,'.').replace(/[^0-9.\-]/g,'');return /^0?\.\d{1,2}$/.test(c)||/^0?\.\d{2}0+$/.test(c)});
  return centGrid||textRounded;
}
function hardBlockReason(price,row,pr){
  if(subPoundRoundedRisk(price,row,pr))return 'دقة سعر أقل من 1 جنيه غير كافية للتنفيذ؛ يلزم تأكيد 3 خانات مثل 0.216';
  return '';
}
function entryQ(r){const p=num(r.price),e1=num(r.entryFrom||r.entryHigh),e2=num(r.entryTo||r.entryLow);if(!p||!e1||!e2)return 45;if(p>=Math.min(e1,e2)*.99&&p<=Math.max(e1,e2)*1.01)return 90;if(p<Math.min(e1,e2)&&p>=Math.min(e1,e2)*.97)return 70;if(p>Math.max(e1,e2)*1.04)return 35;return 55}
function main(){
 const rec=read("data/recommendations.json",{}),prices=read("data/price-reconciliation-report.json",{rows:[]}),hist=read("data/history-backfill-plan.json",{rows:[]});
 const pm={},hm={};(prices.rows||[]).forEach(x=>pm[String(x.symbol||"").toUpperCase()]=x);(hist.rows||[]).forEach(x=>hm[String(x.symbol||"").toUpperCase()]=x);
 const base=Array.isArray(rec.all)?rec.all:[];
 const rows=base.map(r=>{
  const key=String(r.symbol||"").toUpperCase(),pr=pm[key]||{},hs=hm[key]||{};
  const price=num(pr.finalPrice)||num(r.price);
  const tradePlan=planFromRow(r,price);
  const row={...r,...tradePlan,price};
  const hardPriceReason=hardBlockReason(price,row,pr);
  const precisionRisk=Boolean(hardPriceReason)||pr.precisionRisk===true||pr.isExecutionSafe===false&&/دقة|precision/i.test(String(pr.executionBlockReason||""));
  let prob=(num(r.finalConfidence)||0)*.45+(num(r.dataQualityScore)||70)*.12+liq(row)*.12+entryQ(row)*.16+Math.max(0,Math.min(100,rr(row)*28))*.10;
  const gain=potential(row);if(gain>18)prob-=8;else if(gain>10)prob-=3;else if(gain>3)prob+=3;
  const blocks=[];
  if(pr.hasConflict){prob-=18;blocks.push("تعارض سعر")}
  if(pr.isStale){prob-=8;blocks.push("سعر قديم")}
  if(precisionRisk){prob-=70;blocks.push("دقة سعر غير كافية")}
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
  if(precisionRisk){finalScore=Math.min(finalScore,39);prob=Math.min(prob,49)}
  const priceWord=precisionRisk?"دقة غير كافية":pr.hasConflict?"متعارض":pr.isStale?"قديم":"مدقق";
  const why=`احتمال الهدف ${prob}% | ربح هدف1 ${gain.toFixed(1)}% | عائد متوقع ${exp.toFixed(1)}% | R/R ${rrVal.toFixed(2)} | السعر ${priceWord} | تاريخ ${sessions}/50${blocks.length?" | قيود: "+blocks.join("، "):""}`;
  return {
    symbol:key,name:r.name_ar||r.name_en||r.name||"",grade,finalScore,
    targetProbability:prob,potentialProfitPct:Number(gain.toFixed(2)),expectedReturnPct:Number(exp.toFixed(2)),rr:Number(rrVal.toFixed(2)),
    changePct:num(r.changePct), valueTraded:num(r.valueTraded||r.turnover||r.value), volume:num(r.volume),
    support1:row.support1, resistance1:row.resistance1, entryFrom:row.entryFrom, entryTo:row.entryTo, target1:row.target1, target2:row.target2, stopLoss:row.stopLoss,
    price,priceDisplay:fmtPrice(price),
    priceState:precisionRisk?"precision_risk":pr.hasConflict?"conflict":pr.isStale?"stale":"ok",
    precisionRisk,executionAllowed:false===precisionRisk?grade!=="Blocked":false,
    executionBlockReason:precisionRisk?(hardPriceReason||"لا توصية تنفيذية حتى تأكيد السعر بثلاث خانات عشرية من مصدر تفصيلي"):(grade==="Blocked"?"توجد قيود تمنع التنفيذ":""),
    sourceUsed:pr.sourceUsed||null,historySessions:sessions,confidence:num(r.finalConfidence),blocks,why
  }
 }).sort((a,b)=>({P1:4,P2:3,P3:2,Watch:1,Blocked:0}[b.grade]-{P1:4,P2:3,P3:2,Watch:1,Blocked:0}[a.grade])||b.targetProbability-a.targetProbability||b.expectedReturnPct-a.expectedReturnPct||b.rr-a.rr);
 const summary={p1:rows.filter(x=>x.grade==="P1").length,p2:rows.filter(x=>x.grade==="P2").length,p3:rows.filter(x=>x.grade==="P3").length,blocked:rows.filter(x=>x.grade==="Blocked").length,precisionBlocked:rows.filter(x=>x.precisionRisk).length};
 write("data/final-opportunity-ranking.json",{ok:true,engine:"v8_10_2_final_ranking_plan_restore_hard_price_gate",generatedAt:new Date().toISOString(),total:rows.length,summary,rows,note:"Plan restore: final ranking carries entry/targets/stop from recommendations and never falls back to UI sample values. Hard price gate remains active."});
 console.log("Final ranking",{total:rows.length,...summary});
}
main();
