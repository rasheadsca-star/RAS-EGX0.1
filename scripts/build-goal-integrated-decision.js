#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = process.cwd();
const DATA_DIR = path.join(ROOT, 'data');
const NOW = new Date();
const NOW_ISO = NOW.toISOString();
const ENGINE = 'goal_integrated_decision_center_v1_0';

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}
function p(name) { return path.join(DATA_DIR, name); }
function readJson(name, fallback = null) {
  try {
    if (!fs.existsSync(p(name))) return fallback;
    return JSON.parse(fs.readFileSync(p(name), 'utf8'));
  } catch (error) {
    return { __readError: error.message };
  }
}
function writeJson(name, value) {
  ensureDataDir();
  fs.writeFileSync(p(name), `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}
function n(value, fallback = 0) {
  const x = Number(value);
  return Number.isFinite(x) ? x : fallback;
}
function clean(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}
function isSameTradingDay(dateIso) {
  if (!dateIso) return false;
  const a = new Date(dateIso);
  return a.toISOString().slice(0, 10) === NOW_ISO.slice(0, 10);
}
function ageMinutes(iso) {
  if (!iso) return Infinity;
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return Infinity;
  return Math.max(0, Math.round((Date.now() - t) / 60000));
}
function rowsFrom(market) {
  return Array.isArray(market?.rows) ? market.rows : [];
}
function symbolOf(row) { return clean(row.symbol || row.ticker || row.code).toUpperCase(); }
function nameOf(row) { return clean(row.name || row.name_ar || row.name_en || row.companyName || row.company); }
function blocksOf(row) {
  const values = [];
  for (const key of ['blocks', 'blockers', 'warnings', 'hardeningReasons', 'exclusionReasons']) {
    if (Array.isArray(row[key])) values.push(...row[key].map(clean).filter(Boolean));
  }
  return Array.from(new Set(values));
}
function signalLabel(signal) {
  return {
    WATCH_BUY: 'فرصة تنفيذ مشروطة',
    WATCH: 'مراقبة فقط',
    WAIT: 'انتظار',
    RISK_REDUCE: 'حذر / تخفيف',
    INVALID: 'مستبعد',
    NO_TRADE: 'لا شراء'
  }[signal] || signal || 'غير محدد';
}
function decideCategory(row) {
  const blocks = blocksOf(row);
  const confidence = n(row.finalConfidence ?? row.confidence, 0);
  const quality = n(row.dataQualityScore ?? row.quality ?? row.dataQuality, 0);
  const historySessions = n(row.historySessions ?? row.historicalSessions ?? row.sessionsCount, 0);
  const executionAllowed = row.executionAllowed === true;
  const signal = clean(row.signal || row.decision || row.action || 'WAIT');
  const text = [signal, row.goalDecisionGate, row.reason, row.priceState, ...blocks].join(' | ');

  const hasConflict = /conflict|تعارض\s*سعر/i.test(text);
  const hasPrecisionRisk = /precision[_\s-]*risk|دقة\s*السعر|مخاطر\s*الدقة/i.test(text);
  const severeHistoryGap = historySessions < 20;
  const incompleteHistory = historySessions < 50;

  if (hasConflict) return { bucket: 'excluded', label: 'مستبعد بسبب تعارض سعر', severity: 'danger' };
  if (signal === 'INVALID' || row.goalDecisionGate === 'BLOCKED') return { bucket: 'excluded', label: 'مستبعد بسبب جودة البيانات', severity: 'danger' };
  if (hasPrecisionRisk) return { bucket: 'monitor', label: 'مراقبة فقط بسبب دقة السعر', severity: 'warn' };
  if (severeHistoryGap) return { bucket: 'monitor', label: 'مراقبة فقط بسبب نقص التاريخ', severity: 'warn' };
  if (incompleteHistory) return { bucket: 'monitor', label: 'مراقبة بثقة مخفضة', severity: 'warn' };
  if (executionAllowed && signal === 'WATCH_BUY' && confidence >= 70 && quality >= 60) return { bucket: 'intraday', label: 'مضاربة داخل الجلسة - مشروطة', severity: 'good' };
  if ((signal === 'WATCH_BUY' || signal === 'WATCH') && confidence >= 65) return { bucket: 'nextSession', label: 'فرصة جلسة قادمة - مراقبة', severity: 'good' };
  return { bucket: 'wait', label: 'انتظار', severity: 'neutral' };
}
function buildEntryPlan(row) {
  const price = n(row.price, null);
  const support1 = n(row.support1, null);
  const resistance1 = n(row.resistance1, null);
  const pivot = n(row.pivot, null);
  const entry = n(row.entry, null) || n(row.entryPrice, null) || price;
  let stop = n(row.stopLoss, null) || n(row.stop, null);
  let target1 = n(row.target1, null) || n(row.firstTarget, null) || resistance1;
  let target2 = n(row.target2, null) || n(row.secondTarget, null);

  if (price && !stop) stop = support1 || +(price * 0.97).toFixed(3);
  if (price && !target1) target1 = +(price * 1.03).toFixed(3);
  if (price && !target2) target2 = +(price * 1.055).toFixed(3);

  const risk = entry && stop ? Math.max(0, entry - stop) : null;
  const reward = entry && target1 ? Math.max(0, target1 - entry) : null;
  const rr = risk && reward ? +(reward / risk).toFixed(2) : null;

  return { price, pivot, entry, stopLoss: stop, target1, target2, riskReward: rr };
}
function toDecisionItem(row) {
  const category = decideCategory(row);
  const plan = buildEntryPlan(row);
  return {
    symbol: symbolOf(row),
    name: nameOf(row),
    category: category.bucket,
    label: category.label,
    severity: category.severity,
    signal: clean(row.signal || 'WAIT'),
    signalLabel: signalLabel(row.signal),
    finalConfidence: n(row.finalConfidence ?? row.confidence, 0),
    dataQualityScore: n(row.dataQualityScore ?? row.quality, 0),
    historySessions: n(row.historySessions ?? row.historicalSessions ?? row.sessionsCount, 0),
    executionAllowed: row.executionAllowed === true && category.bucket === 'intraday',
    monitorOnly: row.monitorOnly === true || category.bucket === 'monitor',
    reason: clean(row.reason || row.decisionReason || ''),
    blocks: blocksOf(row),
    price: plan.price,
    pivot: plan.pivot,
    entry: plan.entry,
    stopLoss: plan.stopLoss,
    target1: plan.target1,
    target2: plan.target2,
    riskReward: plan.riskReward,
    liquidityScore: n(row.liquidityScore, 0),
    volume: n(row.volume, 0),
    turnover: n(row.turnover, 0),
    changePct: n(row.changePct, 0),
    sourceUrl: row.sourceUrl || row.url || null
  };
}
function sortBest(a, b) {
  return (b.executionAllowed - a.executionAllowed) || (b.finalConfidence - a.finalConfidence) || (b.dataQualityScore - a.dataQualityScore) || (b.turnover - a.turnover);
}
function topN(items, nItems) { return items.slice().sort(sortBest).slice(0, nItems); }
function updateBacktestLedger(decisionCenter, marketRows) {
  const existing = readJson('recommendation-backtest-ledger.json', { ok: true, items: [] });
  const items = Array.isArray(existing?.items) ? existing.items : Array.isArray(existing) ? existing : [];
  const bySymbol = new Map(marketRows.map(row => [symbolOf(row), row]));
  const today = NOW_ISO.slice(0, 10);

  for (const rec of items) {
    if (!rec || !rec.symbol || !rec.createdAt) continue;
    const row = bySymbol.get(rec.symbol);
    if (!row) continue;
    const currentPrice = n(row.price, null);
    if (!currentPrice) continue;
    const ageDays = Math.floor((new Date(today).getTime() - new Date(String(rec.createdAt).slice(0, 10)).getTime()) / 86400000);
    const updateOutcome = key => {
      if (rec[key]) return;
      const entry = n(rec.entry, null);
      const target1 = n(rec.target1, null);
      const stopLoss = n(rec.stopLoss, null);
      const changePct = entry ? +(((currentPrice - entry) / entry) * 100).toFixed(2) : null;
      let status = 'OPEN';
      if (target1 && currentPrice >= target1) status = 'TARGET_HIT';
      else if (stopLoss && currentPrice <= stopLoss) status = 'STOP_HIT';
      rec[key] = { checkedAt: NOW_ISO, currentPrice, changePct, status };
    };
    if (ageDays >= 1) updateOutcome('outcomeT1');
    if (ageDays >= 3) updateOutcome('outcomeT3');
    if (ageDays >= 5) updateOutcome('outcomeT5');
  }

  const candidates = [...decisionCenter.intraday, ...decisionCenter.nextSession].slice(0, 10);
  for (const rec of candidates) {
    const key = `${today}|${rec.symbol}|${rec.category}`;
    if (items.some(x => x.key === key)) continue;
    items.push({
      key,
      createdAt: NOW_ISO,
      symbol: rec.symbol,
      name: rec.name,
      category: rec.category,
      label: rec.label,
      entry: rec.entry,
      stopLoss: rec.stopLoss,
      target1: rec.target1,
      target2: rec.target2,
      finalConfidence: rec.finalConfidence,
      dataQualityScore: rec.dataQualityScore,
      historySessions: rec.historySessions,
      status: 'OPEN'
    });
  }

  const closed = items.filter(x => x.outcomeT1 || x.outcomeT3 || x.outcomeT5);
  const wins = closed.filter(x => [x.outcomeT1, x.outcomeT3, x.outcomeT5].some(o => o?.status === 'TARGET_HIT')).length;
  const losses = closed.filter(x => [x.outcomeT1, x.outcomeT3, x.outcomeT5].some(o => o?.status === 'STOP_HIT')).length;

  const ledger = {
    ok: true,
    engine: `${ENGINE}_backtest_ledger`,
    generatedAt: NOW_ISO,
    summary: {
      totalRecords: items.length,
      evaluatedRecords: closed.length,
      targetHits: wins,
      stopHits: losses,
      measuredWinRate: closed.length ? +((wins / closed.length) * 100).toFixed(2) : null,
      note: closed.length ? 'مؤشر مبدئي بناءً على أسعار عامة/متأخرة وليس Backtest احترافي كامل.' : 'لا توجد نتائج كافية بعد. يحتاج عدة جلسات تشغيل.'
    },
    items: items.slice(-500)
  };
  writeJson('recommendation-backtest-ledger.json', ledger);
  return ledger.summary;
}
function main() {
  ensureDataDir();
  const market = readJson('market.json', { ok: false, rows: [] });
  const sourceHealth = readJson('source-health.json', {});
  const appHealth = readJson('app-health-status.json', {});
  const hardening = readJson('hardening-report.json', {});
  const rows = rowsFrom(market);

  const items = rows.map(toDecisionItem).filter(x => x.symbol);
  const intraday = topN(items.filter(x => x.category === 'intraday'), 8);
  const nextSession = topN(items.filter(x => x.category === 'nextSession'), 12);
  const monitor = topN(items.filter(x => x.category === 'monitor'), 25);
  const excluded = topN(items.filter(x => x.category === 'excluded'), 50);
  const wait = topN(items.filter(x => x.category === 'wait'), 25);

  const coverage = n(sourceHealth.coveragePct ?? sourceHealth.coverage ?? market.summary?.coveragePct, null);
  const staleMinutes = ageMinutes(market.updatedAt || sourceHealth.lastSuccessAt);
  const dataOk = Boolean(market.ok !== false && rows.length > 0 && staleMinutes <= 240);
  const measuredAccuracyCount = n(appHealth.measuredRecommendations ?? appHealth.recommendationsMeasured ?? appHealth.accuracyMeasuredCount, 0);
  const fullHistoryCount = n(appHealth.fullHistorySymbols ?? appHealth.fullHistoryCount ?? appHealth.history50Symbols, 0);

  const globalBlocks = [];
  if (!dataOk) globalBlocks.push('البيانات غير محدثة أو غير متاحة بما يكفي.');
  if (fullHistoryCount === 0) globalBlocks.push('لا يوجد تأكيد بأن 50 جلسة تاريخية مكتملة متاحة للأسهم.');
  if (measuredAccuracyCount === 0) globalBlocks.push('دقة التوصيات غير مقاسة بعد؛ كل قرارات الشراء تعتبر مشروطة/مراقبة.');
  if (n(hardening.excludedCount, 0) > 0) globalBlocks.push(`تم استبعاد أو تخفيض ${hardening.excludedCount} فرصة بسبب بوابة الجودة.`);

  const primaryDecision = intraday[0] || nextSession[0] || monitor[0] || null;
  const mode = intraday.length && !globalBlocks.length ? 'EXECUTION_CONDITIONAL' : nextSession.length ? 'NEXT_SESSION_WATCH' : monitor.length ? 'MONITOR_ONLY' : 'NO_TRADE';
  const modeLabel = {
    EXECUTION_CONDITIONAL: 'يوجد قرار تنفيذ مشروط',
    NEXT_SESSION_WATCH: 'فرص جلسة قادمة للمراقبة فقط',
    MONITOR_ONLY: 'مراقبة فقط - لا شراء آلي',
    NO_TRADE: 'لا توجد فرصة شراء آمنة الآن'
  }[mode];

  const decisionCenter = {
    ok: true,
    engine: ENGINE,
    generatedAt: NOW_ISO,
    mode,
    modeLabel,
    disclaimer: 'هذه أداة مساعدة قرار مبنية على بيانات عامة/متأخرة. ليست توصية مالية ولا تنفذ أوامر تداول.',
    definitions: {
      intraday: 'مضاربة داخل الجلسة: شراء وبيع خلال نفس الجلسة فقط عند تحقق السعر والسيولة ووقف الخسارة.',
      nextSession: 'فرصة جلسة قادمة: سهم للمراقبة في الجلسة التالية، وليس أمر شراء تلقائي.',
      monitor: 'مراقبة فقط: لا شراء حتى تزول أسباب المنع أو يكتمل التاريخ/تتحسن جودة البيانات.',
      excluded: 'مستبعد: لا يظهر كفرصة شراء بسبب تعارض سعر أو جودة بيانات أو خطر جوهري.'
    },
    dataStatus: {
      rows: rows.length,
      coveragePct: coverage,
      updatedAt: market.updatedAt || null,
      staleMinutes,
      source: sourceHealth.sourceName || market.source || null,
      mode: sourceHealth.mode || 'public_delayed',
      dataOk,
      publicDelayed: true
    },
    summary: {
      intradayCount: intraday.length,
      nextSessionCount: nextSession.length,
      monitorCount: monitor.length,
      excludedCount: excluded.length,
      waitCount: wait.length,
      measuredAccuracyCount,
      fullHistoryCount,
      globalBlocks
    },
    primaryDecision,
    intraday,
    nextSession,
    monitor,
    excluded,
    wait
  };

  const backtestSummary = updateBacktestLedger(decisionCenter, rows);
  decisionCenter.backtestSummary = backtestSummary;

  writeJson('today-decision-center.json', decisionCenter);
  console.log(`[${ENGINE}] mode=${mode}; intraday=${intraday.length}; next=${nextSession.length}; monitor=${monitor.length}; excluded=${excluded.length}`);
}

main();
