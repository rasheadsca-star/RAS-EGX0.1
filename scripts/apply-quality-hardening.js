#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = process.cwd();
const DATA_DIR = path.join(ROOT, 'data');
const NOW = new Date().toISOString();
const ENGINE = 'quality_hardening_v2_goal_integrated';

const TARGET_FILES = [
  'market.json',
  'recommendations.json',
  'final-opportunity-ranking.json',
  'final-multisource-ranking.json',
  'daily-decision-brief.json',
  'daily-report.json',
  'actionable-watchlist.json',
  'confidence-guard-report.json'
];

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

function filePath(name) {
  return path.join(DATA_DIR, name);
}

function exists(name) {
  return fs.existsSync(filePath(name));
}

function readJson(name, fallback = null) {
  try {
    const p = filePath(name);
    if (!fs.existsSync(p)) return fallback;
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch (error) {
    return { __readError: error.message };
  }
}

function writeJson(name, value) {
  ensureDataDir();
  fs.writeFileSync(filePath(name), `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function cleanText(value) {
  if (value === null || value === undefined) return value;
  const original = String(value);
  let text = original
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/\bgoogletag\b[\s\S]{0,300}/gi, ' ')
    .replace(/\bAdSlot\b[\s\S]{0,300}/gi, ' ')
    .replace(/\bdoubleclick\b[\s\S]{0,300}/gi, ' ')
    .replace(/\bdataLayer\b[\s\S]{0,300}/gi, ' ')
    .replace(/\bwindow\.[A-Za-z0-9_$]+[\s\S]{0,200}/g, ' ')
    .replace(/[{}()[\];]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  // Keep company names readable. If the parser captured a long ad payload, keep the first clean fragment.
  if (text.length > 90) {
    text = text.split(/[-|•–—]/).map(x => x.trim()).find(x => x.length >= 2 && x.length <= 90) || text.slice(0, 90).trim();
  }
  return text;
}

function numberOf(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function arrayOf(value) {
  if (Array.isArray(value)) return value;
  if (Array.isArray(value?.rows)) return value.rows;
  if (Array.isArray(value?.items)) return value.items;
  if (Array.isArray(value?.opportunities)) return value.opportunities;
  if (Array.isArray(value?.ranking)) return value.ranking;
  if (Array.isArray(value?.topWatchBuy)) return value.topWatchBuy;
  return [];
}

function detectHistorySessions(row) {
  const candidates = [
    row.historySessions,
    row.historicalSessions,
    row.sessions,
    row.sessionsCount,
    row.historyDays,
    row.historyCount,
    row.bars,
    row.barsCount,
    row.metrics?.historySessions,
    row.history?.sessions,
    row.history?.length,
    Array.isArray(row.history) ? row.history.length : undefined,
    Array.isArray(row.priceHistory) ? row.priceHistory.length : undefined,
    Array.isArray(row.candles) ? row.candles.length : undefined
  ];
  for (const v of candidates) {
    const n = Number(v);
    if (Number.isFinite(n) && n >= 0) return n;
  }
  return 0;
}

function hasText(value, regex) {
  return regex.test(String(value || ''));
}

function getBlocks(row) {
  const blocks = [];
  for (const key of ['blocks', 'blockers', 'warnings', 'guards', 'riskFlags', 'exclusionReasons']) {
    if (Array.isArray(row[key])) blocks.push(...row[key].map(String));
  }
  return blocks;
}

function detectProblems(row) {
  const blocks = getBlocks(row);
  const combinedText = [
    row.priceState,
    row.dataState,
    row.decisionState,
    row.reason,
    row.blockReason,
    row.warning,
    row.dataWarning,
    row.sourceWarning,
    ...blocks
  ].join(' | ');

  const priceConflict =
    row.priceState === 'conflict' ||
    row.priceConflict === true ||
    row.hasPriceConflict === true ||
    hasText(combinedText, /conflict|تعارض\s*سعر|price\s*conflict/i);

  const precisionRisk =
    row.precisionRisk === true ||
    row.pricePrecisionRisk === true ||
    hasText(combinedText, /precision[_\s-]*risk|دقة\s*السعر|مخاطر\s*الدقة/i);

  const badSource =
    row.sourceOk === false ||
    row.dataQualityOk === false ||
    hasText(combinedText, /source\s*failed|تعذر|فشل\s*المصدر|بيانات\s*غير\s*صالحة/i);

  const historySessions = detectHistorySessions(row);
  const insufficientHistory = historySessions < 50;
  const severeHistoryGap = historySessions < 20;

  const reasons = [];
  if (priceConflict) reasons.push('تعارض سعر: لا يسمح بالتنفيذ');
  if (precisionRisk) reasons.push('مخاطر دقة السعر: مراقبة فقط');
  if (badSource) reasons.push('مصدر بيانات غير موثوق بما يكفي');
  if (severeHistoryGap) reasons.push(`تاريخ غير كافٍ جدًا (${historySessions}/50 جلسة): مراقبة فقط`);
  else if (insufficientHistory) reasons.push(`تاريخ غير مكتمل (${historySessions}/50 جلسة): تخفيض الثقة`);

  return { priceConflict, precisionRisk, badSource, insufficientHistory, severeHistoryGap, historySessions, reasons };
}

function hardenRow(row, context = {}) {
  if (!row || typeof row !== 'object') return row;
  const before = { ...row };
  const patched = { ...row };

  for (const key of ['name', 'name_ar', 'name_en', 'companyName', 'company', 'reason', 'decisionReason']) {
    if (Object.prototype.hasOwnProperty.call(patched, key)) patched[key] = cleanText(patched[key]);
  }

  const problems = detectProblems(patched);
  const originalConfidence = numberOf(patched.finalConfidence ?? patched.confidence ?? patched.score, 0);
  let cappedConfidence = Math.max(0, Math.min(100, originalConfidence));

  if (problems.severeHistoryGap) cappedConfidence = Math.min(cappedConfidence, 55);
  else if (problems.insufficientHistory) cappedConfidence = Math.min(cappedConfidence, 70);

  if (problems.precisionRisk) cappedConfidence = Math.min(cappedConfidence, 60);
  if (problems.priceConflict || problems.badSource) cappedConfidence = Math.min(cappedConfidence, 40);

  const hardBlocked = problems.priceConflict || problems.badSource;
  const monitorOnly = problems.precisionRisk || problems.severeHistoryGap || hardBlocked;

  patched.originalConfidence = originalConfidence;
  patched.finalConfidence = Math.round(cappedConfidence);
  if (Object.prototype.hasOwnProperty.call(patched, 'confidence')) patched.confidence = Math.round(cappedConfidence);
  patched.historySessions = problems.historySessions;
  patched.historyRequiredSessions = 50;
  patched.executionAllowed = !monitorOnly && patched.finalConfidence >= 70;
  patched.monitorOnly = monitorOnly;
  patched.goalDecisionGate = hardBlocked ? 'BLOCKED' : monitorOnly ? 'MONITOR_ONLY' : 'PASSED';
  patched.goalDecisionLabel = hardBlocked ? 'مستبعد من الشراء' : monitorOnly ? 'مراقبة فقط' : 'صالح للمراقبة التنفيذية المشروطة';

  const hardeningReasons = problems.reasons;
  if (hardeningReasons.length) {
    const existing = getBlocks(patched);
    patched.blocks = Array.from(new Set([...existing, ...hardeningReasons]));
    patched.hardeningReasons = hardeningReasons;
    patched.reason = cleanText([patched.reason, ...hardeningReasons].filter(Boolean).join(' | '));
  }

  if (hardBlocked) {
    patched.signal = 'INVALID';
    patched.decision = 'NO_TRADE';
    patched.action = 'NO_TRADE';
    patched.recommendation = 'لا شراء';
  } else if (monitorOnly) {
    if (patched.signal === 'WATCH_BUY' || patched.signal === 'BUY' || patched.signal === 'STRONG_BUY') patched.signal = 'WATCH';
    patched.decision = 'MONITOR_ONLY';
    patched.action = 'WATCH';
    patched.recommendation = 'مراقبة فقط';
  }

  const changed = JSON.stringify(before) !== JSON.stringify(patched);
  if (changed && context.report) {
    context.report.patchedRows += 1;
    if (patched.symbol) {
      context.report.symbolsPatched.add(patched.symbol);
      if (hardBlocked || monitorOnly) {
        context.report.excluded.push({
          symbol: patched.symbol,
          name: patched.name || patched.name_ar || patched.name_en || '',
          gate: patched.goalDecisionGate,
          finalConfidence: patched.finalConfidence,
          historySessions: patched.historySessions,
          reasons: patched.hardeningReasons || []
        });
      }
    }
  }

  return patched;
}

function walkAndHarden(value, context) {
  if (Array.isArray(value)) return value.map(item => walkAndHarden(item, context));
  if (!value || typeof value !== 'object') return value;

  const looksLikeStockRow =
    Object.prototype.hasOwnProperty.call(value, 'symbol') ||
    Object.prototype.hasOwnProperty.call(value, 'ticker') ||
    Object.prototype.hasOwnProperty.call(value, 'price') ||
    Object.prototype.hasOwnProperty.call(value, 'finalConfidence') ||
    Object.prototype.hasOwnProperty.call(value, 'signal');

  if (looksLikeStockRow) return hardenRow(value, context);

  const out = { ...value };
  for (const [key, child] of Object.entries(out)) {
    out[key] = walkAndHarden(child, context);
  }
  return out;
}

function recomputeMarketSummary(market) {
  const rows = Array.isArray(market?.rows) ? market.rows : [];
  if (!rows.length) return market;
  const avg = key => Math.round(rows.reduce((sum, row) => sum + numberOf(row[key], 0), 0) / rows.length);
  market.summary = {
    ...(market.summary || {}),
    count: rows.length,
    avgConfidence: avg('finalConfidence'),
    avgQuality: avg('dataQualityScore'),
    watchBuy: rows.filter(r => r.signal === 'WATCH_BUY' && r.executionAllowed).length,
    watch: rows.filter(r => r.signal === 'WATCH').length,
    riskReduce: rows.filter(r => r.signal === 'RISK_REDUCE').length,
    invalid: rows.filter(r => r.signal === 'INVALID').length,
    monitorOnly: rows.filter(r => r.monitorOnly).length,
    executionAllowed: rows.filter(r => r.executionAllowed).length
  };
  market.qualityHardening = {
    engine: ENGINE,
    appliedAt: NOW,
    rule: 'No execution when price conflict, precision risk, bad source, or severe missing history exists.'
  };
  return market;
}

function main() {
  ensureDataDir();
  const report = {
    ok: true,
    engine: ENGINE,
    generatedAt: NOW,
    filesScanned: [],
    filesPatched: [],
    patchedRows: 0,
    symbolsPatched: new Set(),
    excluded: [],
    rules: [
      'Clean ad/script pollution from company names and reasons.',
      'Block execution when priceState/conflict or price-conflict text exists.',
      'Block execution when price precision risk exists.',
      'Cap confidence at 70 when history < 50 sessions.',
      'Convert BUY/WATCH_BUY to WATCH when history < 20 sessions.',
      'Write a transparent excluded-opportunities report.'
    ]
  };

  for (const name of TARGET_FILES) {
    if (!exists(name)) continue;
    const input = readJson(name, null);
    if (!input || input.__readError) continue;
    report.filesScanned.push(name);
    const context = { report };
    let output = walkAndHarden(input, context);
    if (name === 'market.json') output = recomputeMarketSummary(output);
    writeJson(name, output);
    report.filesPatched.push(name);
  }

  const uniqueExcluded = new Map();
  for (const item of report.excluded) {
    const key = `${item.symbol}|${item.gate}|${item.reasons.join('|')}`;
    uniqueExcluded.set(key, item);
  }
  report.excluded = Array.from(uniqueExcluded.values()).sort((a, b) => String(a.symbol).localeCompare(String(b.symbol)));
  report.symbolsPatched = Array.from(report.symbolsPatched).sort();
  report.excludedCount = report.excluded.length;
  report.symbolsPatchedCount = report.symbolsPatched.length;

  writeJson('excluded-opportunities.json', {
    ok: true,
    generatedAt: NOW,
    engine: ENGINE,
    count: report.excluded.length,
    items: report.excluded
  });
  writeJson('hardening-report.json', report);
  console.log(`[${ENGINE}] patched ${report.patchedRows} rows across ${report.filesPatched.length} files. Excluded/monitor-only: ${report.excludedCount}`);
}

main();
