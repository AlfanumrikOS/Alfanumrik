#!/usr/bin/env node

const { execFileSync } = require('node:child_process');

const ignoredPrefixes = [
  '.agents/',
  '.claude/',
  '.github/',
  '.superpowers/',
  'AEOS/',
  'artifacts/',
  'data/',
  'design-previews/',
  'docs/',
  'engineering-audit/',
  'mobile/',
];

const ignoredRootFiles = new Set([
  'ARCHITECTURE.md',
  'Alfanumrik_Developer_Docket.md',
  'DEPLOYMENT_RUNBOOK.md',
  'EMAIL_DELIVERABILITY.md',
  'ENVIRONMENT_SETUP.md',
  'FEATURE_FLAGS_SYNC.md',
  'FLAGS_QUICKSTART.md',
  'LAUNCH_CHECKLIST.md',
  'README.md',
  'README_LOCAL.md',
  'alfanumrik_launch_readiness_2026-05-05.html',
]);

let changedFiles;
try {
  changedFiles = execFileSync('git', ['diff', '--name-only', 'HEAD^', 'HEAD'], {
    encoding: 'utf8',
  })
    .trim()
    .split('\n')
    .filter(Boolean);
} catch {
  // A first deployment or an unavailable parent commit must always build.
  process.exit(1);
}

const hasDeployableChange = changedFiles.some(
  (file) =>
    !ignoredRootFiles.has(file) &&
    !ignoredPrefixes.some((prefix) => file.startsWith(prefix)),
);

if (hasDeployableChange) {
  process.exit(1);
}

console.log('Skipping build: no deployable application files changed.');
process.exit(0);
