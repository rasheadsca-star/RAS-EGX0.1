/*
EGX Pro Hub V9.8.8 — Unified Decision Board
Unifies daily opportunities, final ranking, price reconciliation, and gateway into a single decision list.
*/
const fs=require("fs");
const path=require("path");
function read(f,d){try{return JSON.parse(fs.readFileSync(f,"utf8"))}catch{return d}}
function write(f,o){fs.mkdirSync(path.dirname(f),{recursive:true});fs.writeFileSync(f,JSON.stringify(o,null,2),"utf8")}
function num(v){if(v==null||v==="")return 0;const n=Number(String(v).replace(/[,%٬،]/g,"").replace(/[^\d.+\-eE]/g,""));return Number.isFinite(n)?n:0}
function mapBy(rows,key="symbol"){const m={};(rows||[]).forEach(x=>{if(x&&x[key])m[String(x[key]).toUpperCase()]=x});return m}
function sclass(r){const s=String(r.signal||r.recommendation||"").toLowerCase();if(/risk|sell|تخفيف|مخاطر|بيع|خروج/.test(s))return"risk";if(/buy|شراء|دخول|فرصة/.test(s))return"buy";return"watch"}
function rr(r){const p=num(r.price||r.finalPrice), t=num(r.target1), st=num(r.stopLoss);return p&&t&&st&&p>st?(t-p)/(p-st):0}
function potential(r){const p=num(r.price||r.finalPrice), t=num(r.target1);return p&&t?(t-p)/p*100:0}
function riskPct(r){const p=num(r.price||r.finalPrice), st=num(r.stopLoss);return p&&st?Math.max(0,(p-st)/p*100):8}
function expected(r,prob){return prob/100*Math.max(0,potential(r))-(1-prob/100)*riskPct(r)}
function priceState(pr){return pr?.hasConflict?"conflict":pr?.isStale?"stale":"ok"}
function decide(base, rk, pr, gateway){
 const prob=num(rk.targetProbability)||num(base.finalConfidence)||0;
 const grade=rk.grade||((prob>=75)?"P1":(prob>=65)?"P2":"Watch");
 const pState=priceState(pr);
 const rrVal=num(rk.rr)||rr(base);
 const exp=num(rk.expectedReturnPct)||expected(base,prob);
 const pot=num(rk.potentialProfitPct)||potential(base);
 const reasons=[];
 let action="مراقبة", actionClass="watch", priority=50;
 if(pState==="conflict"){action="ممنوع حتى تدقيق السعر";actionClass="block";priority=95;reasons.push("تعارض سعر");}
 else if(pState==="stale"){action="مراقبة فقط";actionClass="watch";priority=70;reasons.push("سعر قديم");}
 else if(grade==="P1"&&prob>=75&&exp>0&&rrVal>=.9&&sclass(base)!=="risk"){action="جاهز للمراجعة";actionClass="go";priority=90;reasons.push("P1 + سعر مدقق + عائد موجب + R/R مقبول");}
 else if(grade==="P2"&&prob>=65&&exp>=0&&rrVal>=.8&&sclass(base)!=="risk"){action="مرشح مشروط";actionClass="watch";priority=72;reasons.push("P2 يحتاج تأكيد دخول");}
 else if(grade==="Blocked"||sclass(base)==="risk"){action="استبعاد مؤقت";actionClass="block";priority=80;reasons.push("Blocked أو إشارة مخاطر");}
 else reasons.push("غير كافٍ للتنفيذ الآن");
 if(gateway?.status&&/degraded|failed/i.test(gateway.status)){if(actionClass==="go"){action="مراجعة مشروطة بسبب مصدر البيانات";actionClass="watch"}reasons.push("بوابة البيانات ليست Full Fresh")}
 return {action,actionClass,priority,grade,targetProbability:prob,potentialProfitPct:pot,expectedReturnPct:exp,rr:rrVal,priceState:pState,why:reasons.join(" | ")};
}
function main(){
 const rec=read("data/recommendations.json",{}), ranking=read("data/final-opportunity-ranking.json",{rows:[]}), price=read("data/price-reconciliation-report.json",{rows:[]}), gateway=read("data/source-gateway-report.json",{}), market=read("data/market.json",{rows:[]});
 const rankMap=mapBy(ranking.rows), priceMap=mapBy(price.rows), marketMap=mapBy(market.rows);
 const baseRows=Array.isArray(rec.all)?rec.all:(Array.isArray(market.rows)?market.rows:[]);
 const rows=baseRows.map(r=>{
   const symbol=String(r.symbol||"").toUpperCase(); if(!symbol)return null;
   const mk=marketMap[symbol]||{}, rk=rankMap[symbol]||{}, pr=priceMap[symbol]||{};
   const finalPrice=num(pr.finalPrice)||num(mk.price)||num(r.price);
   const base={...r,...mk,price:finalPrice};
   const d=decide(base,rk,pr,gateway);
   return {symbol,name:r.name_ar||r.name_en||r.name||mk.name_ar||mk.name_en||"",price:finalPrice,entryFrom:r.entryFrom,entryTo:r.entryTo,target1:r.target1,stopLoss:r.stopLoss,finalConfidence:r.finalConfidence||r.confidence,finalScore:num(rk.finalScore)||d.targetProbability,source:mk.source||r.source||"",...d,rankWhy:rk.why||"",gatewayStatus:gateway.status||gateway.mode||""};
 }).filter(Boolean).sort((a,b)=>{
   const order={go:3,watch:2,block:1};
   return (order[b.actionClass]||0)-(order[a.actionClass]||0)||num(b.targetProbability)-num(a.targetProbability)||num(b.expectedReturnPct)-num(a.expectedReturnPct)||num(b.finalScore)-num(a.finalScore);
 });
 const summary={total:rows.length,go:rows.filter(x=>x.actionClass==="go").length,watch:rows.filter(x=>x.actionClass==="watch").length,block:rows.filter(x=>x.actionClass==="block").length,p1:rows.filter(x=>x.grade==="P1").length,p2:rows.filter(x=>x.grade==="P2").length};
 write("data/unified-decision-board.json",{ok:true,engine:"v9_8_8_unified_decision_board",generatedAt:new Date().toISOString(),summary,gateway:{status:gateway.status,level:gateway.level,marketRows:gateway.marketRows,coveragePct:gateway.coveragePct,fallbackUsed:gateway.fallbackUsed,lastGoodSnapshotUsed:gateway.lastGoodSnapshotUsed},rows,note:"Single source of truth: select from this board. Daily Opportunities and Final Ranking are inputs, not competing lists."});
 console.log("Unified Decision Board", summary);
}
main();
