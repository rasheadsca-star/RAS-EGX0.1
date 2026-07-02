/*
EGX Pro Hub V7.3 — Git Past Snapshot Recovery

Goal:
Recover as much historical data as possible from this repository's own commit history.

Why:
Before the 50-session engine existed, the repo may still have contained daily/periodic snapshots in:
- data/recommendations.json
- data/full-market-cache.json
- data/market.json
- data/source-health.json

This script scans previous commits, extracts the market rows that were actually saved at that time,
converts them into daily OHLCV-like session snapshots, merges them into data/history.json,
then the normal build-history-50-engine.js validates and computes indicators.

No fake data is generated.
*/

const fs = require("fs");
const path = require("path");
const cp = require("child_process");

const MAX_SESSIONS = 75;
const FILES = [
  "data/recommendations.json",
  "data/full-market-cache.json",
  "data/market.json"
];

function sh(args, fallback = "") {
  try {
    return cp.execFileSync("git", args, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return fallback;
  }
}
function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return fallback; }
}
function writeJson(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, 2), "utf8");
}
function showJson(commit, file) {
  try {
    const txt = cp.execFileSync("git", ["show", `${commit}:${file}`], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], maxBuffer: 20 * 1024 * 1024 });
    return JSON.parse(txt);
  } catch {
    return null;
  }
}
function num(v) {
  if (v === null || v === undefined || v === "") return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  const n = Number(String(v).trim().replace(/[,%٬،]/g, "").replace(/[^\d.+\-eE]/g, ""));
  return Number.isFinite(n) ? n : null;
}
function symbolOf(r) {
  return String(r.symbol || r.ticker || r.code || r.Symbol || "").trim().toUpperCase();
}
function dateOnly(v) {
  if (!v) return null;
  if (typeof v === "number") return null;
  const s = String(v);
  const m = s.match(/(\d{4}-\d{2}-\d{2})/);
  if (m) return m[1];
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}
function commitDate(commit) {
  const d = sh(["show", "-s", "--format=%cI", commit], "");
  return dateOnly(d);
}
function extractGeneratedDate(obj, fallbackDate) {
  return dateOnly(
    obj?.generatedAt ||
    obj?.sessionDate ||
    obj?.lastSuccessAt ||
    obj?.source?.lastSuccessAt ||
    obj?.meta?.generatedAt ||
    obj?.market?.generatedAt
  ) || fallbackDate;
}
function extractRows(obj) {
  if (!obj) return [];
  if (Array.isArray(obj)) return obj;
  if (Array.isArray(obj.all)) return obj.all;
  if (Array.isArray(obj.rows)) return obj.rows;
  if (Array.isArray(obj.data)) return obj.data;
  if (obj.market && Array.isArray(obj.market.rows)) return obj.market.rows;
  if (obj.cache && Array.isArray(obj.cache.rows)) return obj.cache.rows;
  return [];
}
function makePoint(row, date, commit, file) {
  const symbol = symbolOf(row);
  const close = num(row.price ?? row.lastPrice ?? row.last ?? row.close ?? row.currentPrice);
  if (!symbol || !date || !close) return null;

  const changePct = num(row.changePct ?? row.changePercent ?? row.change_percentage);
  const prev = changePct !== null && changePct !== -100 ? close / (1 + changePct / 100) : null;
  const open = num(row.open ?? row.openPrice) ?? prev ?? close;
  const high = num(row.high ?? row.highPrice) ?? Math.max(open, close);
  const low = num(row.low ?? row.lowPrice) ?? Math.min(open, close);
  const volume = num(row.volume ?? row.tradedVolume);
  const valueTraded = num(row.valueTraded ?? row.tradedValue ?? row.turnover ?? row.value);

  return {
    symbol,
    date,
    open,
    high: Math.max(high, open, close),
    low: Math.min(low, open, close),
    close,
    volume,
    valueTraded,
    changePct,
    source: "git_snapshot_recovery",
    sourceFile: file,
    sourceCommit: commit.slice(0, 10),
    sourceQuality: "recovered_from_repository_market_snapshot",
    recoveredAt: new Date().toISOString()
  };
}
function normalizeExistingHistory(history) {
  const out = {};
  function add(symbol, arr) {
    symbol = String(symbol || "").toUpperCase();
    if (!symbol || !Array.isArray(arr)) return;
    out[symbol] = out[symbol] || [];
    for (const p of arr) {
      const close = num(p.close ?? p.price ?? p.value);
      const date = dateOnly(p.date || p.sessionDate);
      if (!date || !close) continue;
      out[symbol].push({
        ...p,
        symbol,
        date,
        open: num(p.open) ?? close,
        high: num(p.high) ?? close,
        low: num(p.low) ?? close,
        close,
        volume: num(p.volume),
        valueTraded: num(p.valueTraded)
      });
    }
  }
  if (history.sessionsBySymbol) for (const [s, a] of Object.entries(history.sessionsBySymbol)) add(s, a);
  if (history.prices) for (const [s, a] of Object.entries(history.prices)) add(s, a);
  if (history.history) for (const [s, a] of Object.entries(history.history)) add(s, a);
  for (const s of Object.keys(out)) out[s] = dedupe(out[s]).slice(-MAX_SESSIONS);
  return out;
}
function dedupe(arr) {
  const m = new Map();
  for (const p of arr) {
    if (!p || !p.date || !p.close) continue;
    // latest point for same date wins; git loop is oldest -> newest
    m.set(p.date, p);
  }
  return [...m.values()].sort((a, b) => String(a.date).localeCompare(String(b.date)));
}
function main() {
  const status = {
    ok: true,
    engine: "v7_3_git_past_snapshot_recovery",
    generatedAt: new Date().toISOString(),
    commitsScanned: 0,
    filesScanned: 0,
    snapshotsRecovered: 0,
    rowsRecovered: 0,
    symbolsRecovered: 0,
    symbolsWithComplete50AfterRecovery: 0,
    averageSessionsAfterRecovery: 0,
    message: ""
  };

  // This requires checkout fetch-depth > 1.
  const commitList = sh(["log", "--format=%H", "--", ...FILES], "");
  const commits = commitList ? commitList.split(/\r?\n/).filter(Boolean).reverse() : [];
  status.commitsScanned = commits.length;

  if (!commits.length) {
    status.message = "No git history available. Use actions/checkout fetch-depth > 1 or run future rolling collection.";
    writeJson("data/git-history-recovery-status.json", status);
    console.log(status.message);
    return;
  }

  const history = normalizeExistingHistory(readJson("data/history.json", {}));
  const recoveredBySymbol = {};

  for (const commit of commits) {
    const cDate = commitDate(commit);
    for (const file of FILES) {
      const obj = showJson(commit, file);
      if (!obj) continue;
      status.filesScanned++;
      const date = extractGeneratedDate(obj, cDate);
      if (!date) continue;

      const rows = extractRows(obj);
      if (!rows.length) continue;

      status.snapshotsRecovered++;
      for (const r of rows) {
        const pt = makePoint(r, date, commit, file);
        if (!pt) continue;
        history[pt.symbol] = history[pt.symbol] || [];
        history[pt.symbol].push(pt);
        recoveredBySymbol[pt.symbol] = (recoveredBySymbol[pt.symbol] || 0) + 1;
        status.rowsRecovered++;
      }
    }
  }

  for (const s of Object.keys(history)) history[s] = dedupe(history[s]).slice(-MAX_SESSIONS);

  const symbols = Object.keys(history);
  status.symbolsRecovered = Object.keys(recoveredBySymbol).length;
  status.symbolsWithComplete50AfterRecovery = symbols.filter(s => history[s].length >= 50).length;
  status.averageSessionsAfterRecovery = Math.round(symbols.reduce((sum, s) => sum + history[s].length, 0) / Math.max(1, symbols.length));
  status.recoveredBySymbol = recoveredBySymbol;
  status.message = `Recovered ${status.rowsRecovered} rows from ${status.snapshotsRecovered} historical repository snapshots.`;

  writeJson("data/history.json", {
    version: "v7_3_git_past_snapshot_recovery",
    generatedAt: new Date().toISOString(),
    requiredSessions: 50,
    maxStoredSessions: MAX_SESSIONS,
    importantNote: "Recovered from actual repository snapshots. build-history-50-engine.js will validate and compute indicators after this step.",
    sessionsBySymbol: history
  });

  writeJson("data/git-history-recovery-status.json", status);
  console.log("Git past recovery complete:", status);
}
main();
