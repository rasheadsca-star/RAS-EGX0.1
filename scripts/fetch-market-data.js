const fs = require("fs");

function writeJson(file, data) {
  fs.mkdirSync("data", { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, 2), "utf8");
}

const now = new Date().toISOString();

const rows = [
  {
    symbol: "COMI",
    name: "Commercial International Bank",
    price: null,
    previousClose: null,
    changePct: null,
    volume: null,
    turnover: null,
    pivot: null,
    support1: null,
    resistance1: null,
    distanceToSupport: null,
    distanceToResistance: null,
    signal: "INVALID",
    decision: "بيانات غير كافية",
    confidence: 0,
    finalConfidence: 0,
    dataQualityScore: 0,
    reason: "GitHub Actions يعمل الآن. هذه مرحلة تثبيت التشغيل فقط قبل إضافة قارئ مباشر الحقيقي.",
    dataMode: "public_delayed",
    fetchedAt: now
  }
];

writeJson("data/market.json", {
  ok: true,
  source: "safe_workflow_placeholder",
  message: "تم تشغيل GitHub Actions بنجاح. هذه مرحلة تثبيت التشغيل فقط.",
  updatedAt: now,
  dataMode: "public_delayed",
  market: {
    index: "EGX30",
    value: null,
    volume: null,
    turnover: null,
    state: "public_delayed",
    fetchedAt: now
  },
  summary: {
    count: rows.length,
    avgConfidence: 0,
    avgQuality: 0,
    watchBuy: 0,
    watch: 0,
    wait: 0,
    riskReduce: 0,
    invalid: rows.length
  },
  rows,
  errors: []
});

writeJson("data/source-health.json", {
  sourceName: "GitHub Actions Safe Workflow",
  ok: true,
  mode: "public_delayed",
  lastSuccessAt: now,
  lastFailureAt: null,
  rowsRead: rows.length,
  failedSymbols: [],
  avgDataQuality: 0,
  warning: "Actions يعمل الآن بدون فشل. Collector الحقيقي يضاف بعد تثبيت التشغيل.",
  generatedAt: now
});

writeJson("data/validation-report.json", {
  ok: true,
  requestedSymbols: rows.length,
  readSymbols: rows.length,
  missingSymbols: [],
  failedSymbols: [],
  validForDisplay: true,
  warnings: ["Safe workflow active. Real collector will be added later."],
  generatedAt: now
});

writeJson("data/daily-report.json", {
  generatedAt: now,
  topWatchBuy: [],
  riskReduce: [],
  marketSummary: {},
  sourceStatus: "safe_workflow_ok",
  notes: [
    "Actions يعمل الآن بدون فشل.",
    "هذه خطوة تثبيت فقط.",
    "لا توجد أسعار حقيقية في هذه المرحلة."
  ]
});

console.log("Safe EGX data files generated successfully.");
process.exit(0);
