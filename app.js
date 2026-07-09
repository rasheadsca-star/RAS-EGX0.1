'use strict';

const state = {
  market: null,
  sourceHealth: null,
  validation: null,
  dailyReport: null,
  decisionCenter: null,
  hardening: null,
  excludedReport: null,
  backtest: null,
  version: null,
  currentView: 'dashboard',
  filters: { q: '', signal: 'ALL', minConfidence: 0 }
};

const viewMeta = {
  dashboard: ['لوحة القرار', 'قرار واحد واضح: تنفيذ مشروط، مراقبة، أو لا شراء.'],
  today: ['قرار اليوم', 'فصل مضاربة داخل الجلسة عن فرص الجلسة القادمة.'],
  opportunities: ['الفرص التفصيلية', 'كل الأسهم مع الإشارة والثقة وسبب القرار.'],
  excluded: ['المستبعدة ولماذا', 'كل سهم تم منعه أو تخفيضه بواسطة بوابة الجودة.'],
  liquidity: ['السيولة', 'ترتيب الأسهم حسب قيمة التداول وحجم التداول.'],
  support: ['الدعم والمقاومة', 'قراءة Pivot والدعم والمقاومة وخطة الدخول المشروطة.'],
  backtest: ['قياس الدقة', 'متابعة نتيجة التوصيات بعد T+1 / T+3 / T+5.'],
  sources: ['جودة البيانات', 'حالة المصدر والتغطية ووقت آخر تحديث.'],
  dailyReport: ['التقرير اليومي', 'ملخص التقرير اليومي كما يولده محرك البيانات.'],
  settings: ['الإعدادات', 'حدود النسخة وطريقة التشغيل.']
};

function $(id) { return document.getElementById(id); }
function fmt(value, digits = 2) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return '--';
  return Number(value).toLocaleString('ar-EG', { maximumFractionDigits: digits });
}
function pct(value) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return '--';
  return `${Number(value).toFixed(2)}%`;
}
function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[c]));
}
function ageMinutes(iso) {
  if (!iso) return Infinity;
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return Infinity;
  return Math.max(0, Math.round((Date.now() - t) / 60000));
}
function signalArabic(signal) {
  return {
    WATCH_BUY: 'فرصة تنفيذ مشروطة',
    WATCH: 'مراقبة فقط',
    WAIT: 'انتظار',
    RISK_REDUCE: 'حذر / تخفيف',
    INVALID: 'مستبعد',
    NO_TRADE: 'لا شراء'
  }[signal] || signal || '--';
}
function severityClass(severity) {
  return { good: 'good', warn: 'warn', danger: 'bad', neutral: 'neutral' }[severity] || 'neutral';
}
async function fetchJson(path, fallback) {
  try {
    const res = await fetch(`${path}?ts=${Date.now()}`);
    if (!res.ok) throw new Error(`${path} HTTP ${res.status}`);
    return await res.json();
  } catch (error) {
    return { ...fallback, loadError: error.message };
  }
}
async function loadData() {
  const [market, sourceHealth, validation, dailyReport, decisionCenter, hardening, excludedReport, backtest, version] = await Promise.all([
    fetchJson('data/market.json', { ok: false, rows: [], summary: {}, errors: [], message: 'تعذر تحميل market.json' }),
    fetchJson('data/source-health.json', { ok: false, warning: 'تعذر تحميل source-health.json' }),
    fetchJson('data/validation-report.json', { ok: false, warnings: ['تعذر تحميل validation-report.json'] }),
    fetchJson('data/daily-report.json', { notes: ['تعذر تحميل daily-report.json'] }),
    fetchJson('data/today-decision-center.json', { ok: false, modeLabel: 'لم يتم توليد Decision Center بعد' }),
    fetchJson('data/hardening-report.json', { ok: false, rules: [] }),
    fetchJson('data/excluded-opportunities.json', { ok: false, items: [] }),
    fetchJson('data/recommendation-backtest-ledger.json', { ok: false, items: [], summary: {} }),
    fetchJson('VERSION.json', { ok: false })
  ]);
  Object.assign(state, { market, sourceHealth, validation, dailyReport, decisionCenter, hardening, excludedReport, backtest, version });
  renderShell();
  renderCurrent();
}
function rows() { return state.market?.rows || []; }
function filteredRows() {
  const q = state.filters.q.trim().toUpperCase();
  return rows()
    .filter(row => !q || String(row.symbol || '').toUpperCase().includes(q) || String(row.name || row.name_ar || row.name_en || '').toUpperCase().includes(q))
    .filter(row => state.filters.signal === 'ALL' || row.signal === state.filters.signal)
    .filter(row => (row.finalConfidence || row.confidence || 0) >= state.filters.minConfidence)
    .sort((a, b) => (b.executionAllowed === true) - (a.executionAllowed === true) || (b.finalConfidence || b.confidence || 0) - (a.finalConfidence || a.confidence || 0));
}
function renderShell() {
  const market = state.market || {};
  const decision = state.decisionCenter || {};
  const badge = $('sourceBadge');
  const notice = $('notice');
  const minutes = ageMinutes(market.updatedAt || decision.dataStatus?.updatedAt);
  const stale = minutes > 240;
  if (market.ok !== false && rows().length && !stale) {
    badge.textContent = decision.modeLabel || 'Public Delayed OK';
    badge.className = `status-pill ${decision.mode === 'NO_TRADE' ? 'warn' : 'good'}`;
    notice.className = 'notice good';
    notice.textContent = `${market.message || 'تم تحميل البيانات.'} آخر تحديث: ${market.updatedAt ? new Date(market.updatedAt).toLocaleString('ar-EG') : '--'} — وضع القرار: ${decision.modeLabel || '--'}`;
  } else if (rows().length && stale) {
    badge.textContent = 'بيانات قديمة';
    badge.className = 'status-pill warn';
    notice.className = 'notice warn';
    notice.textContent = `البيانات قديمة أو لم تتحدث منذ ${minutes} دقيقة. شغّل Workflow: Update EGX Market Data.`;
  } else {
    badge.textContent = 'لا توجد بيانات';
    badge.className = 'status-pill bad';
    notice.className = 'notice bad';
    notice.textContent = market.message || market.loadError || 'لم يتم تحميل بيانات صالحة.';
  }
}
function setView(view) {
  state.currentView = view;
  document.querySelectorAll('.nav').forEach(btn => btn.classList.toggle('active', btn.dataset.view === view));
  document.querySelectorAll('.view').forEach(section => section.classList.toggle('active', section.id === view));
  const meta = viewMeta[view] || viewMeta.dashboard;
  $('viewTitle').textContent = meta[0];
  $('viewSubtitle').textContent = meta[1];
  renderCurrent();
}
function kpi(label, value, sub = '', cls = '') {
  return `<article class="kpi ${cls}"><span>${esc(label)}</span><strong>${value}</strong>${sub ? `<small>${esc(sub)}</small>` : ''}</article>`;
}
function badge(text, cls = 'neutral') { return `<span class="pill ${cls}">${esc(text)}</span>`; }
function confidenceBar(value) {
  const n = Math.max(0, Math.min(100, Number(value || 0)));
  return `<div class="confidence"><div style="width:${n}%"></div><span>${n}%</span></div>`;
}
function renderDecisionCard(item, title = '') {
  if (!item) return `<div class="empty">لا توجد فرصة مناسبة الآن.</div>`;
  const cls = severityClass(item.severity);
  return `<article class="decision-card ${cls}">
    <div class="card-head">
      <div><h3>${title ? `${esc(title)} — ` : ''}${esc(item.symbol)} <small>${esc(item.name)}</small></h3><p>${esc(item.label || signalArabic(item.signal))}</p></div>
      ${badge(item.executionAllowed ? 'قابل للتنفيذ المشروط' : item.monitorOnly ? 'مراقبة فقط' : 'لا شراء', item.executionAllowed ? 'good' : item.monitorOnly ? 'warn' : 'bad')}
    </div>
    <div class="plan-grid">
      ${kpi('السعر الحالي', fmt(item.price))}
      ${kpi('الدخول', fmt(item.entry), 'مشروط بتحقق السيولة والسعر')}
      ${kpi('وقف الخسارة', fmt(item.stopLoss))}
      ${kpi('هدف 1', fmt(item.target1))}
      ${kpi('R/R', item.riskReward ?? '--')}
      ${kpi('الثقة', `${fmt(item.finalConfidence, 0)}%`, `تاريخ: ${item.historySessions || 0}/50`)}
    </div>
    <p class="reason">${esc(item.reason || 'لا يوجد سبب مسجل.')}</p>
    ${(item.blocks || []).length ? `<ul class="blocks">${item.blocks.map(x => `<li>${esc(x)}</li>`).join('')}</ul>` : ''}
  </article>`;
}
function renderDashboard() {
  const decision = state.decisionCenter || {};
  const ds = decision.dataStatus || {};
  const summary = decision.summary || {};
  const primary = decision.primaryDecision;
  $('dashboard').innerHTML = `
    <div class="hero-decision">
      <div>
        <span class="eyebrow">/GOAL Integrated</span>
        <h2>${esc(decision.modeLabel || 'لم يتم توليد قرار اليوم بعد')}</h2>
        <p>${esc(decision.disclaimer || 'الأداة مساعد قرار فقط وليست توصية مالية.')}</p>
      </div>
      <div class="hero-badge ${decision.mode === 'NO_TRADE' ? 'bad' : decision.mode === 'MONITOR_ONLY' ? 'warn' : 'good'}">${esc(decision.mode || '--')}</div>
    </div>
    <div class="kpi-grid">
      ${kpi('عدد الأسهم', ds.rows ?? rows().length, 'الأسهم المقروءة')}
      ${kpi('التغطية', ds.coveragePct !== null && ds.coveragePct !== undefined ? `${fmt(ds.coveragePct, 1)}%` : '--', 'Public / Delayed')}
      ${kpi('تنفيذ مشروط', summary.intradayCount || 0, 'مضاربة داخل الجلسة')}
      ${kpi('جلسة قادمة', summary.nextSessionCount || 0, 'مراقبة لا تعني شراء')}
      ${kpi('مراقبة فقط', summary.monitorCount || 0, 'غير قابل للتنفيذ')}
      ${kpi('مستبعد', summary.excludedCount || 0, 'بسبب الجودة أو السعر')}
    </div>
    ${renderDecisionCard(primary, 'القرار الأول')}
    <section class="panel">
      <h3>موانع عامة</h3>
      ${(summary.globalBlocks || []).length ? `<ul class="blocks">${summary.globalBlocks.map(x => `<li>${esc(x)}</li>`).join('')}</ul>` : '<p class="muted">لا توجد موانع عامة مسجلة.</p>'}
    </section>
    <section class="panel two-col">
      <div><h3>ماذا يعني شراء اليوم؟</h3><p>${esc(decision.definitions?.intraday || 'شراء وبيع خلال نفس الجلسة، وليس احتفاظ تلقائي.')}</p></div>
      <div><h3>ماذا يعني شراء غدًا؟</h3><p>${esc(decision.definitions?.nextSession || 'فرصة جلسة قادمة للمراقبة وليست أمر شراء تلقائي.')}</p></div>
    </section>`;
}
function renderToday() {
  const d = state.decisionCenter || {};
  $('today').innerHTML = `
    <div class="section-title"><h3>مضاربة داخل الجلسة</h3>${badge('شراء وبيع نفس الجلسة', 'good')}</div>
    <div class="cards-list">${(d.intraday || []).length ? d.intraday.map(x => renderDecisionCard(x)).join('') : '<div class="empty">لا توجد فرص مضاربة داخل الجلسة صالحة الآن.</div>'}</div>
    <div class="section-title"><h3>فرص جلسة قادمة</h3>${badge('مراقبة فقط', 'warn')}</div>
    <div class="cards-list">${(d.nextSession || []).length ? d.nextSession.map(x => renderDecisionCard(x)).join('') : '<div class="empty">لا توجد فرص جلسة قادمة كافية.</div>'}</div>`;
}
function renderToolbar() {
  return `<div class="toolbar">
    <input id="filterQ" type="search" placeholder="بحث بالرمز أو الاسم" value="${esc(state.filters.q)}" />
    <select id="filterSignal">
      ${['ALL', 'WATCH_BUY', 'WATCH', 'WAIT', 'RISK_REDUCE', 'INVALID'].map(sig => `<option value="${sig}" ${state.filters.signal === sig ? 'selected' : ''}>${sig === 'ALL' ? 'كل الإشارات' : signalArabic(sig)}</option>`).join('')}
    </select>
    <label>أقل ثقة <input id="filterConfidence" type="range" min="0" max="100" value="${state.filters.minConfidence}" /></label>
  </div>`;
}
function bindToolbar() {
  const q = $('filterQ');
  const sig = $('filterSignal');
  const min = $('filterConfidence');
  if (q) q.addEventListener('input', e => { state.filters.q = e.target.value; renderCurrent(); });
  if (sig) sig.addEventListener('change', e => { state.filters.signal = e.target.value; renderCurrent(); });
  if (min) min.addEventListener('input', e => { state.filters.minConfidence = Number(e.target.value || 0); renderCurrent(); });
}
function renderMainTable(targetId, sortedRows = filteredRows()) {
  $(targetId).innerHTML = `${renderToolbar()}
    <div class="table-wrap"><table><thead><tr>
      <th>الرمز</th><th>السعر</th><th>التغير</th><th>الحجم</th><th>قيمة التداول</th><th>Pivot</th><th>دعم</th><th>مقاومة</th><th>الإشارة</th><th>الثقة</th><th>الجودة</th><th>بوابة القرار</th><th>السبب</th>
    </tr></thead><tbody>
      ${sortedRows.map(row => `<tr>
        <td><strong>${esc(row.symbol)}</strong><small>${esc(row.name || row.name_ar || row.name_en || '')}</small></td>
        <td>${fmt(row.price)}</td><td>${pct(row.changePct)}</td><td>${fmt(row.volume, 0)}</td><td>${fmt(row.turnover, 0)}</td>
        <td>${fmt(row.pivot)}</td><td>${fmt(row.support1)}</td><td>${fmt(row.resistance1)}</td>
        <td>${badge(signalArabic(row.signal), row.executionAllowed ? 'good' : row.monitorOnly ? 'warn' : row.signal === 'INVALID' ? 'bad' : 'neutral')}</td>
        <td>${confidenceBar(row.finalConfidence || row.confidence || 0)}</td><td>${fmt(row.dataQualityScore, 0)}%</td>
        <td>${esc(row.goalDecisionLabel || (row.executionAllowed ? 'مسموح مشروط' : 'غير مسموح'))}</td>
        <td>${esc(row.reason || '')}</td>
      </tr>`).join('')}
    </tbody></table></div>`;
  bindToolbar();
}
function renderExcluded() {
  const items = state.decisionCenter?.excluded || state.excludedReport?.items || [];
  $('excluded').innerHTML = `<div class="kpi-grid">
    ${kpi('عدد المستبعدين', items.length)}
    ${kpi('بوابة الجودة', state.hardening?.ok ? 'مفعلة' : 'غير مفعلة')}
    ${kpi('آخر تطبيق', state.hardening?.generatedAt ? new Date(state.hardening.generatedAt).toLocaleString('ar-EG') : '--')}
  </div>
  <div class="cards-list">${items.length ? items.map(x => renderDecisionCard(x)).join('') : '<div class="empty">لا توجد أسهم مستبعدة مسجلة.</div>'}</div>`;
}
function renderLiquidity() {
  renderMainTable('liquidity', filteredRows().slice().sort((a, b) => (b.turnover || 0) - (a.turnover || 0)));
}
function renderSupport() {
  renderMainTable('support', filteredRows().slice().sort((a, b) => Math.abs(a.distanceToSupport ?? 999) - Math.abs(b.distanceToSupport ?? 999)));
}
function renderBacktest() {
  const b = state.backtest || {};
  const s = b.summary || {};
  const items = Array.isArray(b.items) ? b.items.slice().reverse().slice(0, 120) : [];
  $('backtest').innerHTML = `<div class="kpi-grid">
    ${kpi('إجمالي السجلات', s.totalRecords || 0)}
    ${kpi('سجلات مقاسة', s.evaluatedRecords || 0)}
    ${kpi('ضرب الهدف', s.targetHits || 0)}
    ${kpi('ضرب الوقف', s.stopHits || 0)}
    ${kpi('Win Rate مبدئي', s.measuredWinRate !== null && s.measuredWinRate !== undefined ? `${fmt(s.measuredWinRate)}%` : '--')}
  </div>
  <p class="notice warn">${esc(s.note || 'قياس مبدئي يحتاج عدة جلسات تشغيل قبل الاعتماد عليه.')}</p>
  <div class="table-wrap"><table><thead><tr><th>التاريخ</th><th>الرمز</th><th>النوع</th><th>دخول</th><th>وقف</th><th>هدف</th><th>T+1</th><th>T+3</th><th>T+5</th></tr></thead><tbody>
    ${items.map(x => `<tr><td>${esc(String(x.createdAt || '').slice(0, 10))}</td><td><strong>${esc(x.symbol)}</strong><small>${esc(x.name || '')}</small></td><td>${esc(x.label || x.category)}</td><td>${fmt(x.entry)}</td><td>${fmt(x.stopLoss)}</td><td>${fmt(x.target1)}</td><td>${esc(x.outcomeT1?.status || '--')}</td><td>${esc(x.outcomeT3?.status || '--')}</td><td>${esc(x.outcomeT5?.status || '--')}</td></tr>`).join('')}
  </tbody></table></div>`;
}
function renderSources() {
  const d = state.decisionCenter?.dataStatus || {};
  const h = state.sourceHealth || {};
  $('sources').innerHTML = `<div class="kpi-grid">
    ${kpi('المصدر', h.sourceName || d.source || '--')}
    ${kpi('الحالة', h.ok || d.dataOk ? 'OK' : 'تحذير')}
    ${kpi('التغطية', d.coveragePct !== null && d.coveragePct !== undefined ? `${fmt(d.coveragePct, 1)}%` : '--')}
    ${kpi('عدد الأسهم', d.rows || rows().length)}
    ${kpi('عمر البيانات', d.staleMinutes === Infinity ? '--' : `${fmt(d.staleMinutes, 0)} دقيقة`)}
    ${kpi('الوضع', h.mode || d.mode || 'public_delayed')}
  </div>
  <section class="panel"><h3>قواعد بوابة الجودة</h3><ul class="blocks">${(state.hardening?.rules || []).map(x => `<li>${esc(x)}</li>`).join('') || '<li>لم يتم تحميل hardening-report.json.</li>'}</ul></section>`;
}
function renderDailyReport() {
  const d = state.dailyReport || {};
  $('dailyReport').innerHTML = `<section class="panel"><h3>Top Watch Buy</h3>${(d.topWatchBuy || []).map(x => renderDecisionCard(x)).join('') || '<p class="muted">لا توجد.</p>'}</section>
  <section class="panel"><h3>ملاحظات</h3><ul class="blocks">${(d.notes || []).map(n => `<li>${esc(n)}</li>`).join('') || '<li>لا توجد ملاحظات.</li>'}</ul></section>`;
}
function renderSettings() {
  $('settings').innerHTML = `<section class="panel"><h3>النسخة</h3>
    <div class="kpi-grid">${kpi('Version', state.version?.version || '--')}${kpi('Build', state.version?.build || '--')}${kpi('Commit', state.version?.commit || '--')}${kpi('Node', state.version?.node || '--')}</div>
    <p>لتحديث البيانات: افتح GitHub Actions ثم شغّل Workflow باسم <strong>Update EGX Market Data</strong>.</p>
    <p>النسخة تعمل على GitHub Pages وبيانات عامة/متأخرة، ولا تستخدم Login أو API مدفوع.</p>
  </section>`;
}
function renderCurrent() {
  if (!state.market) return;
  if (state.currentView === 'dashboard') renderDashboard();
  else if (state.currentView === 'today') renderToday();
  else if (state.currentView === 'opportunities') renderMainTable('opportunities');
  else if (state.currentView === 'excluded') renderExcluded();
  else if (state.currentView === 'liquidity') renderLiquidity();
  else if (state.currentView === 'support') renderSupport();
  else if (state.currentView === 'backtest') renderBacktest();
  else if (state.currentView === 'sources') renderSources();
  else if (state.currentView === 'dailyReport') renderDailyReport();
  else if (state.currentView === 'settings') renderSettings();
}
function exportCsv() {
  const columns = ['symbol', 'name', 'price', 'changePct', 'volume', 'turnover', 'pivot', 'support1', 'resistance1', 'signal', 'decision', 'executionAllowed', 'monitorOnly', 'finalConfidence', 'dataQualityScore', 'historySessions', 'goalDecisionLabel', 'reason'];
  const csv = [columns.join(','), ...filteredRows().map(row => columns.map(col => `"${String(row[col] ?? '').replaceAll('"', '""')}"`).join(','))].join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'egx-goal-decision-center.csv';
  a.click();
  URL.revokeObjectURL(a.href);
}

document.querySelectorAll('.nav').forEach(btn => btn.addEventListener('click', () => setView(btn.dataset.view)));
$('reloadData').addEventListener('click', loadData);
$('exportCsv').addEventListener('click', exportCsv);
$('printPage').addEventListener('click', () => window.print());
loadData();
setInterval(loadData, 60000);
