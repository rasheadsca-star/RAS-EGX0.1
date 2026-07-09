#!/usr/bin/env node
'use strict';

const fs = require('fs');
const cp = require('child_process');

function sh(command) {
  try { return cp.execSync(command, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); }
  catch { return null; }
}
function readJson(file, fallback = {}) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch { return fallback; }
}

const pkg = readJson('package.json', {});
const decision = readJson('data/today-decision-center.json', {});
const hardening = readJson('data/hardening-report.json', {});
const version = {
  ok: true,
  app: 'RAS EGX Pro Hub',
  version: pkg.version || '1.1.0',
  build: 'GOAL Integrated Decision Center',
  generatedAt: new Date().toISOString(),
  commit: sh('git rev-parse --short HEAD'),
  branch: sh('git rev-parse --abbrev-ref HEAD'),
  node: process.version,
  engines: pkg.engines || {},
  features: [
    'Today Decision Center',
    'Quality Hardening Gate',
    'Excluded Opportunities Board',
    'Intraday vs Next Session Definitions',
    'Backtesting Ledger',
    'Data Status Banner'
  ],
  activeReports: {
    hardening: Boolean(hardening.ok),
    todayDecisionCenter: Boolean(decision.ok),
    backtestLedger: fs.existsSync('data/recommendation-backtest-ledger.json')
  }
};
fs.writeFileSync('VERSION.json', `${JSON.stringify(version, null, 2)}\n`, 'utf8');
console.log(`[version] ${version.version} ${version.build}`);
