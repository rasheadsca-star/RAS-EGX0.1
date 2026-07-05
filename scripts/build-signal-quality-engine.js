#!/usr/bin/env node
/*
  EGX Pro Hub V8.9.2 — Signal Quality Engine
  Purpose: build a stricter, actionable quality score by merging daily opportunities,
  priority ranking, liquidity, entry/target/stop, news, data freshness, history, and risk.
  Output: data/signal-quality-report.json
*/

const fs = require('fs');
const path = require('path');

const ROOT = process.cwd();
const DATA_DIR = path.join(ROOT, 'data');

function readJson(rel, fallback) {
  try {
    const p = path.join(ROOT, rel);
    if (!fs.existsSync(p)) return fallback;
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch (err) {
    return fallback;
  }
}

function writeJson(rel, data) {
  const p = path.join(ROOT, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(data, null, 2) + '\n', 'utf8');
}

function arr(x, keys = []) {
  if (Array.isArray(x)) return x;
  if (!x || typeof x !== 'object') return [];
  for (const k of keys) if (Array.isArray(x[k])) return x[k];
  return [];
}

function num(v, d = 0) {
  if (v === null || v === undefined || v === '') return d;
  if (typeof v === 'number') return Number.isFinite(v) ? v : d;
  const s = String(v).replace(/,/g, '').replace(/%/g, '').trim();
  const n = Number(s);
  return Number.isFinite(n) ? n : d;
}

function clamp(n, lo = 0, hi = 100) { return Math.max(lo, Math.min(hi, n)); }
function round(n, dp = 2) { const m = Math.pow(10, dp); return Math.round(num(n) * m) / m; }
function symOf(r) { return String(r?.symbol || r?.code || r?.ticker || '').trim().toUpperCase(); }
function pctFromPrice(price, base) { return base ? ((price - base) / base) * 100 : 0; }

function normalizeName(r) {
  return r?.name || r?.name_ar || r?.name_en || r?.company || r?.companyName || symOf(r);
}

function addToMap(map, rows, tag) {
  for (const row of rows || []) {
    const s = symOf(row);
    if (!s) continue;
    if (!map.has(s)) map.set(s, { symbol: s, sources: [] });
    Object.assign(map.get(s), row);
    map.get(s).sources.push(tag);
  }
}

function safeDateAgeHours(dateValue) {
  if (!dateValue) return null;
  const t = new Date(dateValue).getTime();
  if (!Number.isFinite(t)) return null;
  return (Date.now() - t) / 36e5;
}

function deriveEntry(row) {
  const price = num(row.price ?? row.last ?? row.close, 0);
  let from = num(row.entryFrom ?? row.entryHigh ?? row.entry_to ?? row.entry, 0);
  let to = num(row.entryTo ?? row.entryLow ?? row.entry_from ?? row.entry, 0);
  if (!from && !to && row.entryRange && typeof row.entryRange === 'object') {
    from = num(row.entryRange.from || row.entryRange.high, 0);
    to = num(row.entryRange.to || row.entryRange.low, 0);
  }
  if (!from && !to && price) {
    const support = num(row.support1 ?? row.support ?? row.s1, 0);
    if (support) {
      to = support;
      from = Math.max(support * 1.015, price * 0.985);
    } else {
      to = price * 0.985;
      from = price * 1.01;
    }
  }
  if (from && to && to > from) [from, to] = [to, from]; // from = upper edge, to = lower edge
  return { entryHigh: round(from || price, 2), entryLow: round(to || price, 2) };
}

function deriveTargets(row, entryHigh) {
  const price = num(row.price ?? row.last ?? row.close, 0);
  const resistance1 = num(row.resistance1 ?? row.resistance ?? row.r1, 0);
  const resistance2 = num(row.resistance2 ?? row.r2, 0);
  const target1 = num(row.target1 ?? row.t1, 0) || (resistance1 && resistance1 > price ? resistance1 : price * 1.045);
  const target2 = num(row.target2 ?? row.t2, 0) || (resistance2 && resistance2 > target1 ? resistance2 : target1 * 1.055);
  return { target1: round(target1, 2), target2: round(target2, 2) };
}

function deriveStop(row, entryLow) {
  const price = num(row.price ?? row.last ?? row.close, 0);
  const support1 = num(row.support1 ?? row.support ?? row.s1, 0);
  const support2 = num(row.support2 ?? row.s2, 0);
  const stop = num(row.stopLoss ?? row.stop ?? row.sl, 0) || (support2 && support2 < price ? support2 : (support1 ? support1 * 0.975 : entryLow * 0.965));
  return round(stop, 2);
}

function deriveRR(row, entryHigh, target1, stopLoss) {
  const rrExisting = num(row.riskReward ?? row.rr ?? row.RR, 0);
  if (rrExisting > 0 && rrExisting < 20) return round(rrExisting, 2);
  const risk = Math.max(0.0001, entryHigh - stopLoss);
  const reward = Math.max(0, target1 - entryHigh);
  return round(reward / risk, 2);
}

function gradeFromScore(score, rr, blocks) {
  if (blocks.some(b => ['broken_stop', 'weak_data', 'stale_price'].includes(b))) return 'C';
  if (score >= 84 && rr >= 1.7) return 'A+';
  if (score >= 76 && rr >= 1.45) return 'A';
  if (score >= 66) return 'B';
  if (score >= 55) return 'C';
  return 'Risk';
}

function actionFrom(grade, priceState, blocks) {
  if (blocks.includes('broken_stop')) return 'خروج / مراجعة فورية';
  if (blocks.includes('extended_price')) return 'انتظار عودة لنطاق دخول';
  if (grade === 'A+' || grade === 'A') return priceState === 'inside_entry' || priceState === 'near_entry' ? 'مراقبة لشراء' : 'مراقبة قوية مشروطة';
  if (grade === 'B') return 'متابعة فقط';
  if (grade === 'C') return 'انتظار تأكيد';
  return 'تجنب / مخاطر عالية';
}

function explain(row, parts) {
  const base = row.reason || row.why || row.setup || row.decision || row.recommendation || '';
  const unique = Array.from(new Set(parts.filter(Boolean)));
  return [base, ...unique].filter(Boolean).join(' | ');
}

const market = readJson('data/market.json', {});
const cache = readJson('data/full-market-cache.json', {});
const recs = readJson('data/recommendations.json', {});
const finalRanking = readJson('data/final-opportunity-ranking.json', {});
const board = readJson('data/unified-decision-board.json', {});
const historyIntegrity = readJson('data/history-integrity-report.json', {});
const priceFresh = readJson('data/price-freshness-report.json', {});
const priceRec = readJson('data/price-reconciliation-report.json', {});
const institutional = readJson('data/institutional-score-report.json', {});
const rebalancing = readJson('data/rebalancing-candidates.json', {});
const newsImpactStatus = readJson('data/news-impact-status.json', {});
const trustedNews = readJson('data/trusted-news-collector-status.json', {});

const bySymbol = new Map();
addToMap(bySymbol, arr(cache, ['rows']), 'cache');
addToMap(bySymbol, arr(market, ['rows']), 'market');
addToMap(bySymbol, arr(recs, ['all', 'topBuyCandidates', 'watchlist']), 'recommendations');
addToMap(bySymbol, arr(finalRanking, ['rows']), 'final_ranking');
addToMap(bySymbol, arr(board, ['rows']), 'decision_board');

const historyMap = new Map(arr(historyIntegrity, ['symbols']).map(r => [symOf(r), r]));
const priceFreshMap = new Map(arr(priceFresh, ['rows', 'symbols']).map(r => [symOf(r), r]));
const priceRecMap = new Map(arr(priceRec, ['rows']).map(r => [symOf(r), r]));
const instMap = new Map(arr(institutional, ['top', 'rows']).map(r => [symOf(r), r]));
const rebalMap = new Map(arr(rebalancing, ['candidates']).map(r => [symOf(r), r]));

const newsLinkedSymbols = num(newsImpactStatus.linkedSymbols ?? trustedNews.linkedSymbols, 0);
const trustedNewsItems = num(trustedNews.itemsSaved ?? newsImpactStatus.classifiedItems, 0);

const rows = [];
for (const [symbol, row] of bySymbol.entries()) {
  const price = num(row.price ?? row.last ?? row.close, 0);
  if (!symbol || !price) continue;
  const changePct = num(row.changePct ?? row.change_pct ?? row.change, 0);
  const volume = num(row.volume ?? row.tradedVolume, 0);
  const turnover = num(row.turnover ?? row.valueTraded ?? row.value ?? row.tradedValue, 0);
  const confidence = clamp(num(row.confidence ?? row.finalConfidence ?? row.finalScore ?? row.targetProbability, 50));
  const targetProbability = clamp(num(row.targetProbability ?? row.probability, Math.max(50, confidence - 6)));
  const dataQuality = clamp(num(row.dataQualityScore ?? row.sourceConfidence ?? row.dataQuality ?? 75));
  const liquidityScore = clamp(num(row.liquidityScore, Math.min(100, Math.log10(Math.max(turnover, 1)) * 10)));
  const priceActionScore = clamp(num(row.priceActionScore ?? row.technicalScore, 50));
  const srScore = clamp(num(row.supportResistanceScore, 50));
  const hist = historyMap.get(symbol) || {};
  const sessions = num(hist.sessions ?? hist.count ?? row.historySessions, 0);
  const historyScore = sessions >= 50 ? 100 : sessions >= 20 ? 78 : sessions >= 10 ? 63 : sessions >= 4 ? 48 : 35;
  const inst = instMap.get(symbol) || {};
  const financialScore = clamp(num(inst.score ?? inst.institutionalScore ?? row.financialScore ?? row.fundamentalScore, 55));
  const rebal = rebalMap.get(symbol) || {};
  const rebalBonus = rebal && Object.keys(rebal).length ? 4 : 0;
  const newsScoreRaw = num(row.newsImpactScore ?? row.newsScore, 50);
  const newsScore = clamp(newsScoreRaw || (newsLinkedSymbols ? 52 : 50));
  const fresh = priceFreshMap.get(symbol) || {};
  const reconc = priceRecMap.get(symbol) || {};
  const ageHours = safeDateAgeHours(row.updatedAt || row.cacheUpdatedAt || row.fetchedAt || fresh.updatedAt);
  const stale = row.stale === true || fresh.stale === true || (ageHours !== null && ageHours > 48);
  const priceMismatch = reconc.ok === false || num(reconc.diffPct ?? reconc.mismatchPct, 0) > 2;

  const { entryHigh, entryLow } = deriveEntry(row);
  const { target1, target2 } = deriveTargets(row, entryHigh);
  const stopLoss = deriveStop(row, entryLow);
  const rr = deriveRR(row, entryHigh, target1, stopLoss);

  let priceState = 'neutral';
  if (price >= entryLow && price <= entryHigh) priceState = 'inside_entry';
  else if (price > entryHigh && price <= entryHigh * 1.025) priceState = 'near_entry';
  else if (price > entryHigh * 1.025) priceState = 'extended';
  else if (price < stopLoss) priceState = 'below_stop';
  else if (price < entryLow) priceState = 'below_entry_wait';

  const blocks = [];
  if (dataQuality < 55) blocks.push('weak_data');
  if (stale) blocks.push('stale_price');
  if (priceMismatch) blocks.push('price_mismatch');
  if (rr < 1.15) blocks.push('weak_rr');
  if (priceState === 'extended') blocks.push('extended_price');
  if (priceState === 'below_stop') blocks.push('broken_stop');
  if (sessions < 10) blocks.push('limited_history');

  const technicalScore = clamp((priceActionScore * 0.40) + (srScore * 0.35) + (targetProbability * 0.25));
  const riskPenalty = clamp(num(row.riskScore, 0) + (rr < 1.2 ? 13 : 0) + (stale ? 12 : 0) + (priceMismatch ? 10 : 0) + (priceState === 'extended' ? 8 : 0) + (sessions < 5 ? 7 : 0), 0, 40);
  let composite = (confidence * 0.26) + (dataQuality * 0.18) + (technicalScore * 0.22) + (liquidityScore * 0.14) + (financialScore * 0.08) + (newsScore * 0.07) + (historyScore * 0.05) + rebalBonus - riskPenalty;
  composite = clamp(composite);
  const grade = gradeFromScore(composite, rr, blocks);
  const action = actionFrom(grade, priceState, blocks);
  const whyParts = [];
  if (row.sources?.includes('final_ranking')) whyParts.push('موجود في محرك الأولويات');
  if (row.sources?.includes('recommendations')) whyParts.push('موجود في التوصيات اليومية');
  if (liquidityScore >= 70) whyParts.push('سيولة قوية');
  if (technicalScore >= 70) whyParts.push('تأكيد فني جيد');
  if (rr >= 1.5) whyParts.push('عائد/مخاطرة مقبول');
  if (priceState === 'inside_entry') whyParts.push('السعر داخل نطاق الدخول');
  if (priceState === 'near_entry') whyParts.push('السعر قريب من نطاق الدخول');
  if (priceState === 'extended') whyParts.push('السعر ابتعد عن نقطة الدخول');
  if (sessions < 10) whyParts.push(`تاريخ محدود ${sessions}/50`);
  if (stale) whyParts.push('السعر يحتاج تحديث');
  if (priceMismatch) whyParts.push('يوجد فرق سعر يحتاج مراجعة');

  rows.push({
    symbol,
    name: normalizeName(row),
    action,
    grade,
    compositeScore: round(composite, 1),
    confidence: round(confidence, 1),
    targetProbability: round(targetProbability, 1),
    dataQualityScore: round(dataQuality, 1),
    technicalScore: round(technicalScore, 1),
    liquidityScore: round(liquidityScore, 1),
    financialScore: round(financialScore, 1),
    newsScore: round(newsScore, 1),
    historyScore: round(historyScore, 1),
    historySessions: sessions,
    riskPenalty: round(riskPenalty, 1),
    price: round(price, 3),
    changePct: round(changePct, 2),
    volume,
    turnover,
    support1: round(num(row.support1 ?? row.support, 0), 3),
    resistance1: round(num(row.resistance1 ?? row.resistance, 0), 3),
    entryLow,
    entryHigh,
    target1,
    target2,
    stopLoss,
    riskReward: rr,
    priceState,
    blocks,
    reason: explain(row, whyParts),
    sourceTags: Array.from(new Set(row.sources || [])),
    stale,
    ageHours: ageHours === null ? null : round(ageHours, 1),
    updatedAt: row.updatedAt || row.cacheUpdatedAt || row.fetchedAt || null,
    sourceUrl: row.sourceUrl || null
  });
}

rows.sort((a, b) => b.compositeScore - a.compositeScore || b.confidence - a.confidence || b.liquidityScore - a.liquidityScore);
rows.forEach((r, i) => { r.rank = i + 1; });

const summary = {
  total: rows.length,
  aPlus: rows.filter(r => r.grade === 'A+').length,
  a: rows.filter(r => r.grade === 'A').length,
  b: rows.filter(r => r.grade === 'B').length,
  c: rows.filter(r => r.grade === 'C').length,
  risk: rows.filter(r => r.grade === 'Risk').length,
  watchBuy: rows.filter(r => r.action.includes('شراء')).length,
  wait: rows.filter(r => r.action.includes('انتظار')).length,
  avoid: rows.filter(r => r.action.includes('تجنب') || r.action.includes('خروج')).length,
  limitedHistory: rows.filter(r => r.blocks.includes('limited_history')).length,
  stalePrice: rows.filter(r => r.blocks.includes('stale_price')).length,
  trustedNewsItems,
  newsLinkedSymbols
};

writeJson('data/signal-quality-report.json', {
  ok: true,
  engine: 'v8_9_2_signal_quality_engine',
  generatedAt: new Date().toISOString(),
  summary,
  weights: {
    confidence: 26,
    dataQuality: 18,
    technical: 22,
    liquidity: 14,
    financial: 8,
    news: 7,
    history: 5,
    riskPenalty: 'dynamic'
  },
  rows,
  disclaimer: 'قائمة تحليل ومراقبة من بيانات عامة/متأخرة. ليست أوامر شراء أو بيع.'
});

console.log(`Signal quality report generated: ${rows.length} symbols`);
