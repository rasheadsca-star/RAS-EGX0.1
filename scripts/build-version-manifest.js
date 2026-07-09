#!/usr/bin/env node
'use strict';
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const ROOT = process.cwd();
function p(...x) { return path.join(ROOT, ...x); }
function readJson(file, fallback) { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; } }
function writeJson(file, obj) { fs.writeFileSync(file, JSON.stringify(obj, null, 2) + '\n', 'utf8'); }
function git(cmd) { try { return execSync(cmd, { cwd: ROOT, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim(); } catch { return ''; } }
const now = new Date().toISOString();
const pkg = readJson(p('package.json'), {});
const hardening = readJson(p('data/hardening-report.json'), {});
const decision = readJson(p('data/today-decision-center.json'), {});
const mubasher = readJson(p('data/mubasher-primary-fields-report.json'), {});
writeJson(p('VERSION.json'), {
  ok: true,
  app: 'RAS EGX Pro Hub',
  version: pkg.version || '1.2.0',
  generatedAt: now,
  commit: git('git rev-parse --short HEAD'),
  branch: git('git rev-parse --abbrev-ref HEAD'),
  goalIntegrated: true,
  mubasherPrimaryEnabled: true,
  qualityHardeningEnabled: Boolean(hardening.ok),
  decisionCenterEnabled: Boolean(decision.ok),
  mubasherCoverage: mubasher.summary || null,
  notes: [
    'Mubasher price, volume/turnover, and support/resistance are mandatory before executable decisions.',
    'Bulk Mubasher analysis-tool pages are audited; public stock pages are used as primary fallback when bulk pages return Angular placeholders.',
    'GitHub Actions does not require npm install for CI data generation.',
  ],
});
console.log('VERSION.json updated');
