#!/usr/bin/env node
'use strict';

/**
 * RAS EGX /GOAL — Quality Hardening Gate
 * Enforces: no executable decision without Mubasher price, liquidity/turnover/volume,
 * support/resistance, no price conflicts, no precision risk, and sufficient history.
 */
const fs = require('fs');
const path = require('path');
const RUN_AT = new Date().toISOString();
const ROOT = process.cwd();

function p(...x) { return path.join(ROOT, ...x); }
function readJson(file, fallback) { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; } }
function writeJson(file, obj) { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, JSON.stringify(obj, null, 2) + '\n', 'utf8'); }
function rowsOf(x) { if (Array.isArray(x)) return x; if (Array.isArray(x?.rows)) return x.rows; if (Array.isArray(x?.data)) return x.data; if (Array.isArray(x?.items)) return x.items; if (Array.isArray(x?.recommendations)) return x.recommendations; return []; }
function sym(v) { return String(v || '').toUpperCase().replace(/\.CA$/i, '').replace(/[^A-Z0-9.]/g, '').trim(); }
function num(v) { if (v == null || v === '') return null; let s = String(v).replace(/[,%٬،]/g, '').replace(/−/g, '-').trim().replace(/[^0-9.+\-eE]/g, ''); const n = Number(s); return Number.isFinite(n) ? n : null; }
function finite(v) { const n = num(v); return Number.isFinite(n) ? n : null; }
function first(...vals) { for (const v of vals) if (v !== undefined && v !== null && v !== '') return v; return null; }
function bool(x) { return x === true || x === 'true' || x === 1 || x === '1'; }
function pctCap(v, cap) { const n = finite(v); return n == null ? n : Math.min(n, cap); }
function cleanName(s) { return String(s || '').replace(/googletag|adslot|script|window\.|function\(|var\s+/gi, '').replace(/\{\{[^}]+\}\}/g, '').replace(/\s+/g, ' ').trim(); }
function validPositive(v) { const n = finite(v); return n != null && n > 0; }
function hasSupportResistance(r) { const s = finite(first(r.support1, r.nearestSupport, r.support)); const rr = finite(first(r.resistance1, r.nearestResistance, r.resistance)); return s != null && rr != null && s > 0 && rr > 0 && s < rr; }
function getHistoryCount(r) { return finite(first(r.historySessions, r.sessionsCount, r.historicalSessions, r.historyCount, r.history50Count, r.backfillSessions, r.technical?.historySessions)) || 0; }
function pricePrecisionRisk(r) { const p = finite(first(r.price, r.lastPrice, r.currentPrice, r.mubasherPrice)); if (!p || p <= 0) return true; if (p >= 1) return false; const raw = String(first(r.price, r.lastPrice, r.currentPrice, r.mubasherPrice) || ''); const m = raw.match(/\.(\d+)/); return !m || m[1].length < 3; }
function detectConflict(r) {
  const blocks = Array.isArray(r.blocks) ? r.blocks.join(' ') : String(r.blocks || '');
  const flags = [r.priceState, r.executionState, r.decisionState, r.status, blocks].join(' ').toLowerCase();
  return /conflict|تعارض|precision_risk|price precision|سعر متعارض|blocked_price/.test(flags);
}
function sourceFreshOk(r) {
  const feed = r.mubasherPrimaryFeed || {};
  return bool(feed.currentRunOk) || bool(feed.ok) || Boolean(r.mubasherPrice || r.mubasherTurnover || r.mubasherVolume);
}
function requiredCore(r) {
  const feed = r.mubasherPrimaryFeed || {};
  const priceOk = bool(feed.hasPrice) || validPositive(first(r.mubasherPrice, r.price, r.lastPrice, r.currentPrice));
  const liquidityOk = bool(feed.hasLiquidity) || bool(feed.hasTurnover) || bool(feed.hasVolume) || validPositive(first(r.mubasherTurnover, r.valueTraded, r.turnover, r.liquidityValue, r.mubasherVolume, r.volume));
  const srOk = bool(feed.hasSupportResistance) || hasSupportResistance(r);
  const freshOk = sourceFreshOk(r);
  const missing = [];
  if (!priceOk) missing.push('السعر غير متاح من مباشر');
  if (!liquidityOk) missing.push('السيولة/قيمة أو حجم التداول غير متاحة من مباشر');
  if (!srOk) missing.push('الدعم والمقاومة غير متاحة من مباشر');
  if (!freshOk) missing.push('لا يوجد تأكيد مصدر مباشر/كاش مباشر صالح');
  return { priceOk, liquidityOk, srOk, freshOk, ok: missing.length === 0, missing };
}
function hardenRow(row) {
  const r = { ...row };
  r.symbol = sym(first(r.symbol, r.ticker, r.code)) || r.symbol;
  r.name = cleanName(first(r.name, r.name_ar, r.name_en, r.companyName, r.symbol));
  r.name_ar = cleanName(r.name_ar || r.name || '');
  r.name_en = cleanName(r.name_en || r.name || '');

  const core = requiredCore(r);
  const reasons = [...core.missing];
  const hist = getHistoryCount(r);
  const conflict = detectConflict(r);
  const precision = pricePrecisionRisk(r);
  if (conflict) reasons.push('تعارض سعر أو حظر سابق في محرك السعر');
  if (precision) reasons.push('مخاطر دقة السعر أقل من جنيه أو سعر غير مؤكد');
  if (hist > 0 && hist < 20) reasons.push('تاريخ أقل من 20 جلسة: مراقبة فقط');
  else if (!hist) reasons.push('تاريخ 50 جلسة غير مكتمل/غير مؤكد');

  let confidence = finite(first(r.finalConfidence, r.confidence, r.score, r.dataQualityScore)) || 0;
  if (!core.ok) confidence = Math.min(confidence, 55);
  if (hist < 50) confidence = Math.min(confidence, hist < 20 ? 55 : 70);
  if (conflict || precision) confidence = Math.min(confidence, 45);

  const canExecute = core.ok && !conflict && !precision && hist >= 20;
  r.finalConfidence = Math.round(confidence);
  r.confidence = Math.round(confidence);
  r.coreDataReady = core.ok;
  r.missingCoreFields = core.missing;
  r.executionAllowed = Boolean(row.executionAllowed) && canExecute;
  r.monitorOnly = !canExecute;
  r.goalQualityGate = {
    ok: canExecute,
    generatedAt: RUN_AT,
    requiredMubasherFields: core,
    historySessions: hist,
    priceConflict: conflict,
    pricePrecisionRisk: precision,
    executionAllowed: r.executionAllowed,
    monitorOnly: r.monitorOnly,
    reasons,
  };
  if (!canExecute) {
    r.recommendation = /buy|شراء/i.test(String(r.recommendation || r.signal || '')) ? 'مراقبة فقط' : (r.recommendation || 'مراقبة فقط');
    r.signal = /buy|شراء/i.test(String(r.signal || '')) ? 'WATCH_ONLY' : (r.signal || 'WATCH_ONLY');
    r.exclusionReason = reasons.join('، ');
  }
  return r;
}
function writeSameShape(file, original, rows) {
  if (Array.isArray(original)) writeJson(file, rows);
  else if (Array.isArray(original?.rows)) writeJson(file, { ...original, rows, qualityHardenedAt: RUN_AT });
  else if (Array.isArray(original?.data)) writeJson(file, { ...original, data: rows, qualityHardenedAt: RUN_AT });
  else if (Array.isArray(original?.items)) writeJson(file, { ...original, items: rows, qualityHardenedAt: RUN_AT });
  else if (Array.isArray(original?.recommendations)) writeJson(file, { ...original, recommendations: rows, qualityHardenedAt: RUN_AT });
  else writeJson(file, rows);
}
function processFile(rel) {
  const file = p(rel);
  const obj = readJson(file, null);
  const rows = rowsOf(obj);
  if (!obj || !rows.length) return { file: rel, found: false, rows: 0 };
  const hardened = rows.map(hardenRow);
  writeSameShape(file, obj, hardened);
  return {
    file: rel,
    found: true,
    rows: hardened.length,
    executionAllowed: hardened.filter(r => r.executionAllowed).length,
    monitorOnly: hardened.filter(r => r.monitorOnly).length,
    coreReady: hardened.filter(r => r.coreDataReady).length,
    blocked: hardened.filter(r => !r.goalQualityGate?.ok).length,
  };
}
function main() {
  const files = [
    'data/market.json',
    'data/recommendations.json',
    'data/final-opportunity-ranking.json',
    'data/final-multisource-ranking.json',
  ];
  const results = files.map(processFile);
  const market = rowsOf(readJson(p('data/market.json'), []));
  const excluded = market.filter(r => !r.goalQualityGate?.ok).map(r => ({
    symbol: r.symbol,
    name: first(r.name, r.name_ar, r.name_en, r.symbol),
    price: first(r.mubasherPrice, r.price, r.lastPrice, r.currentPrice),
    volume: first(r.mubasherVolume, r.volume),
    turnover: first(r.mubasherTurnover, r.turnover, r.valueTraded),
    support1: r.support1,
    resistance1: r.resistance1,
    finalConfidence: r.finalConfidence,
    reason: r.exclusionReason || r.goalQualityGate?.reasons?.join('، ') || 'غير محدد',
  }));
  writeJson(p('data/excluded-opportunities.json'), {
    ok: true,
    engine: 'goal_quality_hardening_v1_2',
    generatedAt: RUN_AT,
    count: excluded.length,
    rows: excluded,
  });
  writeJson(p('data/hardening-report.json'), {
    ok: true,
    engine: 'goal_quality_hardening_v1_2',
    generatedAt: RUN_AT,
    rules: [
      'No execution without Mubasher price.',
      'No execution without volume/turnover/liquidity proxy.',
      'No execution without support/resistance.',
      'No execution with price conflict or precision risk.',
      'History <20 sessions becomes watch-only; history <50 caps confidence.',
    ],
    results,
    summary: {
      marketRows: market.length,
      marketExecutionAllowed: market.filter(r => r.executionAllowed).length,
      marketMonitorOnly: market.filter(r => r.monitorOnly).length,
      marketCoreReady: market.filter(r => r.coreDataReady).length,
      excluded: excluded.length,
    },
  });
  console.log('GOAL quality hardening complete');
}
main();
