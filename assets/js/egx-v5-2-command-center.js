/*
EGX Pro Hub V5.2 Command Center
Adds a visible executive command center:
- Session reports
- Tomorrow playbook
- Risk dashboard
- Alerts
- News intelligence
- Export/copy reports
Works with:
data/pro-report.json
data/session-report.json
data/alerts.json
data/news-report.json
data/risk-dashboard.json
data/recommendations.json
data/source-health.json
*/

(function () {
  "use strict";

  const STATE = {
    tab: localStorage.getItem("egx_v52_tab") || "playbook",
    q: "",
    pro: {},
    session: {},
    alerts: {},
    news: {},
    risk: {},
    recs: {},
    source: {},
    rows: []
  };

  function esc(v) {
    return String(v == null ? "" : v).replace(/[&<>"']/g, function (m) {
      return {"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[m];
    });
  }

  function fmt(v, d) {
    d = d == null ? 2 : d;
    if (v === null || v === undefined || v === "" || isNaN(Number(v))) return "-";
    return Number(v).toLocaleString("ar-EG", { maximumFractionDigits: d, minimumFractionDigits: d });
  }

  function fmt0(v) {
    if (v === null || v === undefined || v === "" || isNaN(Number(v))) return "-";
    return Number(v).toLocaleString("ar-EG", { maximumFractionDigits: 0 });
  }

  function norm(s) {
    return String(s || "")
      .toLowerCase()
      .replace(/[أإآا]/g, "ا")
      .replace(/ى/g, "ي")
      .replace(/ة/g, "ه")
      .replace(/ؤ/g, "و")
      .replace(/ئ/g, "ي")
      .replace(/[ًٌٍَُِّْـ]/g, "")
      .replace(/[^\u0600-\u06FFa-z0-9]+/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function getJson(path) {
    return fetch(path + "?v=" + Date.now(), { cache: "no-store" })
      .then(function (r) { return r.ok ? r.json() : {}; })
      .catch(function () { return {}; });
  }

  function downloadFile(filename, content, type) {
    const blob = new Blob([content], { type: type || "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 500);
  }

  function sortedRows() {
    return STATE.rows.slice().sort(function (a, b) {
      const pa = Number(a.priority || 99);
      const pb = Number(b.priority || 99);
      if (pa !== pb) return pa - pb;
      return Number(b.finalConfidence || 0) - Number(a.finalConfidence || 0);
    });
  }

  function injectStyle() {
    if (document.getElementById("egxV52Style")) return;
    const style = document.createElement("style");
    style.id = "egxV52Style";
    style.textContent = `
      #egxV52{direction:rtl;margin:16px 8px 26px;padding:16px;border-radius:26px;color:#eef6ff;background:radial-gradient(circle at top left,rgba(34,197,94,.16),transparent 26%),linear-gradient(135deg,#041022,#0b1f3d 60%,#050812);border:1px solid rgba(125,211,252,.32);box-shadow:0 28px 78px rgba(0,0,0,.38);font-family:Tahoma,Arial,sans-serif;position:relative;z-index:999}
      #egxV52 *{box-sizing:border-box}
      .v52top{display:flex;justify-content:space-between;align-items:flex-start;gap:12px;flex-wrap:wrap;margin-bottom:12px}
      .v52top h2{margin:0;font-size:25px;font-weight:950;letter-spacing:-.3px}
      .v52sub{color:#a8bddb;font-size:13px;margin-top:5px;line-height:1.7}
      .v52badges{display:flex;gap:8px;flex-wrap:wrap}
      .v52badge{background:#0b1b33;border:1px solid #2e5b92;border-radius:999px;padding:8px 11px;font-size:12px;font-weight:850;color:#dbeafe}
      .v52pulse{display:grid;grid-template-columns:repeat(6,minmax(0,1fr));gap:10px;margin:12px 0}
      .v52card{background:rgba(6,20,39,.82);border:1px solid rgba(97,137,202,.25);border-radius:18px;padding:12px}
      .v52card span{display:block;color:#9fb5d5;font-size:12px}.v52card b{display:block;margin-top:5px;font-size:20px}
      .v52tabs{display:flex;gap:8px;flex-wrap:wrap;margin:10px 0 12px}
      .v52tab{background:#0a172b;color:#d7e7ff;border:1px solid #294a78;border-radius:13px;padding:10px 12px;font-weight:900;cursor:pointer}
      .v52tab.active{background:linear-gradient(135deg,#0ea5e9,#1d4ed8);border-color:#38bdf8;color:white}
      .v52layout{display:grid;grid-template-columns:1.25fr .75fr;gap:12px}
      .v52grid2{display:grid;grid-template-columns:1fr 1fr;gap:12px}
      .v52tablewrap{overflow:auto;border:1px solid rgba(97,137,202,.26);border-radius:18px;background:rgba(5,13,27,.58)}
      .v52table{width:100%;border-collapse:collapse;min-width:1020px}
      .v52table th,.v52table td{padding:10px 8px;border-bottom:1px solid rgba(97,137,202,.18);white-space:nowrap;text-align:right;font-size:13px}
      .v52table th{background:#0b1a31;color:#dbeafe;position:sticky;top:0;z-index:1}
      .v52tag{display:inline-block;padding:5px 8px;border-radius:999px;font-size:12px;font-weight:900}
      .ok{background:#063b23;color:#80ffb7}.risk{background:#3b0b16;color:#ff9fb2}.watch{background:#332707;color:#ffe18a}.info{background:#092d4a;color:#a7dcff}.muted{background:#222a36;color:#cbd5e1}
      .v52item{background:#08182d;border:1px solid rgba(97,137,202,.22);border-radius:14px;padding:10px;margin-bottom:8px}
      .v52item h4{margin:0 0 5px;font-size:14px}.v52item p{margin:0;color:#a7bad7;font-size:12px;line-height:1.7}
      .v52muted{color:#9fb5d5;font-size:12px;line-height:1.8}
      .v52actions{display:flex;gap:8px;flex-wrap:wrap;margin:10px 0}
      .v52btn,.v52input{background:#071326;color:#fff;border:1px solid #28456f;border-radius:14px;padding:11px;outline:none}
      .v52btn{background:#126aaa;border-color:#1684d8;font-weight:900;cursor:pointer}
      .v52btn.dark{background:#10233f;border-color:#315780}
      .v52input{min-width:260px}
      .v52report{line-height:1.9;font-size:14px}.v52report li{margin-bottom:6px}
      @media(max-width:1100px){.v52layout,.v52grid2{grid-template-columns:1fr}.v52pulse{grid-template-columns:repeat(2,minmax(0,1fr))}}
      @media(max-width:560px){.v52pulse{grid-template-columns:1fr}.v52top h2{font-size:20px}.v52input{min-width:100%;width:100%}}
    `;
    document.head.appendChild(style);
  }

  function pulse() {
    const market = STATE.pro.marketPulse || {};
    const rows = STATE.rows.filter(function (r) { return r.signal !== "INVALID"; });
    const buy = rows.filter(function (r) { return Number(r.priority || 99) <= 2; }).length;
    const risk = rows.filter(function (r) { return r.signal === "RISK_REDUCE"; }).length;
    const up = rows.filter(function (r) { return Number(r.changePct || 0) > 0; }).length;
    const breadth = market.breadthPct != null ? market.breadthPct : (rows.length ? Math.round(up / rows.length * 100) : 0);
    const conf = market.avgConfidence != null ? market.avgConfidence : (rows.length ? Math.round(rows.reduce(function (s, r) { return s + Number(r.finalConfidence || 0); }, 0) / rows.length) : 0);
    const status = market.status || (breadth >= 60 ? "إيجابي انتقائي" : breadth < 40 ? "حذر" : "متوازن");
    return { status, buy, risk, breadth, conf, rows: rows.length };
  }

  function tabs() {
    const list = [
      ["playbook", "جلسة الغد"],
      ["reports", "التقارير"],
      ["alerts", "التنبيهات"],
      ["risk", "المخاطر"],
      ["news", "الأخبار"],
      ["exports", "التصدير"]
    ];
    return `<div class="v52tabs">${list.map(function (t) {
      return `<button class="v52tab ${STATE.tab === t[0] ? "active" : ""}" data-v52tab="${t[0]}">${t[1]}</button>`;
    }).join("")}</div>`;
  }

  function table(rows, limit) {
    rows = (rows || []).slice(0, limit || 80);
    return `
      <div class="v52tablewrap">
        <table class="v52table">
          <thead><tr><th>الأولوية</th><th>الرمز</th><th>الاسم</th><th>السعر</th><th>القرار</th><th>دخول</th><th>هدف 1</th><th>هدف 2</th><th>وقف</th><th>ثقة</th><th>سبب</th></tr></thead>
          <tbody>${rows.map(function (r, i) {
            const cls = r.signal === "RISK_REDUCE" ? "risk" : Number(r.priority || 99) <= 2 ? "ok" : r.signal === "WATCH" ? "watch" : "muted";
            return `<tr>
              <td>${Number(r.priority || 99) <= 2 ? "🔥 " : ""}${fmt0(r.priority || i + 1)}</td>
              <td><b>${esc(r.symbol)}</b></td>
              <td>${esc(r.name_ar || r.name_en || r.name || "")}</td>
              <td>${fmt(r.price)}</td>
              <td><span class="v52tag ${cls}">${esc(r.recommendation || r.decision || "")}</span></td>
              <td>${fmt(r.entryFrom)} - ${fmt(r.entryTo)}</td>
              <td>${fmt(r.target1)}</td>
              <td>${fmt(r.target2)}</td>
              <td>${fmt(r.stopLoss)}</td>
              <td>${fmt0(r.finalConfidence)}%</td>
              <td title="${esc(r.reason || "")}">${esc(String(r.reason || "").slice(0, 70))}</td>
            </tr>`;
          }).join("")}</tbody>
        </table>
      </div>
    `;
  }

  function renderPlaybook() {
    const tomorrow = (STATE.session.afterClose && STATE.session.afterClose.tomorrowWatch) || STATE.pro.topBuyCandidates || sortedRows().filter(function (r) { return Number(r.priority || 99) <= 2; });
    const avoid = (STATE.session.afterClose && STATE.session.afterClose.avoidOrReduce) || STATE.pro.riskReduce || [];
    return `
      <div class="v52layout">
        <div>
          <div class="v52card">
            <h3 style="margin:0 0 10px">خطة جلسة الغد / المتابعة القادمة</h3>
            <div class="v52muted">الأولوية للأسهم داخل منطقة الدخول أو القريبة منها، مع وقف خسارة واضح وعدم ملاحقة الأسعار.</div>
          </div>
          ${table(tomorrow, 30)}
        </div>
        <div>
          <div class="v52card">
            <h3 style="margin:0 0 10px">قواعد التنفيذ</h3>
            <ul class="v52report">
              <li>لا دخول خارج منطقة الدخول إلا بعد تحديث جديد.</li>
              <li>جني جزء عند هدف 1، ومتابعة الباقي نحو هدف 2.</li>
              <li>أي سهم في قائمة الحذر يُراجع حجمه فورًا.</li>
              <li>البيانات عامة ومتأخرة وليست أوامر تداول.</li>
            </ul>
          </div>
          <div class="v52card" style="margin-top:12px">
            <h3 style="margin:0 0 10px">حذر / تخفيف</h3>
            ${(avoid || []).slice(0, 12).map(function (r) {
              return `<div class="v52item"><h4><span class="v52tag risk">${esc(r.symbol)}</span></h4><p>${esc(r.reason || r.decision || "")}</p></div>`;
            }).join("") || `<div class="v52item"><p>لا توجد إشارات حذر رئيسية.</p></div>`}
          </div>
        </div>
      </div>
    `;
  }

  function renderReports() {
    const summary = STATE.pro.executiveSummary || [];
    return `
      <div class="v52grid2">
        <div class="v52card">
          <h3 style="margin:0 0 10px">Executive Summary</h3>
          <ul class="v52report">${summary.map(function (x) { return `<li>${esc(x)}</li>`; }).join("") || `<li>لا يوجد تقرير مولد بعد. ارفع build-v52-intelligence.js وشغّل Workflow.</li>`}</ul>
          <button class="v52btn" id="v52CopySummary">نسخ الملخص</button>
        </div>
        <div class="v52card">
          <h3 style="margin:0 0 10px">Session Reports</h3>
          <div class="v52item"><h4>بعد بداية الجلسة</h4><p>${esc((STATE.session.afterOpen15Min && STATE.session.afterOpen15Min.title) || "جاهز للتوليد بعد تشغيل workflow")}</p></div>
          <div class="v52item"><h4>تقرير ساعي</h4><p>${esc((STATE.session.hourly && STATE.session.hourly.title) || "جاهز للتوليد بعد تشغيل workflow")}</p></div>
          <div class="v52item"><h4>بعد الإغلاق</h4><p>${esc((STATE.session.afterClose && STATE.session.afterClose.title) || "جاهز للتوليد بعد تشغيل workflow")}</p></div>
        </div>
      </div>
    `;
  }

  function renderAlerts() {
    const alerts = STATE.alerts.alerts || [];
    return `
      <div class="v52layout">
        <div class="v52card">
          <h3 style="margin:0 0 10px">Smart Alerts Center</h3>
          ${(alerts.length ? alerts : []).slice(0, 70).map(function (a) {
            const cls = a.level === "danger" ? "risk" : a.level === "success" ? "ok" : "info";
            return `<div class="v52item"><h4><span class="v52tag ${cls}">${esc(a.symbol || "-")}</span> ${esc(a.title || "")}</h4><p>${esc(a.text || "")}</p></div>`;
          }).join("") || `<div class="v52item"><p>لا توجد تنبيهات مولدة بعد. سيولدها V5.2 بعد تشغيل workflow.</p></div>`}
        </div>
        <div class="v52card">
          <h3 style="margin:0 0 10px">مستويات التنبيه</h3>
          <div class="v52item"><h4>داخل منطقة الدخول</h4><p>سهم قريب من منطقة الدخول المحددة.</p></div>
          <div class="v52item"><h4>قرب الهدف</h4><p>السعر قريب من هدف 1 وقد يحتاج جني جزء.</p></div>
          <div class="v52item"><h4>قرب وقف الخسارة</h4><p>السعر قريب من مستوى المخاطرة.</p></div>
        </div>
      </div>
    `;
  }

  function renderRisk() {
    const risk = STATE.risk || {};
    const sectors = risk.riskReduce || STATE.pro.riskReduce || [];
    return `
      <div class="v52grid2">
        <div class="v52card">
          <h3 style="margin:0 0 10px">Risk Dashboard</h3>
          <div class="v52item"><p>عدد إشارات الحذر: ${fmt0(sectors.length)}</p></div>
          <div class="v52item"><p>تغطية السوق: ${fmt0(STATE.source.universeCoveragePct || 0)}%</p></div>
          <div class="v52item"><p>جودة البيانات: ${fmt0(STATE.source.avgDataQuality || 0)}%</p></div>
        </div>
        <div>${table(sectors, 35)}</div>
      </div>
    `;
  }

  function renderNews() {
    const items = STATE.news.items || [];
    return `
      <div class="v52layout">
        <div class="v52card">
          <h3 style="margin:0 0 10px">News Intelligence</h3>
          <div class="v52muted">${esc(STATE.news.summary_ar || "تم تجهيز مركز الأخبار. المصادر العامة ستظهر هنا بعد تشغيل V5.2 workflow.")}</div>
          <div style="margin-top:10px">
            ${items.slice(0, 40).map(function (n) {
              return `<div class="v52item"><h4>${esc(n.title || "")}</h4><p>${esc(n.source || "")} ${n.url ? " — " + esc(n.url) : ""}</p></div>`;
            }).join("") || `<div class="v52item"><p>لا توجد أخبار مدمجة بعد.</p></div>`}
          </div>
        </div>
        <div class="v52card">
          <h3 style="margin:0 0 10px">تصنيف التأثير</h3>
          <ul class="v52report">
            <li>اقتصاد كلي: فائدة، تضخم، سعر صرف.</li>
            <li>شركات: إفصاحات، نتائج أعمال، توزيعات.</li>
            <li>سياسة ومخاطر: أخبار قد تؤثر على شهية المخاطرة.</li>
          </ul>
        </div>
      </div>
    `;
  }

  function renderExports() {
    return `
      <div class="v52card">
        <h3 style="margin:0 0 10px">Exports</h3>
        <div class="v52actions">
          <button class="v52btn" id="v52ExportCSV">Download CSV</button>
          <button class="v52btn" id="v52ExportJSON">Download JSON</button>
          <button class="v52btn" id="v52ExportHTML">Download HTML Report</button>
        </div>
        <p class="v52muted">التصدير يتم من البيانات الحالية في المتصفح.</p>
      </div>
    `;
  }

  function tabContent() {
    if (STATE.tab === "reports") return renderReports();
    if (STATE.tab === "alerts") return renderAlerts();
    if (STATE.tab === "risk") return renderRisk();
    if (STATE.tab === "news") return renderNews();
    if (STATE.tab === "exports") return renderExports();
    return renderPlaybook();
  }

  function sortedRows() {
    return STATE.rows.slice().sort(function (a, b) {
      const pa = Number(a.priority || 99), pb = Number(b.priority || 99);
      if (pa !== pb) return pa - pb;
      return Number(b.finalConfidence || 0) - Number(a.finalConfidence || 0);
    });
  }

  function exportCSV() {
    const rows = sortedRows();
    const headers = ["priority","symbol","name_ar","price","changePct","recommendation","entryFrom","entryTo","target1","target2","stopLoss","riskReward","finalConfidence","dataQualityScore","reason"];
    const csv = [headers.join(",")].concat(rows.map(function (r) {
      return headers.map(function (h) { return '"' + String(r[h] == null ? "" : r[h]).replace(/"/g, '""') + '"'; }).join(",");
    })).join("\n");
    downloadFile("egx-v5-2-opportunities.csv", csv, "text/csv;charset=utf-8");
  }

  function exportHTML() {
    const top = sortedRows().filter(function (r) { return Number(r.priority || 99) <= 2; }).slice(0, 20);
    const html = `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><title>EGX V5.2 Report</title><style>body{font-family:Tahoma,Arial,sans-serif;background:#f4f7fb;color:#111827;padding:28px;line-height:1.8}.card{background:#fff;border:1px solid #e5e7eb;border-radius:16px;padding:18px;margin:14px 0}table{width:100%;border-collapse:collapse}th,td{border:1px solid #e5e7eb;padding:8px;text-align:right;font-size:13px}th{background:#eaf2ff}</style></head><body><h1>EGX Pro Hub V5.2 Report</h1><div class="card"><p>تغطية السوق: ${fmt0(STATE.source.universeCoveragePct || 0)}%</p><p>البيانات عامة ومتأخرة وليست توصية مالية ملزمة.</p></div><div class="card">${table(top, 20)}</div></body></html>`;
    downloadFile("egx-v5-2-report.html", html, "text/html;charset=utf-8");
  }

  function render() {
    const p = pulse();
    const panel = document.getElementById("egxV52");
    const updated = STATE.pro.generatedAt || STATE.source.generatedAt || "";
    panel.innerHTML = `
      <div class="v52top">
        <div><h2>🧠 EGX Pro Hub V5.2 Command Center</h2><div class="v52sub">مركز قيادة تنفيذي: تقارير الجلسة، خطة الغد، المخاطر، الأخبار، والتنبيهات. البيانات عامة ومتأخرة وليست أوامر تداول. ${updated ? "آخر توليد: " + esc(new Date(updated).toLocaleString("ar-EG")) : ""}</div></div>
        <div class="v52badges">
          <span class="v52badge">Universe ${fmt0(STATE.source.totalUniverse || STATE.rows.length)}</span>
          <span class="v52badge">Coverage ${fmt0(STATE.source.universeCoveragePct || 0)}%</span>
          <span class="v52badge">Cache ${fmt0(STATE.source.cacheRows || STATE.rows.length)}</span>
          <span class="v52badge">Quality ${fmt0(STATE.source.avgDataQuality || 0)}%</span>
        </div>
      </div>
      <div class="v52pulse">
        <div class="v52card"><span>حالة السوق</span><b>${esc(p.status)}</b></div>
        <div class="v52card"><span>فرص شراء</span><b>${fmt0(p.buy)}</b></div>
        <div class="v52card"><span>حذر</span><b>${fmt0(p.risk)}</b></div>
        <div class="v52card"><span>اتساع الصعود</span><b>${fmt0(p.breadth)}%</b></div>
        <div class="v52card"><span>متوسط الثقة</span><b>${fmt0(p.conf)}%</b></div>
        <div class="v52card"><span>صفوف صالحة</span><b>${fmt0(p.rows)}</b></div>
      </div>
      ${tabs()}
      <div id="v52Content">${tabContent()}</div>
    `;
    bind();
  }

  function bind() {
    document.querySelectorAll("[data-v52tab]").forEach(function (b) {
      b.addEventListener("click", function () {
        STATE.tab = b.getAttribute("data-v52tab");
        localStorage.setItem("egx_v52_tab", STATE.tab);
        render();
      });
    });
    document.getElementById("v52ExportCSV")?.addEventListener("click", exportCSV);
    document.getElementById("v52ExportJSON")?.addEventListener("click", function () {
      downloadFile("egx-v5-2-data.json", JSON.stringify({pro: STATE.pro, rows: STATE.rows}, null, 2), "application/json;charset=utf-8");
    });
    document.getElementById("v52ExportHTML")?.addEventListener("click", exportHTML);
    document.getElementById("v52CopySummary")?.addEventListener("click", async function () {
      const text = (STATE.pro.executiveSummary || []).join("\n");
      try { await navigator.clipboard.writeText(text); this.textContent = "تم النسخ"; } catch {}
    });
  }

  async function init() {
    injectStyle();
    const all = await Promise.all([
      getJson("data/pro-report.json"),
      getJson("data/session-report.json"),
      getJson("data/alerts.json"),
      getJson("data/news-report.json"),
      getJson("data/risk-dashboard.json"),
      getJson("data/recommendations.json"),
      getJson("data/source-health.json"),
      getJson("data/full-market-cache.json")
    ]);

    STATE.pro = all[0] || {};
    STATE.session = all[1] || {};
    STATE.alerts = all[2] || {};
    STATE.news = all[3] || {};
    STATE.risk = all[4] || {};
    STATE.recs = all[5] || {};
    STATE.source = all[6] || {};
    const cache = all[7] || {};

    STATE.rows =
      (Array.isArray(STATE.recs.all) && STATE.recs.all.length && STATE.recs.all) ||
      (Array.isArray(cache.rows) && cache.rows.length && cache.rows) ||
      (Array.isArray(STATE.pro.topBuyCandidates) && STATE.pro.topBuyCandidates.length && STATE.pro.topBuyCandidates) ||
      [];

    let panel = document.getElementById("egxV52");
    if (!panel) {
      panel = document.createElement("section");
      panel.id = "egxV52";
      const v51 = document.getElementById("egxV51Global") || document.getElementById("egxV51") || document.getElementById("egxV5Terminal");
      if (v51 && v51.parentNode) v51.parentNode.insertBefore(panel, v51.nextSibling);
      else (document.querySelector("main, .main, .content, #app") || document.body).prepend(panel);
    }
    render();
    console.log("EGX V5.2 Command Center loaded", STATE.rows.length);
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
