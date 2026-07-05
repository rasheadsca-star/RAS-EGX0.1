/*
EGX Pro Hub V9.8.4 — Public Market Source Adapter
Purpose:
- Periodically fetch EGX public/delayed market data from configured JSON, EGX official pages, and Mubasher public pages.
- Never invent prices.
- Only update market.json/source-health.json when a source returns enough valid rows.
Important:
- Public pages can change HTML structure or block bots. Failure is reported, not hidden.
- Mubasher pages state data can be delayed during market session.
*/
const fs = require("fs");
const path = require("path");

const RUN_AT = new Date().toISOString();
const MIN_ROWS = Number(process.env.EGX_MIN_PUBLIC_ROWS || 50);
const ACCEPT_LOW_COVERAGE = String(process.env.EGX_ALLOW_LOW_COVERAGE_FETCH || "").toLowerCase() === "true";

function read(f, d){ try { return JSON.parse(fs.readFileSync(f, "utf8")); } catch { return d; } }
function write(f, o){ fs.mkdirSync(path.dirname(f), {recursive:true}); fs.writeFileSync(f, JSON.stringify(o, null, 2), "utf8"); }
function num(v){
  if(v == null || v === "") return null;
  let s = String(v).replace(/&nbsp;/g, " ").replace(/[,%٬،]/g, "").replace(/[−–—]/g, "-").replace(/[^\d.+\-eE]/g, "");
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}
function text(v){ return String(v == null ? "" : v); }
function htmlDecode(s){
  return text(s)
    .replace(/&#x([0-9a-fA-F]+);/g, (_,h)=>String.fromCharCode(parseInt(h,16)))
    .replace(/&#(\d+);/g, (_,d)=>String.fromCharCode(parseInt(d,10)))
    .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'");
}
function stripTags(s){
  return htmlDecode(text(s)
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/t[dh]>/gi, "\t")
    .replace(/<\/tr>/gi, "\n")
    .replace(/<[^>]+>/g, " "))
    .replace(/\s+/g, " ").trim();
}
function normSymbol(v){
  return text(v).trim().toUpperCase().replace(/[^A-Z0-9._-]/g, "");
}
function normalizeName(v){ return text(v).replace(/\s+/g, " ").trim(); }
function normalizeRows(rows, sourceName, sourceUrl){
  const out = [];
  for(const r of rows || []){
    const symbol = normSymbol(r.symbol || r.ticker || r.code || r.Symbol || r.securityCode || r["Symbol"] || r["Code"]);
    if(!symbol || symbol.length < 2 || symbol.length > 12) continue;
    const price = num(r.price ?? r.last ?? r.lastPrice ?? r.close ?? r.Close ?? r["Last"] ?? r["Last Price"] ?? r["آخر"] ?? r["السعر"]);
    if(!price || price <= 0) continue;
    out.push({
      symbol,
      name_ar: normalizeName(r.name_ar || r.nameAr || r.arabicName || r.name || r.company || r["Name"] || r["Company"] || ""),
      name_en: normalizeName(r.name_en || r.nameEn || r.englishName || r.name || r.company || r["Name"] || r["Company"] || ""),
      price,
      last: price,
      change: num(r.change ?? r.changeValue ?? r["Change"]),
      changePct: num(r.changePct ?? r.change_percent ?? r.percentChange ?? r.changePercent ?? r["Change %"] ?? r["% Change"] ?? r["%"]),
      open: num(r.open ?? r["Open"]),
      high: num(r.high ?? r["High"]),
      low: num(r.low ?? r["Low"]),
      volume: num(r.volume ?? r.volumeTraded ?? r.tradedVolume ?? r["Volume"] ?? r["Vol."]),
      valueTraded: num(r.valueTraded ?? r.turnover ?? r.value ?? r.tradedValue ?? r["Turnover"] ?? r["Value"]),
      updatedAt: r.updatedAt || r.timestamp || RUN_AT,
      source: sourceName,
      sourceUrl
    });
  }
  const map = new Map();
  for(const r of out){
    if(!map.has(r.symbol)) map.set(r.symbol, r);
  }
  return Array.from(map.values());
}
async function fetchText(url){
  const res = await fetch(url, {
    headers: {
      "accept": "text/html,application/json,text/plain,*/*",
      "accept-language": "en-US,en;q=0.9,ar;q=0.8",
      "cache-control": "no-cache",
      "pragma": "no-cache",
      "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36 EGXProHub/9.8.4"
    }
  });
  if(!res.ok) throw new Error(`HTTP ${res.status}`);
  return await res.text();
}
function tableCells(rowHtml, tag){
  const re = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, "gi");
  const a = [];
  let m;
  while((m = re.exec(rowHtml))) a.push(stripTags(m[1]));
  return a;
}
function parseHtmlTables(html, sourceName, sourceUrl){
  const tables = [];
  const tre = /<table[\s\S]*?<\/table>/gi;
  let tm;
  while((tm = tre.exec(html))){
    const table = tm[0];
    const rows = [];
    const rre = /<tr[\s\S]*?<\/tr>/gi;
    let rm;
    while((rm = rre.exec(table))){
      const raw = rm[0];
      const th = tableCells(raw, "th");
      const td = tableCells(raw, "td");
      if(th.length || td.length) rows.push({th, td});
    }
    if(rows.length) tables.push(rows);
  }
  const allRows = [];
  for(const rows of tables){
    let headers = rows.find(r => r.th.length >= 2)?.th || [];
    if(!headers.length && rows[0]?.td?.length) headers = rows[0].td;
    const dataRows = rows.filter(r => r.td.length >= 3);
    for(const row of dataRows){
      const cells = row.td;
      const obj = {};
      cells.forEach((c, i) => {
        const h = headers[i] || `col${i}`;
        obj[h] = c;
      });
      const lowerHeaders = headers.map(h => h.toLowerCase());
      const findIdx = (patterns) => {
        for(const p of patterns){
          const idx = lowerHeaders.findIndex(h => h.includes(p));
          if(idx >= 0) return idx;
        }
        return -1;
      };
      const symbolIdx = findIdx(["symbol","code","ticker","رمز"]);
      const nameIdx = findIdx(["name","company","security","الشركة","الاسم"]);
      const lastIdx = findIdx(["last","close","price","آخر","السعر","إغلاق"]);
      const changePctIdx = findIdx(["change %","% change","percent","%","التغير"]);
      const volumeIdx = findIdx(["volume","vol","الكمية"]);
      const turnoverIdx = findIdx(["turnover","value","قيمة"]);
      const openIdx = findIdx(["open","افتتاح"]);
      const highIdx = findIdx(["high","أعلى"]);
      const lowIdx = findIdx(["low","أدنى"]);
      const candidate = {
        symbol: symbolIdx >= 0 ? cells[symbolIdx] : "",
        name: nameIdx >= 0 ? cells[nameIdx] : "",
        last: lastIdx >= 0 ? cells[lastIdx] : "",
        changePct: changePctIdx >= 0 ? cells[changePctIdx] : "",
        volume: volumeIdx >= 0 ? cells[volumeIdx] : "",
        valueTraded: turnoverIdx >= 0 ? cells[turnoverIdx] : "",
        open: openIdx >= 0 ? cells[openIdx] : "",
        high: highIdx >= 0 ? cells[highIdx] : "",
        low: lowIdx >= 0 ? cells[lowIdx] : ""
      };
      if(!candidate.symbol){
        // Common fallback: symbol is often first or second cell
        candidate.symbol = normSymbol(cells[0]) ? cells[0] : cells[1];
        candidate.name = candidate.name || cells[1] || cells[0];
        candidate.last = candidate.last || cells.find(c => num(c) && num(c) > 0);
      }
      allRows.push(candidate);
    }
  }
  return normalizeRows(allRows, sourceName, sourceUrl);
}
function extractInlineJsonObjects(html){
  const out = [];
  // Try JSON script blocks first
  const scriptRe = /<script[^>]*type=["']application\/json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let m;
  while((m = scriptRe.exec(html))){
    try { out.push(JSON.parse(htmlDecode(m[1]))); } catch {}
  }
  // Try common Next.js payload
  const next = html.match(/<script[^>]*id=["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/i);
  if(next){ try { out.push(JSON.parse(htmlDecode(next[1]))); } catch {} }
  return out;
}
function flattenRowsFromObject(obj, acc=[]){
  if(!obj || typeof obj !== "object") return acc;
  if(Array.isArray(obj)){
    if(obj.length && typeof obj[0] === "object"){
      const sample = obj[0];
      const keys = Object.keys(sample).map(k=>k.toLowerCase());
      if(keys.some(k=>["symbol","ticker","code","last","price","close"].includes(k) || k.includes("price"))) acc.push(obj);
    }
    for(const x of obj) flattenRowsFromObject(x, acc);
  } else {
    for(const k of Object.keys(obj)) flattenRowsFromObject(obj[k], acc);
  }
  return acc;
}
function parseJsonLike(html, sourceName, sourceUrl){
  const objects = extractInlineJsonObjects(html);
  const rows = [];
  for(const obj of objects){
    for(const arr of flattenRowsFromObject(obj)){
      rows.push(...normalizeRows(arr, sourceName, sourceUrl));
    }
  }
  return rows;
}
async function sourceConfiguredJson(){
  const url = process.env.EGX_MARKET_JSON_URL || process.env.PUBLIC_MARKET_JSON_URL || "";
  if(!url) return {ok:false, name:"configured_json", url:null, rows:[], message:"EGX_MARKET_JSON_URL not configured"};
  const raw = await fetchText(url);
  let payload;
  try { payload = JSON.parse(raw); } catch { throw new Error("Configured URL did not return valid JSON"); }
  const arr = Array.isArray(payload) ? payload : (payload.rows || payload.data || payload.all || []);
  const rows = normalizeRows(arr, "configured_json", url);
  return {ok:rows.length >= MIN_ROWS || (ACCEPT_LOW_COVERAGE && rows.length), name:"configured_json", url, rows, message:`Parsed ${rows.length} rows`};
}
async function sourceHtml(name, url){
  const raw = await fetchText(url);
  const tableRows = parseHtmlTables(raw, name, url);
  const jsonRows = parseJsonLike(raw, name, url);
  const rows = normalizeRows([...tableRows, ...jsonRows], name, url);
  return {ok:rows.length >= MIN_ROWS || (ACCEPT_LOW_COVERAGE && rows.length), name, url, rows, message:`Parsed ${rows.length} rows from HTML/inline JSON`};
}
async function sourceMubasherStockPages(){
  const rec = read("data/recommendations.json", {});
  const market = read("data/market.json", {});
  const syms = Array.from(new Set([...(rec.all||[]), ...(market.rows||[])].map(r=>normSymbol(r.symbol)).filter(Boolean)));
  const limit = Math.max(0, Math.min(Number(process.env.EGX_MUBASHER_STOCK_PAGE_LIMIT || 35), syms.length));
  const rows = [];
  const errors = [];
  for(const sym of syms.slice(0, limit)){
    const url = `https://english.mubasher.info/markets/EGX/stocks/${encodeURIComponent(sym)}/`;
    try{
      const raw = await fetchText(url);
      const plain = stripTags(raw);
      const priceMatch = plain.match(/Last update:.*?market time\.?\s*([0-9][0-9,]*\.?[0-9]*)/i) || plain.match(/\)\s*\([A-Z0-9._-]+\)\s*Last update:.*?([0-9][0-9,]*\.?[0-9]*)/i);
      const price = priceMatch ? num(priceMatch[1]) : null;
      const volume = num((plain.match(/Volume\s+([0-9,.]+)/i)||[])[1]);
      const turnover = num((plain.match(/Turnover\s+([0-9,.]+)/i)||[])[1]);
      const changePct = num((plain.match(/([+-]?[0-9,.]+)%\s+Open/i)||[])[1]);
      const name = (plain.match(/^(.+?)\s+\([A-Z0-9._-]+\)\s+Last update:/i)||[])[1] || "";
      if(price && price > 0) rows.push({symbol:sym, name, price, last:price, volume, valueTraded:turnover, changePct, updatedAt:RUN_AT, source:"mubasher_stock_pages", sourceUrl:url});
    }catch(e){ errors.push(`${sym}:${e.message}`); }
  }
  return {ok:rows.length >= MIN_ROWS || (ACCEPT_LOW_COVERAGE && rows.length), name:"mubasher_stock_pages", url:`${limit} symbol pages`, rows:normalizeRows(rows, "mubasher_stock_pages", "per-symbol"), message:`Parsed ${rows.length}/${limit} stock pages${errors.length ? "; errors: "+errors.slice(0,5).join(" | ") : ""}`};
}
async function trySources(){
  const candidates = [
    sourceConfiguredJson,
    () => sourceHtml("egx_official_prices", "https://www.egx.com.eg/en/prices.aspx"),
    () => sourceHtml("egx_official_home_market", "https://www.egx.com.eg/en/homepage.aspx"),
    () => sourceHtml("mubasher_english_stock_prices", "https://english.mubasher.info/countries/eg/stock-prices"),
    () => sourceHtml("mubasher_english_egx_stocks", "https://english.mubasher.info/markets/EGX/stocks"),
    () => sourceHtml("mubasher_arabic_stock_prices", "https://www.mubasher.info/countries/eg/stock-prices"),
    sourceMubasherStockPages
  ];
  const attempts = [];
  for(const fn of candidates){
    try{
      const res = await fn();
      attempts.push({name:res.name, url:res.url, ok:!!res.ok, rows:res.rows.length, message:res.message});
      if(res.ok) return {selected:res, attempts};
    }catch(e){
      attempts.push({name:fn.name || "source", url:null, ok:false, rows:0, error:e.message});
    }
  }
  return {selected:null, attempts};
}
function mergeRows(rows){
  // Keep only meaningful symbols and prefer fresh source rows.
  return normalizeRows(rows, rows[0]?.source || "public_adapter", rows[0]?.sourceUrl || "");
}
async function main(){
  const startedAt = RUN_AT;
  const {selected, attempts} = await trySources();
  const existingMarket = read("data/market.json", {});
  const existingCache = read("data/full-market-cache.json", {});
  const existingRec = read("data/recommendations.json", {});
  const expectedUniverse = Math.max(
    Array.isArray(existingCache.rows) ? existingCache.rows.length : 0,
    Array.isArray(existingRec.all) ? existingRec.all.length : 0,
    224
  );

  if(selected && selected.rows.length){
    const rows = mergeRows(selected.rows);
    const coveragePct = expectedUniverse ? Number((rows.length / expectedUniverse * 100).toFixed(1)) : 0;
    write("data/market.json", {
      ok:true,
      generatedAt:startedAt,
      updatedAt:startedAt,
      source:selected.name,
      sourceUrl:selected.url,
      rows,
      note:"Public/delayed data fetched by V9.8.4 adapter. Validate against broker before trading."
    });
    write("data/source-health.json", {
      ok:true,
      generatedAt:startedAt,
      lastSuccessAt:startedAt,
      mode:"public_market_source_adapter",
      sourceName:selected.name,
      sourceUrl:selected.url,
      marketRows:rows.length,
      cacheRows:Array.isArray(existingCache.rows)?existingCache.rows.length:0,
      recommendationRows:Array.isArray(existingRec.all)?existingRec.all.length:0,
      totalUniverse:expectedUniverse,
      universeCoveragePct:coveragePct,
      coveragePct,
      delayed:true
    });
    write("data/fetch-status.json", {
      ok:true,
      realFetch:true,
      scriptExists:true,
      generatedAt:startedAt,
      mode:"public_market_source_adapter",
      sourceName:selected.name,
      sourceUrl:selected.url,
      marketRows:rows.length,
      coveragePct,
      message:`Fetched and accepted ${rows.length} rows from ${selected.name}`
    });
    write("data/source-fetch-report.json", {
      ok:true,
      realFetch:true,
      engine:"v9_8_4_public_market_source_adapter",
      generatedAt:startedAt,
      mode:"public_market_source_adapter",
      sourceName:selected.name,
      selected:{name:selected.name,url:selected.url,rows:rows.length,message:selected.message},
      attempts,
      marketRows:rows.length,
      expectedUniverse,
      coveragePct,
      minimumRows:MIN_ROWS,
      note:"Adapter accepted a public source. Data may be delayed and should be validated before execution."
    });
    console.log(`Accepted public source ${selected.name}: ${rows.length} rows (${coveragePct}%)`);
    return;
  }

  const status = {
    ok:false,
    realFetch:false,
    scriptExists:true,
    generatedAt:startedAt,
    mode:"public_sources_failed_existing_files_only",
    sourceName:null,
    marketRows:Array.isArray(existingMarket.rows)?existingMarket.rows.length:0,
    cacheRows:Array.isArray(existingCache.rows)?existingCache.rows.length:0,
    recommendationRows:Array.isArray(existingRec.all)?existingRec.all.length:0,
    message:"All public source adapters failed or returned low coverage. Existing repository data preserved; freshness is not guaranteed."
  };
  write("data/fetch-status.json", status);
  write("data/source-fetch-report.json", {
    ok:false,
    realFetch:false,
    engine:"v9_8_4_public_market_source_adapter",
    generatedAt:startedAt,
    mode:status.mode,
    selected:null,
    attempts,
    marketRows:status.marketRows,
    expectedUniverse,
    coveragePct:0,
    minimumRows:MIN_ROWS,
    note:"No data was overwritten because no public source produced enough valid rows."
  });
  console.warn(status.message);
}
main().catch(err=>{
  const status = {ok:false, realFetch:false, scriptExists:true, generatedAt:new Date().toISOString(), mode:"adapter_exception", message:err.stack||err.message};
  write("data/fetch-status.json", status);
  write("data/source-fetch-report.json", {ok:false, realFetch:false, engine:"v9_8_4_public_market_source_adapter", generatedAt:status.generatedAt, mode:"adapter_exception", attempts:[], error:err.stack||err.message});
  console.error(err);
});
