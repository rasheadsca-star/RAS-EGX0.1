const fs = require("fs");

const DEFAULT_BASE_URL = "https://english.mubasher.info";
const DEFAULT_MAX_SYMBOLS = 80;
const DEFAULT_DELAY_MS = 800;

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function writeJson(file, data) {
  ensureDir("data");
  fs.writeFileSync(file, JSON.stringify(data, null, 2), "utf8");
}

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function toNumber(value) {
  if (value === undefined || value === null) return null;
  const cleaned = String(value).replace(/,/g, "").replace(/٬/g, "").replace(/%/g, "").replace(/\s+/g, "").trim();
  if (!cleaned || cleaned === "-" || cleaned.toLowerCase() === "n/a") return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

function safeRegex(text) {
  return String(text).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function normalizeArabic(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/[أإآا]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ؤ/g, "و")
    .replace(/ئ/g, "ي")
    .replace(/ة/g, "ه")
    .replace(/[ًٌٍَُِّْـ]/g, "")
    .replace(/[^\u0600-\u06FFa-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function stripHtml(html) {
  return String(html || "")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<svg[\s\S]*?<\/svg>/gi, " ")
    .replace(/<[^>]+>/g, "\n")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s+/g, "\n")
    .replace(/\n{2,}/g, "\n")
    .trim();
}

function linesOf(htmlOrText) {
  const text = String(htmlOrText || "").includes("<") ? stripHtml(htmlOrText) : String(htmlOrText || "");
  return text.split(/\r?\n/).map((x) => x.trim()).filter(Boolean);
}

function findNumberAfterLabel(text, labels) {
  const clean = String(text || "").includes("<") ? stripHtml(text) : String(text || "");
  for (const label of labels) {
    const safe = safeRegex(label);
    const patterns = [
      new RegExp(`${safe}\\s*\\n\\s*(-?[0-9][0-9,]*(?:\\.\\d+)?)`, "i"),
      new RegExp(`${safe}\\s+(-?[0-9][0-9,]*(?:\\.\\d+)?)`, "i"),
      new RegExp(`${safe}[\\s\\S]{0,140}?(-?[0-9][0-9,]*(?:\\.\\d+)?)`, "i")
    ];
    for (const pattern of patterns) {
      const match = clean.match(pattern);
      if (match) return toNumber(match[1]);
    }
  }
  return null;
}

function firstNumberNear(lines, predicate, lookAhead = 18) {
  const start = lines.findIndex(predicate);
  if (start < 0) return null;
  for (let i = start + 1; i < Math.min(lines.length, start + lookAhead); i++) {
    if (/^-?[0-9][0-9,]*(\.\d+)?$/.test(lines[i])) return toNumber(lines[i]);
  }
  return null;
}

function firstPercentNear(lines, startIndex, lookAhead = 8) {
  if (startIndex < 0) return null;
  for (let i = startIndex + 1; i < Math.min(lines.length, startIndex + lookAhead); i++) {
    if (/^-?[0-9][0-9,]*(\.\d+)?%$/.test(lines[i])) return toNumber(lines[i]);
  }
  return null;
}

function pct(a, b) {
  if (a === null || a === undefined || !b) return null;
  return ((a - b) / b) * 100;
}

function round(value, digits = 2) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return null;
  return Number(Number(value).toFixed(digits));
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function stockUrl(symbol, baseUrl) {
  return `${baseUrl}/markets/EGX/stocks/${encodeURIComponent(symbol)}/`;
}

function supportUrl(symbol, baseUrl) {
  return `${baseUrl}/markets/EGX/stocks/${encodeURIComponent(symbol)}/support-resistance`;
}

function marketUrl(baseUrl) {
  return `${baseUrl}/markets/EGX/`;
}

async function fetchText(url) {
  const response = await fetch(url, {
    headers: {
      "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) EGX-Pro-Hub-V3/1.0",
      "accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "accept-language": "en-US,en;q=0.9,ar;q=0.8"
    }
  });
  if (!response.ok) throw new Error(`HTTP ${response.status} ${response.statusText}`);
  return await response.text();
}

function normalizeSymbolItem(item) {
  if (typeof item === "string") {
    return { symbol: item.trim().toUpperCase(), name_en: item.trim().toUpperCase(), name_ar: "", aliases: [] };
  }
  const symbol = String(item.symbol || item.code || "").trim().toUpperCase();
  return {
    symbol,
    name_en: item.name_en || item.name || symbol,
    name_ar: item.name_ar || "",
    aliases: Array.isArray(item.aliases) ? item.aliases : []
  };
}

function discoverSymbolsFromMarketHtml(html) {
  const found = [];
  const re = /\/markets\/EGX\/stocks\/([A-Z0-9_-]+)\/?["']/g;
  let m;
  while ((m = re.exec(html)) !== null) {
    const symbol = String(m[1] || "").toUpperCase();
    if (symbol && !found.includes(symbol)) {
      found.push(symbol);
    }
  }
  return found.map((symbol) => ({ symbol, name_en: symbol, name_ar: "", aliases: [] }));
}

function mergeUniverse(configItems, discoveredItems) {
  const map = new Map();
  for (const item of [...configItems, ...discoveredItems]) {
    const normal = normalizeSymbolItem(item);
    if (!normal.symbol) continue;
    if (!map.has(normal.symbol)) map.set(normal.symbol, normal);
    else {
      const old = map.get(normal.symbol);
      map.set(normal.symbol, {
        ...old,
        ...normal,
        name_en: old.name_en && old.name_en !== old.symbol ? old.name_en : normal.name_en,
        name_ar: old.name_ar || normal.name_ar || "",
        aliases: Array.from(new Set([...(old.aliases || []), ...(normal.aliases || [])]))
      });
    }
  }
  return Array.from(map.values());
}

function parseStockPage(symbolItem, html, sourceUrl) {
  const symbol = symbolItem.symbol;
  const text = stripHtml(html);
  const lines = linesOf(text);

  const pageName =
    lines.find((line) => line.includes(symbol) && line.length < 180) ||
    lines.find((line) => /Stock Price|Share Price|Last update/i.test(line)) ||
    symbolItem.name_en ||
    symbol;

  let price = firstNumberNear(lines, (line) => /Last update/i.test(line), 18);
  if (price === null) price = findNumberAfterLabel(text, ["Last Price", "Price", "Close"]);

  const previousClose = findNumberAfterLabel(text, ["Previous Close", "Prev Close"]);
  const open = findNumberAfterLabel(text, ["Open"]);
  const high = findNumberAfterLabel(text, ["High"]);
  const low = findNumberAfterLabel(text, ["Low"]);
  const volume = findNumberAfterLabel(text, ["Volume"]);
  const turnover = findNumberAfterLabel(text, ["Turnover", "Value"]);

  let changePct = null;
  const priceIndex = lines.findIndex((line) => toNumber(line) === price);
  if (priceIndex >= 0) changePct = firstPercentNear(lines, priceIndex, 8);
  if (changePct === null && price !== null && previousClose) changePct = pct(price, previousClose);

  const searchable = [
    symbol,
    symbolItem.name_en,
    symbolItem.name_ar,
    pageName,
    ...(symbolItem.aliases || [])
  ].filter(Boolean).join(" ");

  return {
    symbol,
    name: pageName.replace(/^#\s*/, "").slice(0, 140),
    name_en: symbolItem.name_en || pageName,
    name_ar: symbolItem.name_ar || "",
    aliases: symbolItem.aliases || [],
    searchText: normalizeArabic(searchable),
    price,
    previousClose,
    changePct: round(changePct),
    open,
    high,
    low,
    volume,
    turnover,
    sourceUrl,
    priceSource: "mubasher_public_stock_page",
    dataMode: "public_delayed",
    fetchedAt: new Date().toISOString()
  };
}

function parseSupportPage(symbol, html, sourceUrl) {
  const text = stripHtml(html);
  return {
    symbol,
    pivot: findNumberAfterLabel(text, ["Pivot point", "Pivot"]),
    support1: findNumberAfterLabel(text, ["First support level (d1)", "First support level (s1)", "First support level", "Support 1"]),
    support2: findNumberAfterLabel(text, ["Second support level (d1)", "Second support level (s2)", "Second support level", "Support 2"]),
    resistance1: findNumberAfterLabel(text, ["First resistance level (r1)", "First resistance level", "Resistance 1"]),
    resistance2: findNumberAfterLabel(text, ["Second resistance level (r2)", "Second resistance level", "Resistance 2"]),
    supportResistanceSource: "mubasher_public_support_resistance_page",
    supportResistanceUrl: sourceUrl
  };
}

function parseMarketPage(html, sourceUrl) {
  const text = stripHtml(html);
  const lines = linesOf(text);
  return {
    index: "EGX30",
    value: firstNumberNear(lines, (line) => /EGX 30 Index/i.test(line), 18),
    volume: findNumberAfterLabel(text, ["Volume"]),
    turnover: findNumberAfterLabel(text, ["Turnover", "Value"]),
    state: "public_delayed",
    sourceUrl,
    fetchedAt: new Date().toISOString()
  };
}

function dataQualityScore(row) {
  const fields = ["price", "previousClose", "volume", "turnover", "pivot", "support1", "resistance1"];
  const present = fields.filter((field) => row[field] !== null && row[field] !== undefined && row[field] !== "");
  return Math.round((present.length / fields.length) * 100);
}

function liquidityScore(row) {
  const turnover = Number(row.turnover || 0);
  const volume = Number(row.volume || 0);
  let score = 0;
  if (turnover >= 100000000) score += 45;
  else if (turnover >= 50000000) score += 36;
  else if (turnover >= 20000000) score += 25;
  else if (turnover >= 5000000) score += 14;
  else if (turnover > 0) score += 7;

  if (volume >= 3000000) score += 25;
  else if (volume >= 1500000) score += 20;
  else if (volume >= 500000) score += 12;
  else if (volume > 0) score += 5;
  return clamp(score, 0, 100);
}

function analyzeRow(row) {
  const changePct = row.changePct ?? pct(row.price, row.previousClose);
  const distanceToSupport = row.support1 ? pct(row.price, row.support1) : null;
  const distanceToResistance = row.resistance1 ? pct(row.resistance1, row.price) : null;
  const distanceToPivot = row.pivot ? pct(row.price, row.pivot) : null;
  const dataQuality = dataQualityScore(row);
  const liq = liquidityScore(row);

  let priceScore = 45;
  if (changePct !== null && changePct > 0.3) priceScore += 12;
  if (changePct !== null && changePct > 1.2) priceScore += 10;
  if (changePct !== null && changePct < -1) priceScore -= 14;
  if (distanceToPivot !== null && distanceToPivot > 0) priceScore += 12;
  if (distanceToPivot !== null && distanceToPivot < 0) priceScore -= 12;
  priceScore = clamp(priceScore, 0, 100);

  let srScore = 45;
  if (distanceToSupport !== null && distanceToSupport >= 0 && distanceToSupport <= 4) srScore += 18;
  if (distanceToSupport !== null && distanceToSupport < 0) srScore -= 35;
  if (distanceToResistance !== null && distanceToResistance > 4) srScore += 14;
  if (distanceToResistance !== null && distanceToResistance >= 0 && distanceToResistance <= 2) srScore -= 16;
  if (distanceToResistance !== null && distanceToResistance < 0) srScore += 18;
  srScore = clamp(srScore, 0, 100);

  let risk = 0;
  if (changePct !== null && changePct < -1) risk += 18;
  if (changePct !== null && changePct < -2.5) risk += 20;
  if (distanceToSupport !== null && distanceToSupport < 0) risk += 35;
  if (distanceToResistance !== null && distanceToResistance >= 0 && distanceToResistance <= 2) risk += 14;
  if (distanceToPivot !== null && distanceToPivot < 0) risk += 12;
  risk = clamp(risk, 0, 100);

  const sourceConfidence = row.supportError ? 70 : 90;
  let finalConfidence = Math.round(
    dataQuality * 0.25 + liq * 0.25 + priceScore * 0.20 + srScore * 0.20 + sourceConfidence * 0.10 - risk * 0.18
  );
  finalConfidence = clamp(finalConfidence, 0, 96);

  const reasons = [];
  if (distanceToPivot !== null && distanceToPivot > 0) reasons.push("فوق Pivot");
  if (distanceToPivot !== null && distanceToPivot < 0) reasons.push("تحت Pivot");
  if (changePct !== null && changePct > 0) reasons.push("السعر إيجابي");
  if (changePct !== null && changePct < -1) reasons.push("ضغط سعري سلبي");
  if (liq >= 65) reasons.push("سيولة قوية");
  else if (liq >= 35) reasons.push("سيولة مقبولة");
  else reasons.push("سيولة ضعيفة");
  if (distanceToSupport !== null && distanceToSupport >= 0 && distanceToSupport <= 4) reasons.push("قريب من دعم");
  if (distanceToSupport !== null && distanceToSupport < 0) reasons.push("كسر دعم");
  if (distanceToResistance !== null && distanceToResistance > 4) reasons.push("مساحة قبل المقاومة");
  if (distanceToResistance !== null && distanceToResistance >= 0 && distanceToResistance <= 2) reasons.push("قريب جدًا من المقاومة");
  if (dataQuality < 70) reasons.push("جودة بيانات منخفضة");

  let signal = "WAIT";
  let decision = "انتظار";

  if (!row.price || !row.previousClose || dataQuality < 45) {
    signal = "INVALID";
    decision = "بيانات غير كافية";
    finalConfidence = Math.min(finalConfidence, 35);
  } else if (
    (distanceToSupport !== null && distanceToSupport < 0) ||
    (changePct !== null && changePct < -2.5) ||
    (distanceToPivot !== null && distanceToPivot < 0 && liq < 35)
  ) {
    signal = "RISK_REDUCE";
    decision = "حذر / تخفيف";
    finalConfidence = Math.max(finalConfidence, 60);
  } else if (
    distanceToPivot !== null && distanceToPivot > 0 &&
    changePct !== null && changePct > 0 &&
    liq >= 35 && dataQuality >= 70 &&
    finalConfidence >= 75 &&
    !(distanceToResistance !== null && distanceToResistance >= 0 && distanceToResistance <= 2)
  ) {
    signal = "WATCH_BUY";
    decision = "مراقبة شراء مشروطة";
  } else if (finalConfidence >= 60) {
    signal = "WATCH";
    decision = "مراقبة";
  }

  return {
    ...row,
    changePct: round(changePct),
    distanceToSupport: round(distanceToSupport),
    distanceToResistance: round(distanceToResistance),
    distanceToPivot: round(distanceToPivot),
    liquidityScore: Math.round(liq),
    priceActionScore: Math.round(priceScore),
    supportResistanceScore: Math.round(srScore),
    riskScore: Math.round(risk),
    dataQualityScore: dataQuality,
    sourceConfidence,
    finalConfidence,
    confidence: finalConfidence,
    signal,
    decision,
    reason: reasons.join(" + ") || "لا توجد أفضلية واضحة"
  };
}

function summarize(rows, requestedCount, discoveredCount) {
  return {
    scanMode: "market_universe",
    requestedSymbols: requestedCount,
    discoveredSymbols: discoveredCount,
    count: rows.length,
    avgConfidence: rows.length ? Math.round(rows.reduce((sum, row) => sum + (row.finalConfidence || 0), 0) / rows.length) : 0,
    avgQuality: rows.length ? Math.round(rows.reduce((sum, row) => sum + (row.dataQualityScore || 0), 0) / rows.length) : 0,
    watchBuy: rows.filter((row) => row.signal === "WATCH_BUY").length,
    watch: rows.filter((row) => row.signal === "WATCH").length,
    wait: rows.filter((row) => row.signal === "WAIT").length,
    riskReduce: rows.filter((row) => row.signal === "RISK_REDUCE").length,
    invalid: rows.filter((row) => row.signal === "INVALID").length
  };
}

async function readMarketAndDiscover(baseUrl) {
  try {
    const url = marketUrl(baseUrl);
    const html = await fetchText(url);
    return {
      market: parseMarketPage(html, url),
      discovered: discoverSymbolsFromMarketHtml(html)
    };
  } catch (error) {
    return {
      market: {
        index: "EGX30",
        error: error.message,
        state: "unavailable",
        fetchedAt: new Date().toISOString()
      },
      discovered: []
    };
  }
}

async function readSymbol(symbolItem, baseUrl) {
  const primaryUrl = stockUrl(symbolItem.symbol, baseUrl);
  const html = await fetchText(primaryUrl);
  const stock = parseStockPage(symbolItem, html, primaryUrl);

  let support = {};
  try {
    const srUrl = supportUrl(symbolItem.symbol, baseUrl);
    const srHtml = await fetchText(srUrl);
    support = parseSupportPage(symbolItem.symbol, srHtml, srUrl);
  } catch (error) {
    support = { symbol: symbolItem.symbol, supportError: error.message };
  }

  return {
    ...stock,
    ...support,
    symbol: symbolItem.symbol,
    dataMode: "public_delayed",
    fetchedAt: new Date().toISOString()
  };
}

async function main() {
  ensureDir("data");
  const generatedAt = new Date().toISOString();
  const config = readJson("config/watchlist.json", {});
  const baseUrl = config.baseUrl || DEFAULT_BASE_URL;
  const maxSymbols = Number(config.maxSymbolsPerRun || DEFAULT_MAX_SYMBOLS);
  const delayMs = Number(config.requestDelayMs || DEFAULT_DELAY_MS);

  const { market, discovered } = await readMarketAndDiscover(baseUrl);
  const configItems = Array.isArray(config.symbols) ? config.symbols : [];
  const universe = mergeUniverse(configItems, discovered);
  const selected = universe.slice(0, maxSymbols);

  writeJson("data/symbols.json", {
    ok: true,
    generatedAt,
    scanMode: "market_universe",
    totalConfigured: configItems.length,
    totalDiscoveredFromMarketPage: discovered.length,
    totalUniverse: universe.length,
    selectedForThisRun: selected.length,
    symbols: universe.map((item) => ({
      ...item,
      searchText: normalizeArabic([item.symbol, item.name_en, item.name_ar, ...(item.aliases || [])].filter(Boolean).join(" "))
    }))
  });

  const rawRows = [];
  const errors = [];

  for (const item of selected) {
    try {
      console.log("Reading", item.symbol);
      rawRows.push(await readSymbol(item, baseUrl));
    } catch (error) {
      console.log("Failed", item.symbol, error.message);
      errors.push({ symbol: item.symbol, error: error.message });
    }
    await sleep(delayMs);
  }

  const rows = rawRows.map(analyzeRow).sort((a, b) => (b.finalConfidence || 0) - (a.finalConfidence || 0));
  const readSymbols = rows.map((r) => r.symbol);
  const missingSymbols = selected.map((s) => s.symbol).filter((symbol) => !readSymbols.includes(symbol));
  const avgDataQuality = rows.length ? Math.round(rows.reduce((sum, row) => sum + (row.dataQualityScore || 0), 0) / rows.length) : 0;
  const summary = summarize(rows, selected.length, discovered.length);

  writeJson("data/market.json", {
    ok: rows.length > 0,
    source: "mubasher_public_pages_v3_market_universe",
    message: rows.length
      ? "تم مسح قائمة سوق موسعة من صفحات مباشر العامة. البيانات عامة ومتأخرة وليست لحظية حقيقية."
      : "لم يتم جمع بيانات صالحة من مباشر.",
    updatedAt: generatedAt,
    dataMode: "public_delayed",
    market,
    summary,
    rows,
    errors
  });

  writeJson("data/source-health.json", {
    sourceName: "Mubasher Public Pages V3",
    ok: rows.length > 0,
    mode: "public_delayed",
    scanMode: "market_universe",
    lastSuccessAt: rows.length ? generatedAt : null,
    lastFailureAt: errors.length ? generatedAt : null,
    rowsRead: rows.length,
    selectedForThisRun: selected.length,
    totalUniverse: universe.length,
    totalDiscoveredFromMarketPage: discovered.length,
    failedSymbols: errors.map((e) => e.symbol).filter(Boolean),
    avgDataQuality,
    warning: "البيانات من صفحات عامة وقد تكون متأخرة. لا تعتبر لحظية حقيقية.",
    generatedAt
  });

  writeJson("data/validation-report.json", {
    ok: rows.length > 0,
    scanMode: "market_universe",
    requestedSymbols: selected.length,
    readSymbols: rows.length,
    missingSymbols,
    failedSymbols: errors.map((e) => e.symbol).filter(Boolean),
    validForDisplay: rows.length > 0,
    warnings: [
      ...(missingSymbols.length ? [`رموز لم تُقرأ: ${missingSymbols.join(", ")}`] : []),
      ...(universe.length > selected.length ? [`تم اختيار ${selected.length} من إجمالي ${universe.length} حتى لا يطول وقت التشغيل.`] : []),
      ...(rows.some((r) => (r.dataQualityScore || 0) < 45) ? ["بعض الصفوف جودة بياناتها منخفضة."] : [])
    ],
    generatedAt
  });

  writeJson("data/daily-report.json", {
    generatedAt,
    topWatchBuy: rows.filter((r) => r.signal === "WATCH_BUY").slice(0, 10),
    riskReduce: rows.filter((r) => r.signal === "RISK_REDUCE").slice(0, 10),
    marketSummary: market,
    sourceStatus: rows.length > 0 ? "ok_public_delayed_market_universe" : "failed",
    notes: [
      "تمت إضافة مسح سوق موسع.",
      "البيانات عامة ومتأخرة وليست لحظية حقيقية.",
      "الإشارات قرارات مراقبة وليست أوامر تداول."
    ]
  });

  console.log(`Collector V3 completed. rows=${rows.length}, universe=${universe.length}, errors=${errors.length}`);
  process.exit(0);
}

main().catch((error) => {
  const generatedAt = new Date().toISOString();
  console.error(error);
  writeJson("data/market.json", {
    ok: false,
    source: "mubasher_public_pages_v3_market_universe",
    message: "فشل التحديث الحقيقي من مباشر. راجع errors.",
    updatedAt: generatedAt,
    dataMode: "public_delayed",
    market: {},
    summary: {},
    rows: [],
    errors: [{ error: error.message }]
  });
  writeJson("data/source-health.json", {
    sourceName: "Mubasher Public Pages V3",
    ok: false,
    mode: "public_delayed",
    scanMode: "market_universe",
    lastSuccessAt: null,
    lastFailureAt: generatedAt,
    rowsRead: 0,
    failedSymbols: [],
    avgDataQuality: 0,
    warning: error.message,
    generatedAt
  });
  writeJson("data/validation-report.json", {
    ok: false,
    requestedSymbols: 0,
    readSymbols: 0,
    missingSymbols: [],
    failedSymbols: [],
    validForDisplay: false,
    warnings: [error.message],
    generatedAt
  });
  writeJson("data/daily-report.json", {
    generatedAt,
    topWatchBuy: [],
    riskReduce: [],
    marketSummary: {},
    sourceStatus: "failed",
    notes: [error.message]
  });
  process.exit(0);
});
