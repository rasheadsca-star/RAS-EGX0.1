#!/usr/bin/env node
'use strict';

/**
 * RAS EGX /GOAL — Integrated Decision Center
 * Builds one clear decision screen from the hardened market data.
 */
const fs = require('fs');
const path = require('path');
const RUN_AT = new Date().toISOString();
const ROOT = process.cwd();
function p(...x) { return path.join(ROOT, ...x); }
function readJson(file, fallback) { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; } }
function writeJson(file, obj) { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, JSON.stringify(obj, null, 2) + '\n', 'utf8'); }
function rowsOf(x) { if (Array.isArray(x)) return x; if (Array.isArray(x?.rows)) return x.rows; if (Array.isArray(x?.data)) return x.data; if (Array.isArray(x?.items)) return x.items; if (Array.isArray(x?.recommendations)) return x.recommendations; return []; }
function num(v) { if (v == null || v === '') return null; const n = Number(String(v).replace(/[,%٬،]/g, '').replace(/[^0-9.+\-eE]/g, '')); return Number.isFinite(n) ? n : null; }
function first(...vals) { for (const v of vals) if (v !== null && v !== undefined && v !== '') return v; return null; }
function score(r) { return num(first(r.finalConfidence, r.confidence, r.score, r.dataQualityScore)) || 0; }
function price(r) { return num(first(r.mubasherPrice, r.price, r.lastPrice, r.currentPrice)); }
function val(r, ...keys) { for (const k of keys) { const n = num(r[k]); if (n != null) return n; } return null; }
function upsideToResistance(r) { const p0 = price(r), res = val(r, 'resistance1', 'resistance'); return p0 && res ? ((res - p0) / p0 * 100) : null; }
function downsideToSupport(r) { const p0 = price(r), sup = val(r, 'support1', 'support'); return p0 && sup ? ((p0 - sup) / p0 * 100) : null; }
function coreOk(r) { return Boolean(r.coreDataReady || r.mubasherPrimaryFeed?.hasPrice && r.mubasherPrimaryFeed?.hasLiquidity && r.mubasherPrimaryFeed?.hasSupportResistance); }
function rowCard(r, type, reason) {
  const p0 = price(r);
  const sup = val(r, 'support1', 'support');
  const res = val(r, 'resistance1', 'resistance');
  const pivot = val(r, 'pivotPoint');
  const risk = downsideToSupport(r);
  const reward = upsideToResistance(r);
  const entryFrom = p0 && sup ? Math.max(sup, p0 * 0.995) : p0;
  const entryTo = p0 && res ? Math.min(res * 0.995, p0 * 1.01) : p0;
  return {
    symbol: r.symbol,
    name: first(r.name, r.name_ar, r.name_en, r.companyName, r.symbol),
    decisionType: type,
    reason,
    price: p0,
    volume: first(r.mubasherVolume, r.volume),
    turnover: first(r.mubasherTurnover, r.turnover, r.valueTraded, r.liquidityValue),
    support1: sup,
    resistance1: res,
    pivotPoint: pivot,
    entryFrom: entryFrom ? Number(entryFrom.toFixed(4)) : null,
    entryTo: entryTo ? Number(entryTo.toFixed(4)) : null,
    target1: res || first(r.target1, r.t1),
    stopLoss: sup ? Number((sup * 0.992).toFixed(4)) : first(r.stopLoss, r.stop_loss),
    rewardPct: reward == null ? null : Number(reward.toFixed(2)),
    riskPct: risk == null ? null : Number(risk.toFixed(2)),
    finalConfidence: Math.round(score(r)),
    source: 'Mubasher primary + internal GOAL gate',
    delayed15Minutes: Boolean(r.dataFreshness?.delayed15Minutes || r.mubasherPrimaryFeed?.stock?.delayed || r.mubasherPrimaryFeed?.supportResistance?.delayed),
    executionAllowed: Boolean(r.executionAllowed),
  };
}
function main() {
  const market = rowsOf(readJson(p('data/market.json'), []));
  const hardening = readJson(p('data/hardening-report.json'), {});
  const mubasher = readJson(p('data/mubasher-primary-fields-report.json'), {});
  const candidates = market.filter(r => coreOk(r) && !r.monitorOnly && !r.goalQualityGate?.priceConflict && !r.goalQualityGate?.pricePrecisionRisk);
  const intraday = candidates
    .filter(r => score(r) >= 75 && (upsideToResistance(r) || 0) >= 1.2 && (downsideToSupport(r) || 999) <= 2.5)
    .sort((a, b) => score(b) - score(a) || (upsideToResistance(b) || 0) - (upsideToResistance(a) || 0))
    .slice(0, 10)
    .map(r => rowCard(r, 'INTRADAY_CONDITIONAL', 'مضاربة داخل الجلسة بشرط الالتزام بمنطقة الدخول ووقف الخسارة.'));
  const nextSession = candidates
    .filter(r => !intraday.some(x => x.symbol === r.symbol) && score(r) >= 65)
    .sort((a, b) => score(b) - score(a))
    .slice(0, 15)
    .map(r => rowCard(r, 'NEXT_SESSION_WATCH', 'فرصة جلسة قادمة للمراقبة؛ ليست أمر شراء تلقائي.'));
  const watchOnly = market
    .filter(r => r.monitorOnly && coreOk(r))
    .sort((a, b) => score(b) - score(a))
    .slice(0, 20)
    .map(r => rowCard(r, 'WATCH_ONLY', r.exclusionReason || 'مراقبة فقط بسبب بوابة الجودة أو التاريخ.'));
  const excluded = rowsOf(readJson(p('data/excluded-opportunities.json'), []));

  const noBuy = intraday.length === 0 && nextSession.length === 0;
  const decision = {
    ok: true,
    engine: 'goal_integrated_decision_center_v1_2_mubasher_primary',
    generatedAt: RUN_AT,
    mainDecision: noBuy ? 'لا يوجد شراء تنفيذي آمن الآن' : 'توجد فرص مشروطة بعد تحقق السعر والسيولة والدعم/المقاومة',
    caution: 'كل بيانات مباشر متأخرة أثناء الجلسة بنحو 15 دقيقة؛ القرار ليس توصية استثمارية ملزمة ويحتاج مراجعة بشرية.',
    definitions: {
      INTRADAY_CONDITIONAL: 'مضاربة داخل الجلسة: شراء وبيع في نفس الجلسة فقط عند تحقق شروط الدخول ووقف الخسارة.',
      NEXT_SESSION_WATCH: 'فرصة جلسة قادمة: مراقبة وتحضير، وليست أمر شراء تلقائي.',
      WATCH_ONLY: 'مراقبة فقط: البيانات الأساسية موجودة جزئيًا لكن بوابة الجودة لا تسمح بالتنفيذ.',
      EXCLUDED: 'مستبعد: نقص سعر/سيولة/دعم ومقاومة أو تعارض/مخاطر دقة.',
    },
    dataStatus: {
      marketRows: market.length,
      mubasherOk: Boolean(mubasher.ok),
      priceCoveragePct: mubasher.summary?.priceCoveragePct ?? null,
      liquidityCoveragePct: mubasher.summary?.liquidityCoveragePct ?? null,
      supportResistanceCoveragePct: mubasher.summary?.supportResistanceCoveragePct ?? null,
      hardeningOk: Boolean(hardening.ok),
      executionAllowedRows: market.filter(r => r.executionAllowed).length,
      monitorOnlyRows: market.filter(r => r.monitorOnly).length,
      excludedRows: excluded.length,
    },
    intradayConditional: intraday,
    nextSessionWatch: nextSession,
    watchOnly,
    excludedPreview: excluded.slice(0, 30),
  };
  writeJson(p('data/today-decision-center.json'), decision);
  console.log('GOAL decision center built', decision.mainDecision);
}
main();
