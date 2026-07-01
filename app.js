let state = { rows: [], summary: {}, errors: [] };

const els = {
  status: document.getElementById("status"),
  message: document.getElementById("message"),
  updated: document.getElementById("updated"),
  count: document.getElementById("count"),
  confidence: document.getElementById("confidence"),
  quality: document.getElementById("quality"),
  watchBuy: document.getElementById("watchBuy"),
  risk: document.getElementById("risk"),
  marketBox: document.getElementById("marketBox"),
  topList: document.getElementById("topList"),
  errorsBox: document.getElementById("errorsBox"),
  rowsBody: document.getElementById("rowsBody"),
  rowsCount: document.getElementById("rowsCount"),
  search: document.getElementById("search"),
  signalFilter: document.getElementById("signalFilter"),
  minConfidence: document.getElementById("minConfidence")
};

function signalArabic(signal){
  return {
    WATCH_BUY:"مراقبة شراء",
    WATCH:"مراقبة",
    WAIT:"انتظار",
    RISK_REDUCE:"حذر / تخفيف",
    INVALID:"بيانات غير كافية"
  }[signal] || signal;
}

function fmt(v){
  return v === null || v === undefined || Number.isNaN(Number(v))
    ? "--"
    : Number(v).toLocaleString(undefined,{maximumFractionDigits:2});
}

function pct(v){
  return v === null || v === undefined || Number.isNaN(Number(v))
    ? "--"
    : Number(v).toFixed(2) + "%";
}

async function loadData(){
  els.status.textContent = "Loading...";
  els.status.className = "pill warn";

  try {
    const res = await fetch("data/market.json?ts=" + Date.now());
    state = await res.json();
    render();
    els.status.textContent = state.ok ? "Data Loaded" : "No Data";
    els.status.className = state.ok ? "pill ok" : "pill warn";
  } catch (error) {
    els.status.textContent = "Error";
    els.status.className = "pill bad";
    els.message.className = "banner bad";
    els.message.textContent = "فشل تحميل data/market.json";
  }
}

function filtered(){
  const rows = state.rows || [];
  const q = els.search.value.trim().toUpperCase();
  const sig = els.signalFilter.value;
  const min = Number(els.minConfidence.value || 0);

  return rows
    .filter(r => !q || r.symbol.includes(q) || (r.name || "").toUpperCase().includes(q))
    .filter(r => sig === "ALL" || r.signal === sig)
    .filter(r => (r.confidence || 0) >= min)
    .sort((a,b) => (b.confidence || 0) - (a.confidence || 0));
}

function render(){
  const summary = state.summary || {};
  const rows = state.rows || [];
  const m = state.market || {};

  els.message.className = state.ok ? "banner ok" : "banner";
  els.message.textContent = state.message || "لم يتم تحديث البيانات بعد.";

  els.updated.textContent = state.updatedAt ? new Date(state.updatedAt).toLocaleString() : "--";
  els.count.textContent = summary.count || 0;
  els.confidence.textContent = summary.avgConfidence ? summary.avgConfidence + "%" : "--";
  els.quality.textContent = summary.avgQuality ? summary.avgQuality + "%" : "--";
  els.watchBuy.textContent = summary.watchBuy || 0;
  els.risk.textContent = summary.riskReduce || 0;

  els.marketBox.innerHTML = `
    <strong>EGX:</strong> ${fmt(m.value)} |
    <strong>الحجم:</strong> ${fmt(m.volume)} |
    <strong>قيمة التداول:</strong> ${fmt(m.turnover)} |
    <strong>آخر تحديث:</strong> ${m.fetchedAt ? new Date(m.fetchedAt).toLocaleString() : "--"}
  `;

  const top = rows.filter(r => r.signal === "WATCH_BUY" || r.signal === "WATCH").slice(0, 8);
  els.topList.className = top.length ? "list" : "list empty";
  els.topList.innerHTML = top.length ? top.map(r => `
    <div class="item">
      <div>
        <strong>${r.symbol}</strong>
        <div class="sub">${r.name || ""}</div>
        <div class="sub">${r.reason}</div>
      </div>
      <div style="text-align:left">
        <span class="badge ${r.signal}">${signalArabic(r.signal)}</span>
        <div class="sub">ثقة ${r.confidence}%</div>
      </div>
    </div>
  `).join("") : "لا توجد فرص مراقبة الآن.";

  els.errorsBox.innerHTML = (state.errors || []).length
    ? state.errors.map(e => `<div>${e.symbol || ""}: ${e.error}</div>`).join("")
    : "لا توجد أخطاء.";

  const tableRows = filtered();
  els.rowsCount.textContent = `${tableRows.length} صف`;
  els.rowsBody.innerHTML = tableRows.map(r => `
    <tr>
      <td><strong>${r.symbol}</strong></td>
      <td>${fmt(r.price)}</td>
      <td class="${(r.changePct || 0) >= 0 ? "good" : "bad"}">${pct(r.changePct)}</td>
      <td>${fmt(r.volume)}</td>
      <td>${fmt(r.turnover)}</td>
      <td>${fmt(r.pivot)}</td>
      <td>${fmt(r.s1)}</td>
      <td>${fmt(r.r1)}</td>
      <td>${pct(r.distSupport)}</td>
      <td>${pct(r.distResistance)}</td>
      <td><span class="badge ${r.signal}">${signalArabic(r.signal)}</span></td>
      <td>${r.confidence || 0}%</td>
      <td>${r.qualityScore || 0}%</td>
      <td>${r.reason || "--"}</td>
    </tr>
  `).join("");
}

document.getElementById("reloadBtn").addEventListener("click", loadData);
["search","signalFilter","minConfidence"].forEach(id => document.getElementById(id).addEventListener("input", render));

loadData();
setInterval(loadData, 60000);
