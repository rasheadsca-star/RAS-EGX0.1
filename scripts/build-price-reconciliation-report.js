const fs=require("fs"),path=require("path");
function read(f,d){try{return JSON.parse(fs.readFileSync(f,"utf8"))}catch{return d}}
function write(f,o){fs.mkdirSync(path.dirname(f),{recursive:true});fs.writeFileSync(f,JSON.stringify(o,null,2),"utf8")}
function num(v){if(v==null||v==="")return null;const n=Number(String(v).replace(/[,%٬،]/g,"").replace(/[^\d.+\-eE]/g,""));return isFinite(n)?n:null}
function decimals(v){if(v==null)return 0;const n=Number(v);if(!Number.isFinite(n))return 0;const s=String(v);if(!s.includes("."))return 0;return s.split(".")[1].replace(/0+$/g,"").length}
function precisionRisk(v){const n=num(v);return !!(n&&n>0&&n<1&&decimals(v)<3)}
function sym(r){return String(r&&(r.symbol||r.ticker||r.code||r.Symbol)||"").trim().toUpperCase()}
function price(r){return num(r&&(r.price??r.last??r.close??r.lastPrice??r.Last??r.Close))}
function mapRows(rows){const m={};(rows||[]).forEach(r=>{const s=sym(r);if(s)m[s]=r});return m}
function age(ts){if(!ts)return null;const d=new Date(ts);if(isNaN(d))return null;return (Date.now()-d.getTime())/60000}
function ts(obj,row){return row?.generatedAt||row?.updatedAt||row?.timestamp||row?.time||obj?.generatedAt||obj?.updatedAt||obj?.lastSuccessAt||obj?.sessionDate||null}
function main(){
 const rec=read("data/recommendations.json",{}),cache=read("data/full-market-cache.json",{}),market=read("data/market.json",{}),hist=read("data/history.json",{}),source=read("data/source-health.json",{});
 const recRows=Array.isArray(rec.all)?rec.all:[],cacheRows=Array.isArray(cache.rows)?cache.rows:[],marketRows=Array.isArray(market.rows)?market.rows:(Array.isArray(market.data)?market.data:[]);
 const rm=mapRows(recRows),cm=mapRows(cacheRows),mm=mapRows(marketRows),hby=hist.sessionsBySymbol||hist.symbols||hist.history||{};
 const symbols=[...new Set([...Object.keys(rm),...Object.keys(cm),...Object.keys(mm),...Object.keys(hby)].filter(Boolean))].sort();
 const rows=symbols.map(s=>{
  const rr=rm[s],cr=cm[s],mr=mm[s],harr=Array.isArray(hby[s])?hby[s]:[],hp=price(harr[harr.length-1]||{});
  const cand=[{source:"market",price:price(mr),ts:ts(market,mr),priority:4},{source:"full-market-cache",price:price(cr),ts:ts(cache,cr),priority:3},{source:"recommendations",price:price(rr),ts:ts(rec,rr),priority:2},{source:"history",price:hp,ts:(harr[harr.length-1]||{}).date||hist.generatedAt,priority:1}].filter(x=>x.price!=null&&x.price>0);
  cand.sort((a,b)=>{const aa=age(a.ts),bb=age(b.ts);if(aa!=null&&bb!=null&&Math.abs(aa-bb)>15)return aa-bb;return b.priority-a.priority});
  const chosen=cand[0]||{},vals=cand.map(x=>x.price),max=vals.length?Math.max(...vals):null,min=vals.length?Math.min(...vals):null,diff=max&&min?(max-min)/min*100:0,ag=age(chosen.ts||source.generatedAt||source.lastSuccessAt||market.updatedAt||rec.generatedAt);
  const finalPrice=chosen.price||price(rr)||price(cr)||price(mr)||hp;
  const pricePrecisionRisk=precisionRisk(finalPrice);
  const spreadConflict=diff>=0.75;
  return {symbol:s,name:rr?.name_ar||rr?.name_en||rr?.name||cr?.name_ar||cr?.name_en||cr?.name||mr?.name_ar||mr?.name_en||mr?.name||"",finalPrice,recommendationPrice:price(rr),marketPrice:price(mr),cachePrice:price(cr),historyPrice:hp,sourceUsed:chosen.source||"fallback",sourceTimestamp:chosen.ts||null,sourceAgeMinutes:ag==null?null:Number(ag.toFixed(1)),isStale:ag!=null?ag>180:false,hasConflict:spreadConflict||pricePrecisionRisk,pricePrecisionRisk,spreadConflict,diffPct:Number(diff.toFixed(2)),conflictSummary:pricePrecisionRisk?"sub-1 EGP price has insufficient decimal precision; recommendations must wait for exact price":spreadConflict?`max/min internal price spread ${diff.toFixed(2)}%`:"",candidates:cand};
 });
 const summary={total:rows.length,ok:rows.filter(x=>!x.isStale&&!x.hasConflict).length,stale:rows.filter(x=>x.isStale).length,conflict:rows.filter(x=>x.hasConflict).length,adjusted:rows.filter(x=>x.finalPrice&&x.recommendationPrice&&Math.abs(x.finalPrice-x.recommendationPrice)>0.0001).length,precisionRisk:rows.filter(x=>x.pricePrecisionRisk).length};
 const last=source.generatedAt||source.lastSuccessAt||market.updatedAt||rec.generatedAt||null;
 write("data/price-reconciliation-report.json",{ok:true,engine:"v8_9_5_price_precision_reconciliation",generatedAt:new Date().toISOString(),lastSourceUpdate:last,sourceAgeMinutes:age(last)==null?null:Number(age(last).toFixed(1)),summary,rows,note:"Final price is selected from public/delayed sources. Sub-1 EGP prices must have at least 3 decimals; otherwise the stock is marked as a precision risk and should not receive an execution recommendation."});
 console.log("Price reconciliation",summary);
}
main();