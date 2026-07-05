/*
EGX Pro Hub V9.8.1 — Safe Public Market Fetcher Wrapper
Purpose:
- Prevent workflow failure when fetch-market-data.js is missing.
- Use a configured public JSON source if available.
- Never invent prices or fake freshness.
Configure a repository variable/secret:
  EGX_MARKET_JSON_URL or PUBLIC_MARKET_JSON_URL
Expected JSON can be an array, or an object with rows/data/all.
*/
const fs=require("fs");
const path=require("path");
function read(f,d){try{return JSON.parse(fs.readFileSync(f,"utf8"))}catch{return d}}
function write(f,o){fs.mkdirSync(path.dirname(f),{recursive:true});fs.writeFileSync(f,JSON.stringify(o,null,2),"utf8")}
function num(v){if(v==null||v==="")return null;const n=Number(String(v).replace(/[,%٬،]/g,"").replace(/[^\d.+\-eE]/g,""));return isFinite(n)?n:null}
function normSymbol(v){return String(v||"").trim().toUpperCase()}
function normalizeRows(payload){
  const arr=Array.isArray(payload)?payload:Array.isArray(payload?.rows)?payload.rows:Array.isArray(payload?.data)?payload.data:Array.isArray(payload?.all)?payload.all:[];
  return arr.map(r=>{
    const symbol=normSymbol(r.symbol||r.ticker||r.code||r.Symbol||r.securityCode);
    if(!symbol)return null;
    const price=num(r.price??r.last??r.close??r.lastPrice??r.Close??r.Last);
    return {
      ...r,
      symbol,
      name_ar:r.name_ar||r.nameAr||r.arabicName||r.name||"",
      name_en:r.name_en||r.nameEn||r.englishName||r.name||"",
      price,
      last:price,
      changePct:num(r.changePct??r.change_percent??r.percentChange??r.changePercent),
      volume:num(r.volume??r.volumeTraded??r.tradedVolume),
      valueTraded:num(r.valueTraded??r.turnover??r.value??r.tradedValue),
      updatedAt:r.updatedAt||r.timestamp||new Date().toISOString()
    };
  }).filter(Boolean);
}
async function fetchJson(url){
  const res=await fetch(url,{headers:{"accept":"application/json,text/plain,*/*","user-agent":"EGX-Pro-Hub/9.8.1"}});
  if(!res.ok)throw new Error(`HTTP ${res.status}`);
  const txt=await res.text();
  try{return JSON.parse(txt)}catch(e){throw new Error("Response is not valid JSON")}
}
async function main(){
  const generatedAt=new Date().toISOString();
  const url=process.env.EGX_MARKET_JSON_URL||process.env.PUBLIC_MARKET_JSON_URL||"";
  const status={ok:false,realFetch:false,scriptExists:true,generatedAt,mode:"existing_files_only",sourceUrl:url||null,message:"No external market JSON URL configured. Existing repository data will be used; freshness is not guaranteed."};
  if(url){
    try{
      const payload=await fetchJson(url);
      const rows=normalizeRows(payload);
      if(!rows.length)throw new Error("Configured JSON returned zero normalized rows");
      write("data/market.json",{ok:true,generatedAt,updatedAt:generatedAt,source:"configured_public_json",sourceUrl:url,rows});
      const universe=read("data/egx-symbols.json",[]);
      write("data/source-health.json",{ok:true,generatedAt,lastSuccessAt:generatedAt,mode:"configured_public_json",sourceUrl:url,marketRows:rows.length,cacheRows:rows.length,totalUniverse:Array.isArray(universe)?universe.length:rows.length,universeCoveragePct:rows.length?Math.min(100,rows.length/(Array.isArray(universe)&&universe.length?universe.length:rows.length)*100):0});
      write("data/fetch-status.json",{...status,ok:true,realFetch:true,mode:"configured_public_json",message:`Fetched ${rows.length} rows from configured public JSON source`,marketRows:rows.length});
      console.log(`Fetched ${rows.length} market rows from configured JSON source`);
      return;
    }catch(err){
      write("data/fetch-status.json",{...status,mode:"configured_url_failed",message:`Configured fetch failed: ${err.message}`});
      console.warn("Configured fetch failed:", err.message);
      return;
    }
  }
  const market=read("data/market.json",{}), cache=read("data/full-market-cache.json",{}), rec=read("data/recommendations.json",{});
  status.marketRows=Array.isArray(market.rows)?market.rows.length:0;
  status.cacheRows=Array.isArray(cache.rows)?cache.rows.length:0;
  status.recommendationRows=Array.isArray(rec.all)?rec.all.length:0;
  write("data/fetch-status.json",status);
  console.warn(status.message);
}
main().catch(err=>{
  write("data/fetch-status.json",{ok:false,realFetch:false,scriptExists:true,generatedAt:new Date().toISOString(),mode:"fetcher_exception",message:err.message});
  console.error(err);
});
