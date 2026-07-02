const fs = require("fs");

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return fallback; }
}

function writeJson(file, data) {
  fs.mkdirSync("data", { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, 2), "utf8");
}

function stripTags(html) {
  return String(html || "")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

function classifyNews(title) {
  const t = String(title || "").toLowerCase();
  if (/interest|inflation|currency|exchange|rate|central bank|imf|fitch|moody|s&p|oil|gas|gold|dollar|pound/.test(t)) return "macro";
  if (/earnings|results|dividend|board|disclosure|profit|loss|shareholders|treasury/.test(t)) return "company";
  if (/war|election|government|policy|geopolitical|politic/.test(t)) return "political";
  return "market";
}

function scoreNews(title) {
  const t = String(title || "").toLowerCase();
  let score = 30;
  if (/egypt|egx|stock|market|listed|shares|index|central bank|inflation|interest|currency|dollar|pound/.test(t)) score += 25;
  if (/urgent|surge|fall|rise|profit|loss|dividend|rates|devaluation|imf/.test(t)) score += 20;
  if (/global|oil|fed|middle east|red sea|suez/.test(t)) score += 10;
  return Math.min(100, score);
}

async function fetchNewsSources() {
  const cfg = readJson("config/news-sources.json", { sources: [] });
  const sources = Array.isArray(cfg.sources) ? cfg.sources.filter(s => s.enabled) : [];
  const items = [];

  for (const src of sources) {
    try {
      const res = await fetch(src.url, {
        headers: {
          "user-agent": "Mozilla/5.0 EGX-Pro-Hub-V5.2",
          "accept": "text/html,application/rss+xml,application/xml;q=0.9,*/*;q=0.8"
        }
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const text = await res.text();

      if (/<item[\s>]/i.test(text)) {
        const blocks = text.match(/<item[\s\S]*?<\/item>/gi) || [];
        for (const b of blocks.slice(0, 12)) {
          const title = stripTags((b.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1] || "");
          const link = stripTags((b.match(/<link[^>]*>([\s\S]*?)<\/link>/i) || [])[1] || "");
          if (title) items.push({ title, url: link, source: src.name, category: classifyNews(title), impactScore: scoreNews(title) });
        }
      } else {
        const links = [...text.matchAll(/<a[^>]+href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)];
        for (const m of links.slice(0, 80)) {
          const title = stripTags(m[2]);
          if (title && title.length > 24 && title.length < 180) {
            let url = m[1];
            if (url && url.startsWith("/") && src.baseUrl) url = src.baseUrl + url;
            items.push({ title, url, source: src.name, category: classifyNews(title), impactScore: scoreNews(title) });
          }
          if (items.length >= 40) break;
        }
      }
    } catch (error) {
      items.push({ title: `تعذر قراءة ${src.name}`, source: src.name, category: "source_error", impactScore: 0, error: error.message });
    }
  }

  const seen = new Set();
  return items
    .filter(item => {
      const key = String(item.title || "").toLowerCase();
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => (b.impactScore || 0) - (a.impactScore || 0))
    .slice(0, 60);
}

function buildReports(newsItems) {
  const now = new Date().toISOString();
  const market = readJson("data/market.json", { rows: [] });
  const recs = readJson("data/recommendations.json", { all: [] });
  const source = readJson("data/source-health.json", {});
  const fullCache = readJson("data/full-market-cache.json", { rows: [] });

  const rows =
    (Array.isArray(recs.all) && recs.all.length && recs.all) ||
    (Array.isArray(fullCache.rows) && fullCache.rows.length && fullCache.rows) ||
    (Array.isArray(market.rows) && market.rows) ||
    [];

  const valid = rows.filter(r => r.signal !== "INVALID");
  const topBuy = rows.filter(r => Number(r.priority || 99) <= 2).slice(0, 25);
  const watch = rows.filter(r => r.signal === "WATCH").slice(0, 40);
  const risk = rows.filter(r => r.signal === "RISK_REDUCE").slice(0, 30);
  const up = valid.filter(r => Number(r.changePct || 0) > 0).length;
  const breadth = valid.length ? Math.round((up / valid.length) * 100) : 0;
  const avgConfidence = valid.length ? Math.round(valid.reduce((s, r) => s + Number(r.finalConfidence || 0), 0) / valid.length) : 0;
  const status = breadth >= 60 && topBuy.length >= risk.length ? "إيجابي انتقائي" : breadth < 40 || risk.length > topBuy.length * 1.5 ? "حذر" : "متوازن";

  const alerts = [];
  for (const r of rows) {
    const price = Number(r.price || 0);
    if (!price || r.signal === "INVALID") continue;
    if (Number(r.priority || 99) <= 2 && r.entryFrom && r.entryTo && price >= Number(r.entryFrom) * 0.985 && price <= Number(r.entryTo) * 1.015) {
      alerts.push({ level: "success", symbol: r.symbol, title: "داخل منطقة الدخول", text: `${r.symbol}: السعر ${price} داخل/قريب من منطقة الدخول ${r.entryFrom} - ${r.entryTo}` });
    }
    if (r.target1 && price >= Number(r.target1) * 0.985) {
      alerts.push({ level: "info", symbol: r.symbol, title: "قريب من هدف 1", text: `${r.symbol}: قريب من الهدف الأول ${r.target1}` });
    }
    if (r.stopLoss && price <= Number(r.stopLoss) * 1.015) {
      alerts.push({ level: "danger", symbol: r.symbol, title: "قريب من وقف الخسارة", text: `${r.symbol}: قريب من وقف الخسارة ${r.stopLoss}` });
    }
    if (r.signal === "RISK_REDUCE") {
      alerts.push({ level: "danger", symbol: r.symbol, title: "حذر / تخفيف", text: r.reason || "إشارة مخاطرة" });
    }
  }

  const executiveSummary = [
    `حالة السوق: ${status}.`,
    `تغطية السوق: ${source.universeCoveragePct || 0}% من ${source.totalUniverse || rows.length} سهم.`,
    `اتساع الصعود: ${breadth}%، ومتوسط الثقة: ${avgConfidence}%.`,
    topBuy.length ? `أفضل فرص المتابعة: ${topBuy.slice(0, 8).map(r => r.symbol).join(", ")}.` : "لا توجد فرص شراء قوية كافية الآن.",
    risk.length ? `أسهم تحتاج مراجعة مخاطرة: ${risk.slice(0, 8).map(r => r.symbol).join(", ")}.` : "لا توجد إشارات حذر رئيسية.",
    newsItems.length ? `أبرز محاور الأخبار: ${newsItems.slice(0, 3).map(n => n.category).join(", ")}.` : "لا توجد أخبار مدمجة حاليًا."
  ];

  writeJson("data/pro-report.json", {
    ok: true,
    generatedAt: now,
    source: "egx_pro_hub_v5_2_intelligence",
    disclaimer: "البيانات عامة ومتأخرة وليست لحظية. التقرير للمتابعة والتحليل وليس توصية مالية ملزمة.",
    marketPulse: {
      status,
      validRows: valid.length,
      breadthPct: breadth,
      avgConfidence,
      coveragePct: source.universeCoveragePct || 0,
      cacheRows: source.cacheRows || rows.length,
      totalUniverse: source.totalUniverse || rows.length
    },
    executiveSummary,
    topBuyCandidates: topBuy,
    watchlist: watch,
    riskReduce: risk
  });

  writeJson("data/alerts.json", {
    ok: true,
    generatedAt: now,
    source: "egx_pro_hub_v5_2_alerts",
    count: alerts.length,
    alerts: alerts.slice(0, 120)
  });

  writeJson("data/session-report.json", {
    ok: true,
    generatedAt: now,
    source: "egx_pro_hub_v5_2_session_reports",
    afterOpen15Min: {
      title: "تقرير بعد بداية الجلسة",
      summary: executiveSummary,
      topBuyCandidates: topBuy.slice(0, 12),
      riskReduce: risk.slice(0, 12),
      rule: "ركز فقط على الأسهم داخل منطقة الدخول أو القريبة منها."
    },
    hourly: {
      title: "تقرير ساعي",
      summary: executiveSummary,
      alerts: alerts.slice(0, 30),
      rule: "راقب تغير الأولويات والتنبيهات وقائمة الحذر."
    },
    afterClose: {
      title: "تقرير الإغلاق وخطة جلسة الغد",
      summary: executiveSummary,
      tomorrowWatch: topBuy.slice(0, 20),
      avoidOrReduce: risk.slice(0, 20),
      rule: "جهّز قائمة الغد من أفضل فرص المتابعة، ولا تدخل إلا قرب مناطق الدخول."
    }
  });

  writeJson("data/risk-dashboard.json", {
    ok: true,
    generatedAt: now,
    source: "egx_pro_hub_v5_2_risk_dashboard",
    riskReduce: risk,
    highConfidenceRisk: risk.filter(r => Number(r.finalConfidence || 0) >= 70),
    nearStop: alerts.filter(a => a.title && a.title.includes("وقف")),
    notes: [
      "الأسهم في قائمة الحذر تحتاج مراجعة حجم المركز.",
      "وقف الخسارة ليس أمر تنفيذ تلقائي، بل مستوى مراقبة."
    ]
  });

  writeJson("data/news-report.json", {
    ok: true,
    generatedAt: now,
    source: "egx_pro_hub_v5_2_news_intelligence",
    summary_ar: newsItems.length
      ? `تم التقاط ${newsItems.length} خبر/عنوان من مصادر عامة مفعلة. يلزم مراجعة التأثير يدويًا قبل اتخاذ أي قرار.`
      : "لا توجد مصادر أخبار مفعلة أو لم يتم التقاط أخبار. يمكن تفعيل المصادر من config/news-sources.json.",
    items: newsItems
  });

  console.log("V5.2 intelligence built", now, "rows", rows.length, "alerts", alerts.length, "news", newsItems.length);
}

fetchNewsSources()
  .then(buildReports)
  .catch(error => {
    console.error(error);
    buildReports([]);
  });
