#!/usr/bin/env node
/*
  EGX Pro Hub V9.1 — Mubasher Public Analysis Tools Collector
  Collects delayed public evidence from Mubasher analysis tools.
  Reliability rule: if a source fails in the current run, preserve the last good rows
  and mark them as staleFallback instead of wiping the evidence layer.
*/
const fs = require('fs');
const path = require('path');
const RUN_AT = new Date().toISOString();
const TIMEOUT_MS = Number(process.env.EGX_SOURCE_FETCH_TIMEOUT_MS || 45000);

const SOURCES = [
  { id:'volume', title:'Mubasher Volume Monitor', url:'https://www.mubasher.info/analysis-tools/volume-monitor/EGX' },
  { id:'liquidity', title:'Mubasher Liquidity Monitor', url:'https://www.mubasher.info/analysis-tools/liquidity-monitor/EGX' },
  { id:'supportResistance', title:'Mubasher Support & Resistance', url:'https://www.mubasher.info/analysis-tools/stocks-support-resistance/EGX' },
  { id:'financialRatios', title:'Mubasher Financial Ratios', url:'https://www.mubasher.info/analysis-tools/financial-ratios/EGX' }
];

function write(file, obj){ fs.mkdirSync(path.dirname(file), {recursive:true}); fs.writeFileSync(file, JSON.stringify(obj,null,2)+'\n', 'utf8'); }
function read(file, def){ try{return JSON.parse(fs.readFileSync(file,'utf8'))}catch{return def} }
function clean(s){ return String(s==null?'':s).replace(/<script[\s\S]*?<\/script>/gi,' ').replace(/<style[\s\S]*?<\/style>/gi,' ').replace(/&nbsp;/g,' ').replace(/&amp;/g,'&').replace(/&#x2F;|&#47;/g,'/').replace(/&quot;/g,'"').replace(/&#039;/g,"'").replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/\s+/g,' ').trim(); }
function stripTags(s){ return clean(String(s||'').replace(/<[^>]*>/g,' ')); }
function normSymbol(s){ return String(s||'').toUpperCase().replace(/\.CA$/,'').replace(/[^A-Z0-9.]/g,'').trim(); }
function num(v){ if(v==null)return null; let s=String(v).replace(/[,%٬،]/g,'').replace(/−/g,'-').trim(); let mult=1; if(/[Kk]$/.test(s)){mult=1e3;s=s.slice(0,-1)} if(/[Mm]$/.test(s)){mult=1e6;s=s.slice(0,-1)} if(/[Bb]$/.test(s)){mult=1e9;s=s.slice(0,-1)} s=s.replace(/[^0-9.\-+eE]/g,''); const n=Number(s); return Number.isFinite(n)?n*mult:null; }
function numbersFromCells(cells){ return cells.map(c=>({raw:c, value:num(c), isPercent:/[%٪]/.test(c)})).filter(x=>x.value!=null); }
function symbolFromRow(rowHtml){
  const patterns = [
    /href=["'][^"']*\/(?:stocks|companies|securities)\/([A-Z0-9.]+)(?:\.CA)?[^"']*["']/i,
    /\/markets\/EGX\/stocks\/([A-Z0-9.]+)(?:\.CA)?/i,
    /data-symbol=["']([A-Z0-9.]+)["']/i,
    /\b([A-Z]{2,6})(?:\.CA)?\b/
  ];
  for(const re of patterns){ const m=rowHtml.match(re); const s=normSymbol(m&&m[1]); if(s&&s.length>=2) return s; }
  return '';
}
function parseTableRows(html, sourceId){
  const rows=[]; const trRe=/<tr[\s\S]*?<\/tr>/gi; let m, idx=0;
  while((m=trRe.exec(html))){
    const tr=m[0]; if(!/<td[\s\S]*?<\/td>/i.test(tr)) continue;
    const cells=[]; let cm; const cellRe=/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi;
    while((cm=cellRe.exec(tr))) cells.push(stripTags(cm[1]));
    const symbol=symbolFromRow(tr); if(!symbol || cells.length<2) continue;
    const rowText=stripTags(tr); const numeric=numbersFromCells(cells);
    rows.push({symbol, sourceId, rowIndex:++idx, name:cells.find(c=>/[\u0600-\u06FF]/.test(c))||cells[0]||symbol, cells, numeric, rowText});
  }
  return rows;
}
function fallbackSymbolRows(html, sourceId){
  const text=stripTags(html); const rows=[];
  const re=/\b([A-Z]{2,6})(?:\.CA)?\b([^A-Z]{0,260})/g; let m;
  while((m=re.exec(text)) && rows.length<1200){
    const symbol=normSymbol(m[1]); if(!symbol||['EGX','USD','P/E','EPS'].includes(symbol)) continue;
    const chunk=(m[1]+(m[2]||'')).slice(0,420); const nums=[]; const nr=/[+\-]?\d+(?:[.,]\d+)?\s*[%٪]?/g; let mm;
    while((mm=nr.exec(chunk)) && nums.length<12) nums.push({raw:mm[0], value:num(mm[0]), isPercent:/[%٪]/.test(mm[0])});
    if(nums.length) rows.push({symbol, sourceId, rowIndex:rows.length+1, name:symbol, cells:[chunk], numeric:nums, rowText:chunk, fallback:true});
  }
  return rows;
}
function lastGoodFor(src){
  const old=read(`data/mubasher-${src.id}.json`, null);
  if(old && Array.isArray(old.rows) && old.rows.length){
    return {...old, ok:true, currentRunOk:false, staleFallback:true, fallbackAt:RUN_AT, note:`current fetch failed; preserved previous good ${src.id} rows`, error:old.error||null};
  }
  return null;
}
async function fetchSource(src){
  const controller=new AbortController(); const timeout=setTimeout(()=>controller.abort(), TIMEOUT_MS);
  try{
    const res=await fetch(src.url, {signal:controller.signal, headers:{'user-agent':'Mozilla/5.0 EGX-Pro-Hub/9.1 SourceEvidence','accept':'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8','accept-language':'ar,en;q=0.8','cache-control':'no-cache'}});
    const text=await res.text();
    let rows=parseTableRows(text, src.id); if(!rows.length) rows=fallbackSymbolRows(text, src.id);
    if(rows.length){
      return {ok:true, currentRunOk:res.ok, staleFallback:false, id:src.id, title:src.title, url:src.url, httpStatus:res.status, generatedAt:RUN_AT, rows, count:rows.length, note:res.ok?'parsed current source':'parsed current source despite non-200 status'};
    }
    const fallback=lastGoodFor(src);
    if(fallback) return {...fallback, id:src.id, title:src.title, url:src.url, httpStatus:res.status, count:fallback.rows.length, error:'no rows parsed in current fetch'};
    return {ok:false, currentRunOk:false, staleFallback:false, id:src.id, title:src.title, url:src.url, httpStatus:res.status, generatedAt:RUN_AT, rows:[], count:0, error:'no rows parsed from source'};
  }catch(e){
    const fallback=lastGoodFor(src);
    if(fallback) return {...fallback, id:src.id, title:src.title, url:src.url, count:fallback.rows.length, error:String(e&&e.message||e)};
    return {ok:false, currentRunOk:false, staleFallback:false, id:src.id, title:src.title, url:src.url, generatedAt:RUN_AT, rows:[], count:0, error:String(e&&e.message||e)};
  }finally{clearTimeout(timeout)}
}
function mergeBySymbol(results){
  const map={};
  for(const src of results){
    for(const r of (src.rows||[])){
      const key=normSymbol(r.symbol); if(!key) continue;
      if(!map[key]) map[key]={symbol:key, sources:{}, sourceCount:0, sourceQuality:{}};
      map[key].sources[src.id]={name:r.name, cells:r.cells, numeric:r.numeric, rowText:r.rowText, sourceTitle:src.title, url:src.url, fallback:!!r.fallback, staleFallback:!!src.staleFallback};
      map[key].sourceQuality[src.id]={ok:src.ok, currentRunOk:!!src.currentRunOk, staleFallback:!!src.staleFallback};
    }
  }
  for(const k of Object.keys(map)) map[k].sourceCount=Object.keys(map[k].sources).length;
  return Object.values(map).sort((a,b)=>b.sourceCount-a.sourceCount||a.symbol.localeCompare(b.symbol));
}
async function main(){
  const results=[];
  for(const src of SOURCES){
    const r=await fetchSource(src); results.push(r); write(`data/mubasher-${src.id}.json`, r);
    console.log(src.id, r.ok?'ok':'warn', r.count||0, r.staleFallback?'stale-fallback':'current');
  }
  const symbols=mergeBySymbol(results);
  const currentOk=results.filter(r=>r.currentRunOk && !r.staleFallback).length;
  const report={ok:results.some(r=>r.ok), engine:'v9_1_mubasher_public_analysis_tools_collector', generatedAt:RUN_AT, delayed:true, sourceNote:'Mubasher public delayed analysis tools; evidence layer only, not live execution data.', summary:{sources:results.length, sourcesOk:results.filter(r=>r.ok).length, currentSourcesOk:currentOk, staleFallbackSources:results.filter(r=>r.staleFallback).length, totalRows:results.reduce((s,r)=>s+(r.count||0),0), uniqueSymbols:symbols.length}, sources:results.map(r=>({id:r.id,title:r.title,url:r.url,ok:r.ok,currentRunOk:!!r.currentRunOk,staleFallback:!!r.staleFallback,httpStatus:r.httpStatus,count:r.count,error:r.error||null,note:r.note||''})), symbols};
  write('data/mubasher-analysis-tools.json', report);
}
main().catch(e=>{console.error(e); write('data/mubasher-analysis-tools.json',{ok:false,engine:'v9_1_mubasher_public_analysis_tools_collector',generatedAt:RUN_AT,error:String(e&&e.stack||e)}); process.exitCode=0;});
