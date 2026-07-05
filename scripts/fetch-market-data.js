/*
EGX Pro Hub V9.8.5 — Mubasher Symbol Pages Fetcher
This version fixes V9.8.4 low coverage by fetching individual Mubasher stock pages for the full local symbol universe.
Rules:
- Never invent prices.
- Accept only rows that have symbol + positive price.
- Preserve existing data if coverage is too low.
- Public data can be delayed; validate before execution.
*/
const fs=require("fs");
const path=require("path");

const RUN_AT=new Date().toISOString();
const MIN_ROWS=Number(process.env.EGX_MIN_PUBLIC_ROWS||80);
const SYMBOL_LIMIT=Number(process.env.EGX_MUBASHER_STOCK_PAGE_LIMIT||260);
const CONCURRENCY=Math.max(1, Math.min(Number(process.env.EGX_FETCH_CONCURRENCY||8), 16));
const ACCEPT_LOW=String(process.env.EGX_ALLOW_LOW_COVERAGE_FETCH||"").toLowerCase()==="true";

function read(f,d){try{return JSON.parse(fs.readFileSync(f,"utf8"))}catch{return d}}
function write(f,o){fs.mkdirSync(path.dirname(f),{recursive:true});fs.writeFileSync(f,JSON.stringify(o,null,2),"utf8")}
function num(v){if(v==null||v==="")return null;let s=String(v).replace(/&nbsp;/g," ").replace(/[,%٬،]/g,"").replace(/[−–—]/g,"-").replace(/[^\d.+\-eE]/g,"");const n=Number(s);return Number.isFinite(n)?n:null}
function clean(s){return String(s==null?"":s).replace(/\s+/g," ").trim()}
function decode(s){return clean(String(s||"").replace(/&#x([0-9a-fA-F]+);/g,(_,h)=>String.fromCharCode(parseInt(h,16))).replace(/&#(\d+);/g,(_,d)=>String.fromCharCode(parseInt(d,10))).replace(/&nbsp;/g," ").replace(/&amp;/g,"&").replace(/&lt;/g,"<").replace(/&gt;/g,">").replace(/&quot;/g,'"').replace(/&#39;/g,"'"))}
function strip(html){return decode(String(html||"").replace(/<script[\s\S]*?<\/script>/gi," ").replace(/<style[\s\S]*?<\/style>/gi," ").replace(/<br\s*\/?>/gi," ").replace(/<[^>]+>/g," "))}
function normSymbol(v){return String(v||"").trim().toUpperCase().replace(/[^A-Z0-9._-]/g,"")}
function normalizeRow(r, source, url){
  const symbol=normSymbol(r.symbol);
  const price=num(r.price ?? r.last ?? r.lastPrice ?? r.close);
  if(!symbol || !price || price<=0)return null;
  return {
    symbol,
    name_ar:clean(r.name_ar||r.name||""),
    name_en:clean(r.name_en||r.name||""),
    price,
    last:price,
    change:num(r.change),
    changePct:num(r.changePct),
    open:num(r.open),
    previousClose:num(r.previousClose),
    high:num(r.high),
    low:num(r.low),
    volume:num(r.volume),
    valueTraded:num(r.valueTraded),
    updatedAt:r.updatedAt||RUN_AT,
    marketTime:r.marketTime||null,
    source,
    sourceUrl:url
  };
}
function uniqueRows(rows){
  const m=new Map();
  for(const r of rows){if(r&&r.symbol&&!m.has(r.symbol))m.set(r.symbol,r)}
  return [...m.values()];
}
function getUniverseSymbols(){
  const rec=read("data/recommendations.json",{});
  const market=read("data/market.json",{});
  const cache=read("data/full-market-cache.json",{});
  const hist=read("data/history.json",{});
  const set=new Set();
  for(const arr of [rec.all, market.rows, cache.rows]){
    if(Array.isArray(arr))arr.forEach(r=>{const s=normSymbol(r.symbol);if(s)set.add(s)});
  }
  const h=hist.sessionsBySymbol||hist.symbols||hist.history||{};
  Object.keys(h||{}).forEach(k=>{const s=normSymbol(k);if(s)set.add(s)});
  return [...set].filter(s=>s.length>=2&&s.length<=12).slice(0,SYMBOL_LIMIT);
}
async function fetchText(url){
  const res=await fetch(url,{headers:{
    "accept":"text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "accept-language":"en-US,en;q=0.9,ar;q=0.8",
    "cache-control":"no-cache",
    "pragma":"no-cache",
    "user-agent":"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36 EGXProHub/9.8.5"
  }});
  if(!res.ok)throw new Error(`HTTP ${res.status}`);
  return await res.text();
}
function parseMubasherPage(symbol, html, url){
  const plain=strip(html);
  if(/Sorry!\s*You need to log in/i.test(plain) && !new RegExp(`\\(${symbol}\\)`, "i").test(plain)){
    return {row:null, error:"login gate/no stock block"};
  }
  const stockHeaderRe=new RegExp(`([^\\n]{0,120}?)\\s*\\(${symbol.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')}\\)\\s*Last update:\\s*([^\\.]+?market time)\\.\\s*([0-9][0-9,.]*\\.?[0-9]*)\\s+([+\\-−–]?[0-9][0-9,.]*\\.?[0-9]*)\\s+([+\\-−–]?[0-9][0-9,.]*\\.?[0-9]*)%`, "i");
  let m=plain.match(stockHeaderRe);
  let name="", marketTime="", price=null, change=null, changePct=null;
  if(m){
    name=clean(m[1]);
    marketTime=clean(m[2]);
    price=num(m[3]);
    change=num(m[4]);
    changePct=num(m[5]);
  }else{
    const lastIdx=plain.search(/Last update:/i);
    if(lastIdx>=0){
      const snippet=plain.slice(Math.max(0,lastIdx-140), lastIdx+260);
      const m2=snippet.match(/(.{0,120})Last update:\s*([^\.]+?market time)\.\s*([0-9][0-9,.]*\.?[0-9]*)\s+([+\-−–]?[0-9][0-9,.]*\.?[0-9]*)\s+([+\-−–]?[0-9][0-9,.]*\.?[0-9]*)%/i);
      if(m2){
        name=clean(m2[1].replace(new RegExp(`\\(${symbol}\\)`,"i"),""));
        marketTime=clean(m2[2]);
        price=num(m2[3]);
        change=num(m2[4]);
        changePct=num(m2[5]);
      }
    }
  }
  if(!price){
    // Last chance: after exact heading, first positive number after market time
    const idx=plain.indexOf(`(${symbol})`);
    const snip=idx>=0?plain.slice(idx, idx+400):plain;
    const m3=snip.match(/market time\.\s*([0-9][0-9,.]*\.?[0-9]*)/i);
    price=m3?num(m3[1]):null;
  }
  const getAfter=(label)=>{
    const re=new RegExp(label+"\\s+([0-9][0-9,.]*\\.?[0-9]*)","i");
    const mm=plain.match(re); return mm?num(mm[1]):null;
  };
  const row=normalizeRow({
    symbol,
    name,
    price,
    change,
    changePct,
    open:getAfter("Open"),
    previousClose:getAfter("Previous Close"),
    high:getAfter("High"),
    low:getAfter("Low"),
    volume:getAfter("Volume"),
    valueTraded:getAfter("Turnover"),
    marketTime,
    updatedAt:RUN_AT
  },"mubasher_symbol_pages",url);
  return row?{row,error:null}:{row:null,error:"price parse failed"};
}
async function fetchSymbol(symbol){
  const urls=[
    `https://english.mubasher.info/markets/EGX/stocks/${encodeURIComponent(symbol)}/`,
    `https://english.mubasher.info/markets/egx/stocks/${encodeURIComponent(symbol)}/`,
    `https://www.mubasher.info/markets/EGX/stocks/${encodeURIComponent(symbol)}/`
  ];
  let lastErr="";
  for(const url of urls){
    try{
      const html=await fetchText(url);
      const parsed=parseMubasherPage(symbol, html, url);
      if(parsed.row)return {ok:true, row:parsed.row, symbol, url};
      lastErr=parsed.error||"parse failed";
    }catch(e){ lastErr=e.message; }
  }
  return {ok:false, symbol, error:lastErr};
}
async function mapLimit(items, limit, fn){
  const ret=[];
  let idx=0;
  async function worker(){
    while(idx<items.length){
      const i=idx++;
      ret[i]=await fn(items[i], i);
    }
  }
  await Promise.all(Array.from({length:Math.min(limit,items.length)},worker));
  return ret;
}
async function sourceConfiguredJson(){
  const url=process.env.EGX_MARKET_JSON_URL||process.env.PUBLIC_MARKET_JSON_URL||"";
  if(!url)return {ok:false,name:"configured_json",url:null,rows:[],message:"EGX_MARKET_JSON_URL not configured"};
  const raw=await fetchText(url);
  let payload; try{payload=JSON.parse(raw)}catch{throw new Error("Configured URL did not return JSON")}
  const arr=Array.isArray(payload)?payload:(payload.rows||payload.data||payload.all||[]);
  const rows=uniqueRows((arr||[]).map(r=>normalizeRow({
    symbol:r.symbol||r.ticker||r.code,
    name:r.name_ar||r.name_en||r.name,
    price:r.price??r.last??r.close??r.lastPrice,
    change:r.change,
    changePct:r.changePct??r.changePercent??r.percentChange,
    volume:r.volume??r.volumeTraded,
    valueTraded:r.valueTraded??r.turnover,
    updatedAt:r.updatedAt||r.timestamp||RUN_AT
  },"configured_json",url)).filter(Boolean));
  return {ok:rows.length>=MIN_ROWS||(ACCEPT_LOW&&rows.length),name:"configured_json",url,rows,message:`Parsed ${rows.length} rows`};
}
async function sourceMubasherSymbolPages(){
  const symbols=getUniverseSymbols();
  const results=await mapLimit(symbols, CONCURRENCY, fetchSymbol);
  const rows=uniqueRows(results.filter(x=>x.ok).map(x=>x.row));
  const failed=results.filter(x=>!x.ok).slice(0,20).map(x=>`${x.symbol}:${x.error}`);
  return {ok:rows.length>=MIN_ROWS||(ACCEPT_LOW&&rows.length),name:"mubasher_symbol_pages",url:`${symbols.length} symbols; concurrency ${CONCURRENCY}`,rows,message:`Parsed ${rows.length}/${symbols.length} symbol pages${failed.length?"; failed examples: "+failed.join(" | "):""}`};
}
async function sourceMubasherMarketPage(){
  const url="https://english.mubasher.info/markets/EGX/";
  const html=await fetchText(url);
  // Market page has indices mostly, not full stocks; still record failure explicitly
  return {ok:false,name:"mubasher_market_page",url,rows:[],message:`Fetched page length ${html.length}; not accepted as stock universe`};
}
async function trySources(){
  const attempts=[];
  const fns=[sourceConfiguredJson, sourceMubasherSymbolPages, sourceMubasherMarketPage];
  for(const fn of fns){
    try{
      const r=await fn();
      attempts.push({name:r.name,url:r.url,ok:!!r.ok,rows:r.rows.length,message:r.message});
      if(r.ok)return {selected:r,attempts};
    }catch(e){attempts.push({name:fn.name,url:null,ok:false,rows:0,error:e.stack||e.message})}
  }
  return {selected:null,attempts};
}
async function main(){
  const {selected,attempts}=await trySources();
  const existingMarket=read("data/market.json",{}), existingCache=read("data/full-market-cache.json",{}), rec=read("data/recommendations.json",{});
  const expected=Math.max(Array.isArray(existingCache.rows)?existingCache.rows.length:0, Array.isArray(rec.all)?rec.all.length:0, 224);
  if(selected&&selected.rows.length){
    const rows=uniqueRows(selected.rows);
    const coveragePct=expected?Number((rows.length/expected*100).toFixed(1)):0;
    write("data/market.json",{ok:true,generatedAt:RUN_AT,updatedAt:RUN_AT,source:selected.name,sourceUrl:selected.url,rows,note:"Public/delayed data fetched from Mubasher symbol pages. Validate with broker before trading."});
    write("data/source-health.json",{ok:true,generatedAt:RUN_AT,lastSuccessAt:RUN_AT,mode:"mubasher_symbol_pages_fetcher",sourceName:selected.name,sourceUrl:selected.url,marketRows:rows.length,cacheRows:Array.isArray(existingCache.rows)?existingCache.rows.length:0,recommendationRows:Array.isArray(rec.all)?rec.all.length:0,totalUniverse:expected,universeCoveragePct:coveragePct,coveragePct,delayed:true});
    write("data/fetch-status.json",{ok:true,realFetch:true,scriptExists:true,generatedAt:RUN_AT,mode:"mubasher_symbol_pages_fetcher",sourceName:selected.name,sourceUrl:selected.url,marketRows:rows.length,coveragePct,message:`Fetched and accepted ${rows.length} rows from ${selected.name}`});
    write("data/source-fetch-report.json",{ok:true,realFetch:true,engine:"v9_8_5_mubasher_symbol_pages_fetcher",generatedAt:RUN_AT,mode:"mubasher_symbol_pages_fetcher",sourceName:selected.name,selected:{name:selected.name,url:selected.url,rows:rows.length,message:selected.message},attempts,marketRows:rows.length,expectedUniverse:expected,coveragePct,minimumRows:MIN_ROWS,note:"Accepted public/delayed Mubasher symbol pages. Validate before execution."});
    console.log(`Accepted ${selected.name}: ${rows.length}/${expected} rows`);
    return;
  }
  const status={ok:false,realFetch:false,scriptExists:true,generatedAt:RUN_AT,mode:"mubasher_symbol_pages_failed_existing_files_only",sourceName:null,marketRows:Array.isArray(existingMarket.rows)?existingMarket.rows.length:0,cacheRows:Array.isArray(existingCache.rows)?existingCache.rows.length:0,recommendationRows:Array.isArray(rec.all)?rec.all.length:0,message:"Mubasher symbol pages did not produce enough valid rows. Existing repository data preserved; freshness is not guaranteed."};
  write("data/fetch-status.json",status);
  write("data/source-fetch-report.json",{ok:false,realFetch:false,engine:"v9_8_5_mubasher_symbol_pages_fetcher",generatedAt:RUN_AT,mode:status.mode,selected:null,attempts,marketRows:status.marketRows,expectedUniverse:expected,coveragePct:0,minimumRows:MIN_ROWS,note:"No data overwritten because coverage was too low."});
  console.warn(status.message);
}
main().catch(err=>{
  const status={ok:false,realFetch:false,scriptExists:true,generatedAt:new Date().toISOString(),mode:"mubasher_fetcher_exception",message:err.stack||err.message};
  write("data/fetch-status.json",status);
  write("data/source-fetch-report.json",{ok:false,realFetch:false,engine:"v9_8_5_mubasher_symbol_pages_fetcher",generatedAt:status.generatedAt,mode:status.mode,attempts:[],error:status.message});
  console.error(err);
});
