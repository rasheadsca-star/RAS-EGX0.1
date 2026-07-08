#!/usr/bin/env node
/*
  EGX Pro Hub — Quality Hardening Gate
  Purpose:
  1) Clean polluted company names caused by ads/scripts in public-page parsing.
  2) Block execution when price reconciliation has conflicts, stale prices, precision risk, or explicit blocks.
  3) Cap confidence when 50-session history is incomplete.
  4) Keep market.json, recommendations.json, final ranking, daily brief, and confidence guard consistent.

  This script is intentionally defensive: if a source file is missing it skips it and writes a report.
*/

const fs = require('fs');
const path = require('path');

const ROOT = process.cwd();
const DATA = path.join(ROOT, 'data');
const CONFIG = path.join(ROOT, 'config');
const HISTORY_TARGET = Number(process.env.EGX_HISTORY_TARGET_SESSIONS || 50);

function readJson(relPath, fallback) {
  try {
    return JSON.parse(fs.readFileSync(path.join(ROOT, relPath), 'utf8'));
  } catch {
    return fallback;
  }
}

function writeJson(relPath, value) {
  const full = path.join(ROOT, relPath);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, JSON.stringify(value, null, 2) + '\n', 'utf8');
}

function exists(relPath) {
  return fs.existsSync(path.join(ROOT, relPath));
}

function num(value, fallback = 0) {
  if (value === null || value === undefined || value === '') return fallback;
  const n = Number(String(value).replace(/[,%٬،]/g, '').replace(/[^\d.+\-eE]/g, ''));
  return Number.isFinite(n) ? n : fallback;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function round(value, dp = 2) {
  const m = 10 ** dp;
  return Math.round(num(value) * m) / m;
}

function symbolOf(row) {
  return String(row?.symbol || row?.code || '').trim().toUpperCase();
}

function hasArabic(text) {
  return /[\u0600-\u06FF]/.test(String(text || ''));
}

function looksPollutedName(text) {
  const s = String(text || '').trim();
  if (!s) return true;
  if (s.length > 160) return true;
  return /AdSlot|googletag|google|gpt|doubleclick|adsbygoogle|advert|iframe|script|function\s*\(|window\.|document\.|var\s+|const\s+|let\s+|<\/?|\{\s*\}|slotRenderEnded|pubads|display\(|defineSlot|\.js|\/ads\//i.test(s);
}

function normalizeWhitespace(text) {
  return String(text || '')
    .replace(/\s+/g, ' ')
    .replace(/\s+,\s+/g, ', ')
    .trim();
}

function loadSymbolNameMap() {
  const map = new Map();
  const csvPath = path.join(CONFIG, 'egx-symbols.csv');
  if (!fs.existsSync(csvPath)) return map;

  const raw = fs.readFileSync(csvPath, 'utf8')
    .replace(/^\uFEFF/, '')
    .replace(/\r/g, '\n');

  // The file in this repo may be line-collapsed. Parse by detecting symbol tokens followed by two comma fields.
  const symbolToken = /\b[A-Z0-9]{3,7}(?:\.CA)?\b/g;
  const matches = [];
  let m;
  while ((m = symbolToken.exec(raw)) !== null) {
    const symbol = m[0];
    if (symbol === 'CA' || symbol === 'S' || symbol === 'SAE' || symbol === 'PLC') continue;
    matches.push({ symbol, index: m.index });
  }

  for (let i = 0; i < matches.length; i += 1) {
    const start = matches[i].index;
    const end = i + 1 < matches.length ? matches[i + 1].index : raw.length;
    let chunk = raw.slice(start, end).trim();
    if (chunk.startsWith('symbol,')) continue;
    const symbol = matches[i].symbol.toUpperCase();
    if (!chunk.startsWith(symbol)) continue;

    chunk = chunk.slice(symbol.length).replace(/^,/, '').trim();
    const parts = chunk.split(',');
    const name_ar = normalizeWhitespace(parts[0] || '');
    const name_en = normalizeWhitespace(parts[1] || '');

    if (!name_ar && !name_en) continue;
    map.set(symbol, { name_ar, name_en, name: name_ar || name_en });
  }

  return map;
}

function pickCleanName(symbol, row, nameMap) {
  const fallback = nameMap.get(symbol) || {};
  const candidates = [
    row?.name_ar,
    row?.nameAr,
    row?.arabicName,
    row?.name,
    row?.name_en,
    row?.nameEn,
    row?.englishName,
  ].map(normalizeWhitespace).filter(Boolean);

  const cleanArabic = candidates.find(v => hasArabic(v) && !looksPollutedName(v));
  const cleanAny = candidates.find(v => !looksPollutedName(v));

  const name_ar = cleanArabic || fallback.name_ar || (hasArabic(cleanAny) ? cleanAny : '') || fallback.name || symbol;
  const name_en = (!hasArabic(cleanAny) ? cleanAny : '') || fallback.name_en || '';
  const name = name_ar || name_en || fallback.name || symbol;

  const changed = [row?.name, row?.name_ar, row?.name_en].some(v => looksPollutedName(v)) || row?.name !== name;
  return { name, name_ar, name_en, changed };
}

function loadPriceMap() {
  const report = readJson('data/price-reconciliation-report.json', { rows: [] });
  const map = new Map();
  for (const row of report.rows || []) {
    const symbol = symbolOf(row);
    if (!symbol) continue;
    map.set(symbol, row);
  }
  return { report, map };
}

function loadHistoryMap() {
  const candidates = [
    readJson('data/history-backfill-plan.json', { rows: [] }),
    readJson('data/history-integrity-report.json', { rows: [] }),
    readJson('data/session-memory-status.json', { rows: [] }),
  ];
  const map = new Map();
  let avgSessions = 0;
  let full50Symbols = 0;

  for (const doc of candidates) {
    avgSessions = Math.max(avgSessions, num(doc.avgSessions));
    full50Symbols = Math.max(full50Symbols, num(doc.full50Symbols));
    for (const row of doc.rows || doc.symbols || []) {
      const symbol = symbolOf(row);
      if (!symbol) continue;
      const sessions = Math.max(
        num(row.sessions),
        num(row.historySessions),
        num(row.sessionsAvailable),
        num(row.availableSessions),
        num(row.validSessions),
        num(row.count)
      );
      if (!map.has(symbol) || sessions > map.get(symbol).sessions) {
        map.set(symbol, { sessions, source: row });
      }
    }
  }

  return { map, avgSessions, full50Symbols };
}

function conflictFromPriceRow(priceRow) {
  if (!priceRow) return null;
  if (priceRow.precisionRisk === true) return 'precision_risk';
  if (priceRow.isExecutionSafe === false && /دقة|precision|decimal/i.test(String(priceRow.executionBlockReason || priceRow.precisionReason || ''))) return 'precision_risk';
  if (priceRow.hasConflict === true || priceRow.conflict === true || String(priceRow.priceState || '').toLowerCase() === 'conflict') return 'conflict';
  if (priceRow.isStale === true || priceRow.stale === true || String(priceRow.priceState || '').toLowerCase() === 'stale') return 'stale';
  return null;
}

function reasonForBlock(priceState, extra = '') {
  const base = {
    conflict: 'تعارض سعر بين المصادر؛ ممنوع تحويله إلى قرار تنفيذ قبل مراجعة السعر.',
    stale: 'السعر قديم/غير مؤكد؛ لا يصلح لقرار سريع قبل تحديث المصدر.',
    precision_risk: 'دقة السعر غير كافية خصوصًا للأسهم أقل من 1 جنيه؛ يلزم تأكيد 3 خانات عشرية.',
    blocked: 'توجد قيود تمنع التنفيذ.',
  }[priceState] || 'توجد قيود جودة تمنع التنفيذ.';
  return extra ? `${base} ${extra}` : base;
}

function historyCap(sessions) {
  const s = num(sessions);
  if (s >= HISTORY_TARGET) return 100;
  if (s >= 40) return 82;
  if (s >= 30) return 75;
  if (s >= 15) return 65;
  if (s >= 5) return 58;
  return 48;
}

function applyConfidenceCap(value, sessions) {
  const current = num(value);
  if (!current) return current;
  return Math.min(current, historyCap(sessions));
}

function appendReason(current, addition) {
  const c = normalizeWhitespace(current);
  if (!addition) return c;
  if (c.includes(addition.slice(0, 24))) return c;
  return c ? `${c} | ${addition}` : addition;
}

function hardenRow(row, ctx, counters) {
  if (!row || typeof row !== 'object') return row;
  const symbol = symbolOf(row);
  if (!symbol) return row;

  const namePick = pickCleanName(symbol, row, ctx.nameMap);
  const beforeName = `${row.name || ''}|${row.name_ar || ''}|${row.name_en || ''}`;
  row.name = namePick.name;
  row.name_ar = namePick.name_ar;
  if (namePick.name_en) row.name_en = namePick.name_en;
  if (`${row.name || ''}|${row.name_ar || ''}|${row.name_en || ''}` !== beforeName) counters.namesCleaned += 1;

  const priceRow = ctx.priceMap.get(symbol);
  const hist = ctx.historyMap.get(symbol) || {};
  const sessions = Math.max(num(row.historySessions), num(row.sessions), num(row.sessionsAvailable), num(hist.sessions));
  if (sessions) {
    row.historySessions = sessions;
    row.historyCompletenessPct = round((sessions / HISTORY_TARGET) * 100, 1);
  }

  const priceState = conflictFromPriceRow(priceRow) || row.priceState;
  const blocks = Array.isArray(row.blocks) ? [...row.blocks] : [];
  if (priceState === 'conflict' && !blocks.includes('تعارض سعر')) blocks.push('تعارض سعر');
  if (priceState === 'stale' && !blocks.includes('سعر قديم')) blocks.push('سعر قديم');
  if (priceState === 'precision_risk' && !blocks.includes('دقة سعر غير كافية')) blocks.push('دقة سعر غير كافية');

  if (sessions < HISTORY_TARGET) {
    const note = `تاريخ غير مكتمل ${sessions || 0}/${HISTORY_TARGET}`;
    if (!blocks.includes(note)) blocks.push(note);
    for (const key of ['finalConfidence', 'confidence', 'targetProbability', 'guardedProbability']) {
      if (row[key] !== undefined) {
        const before = num(row[key]);
        row[key] = applyConfidenceCap(row[key], sessions);
        if (num(row[key]) < before) counters.confidenceCapped += 1;
      }
    }
    row.reason = appendReason(row.reason, `تم خفض الثقة لعدم اكتمال سجل ${HISTORY_TARGET} جلسة`);
  }

  const mustBlock = priceState === 'conflict' || priceState === 'precision_risk' || blocks.some(b => /تعارض سعر|دقة سعر|سعر قديم|إشارة مخاطر/i.test(String(b)));
  if (mustBlock) {
    row.priceState = priceState || 'blocked';
    row.executionAllowed = false;
    row.executionBlockReason = row.executionBlockReason || reasonForBlock(row.priceState);
    row.decision = row.decision === 'BUY' ? 'WAIT' : (row.decision || 'WAIT');
    if (row.signal === 'WATCH_BUY') row.signal = 'WAIT';
    if (row.grade && row.grade !== 'Blocked') row.grade = 'Blocked';
    if (row.targetProbability !== undefined) row.targetProbability = Math.min(num(row.targetProbability), 55);
    if (row.finalScore !== undefined) row.finalScore = Math.min(num(row.finalScore), 45);
    row.reason = appendReason(row.reason, row.executionBlockReason);
    counters.executionBlocked += 1;
  } else if (priceState) {
    row.priceState = priceState;
  }

  if (blocks.length) row.blocks = Array.from(new Set(blocks));
  return row;
}

function hardenArrayRows(rows, ctx, counters) {
  if (!Array.isArray(rows)) return rows;
  return rows.map(row => hardenRow(row, ctx, counters));
}

function hardenMarket(ctx, counters) {
  if (!exists('data/market.json')) return false;
  const market = readJson('data/market.json', null);
  if (!market || !Array.isArray(market.rows)) return false;
  market.rows = hardenArrayRows(market.rows, ctx, counters);
  market.summary = market.summary || {};
  market.summary.qualityHardeningApplied = true;
  market.summary.qualityHardeningAt = new Date().toISOString();
  market.summary.executionBlocked = market.rows.filter(r => r.executionAllowed === false || r.priceState === 'conflict' || r.priceState === 'precision_risk').length;
  market.summary.incompleteHistoryRows = market.rows.filter(r => num(r.historySessions) < HISTORY_TARGET).length;
  writeJson('data/market.json', market);
  return true;
}

function hardenRecommendations(ctx, counters) {
  if (!exists('data/recommendations.json')) return false;
  const rec = readJson('data/recommendations.json', null);
  if (!rec) return false;
  for (const key of ['all', 'rows', 'recommendations', 'topWatchBuy', 'riskReduce']) {
    if (Array.isArray(rec[key])) rec[key] = hardenArrayRows(rec[key], ctx, counters);
  }
  rec.qualityHardeningApplied = true;
  rec.qualityHardeningAt = new Date().toISOString();
  writeJson('data/recommendations.json', rec);
  return true;
}

function hardenFinalRanking(ctx, counters) {
  if (!exists('data/final-opportunity-ranking.json')) return false;
  const rank = readJson('data/final-opportunity-ranking.json', null);
  if (!rank || !Array.isArray(rank.rows)) return false;
  rank.rows = hardenArrayRows(rank.rows, ctx, counters);
  rank.rows.sort((a, b) => {
    const gradeWeight = { P1: 4, P2: 3, P3: 2, Watch: 1, Blocked: 0 };
    return (gradeWeight[b.grade] || 0) - (gradeWeight[a.grade] || 0)
      || num(b.targetProbability) - num(a.targetProbability)
      || num(b.expectedReturnPct) - num(a.expectedReturnPct)
      || num(b.rr) - num(a.rr);
  });
  rank.summary = {
    ...(rank.summary || {}),
    p1: rank.rows.filter(x => x.grade === 'P1').length,
    p2: rank.rows.filter(x => x.grade === 'P2').length,
    p3: rank.rows.filter(x => x.grade === 'P3').length,
    blocked: rank.rows.filter(x => x.grade === 'Blocked' || x.executionAllowed === false).length,
    conflictBlocked: rank.rows.filter(x => x.priceState === 'conflict').length,
    precisionBlocked: rank.rows.filter(x => x.priceState === 'precision_risk' || x.precisionRisk).length,
    incompleteHistory: rank.rows.filter(x => num(x.historySessions) < HISTORY_TARGET).length,
  };
  rank.qualityHardeningApplied = true;
  rank.qualityHardeningAt = new Date().toISOString();
  rank.note = 'Quality hardening applied: polluted names cleaned, conflict/precision/stale execution blocked, confidence capped for incomplete 50-session history.';
  writeJson('data/final-opportunity-ranking.json', rank);
  return true;
}

function hardenDailyBrief(ctx, counters) {
  if (!exists('data/daily-decision-brief.json')) return false;
  const brief = readJson('data/daily-decision-brief.json', null);
  if (!brief) return false;

  const rank = readJson('data/final-opportunity-ranking.json', { rows: [] });
  const safeMap = new Map();
  for (const r of rank.rows || []) {
    const symbol = symbolOf(r);
    if (!symbol) continue;
    const safe = r.executionAllowed !== false && r.grade !== 'Blocked' && !['conflict', 'precision_risk'].includes(String(r.priceState || ''));
    safeMap.set(symbol, { safe, row: r });
  }

  if (Array.isArray(brief.opportunities)) {
    const before = brief.opportunities.length;
    brief.opportunities = brief.opportunities
      .map(op => hardenRow(op, ctx, counters))
      .filter(op => {
        const safe = safeMap.get(symbolOf(op));
        return !safe || safe.safe;
      })
      .slice(0, 10);
    counters.dailyBriefFiltered += Math.max(0, before - brief.opportunities.length);
  }

  if (Array.isArray(brief.topWatchBuy)) {
    const before = brief.topWatchBuy.length;
    brief.topWatchBuy = brief.topWatchBuy
      .map(op => hardenRow(op, ctx, counters))
      .filter(op => {
        const safe = safeMap.get(symbolOf(op));
        return !safe || safe.safe;
      })
      .slice(0, 10);
    counters.dailyBriefFiltered += Math.max(0, before - brief.topWatchBuy.length);
  }

  if (Array.isArray(brief.risks)) brief.risks = hardenArrayRows(brief.risks, ctx, counters);
  brief.notes = Array.from(new Set([
    ...(brief.notes || []),
    'تم تطبيق فلتر جودة نهائي: أي سهم لديه تعارض سعر أو دقة غير كافية أو قيود تنفيذية لا يظهر كفرصة تنفيذية.',
    `الثقة مخفضة تلقائيًا عند عدم اكتمال سجل ${HISTORY_TARGET} جلسة.`,
  ]));
  brief.qualityHardeningApplied = true;
  brief.qualityHardeningAt = new Date().toISOString();
  writeJson('data/daily-decision-brief.json', brief);
  return true;
}

function hardenGuard(ctx, counters) {
  if (!exists('data/confidence-guard-report.json')) return false;
  const guard = readJson('data/confidence-guard-report.json', null);
  if (!guard) return false;
  if (Array.isArray(guard.rows)) guard.rows = hardenArrayRows(guard.rows, ctx, counters);
  guard.guards = guard.guards || [];

  const hasConflictGuard = guard.guards.some(g => g.id === 'hard_execution_gate');
  if (!hasConflictGuard) {
    guard.guards.unshift({
      id: 'hard_execution_gate',
      level: 'critical',
      title: 'بوابة منع التنفيذ',
      message: 'تم منع ترقية أي سهم لديه تعارض سعر، دقة غير كافية، أو قيود تنفيذية إلى شراء قابل للتنفيذ.',
      action: 'راجع hardening-report.json وسجل price-reconciliation قبل أي قرار شراء سريع.',
    });
  }

  guard.summary = {
    ...(guard.summary || {}),
    executionBlockedByHardening: counters.executionBlocked,
    namesCleanedByHardening: counters.namesCleaned,
    confidenceCappedByHardening: counters.confidenceCapped,
  };
  guard.score = clamp(num(guard.score, 80) - (counters.executionBlocked ? 5 : 0), 0, 100);
  guard.state = guard.score >= 80 ? 'ok' : guard.score >= 60 ? 'warn' : 'bad';
  guard.qualityHardeningApplied = true;
  guard.qualityHardeningAt = new Date().toISOString();
  writeJson('data/confidence-guard-report.json', guard);
  return true;
}

function main() {
  const counters = {
    namesCleaned: 0,
    executionBlocked: 0,
    confidenceCapped: 0,
    dailyBriefFiltered: 0,
  };

  const nameMap = loadSymbolNameMap();
  const { report: priceReport, map: priceMap } = loadPriceMap();
  const { map: historyMap, avgSessions, full50Symbols } = loadHistoryMap();
  const ctx = { nameMap, priceMap, historyMap };

  const files = {
    market: hardenMarket(ctx, counters),
    recommendations: hardenRecommendations(ctx, counters),
    finalRanking: hardenFinalRanking(ctx, counters),
    dailyBrief: hardenDailyBrief(ctx, counters),
    confidenceGuard: hardenGuard(ctx, counters),
  };

  const report = {
    ok: true,
    engine: 'quality_hardening_v1_0',
    generatedAt: new Date().toISOString(),
    historyTargetSessions: HISTORY_TARGET,
    counters,
    files,
    inputs: {
      knownSymbolNames: nameMap.size,
      priceRows: priceMap.size,
      priceConflicts: (priceReport.rows || []).filter(r => conflictFromPriceRow(r) === 'conflict').length,
      precisionRisks: (priceReport.rows || []).filter(r => conflictFromPriceRow(r) === 'precision_risk').length,
      stalePrices: (priceReport.rows || []).filter(r => conflictFromPriceRow(r) === 'stale').length,
      historyRows: historyMap.size,
      avgSessions,
      full50Symbols,
    },
    policy: {
      conflict: 'executionAllowed=false, grade=Blocked, signal WATCH_BUY downgraded to WAIT',
      precisionRisk: 'executionAllowed=false until 3-decimal price is confirmed',
      incompleteHistory: 'confidence capped until 50 sessions are available',
      pollutedNames: 'replace script/ad polluted name fields using config/egx-symbols.csv or symbol fallback',
    },
  };

  writeJson('data/hardening-report.json', report);
  console.log('Quality hardening applied', JSON.stringify(report.counters));
}

main();
