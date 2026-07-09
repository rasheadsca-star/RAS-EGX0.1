#!/usr/bin/env node
'use strict';

/**
 * RAS EGX /GOAL — Mubasher Primary Feeds Collector
 *
 * Purpose:
 * 1) Use Mubasher as a PRIMARY, mandatory input for price, volume/turnover,
 *    liquidity proxy, support and resistance.
 * 2) The bulk analysis-tool pages are checked and audited, but they often render
 *    Angular placeholders in raw HTML. When that happens, this script falls back
 *    to the public Mubasher stock pages and per-symbol support-resistance pages,
 *    which expose actual values in server-rendered HTML.
 * 3) Merge verified fields back into data/market.json before ranking/decision.
 *
 * No npm dependencies. Uses Node 22+ global fetch.
 */

const fs = require('fs');
const path = require('path');

const RUN_AT = new Date().toISOString();
const ROOT = process.cwd();
const DATA_DIR = path.join(ROOT, 'data');

const CONCURRENCY = Math.max(1, Number(process.env.EGX_MUBASHER_CONCURRENCY || 4));
const TIMEOUT_MS = Math.max(5000, Number(process.env.EGX_MUBASHER_TIMEOUT_MS || 25000));
const REQUEST_DELAY_MS = Math.max(0, Number(process.env.EGX_MUBASHER_REQUEST_DELAY_MS || 120));
const MAX_SYMBOLS = Math.max(0, Number(process.env.EGX_MUBASHER_MAX_SYMBOLS || 0));
const MIN_PRICE_COVERAGE = Math.max(0, Number(process.env.EGX_MUBASHER_MIN_PRICE_COVERAGE || 45));
const MIN_SR_COVERAGE = Math.max(0, Number(process.env.EGX_MUBASHER_MIN_SR_COVERAGE || 25));
const STALE_OK_HOURS = Math.max(0, Number(process.env.EGX_MUBASHER_STALE_OK_HOURS || 36));

const BULK_TOOLS = [
  {
    id: 'volumeMonitor',
    group: 'volume',
    title: 'Mubasher Volume Monitor',
    url: 'https://www.mubasher.info/analysis-tools/volume-monitor/EGX',
    out: 'mubasher-volume-monitor.json',
  },
  {
    id: 'liquidityMonitor',
    group: 'liquidity',
    title: 'Mubasher Liquidity Monitor',
    url: 'https://www.mubasher.info/analysis-tools/liquidity-monitor/EGX',
    out: 'mubasher-liquidity-monitor.json',
  },
  {
    id: 'supportResistanceMonitor',
    group: 'supportResistance',
    title: 'Mubasher Support & Resistance Monitor',
    url: 'https://www.mubasher.info/analysis-tools/stocks-support-resistance/EGX',
    out: 'mubasher-support-resistance.json',
  },
];

function p(...x) { return path.join(ROOT, ...x); }
function ensureDir(file) { fs.mkdirSync(path.dirname(file), { recursive: true }); }
function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}
function writeJson(file, obj) {
  ensureDir(file);
  fs.writeFileSync(file, JSON.stringify(obj, null, 2) + '\n', 'utf8');
}
function rowsOf(x) {
  if (Array.isArray(x)) return x;
  if (Array.isArray(x?.rows)) return x.rows;
  if (Array.isArray(x?.data)) return x.data;
  if (Array.isArray(x?.items)) return x.items;
  if (Array.isArray(x?.all)) return x.all;
  if (Array.isArray(x?.symbols)) return x.symbols;
  return [];
}
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
function cleanText(s) {
  return String(s ?? '')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/\u00a0/g, ' ')
    .trim();
}
function stripHtml(html) {
  return cleanText(String(html || '')
    .replace(/<br\s*\/?\s*>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<\/div>/gi, '\n')
    .replace(/<\/li>/gi, '\n')
    .replace(/<\/tr>/gi, '\n')
    .replace(/<[^>]+>/g, ' '))
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s+/g, '\n')
    .replace(/\n{2,}/g, '\n');
}
function linesOf(html) {
  return stripHtml(html).split(/\n+/).map(s => s.trim()).filter(Boolean);
}
function sym(v) {
  return String(v || '')
    .toUpperCase()
    .replace(/\.CA$/i, '')
    .replace(/[^A-Z0-9.]/g, '')
    .trim();
}
function num(v) {
  if (v == null || v === '') return null;
  let s = String(v)
    .replace(/\(([^)]+)\)/g, '-$1')
    .replace(/[,%٬،]/g, '')
    .replace(/−/g, '-')
    .replace(/\s+/g, '')
    .trim();
  let mult = 1;
  if (/K$/i.test(s)) { mult = 1e3; s = s.slice(0, -1); }
  if (/M$/i.test(s)) { mult = 1e6; s = s.slice(0, -1); }
  if (/B$/i.test(s)) { mult = 1e9; s = s.slice(0, -1); }
  s = s.replace(/[^0-9.+\-eE]/g, '');
  const n = Number(s);
  return Number.isFinite(n) ? n * mult : null;
}
function finite(v) {
  const n = num(v);
  return Number.isFinite(n) ? n : null;
}
function pct(v) {
  const n = finite(v);
  return Number.isFinite(n) ? n : null;
}
function first(...vals) {
  for (const v of vals) {
    if (v !== null && v !== undefined && v !== '') return v;
  }
  return null;
}
function escapeRegExp(s) { return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

function getName(row) {
  return first(row.name_ar, row.nameAr, row.arabicName, row.name_en, row.nameEn, row.name, row.companyName, row.company, row.symbol, row.ticker) || '';
}

function buildUniverse() {
  const candidates = [
    'data/market.json',
    'data/full-market-cache.json',
    'data/recommendations.json',
    'data/final-opportunity-ranking.json',
    'data/final-multisource-ranking.json',
  ];
  const map = new Map();
  for (const rel of candidates) {
    const rows = rowsOf(readJson(p(rel), []));
    for (const r of rows) {
      const k = sym(first(r.symbol, r.ticker, r.code, r.shortName));
      if (!k) continue;
      const old = map.get(k) || {};
      map.set(k, { ...old, ...r, symbol: k, name: getName(r) || getName(old) || k });
    }
  }
  const out = Array.from(map.values())
    .filter(r => sym(r.symbol))
    .sort((a, b) => String(a.symbol).localeCompare(String(b.symbol)));
  return MAX_SYMBOLS ? out.slice(0, MAX_SYMBOLS) : out;
}

async function fetchText(url, label) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      redirect: 'follow',
      headers: {
        'user-agent': 'Mozilla/5.0 (compatible; RAS-EGX-GOAL/1.2; +https://github.com/rasheadsca-star/RAS-EGX0.1)',
        'accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,application/json;q=0.8,*/*;q=0.7',
        'accept-language': 'en-US,en;q=0.9,ar;q=0.8',
        'cache-control': 'no-cache',
      },
    });
    const text = await res.text();
    return { ok: res.ok, status: res.status, url: res.url || url, text, error: '' };
  } catch (e) {
    return { ok: false, status: 0, url, text: '', error: `${label || url}: ${e && e.message || e}` };
  } finally {
    clearTimeout(t);
  }
}

function looksLikeAngularPlaceholder(html) {
  return /\{\{\s*row\./i.test(html) || /ng-repeat|ng-if|\|\s*number\s*[:}]/i.test(html);
}

function parseBulkToolRows(html, tool, universeSet) {
  if (!html || looksLikeAngularPlaceholder(html)) return [];
  const rows = [];
  const trRe = /<tr\b[\s\S]*?<\/tr>/gi;
  let m;
  while ((m = trRe.exec(html))) {
    const tr = m[0];
    const txt = stripHtml(tr).replace(/\n/g, ' ').trim();
    if (!txt) continue;
    if (/\{\{\s*row\./i.test(txt)) continue;
    let k = '';
    for (const symbol of universeSet) {
      if (new RegExp(`\\b${escapeRegExp(symbol)}(?:\\.CA)?\\b`, 'i').test(txt)) { k = symbol; break; }
    }
    if (!k) continue;
    rows.push({ symbol: k, source: tool.url, rawText: txt, numbers: (txt.match(/[-+]?\d[\d,]*(?:\.\d+)?%?/g) || []) });
  }
  return rows;
}

function parseValueAfterLabel(lines, labelVariants) {
  const labels = Array.isArray(labelVariants) ? labelVariants : [labelVariants];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    for (const label of labels) {
      const re = new RegExp(`${escapeRegExp(label)}\\s+([-+]?\\d[\\d,]*(?:\\.\\d+)?%?)`, 'i');
      const m = line.match(re);
      if (m) return finite(m[1]);
      if (new RegExp(`^${escapeRegExp(label)}$`, 'i').test(line) && lines[i + 1]) {
        const n = finite(lines[i + 1]);
        if (n !== null) return n;
      }
    }
  }
  return null;
}

function parseLineAfter(lines, labelRegex) {
  for (let i = 0; i < lines.length; i++) {
    if (labelRegex.test(lines[i])) return lines[i + 1] || '';
  }
  return '';
}

function parseProfile(symbol, html, url) {
  const lines = linesOf(html);
  const text = lines.join('\n');
  const lineText = lines.join(' ');
  const lastUpdateLine = lines.find(x => /^Last update:/i.test(x)) || '';
  const lastUpdate = lastUpdateLine.replace(/^Last update:\s*/i, '').trim();

  let price = null, change = null, changePct = null;
  const idx = lines.findIndex(x => /^Last update:/i.test(x));
  if (idx >= 0) {
    const nums = [];
    for (let i = idx + 1; i < Math.min(lines.length, idx + 12); i++) {
      if (/^(Open|Previous Close|High|Low|Stock Statistics|Volume|Turnover)\b/i.test(lines[i])) break;
      const n = finite(lines[i]);
      if (n !== null) nums.push({ n, raw: lines[i] });
      if (nums.length >= 3) break;
    }
    price = nums[0]?.n ?? null;
    change = nums[1]?.n ?? null;
    changePct = nums[2]?.n ?? null;
  }

  price = first(price, parseValueAfterLabel(lines, ['Last Price', 'Price']));

  const open = parseValueAfterLabel(lines, 'Open');
  const previousClose = parseValueAfterLabel(lines, 'Previous Close');
  const high = parseValueAfterLabel(lines, 'High');
  const low = parseValueAfterLabel(lines, 'Low');
  const volume = parseValueAfterLabel(lines, 'Volume');
  const turnover = parseValueAfterLabel(lines, 'Turnover');

  const hasDelayedNotice = /Data is delayed 15 minutes during market session|All data are 15 minutes late during market session/i.test(lineText);
  const titleLine = lines.find(x => new RegExp(`\\(${escapeRegExp(symbol)}\\)`, 'i').test(x)) || '';

  return {
    symbol,
    name: titleLine.replace(new RegExp(`\\s*\\(${escapeRegExp(symbol)}\\).*`, 'i'), '').replace(/^#\s*/, '').trim() || symbol,
    url,
    lastUpdate,
    lastPrice: finite(price),
    change: finite(change),
    changePct: pct(changePct),
    open: finite(open),
    previousClose: finite(previousClose),
    high: finite(high),
    low: finite(low),
    volume: finite(volume),
    turnover: finite(turnover),
    delayed: hasDelayedNotice,
    parsed: Boolean(finite(price) || finite(volume) || finite(turnover)),
  };
}

function parseSupportResistance(symbol, html, url) {
  const lines = linesOf(html);
  const lineText = lines.join(' ');
  const sectionIdx = lines.findIndex(x => /^##\s*Support and resistance/i.test(x) || /^Support and resistance$/i.test(x));
  const scoped = sectionIdx >= 0 ? lines.slice(sectionIdx, Math.min(lines.length, sectionIdx + 35)) : lines;

  const price = (() => {
    if (sectionIdx >= 0) {
      for (let i = sectionIdx + 1; i < Math.min(lines.length, sectionIdx + 8); i++) {
        const n = finite(lines[i]);
        if (n !== null) return n;
      }
    }
    return null;
  })();

  const volume = parseValueAfterLabel(scoped, 'Volume');
  const priceToPivotPct = parseValueAfterLabel(scoped, 'Price to pivot point');
  const resistance2 = parseValueAfterLabel(scoped, ['Second resistance level (r2)', 'Second resistance level']);
  const resistance1 = parseValueAfterLabel(scoped, ['First resistance level (r1)', 'First resistance level']);
  const pivotPoint = parseValueAfterLabel(scoped, ['Pivot point']);
  const support1 = parseValueAfterLabel(scoped, ['First support level (s1)', 'First support level (d1)', 'First support level']);
  const support2 = parseValueAfterLabel(scoped, ['Second support level (s2)', 'Second support level (d1)', 'Second support level']);
  const lastUpdateLine = lines.find(x => /^Last update:/i.test(x)) || '';

  return {
    symbol,
    url,
    lastUpdate: lastUpdateLine.replace(/^Last update:\s*/i, '').trim(),
    price: finite(price),
    volume: finite(volume),
    priceToPivotPct: pct(priceToPivotPct),
    resistance1: finite(resistance1),
    resistance2: finite(resistance2),
    pivotPoint: finite(pivotPoint),
    support1: finite(support1),
    support2: finite(support2),
    delayed: /Data is delayed 15 minutes|All data are 15 minutes late/i.test(lineText),
    parsed: Boolean(finite(resistance1) || finite(support1) || finite(pivotPoint)),
  };
}

async function fetchSymbol(symbol) {
  const base = `https://english.mubasher.info/markets/EGX/stocks/${encodeURIComponent(symbol)}/`;
  const srUrl = `${base}support-resistance`;
  const stockFetch = await fetchText(base, `${symbol} stock`);
  await sleep(REQUEST_DELAY_MS);
  const srFetch = await fetchText(srUrl, `${symbol} support-resistance`);
  const stock = stockFetch.ok ? parseProfile(symbol, stockFetch.text, stockFetch.url) : { symbol, url: base, parsed: false, error: stockFetch.error || `HTTP ${stockFetch.status}` };
  const supportResistance = srFetch.ok ? parseSupportResistance(symbol, srFetch.text, srFetch.url) : { symbol, url: srUrl, parsed: false, error: srFetch.error || `HTTP ${srFetch.status}` };
  return {
    symbol,
    ok: Boolean(stock.parsed || supportResistance.parsed),
    currentRunOk: Boolean((stockFetch.ok && stock.parsed) || (srFetch.ok && supportResistance.parsed)),
    generatedAt: RUN_AT,
    stockHttpStatus: stockFetch.status,
    supportResistanceHttpStatus: srFetch.status,
    stock,
    supportResistance,
    errors: [stock.error, supportResistance.error].filter(Boolean),
  };
}

async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let next = 0;
  async function worker() {
    while (true) {
      const i = next++;
      if (i >= items.length) break;
      try { out[i] = await fn(items[i], i); }
      catch (e) { out[i] = { symbol: items[i]?.symbol || String(items[i]), ok: false, error: String(e && e.stack || e) }; }
      if (REQUEST_DELAY_MS) await sleep(REQUEST_DELAY_MS);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

async function collectBulkTools(universeSet) {
  const results = [];
  for (const tool of BULK_TOOLS) {
    const res = await fetchText(tool.url, tool.title);
    const rows = res.ok ? parseBulkToolRows(res.text, tool, universeSet) : [];
    const placeholders = res.text ? looksLikeAngularPlaceholder(res.text) : false;
    results.push({
      id: tool.id,
      group: tool.group,
      title: tool.title,
      url: tool.url,
      ok: rows.length > 0,
      currentRunOk: res.ok,
      httpStatus: res.status,
      generatedAt: RUN_AT,
      rows,
      rowCount: rows.length,
      angularPlaceholdersDetected: placeholders,
      note: rows.length ? 'Bulk HTML rows parsed.' : (placeholders ? 'Bulk page returned Angular placeholders; profile-page fallback is required.' : 'No bulk rows parsed; profile-page fallback is required.'),
      error: res.error || '',
    });
    await sleep(REQUEST_DELAY_MS);
  }
  return results;
}

function previousPrimaryRows() {
  const old = readJson(p('data/mubasher-stock-pages-primary.json'), null);
  if (!old || !Array.isArray(old.rows)) return null;
  const generated = Date.parse(old.generatedAt || old.summary?.generatedAt || '');
  const hours = Number.isFinite(generated) ? (Date.now() - generated) / 36e5 : Infinity;
  return { ...old, staleFallback: true, staleAgeHours: Number(hours.toFixed(2)), staleOk: hours <= STALE_OK_HOURS };
}

function buildDerivedFeeds(rows, bulkResults) {
  const bySymbol = new Map(rows.map(r => [sym(r.symbol), r]));

  const volumeRows = rows.map(r => ({
    symbol: r.symbol,
    name: r.stock?.name || r.symbol,
    volume: r.stock?.volume ?? r.supportResistance?.volume ?? null,
    lastPrice: r.stock?.lastPrice ?? r.supportResistance?.price ?? null,
    updatedAt: r.stock?.lastUpdate || r.supportResistance?.lastUpdate || '',
    source: r.stock?.url || '',
    sourceMode: 'mubasher_stock_profile_primary',
  })).filter(r => r.volume != null || r.lastPrice != null);

  const liquidityRows = rows.map(r => ({
    symbol: r.symbol,
    name: r.stock?.name || r.symbol,
    lastPrice: r.stock?.lastPrice ?? r.supportResistance?.price ?? null,
    turnover: r.stock?.turnover ?? null,
    valueTraded: r.stock?.turnover ?? null,
    updatedAt: r.stock?.lastUpdate || '',
    source: r.stock?.url || '',
    sourceMode: 'mubasher_stock_profile_turnover_primary',
  })).filter(r => r.turnover != null || r.lastPrice != null);

  const srRows = rows.map(r => ({
    symbol: r.symbol,
    name: r.stock?.name || r.symbol,
    lastPrice: r.supportResistance?.price ?? r.stock?.lastPrice ?? null,
    support1: r.supportResistance?.support1 ?? null,
    support2: r.supportResistance?.support2 ?? null,
    resistance1: r.supportResistance?.resistance1 ?? null,
    resistance2: r.supportResistance?.resistance2 ?? null,
    pivotPoint: r.supportResistance?.pivotPoint ?? null,
    priceToPivotPct: r.supportResistance?.priceToPivotPct ?? null,
    updatedAt: r.supportResistance?.lastUpdate || '',
    source: r.supportResistance?.url || '',
    sourceMode: 'mubasher_stock_support_resistance_primary',
  })).filter(r => r.support1 != null || r.resistance1 != null || r.pivotPoint != null || r.lastPrice != null);

  const bulk = Object.fromEntries(bulkResults.map(x => [x.group, x]));
  return {
    volume: {
      ok: volumeRows.length > 0,
      engine: 'mubasher_primary_volume_from_stock_pages_v1_2',
      generatedAt: RUN_AT,
      sourceUrl: BULK_TOOLS.find(x => x.group === 'volume')?.url,
      sourceMode: bulk.volume?.ok ? 'bulk_analysis_tool' : 'profile_page_primary_fallback',
      bulkRowsCount: bulk.volume?.rows?.length || 0,
      profileFallbackRowsCount: volumeRows.length,
      bulkAudit: bulk.volume || null,
      rows: bulk.volume?.ok ? bulk.volume.rows : volumeRows,
    },
    liquidity: {
      ok: liquidityRows.length > 0,
      engine: 'mubasher_primary_liquidity_from_stock_turnover_v1_2',
      generatedAt: RUN_AT,
      sourceUrl: BULK_TOOLS.find(x => x.group === 'liquidity')?.url,
      sourceMode: bulk.liquidity?.ok ? 'bulk_analysis_tool' : 'profile_page_turnover_primary_fallback',
      bulkRowsCount: bulk.liquidity?.rows?.length || 0,
      profileFallbackRowsCount: liquidityRows.length,
      bulkAudit: bulk.liquidity || null,
      rows: bulk.liquidity?.ok ? bulk.liquidity.rows : liquidityRows,
    },
    supportResistance: {
      ok: srRows.length > 0,
      engine: 'mubasher_primary_support_resistance_from_stock_pages_v1_2',
      generatedAt: RUN_AT,
      sourceUrl: BULK_TOOLS.find(x => x.group === 'supportResistance')?.url,
      sourceMode: bulk.supportResistance?.ok ? 'bulk_analysis_tool' : 'per_symbol_support_resistance_page_primary_fallback',
      bulkRowsCount: bulk.supportResistance?.rows?.length || 0,
      profileFallbackRowsCount: srRows.length,
      bulkAudit: bulk.supportResistance || null,
      rows: bulk.supportResistance?.ok ? bulk.supportResistance.rows : srRows,
    },
    bySymbol,
  };
}

function validPrice(v) { const n = finite(v); return n != null && n > 0; }
function validValue(v) { const n = finite(v); return n != null && n > 0; }
function validSr(row) {
  return validValue(row?.support1) && validValue(row?.resistance1) && finite(row.support1) < finite(row.resistance1);
}

function enrichMarketWithMubasher(primaryRows) {
  const marketPath = p('data/market.json');
  const marketObj = readJson(marketPath, []);
  const marketRows = rowsOf(marketObj);
  if (!marketRows.length) return { updated: false, count: 0, path: 'data/market.json', reason: 'market.json not found or empty' };

  const bySymbol = new Map(primaryRows.map(r => [sym(r.symbol), r]));
  let enriched = 0;
  const updatedRows = marketRows.map(r => {
    const k = sym(first(r.symbol, r.ticker, r.code));
    const feed = bySymbol.get(k);
    if (!feed) return r;
    const st = feed.stock || {};
    const sr = feed.supportResistance || {};
    const lastPrice = finite(first(st.lastPrice, sr.price));
    const volume = finite(first(st.volume, sr.volume));
    const turnover = finite(st.turnover);
    const support1 = finite(sr.support1);
    const support2 = finite(sr.support2);
    const resistance1 = finite(sr.resistance1);
    const resistance2 = finite(sr.resistance2);
    const pivotPoint = finite(sr.pivotPoint);
    const hasPrice = validPrice(lastPrice);
    const hasVolume = validValue(volume);
    const hasTurnover = validValue(turnover);
    const hasLiquidity = hasTurnover || hasVolume;
    const hasSupportResistance = validSr({ support1, resistance1 });
    const missing = [];
    if (!hasPrice) missing.push('السعر غير متاح من مباشر');
    if (!hasLiquidity) missing.push('السيولة/قيمة أو حجم التداول غير متاحة من مباشر');
    if (!hasSupportResistance) missing.push('الدعم والمقاومة غير متاحة من مباشر');

    const sources = {
      ...(r.sources && typeof r.sources === 'object' && !Array.isArray(r.sources) ? r.sources : {}),
      mubasherPrimary: {
        stockUrl: st.url || '',
        supportResistanceUrl: sr.url || '',
        generatedAt: RUN_AT,
        delayed: Boolean(st.delayed || sr.delayed),
        hasPrice,
        hasLiquidity,
        hasSupportResistance,
      },
    };

    const out = {
      ...r,
      symbol: k || r.symbol,
      price: hasPrice ? lastPrice : r.price,
      lastPrice: hasPrice ? lastPrice : r.lastPrice,
      currentPrice: hasPrice ? lastPrice : r.currentPrice,
      mubasherPrice: hasPrice ? lastPrice : null,
      open: validValue(st.open) ? st.open : r.open,
      previousClose: validValue(st.previousClose) ? st.previousClose : r.previousClose,
      high: validValue(st.high) ? st.high : r.high,
      low: validValue(st.low) ? st.low : r.low,
      volume: hasVolume ? volume : r.volume,
      mubasherVolume: hasVolume ? volume : null,
      turnover: hasTurnover ? turnover : r.turnover,
      valueTraded: hasTurnover ? turnover : (r.valueTraded ?? r.turnover),
      mubasherTurnover: hasTurnover ? turnover : null,
      liquidityValue: hasTurnover ? turnover : r.liquidityValue,
      support1: hasSupportResistance ? support1 : r.support1,
      support2: validValue(support2) ? support2 : r.support2,
      resistance1: hasSupportResistance ? resistance1 : r.resistance1,
      resistance2: validValue(resistance2) ? resistance2 : r.resistance2,
      pivotPoint: validValue(pivotPoint) ? pivotPoint : r.pivotPoint,
      priceToPivotPct: finite(sr.priceToPivotPct) ?? r.priceToPivotPct,
      sources,
      dataFreshness: {
        ...(r.dataFreshness || {}),
        mubasherPrimaryGeneratedAt: RUN_AT,
        mubasherStockLastUpdate: st.lastUpdate || '',
        mubasherSupportResistanceLastUpdate: sr.lastUpdate || '',
        delayed15Minutes: Boolean(st.delayed || sr.delayed),
      },
      mubasherPrimaryFeed: {
        ok: Boolean(feed.ok),
        currentRunOk: Boolean(feed.currentRunOk),
        hasPrice,
        hasVolume,
        hasTurnover,
        hasLiquidity,
        hasSupportResistance,
        missing,
        stock: st,
        supportResistance: sr,
      },
      missingCoreFields: missing,
      coreDataReady: missing.length === 0,
    };
    enriched += 1;
    return out;
  });

  if (Array.isArray(marketObj)) writeJson(marketPath, updatedRows);
  else writeJson(marketPath, { ...marketObj, rows: updatedRows, generatedAt: marketObj.generatedAt || RUN_AT, mubasherPrimaryMergedAt: RUN_AT });
  return { updated: true, count: enriched, path: 'data/market.json' };
}

function makeSummary(rows, bulkResults, marketMerge, staleFallback = null) {
  const total = rows.length;
  const price = rows.filter(r => validPrice(first(r.stock?.lastPrice, r.supportResistance?.price))).length;
  const volume = rows.filter(r => validValue(first(r.stock?.volume, r.supportResistance?.volume))).length;
  const turnover = rows.filter(r => validValue(r.stock?.turnover)).length;
  const liquidity = rows.filter(r => validValue(r.stock?.turnover) || validValue(first(r.stock?.volume, r.supportResistance?.volume))).length;
  const sr = rows.filter(r => validSr(r.supportResistance)).length;
  const current = rows.filter(r => r.currentRunOk).length;
  const priceCoveragePct = Number((price / Math.max(1, total) * 100).toFixed(1));
  const srCoveragePct = Number((sr / Math.max(1, total) * 100).toFixed(1));
  const ok = total > 0 && priceCoveragePct >= MIN_PRICE_COVERAGE && srCoveragePct >= MIN_SR_COVERAGE;
  return {
    generatedAt: RUN_AT,
    ok,
    engine: 'mubasher_primary_feeds_collector_v1_2',
    totalSymbols: total,
    currentRunSymbols: current,
    staleFallbackUsed: Boolean(staleFallback),
    staleAgeHours: staleFallback?.staleAgeHours ?? null,
    minPriceCoveragePct: MIN_PRICE_COVERAGE,
    minSupportResistanceCoveragePct: MIN_SR_COVERAGE,
    priceSymbols: price,
    volumeSymbols: volume,
    turnoverSymbols: turnover,
    liquiditySymbols: liquidity,
    supportResistanceSymbols: sr,
    priceCoveragePct,
    liquidityCoveragePct: Number((liquidity / Math.max(1, total) * 100).toFixed(1)),
    supportResistanceCoveragePct: srCoveragePct,
    bulkTools: bulkResults.map(x => ({
      id: x.id,
      group: x.group,
      url: x.url,
      httpStatus: x.httpStatus,
      ok: x.ok,
      rowCount: x.rowCount,
      angularPlaceholdersDetected: x.angularPlaceholdersDetected,
      note: x.note,
    })),
    marketMerge,
    failureReason: ok ? '' : `Mubasher mandatory coverage below threshold: price ${priceCoveragePct}% / SR ${srCoveragePct}%.`,
  };
}

async function main() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const universe = buildUniverse();
  if (!universe.length) {
    const report = { ok: false, engine: 'mubasher_primary_feeds_collector_v1_2', generatedAt: RUN_AT, error: 'No universe symbols found in data files.' };
    writeJson(p('data/mubasher-primary-fields-report.json'), report);
    console.error(report.error);
    process.exit(2);
  }

  const universeSet = new Set(universe.map(r => sym(r.symbol)).filter(Boolean));
  console.log(`Mubasher primary collector: ${universe.length} symbols, concurrency=${CONCURRENCY}`);

  const bulkResults = await collectBulkTools(universeSet);
  const rows = await mapLimit(universe, CONCURRENCY, async (r, i) => {
    const k = sym(r.symbol);
    if (!k) return { symbol: '', ok: false, currentRunOk: false, error: 'empty symbol' };
    console.log(`[${i + 1}/${universe.length}] Mubasher ${k}`);
    return fetchSymbol(k);
  });

  let primaryRows = rows.filter(Boolean).map(r => ({ ...r, symbol: sym(r.symbol) })).filter(r => r.symbol);
  const summaryProbe = makeSummary(primaryRows, bulkResults, { updated: false, count: 0 });
  let staleFallback = null;
  if (!summaryProbe.ok) {
    const old = previousPrimaryRows();
    if (old && old.staleOk) {
      staleFallback = old;
      primaryRows = old.rows.map(r => ({ ...r, staleFallback: true, currentRunOk: false }));
      console.warn(`Using previous Mubasher primary feed fallback: ${old.staleAgeHours} hours old.`);
    }
  }

  const derived = buildDerivedFeeds(primaryRows, bulkResults);
  writeJson(p('data/mubasher-volume-monitor.json'), derived.volume);
  writeJson(p('data/mubasher-liquidity-monitor.json'), derived.liquidity);
  writeJson(p('data/mubasher-support-resistance.json'), derived.supportResistance);

  const marketMerge = enrichMarketWithMubasher(primaryRows);
  const summary = makeSummary(primaryRows, bulkResults, marketMerge, staleFallback);
  const primaryReport = {
    ok: summary.ok || Boolean(staleFallback?.staleOk),
    engine: 'mubasher_primary_feeds_collector_v1_2',
    generatedAt: RUN_AT,
    delayed: true,
    note: 'Primary feed uses Mubasher stock pages and per-symbol support-resistance pages. Bulk analysis-tool pages are audited and used only if raw rows are available.',
    summary,
    rows: primaryRows,
  };
  writeJson(p('data/mubasher-stock-pages-primary.json'), primaryReport);
  writeJson(p('data/mubasher-primary-fields-report.json'), primaryReport);

  console.log('Mubasher primary summary:', JSON.stringify(summary, null, 2));
  if (!primaryReport.ok) {
    console.error(summary.failureReason || 'Mubasher mandatory primary feed failed.');
    process.exit(2);
  }
}

main().catch(e => {
  const report = { ok: false, engine: 'mubasher_primary_feeds_collector_v1_2', generatedAt: RUN_AT, error: String(e && e.stack || e) };
  writeJson(p('data/mubasher-primary-fields-report.json'), report);
  console.error(e);
  process.exit(2);
});
