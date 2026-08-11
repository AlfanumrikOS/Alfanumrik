#!/usr/bin/env node

// Vercel `ignoreCommand` (see apps/host/vercel.json). Exit 0 = SKIP the build,
// exit 1 = BUILD. Vercel invokes it with NO arguments, which is the default
// `HEAD^ HEAD` behavior below — that path is unchanged.
//
// Optional argv (added 2026-08-11, purely additive, Vercel never passes it):
//   node scripts/ignore-build.cjs [<baseRef> [<headRef>]]
// so the SAME prefix list can answer "does the range base..head contain any
// deployable change?" for an arbitrary range. `.github/scripts/
// verify-skipped-build.sh` uses this to let deploy-production.yml's post-deploy
// health check recognise a commit Vercel intentionally did not deploy, instead
// of polling 10 minutes for a SHA that will never appear and then failing.
// The prefix list below must stay the ONLY copy — a second hand-maintained copy
// in a workflow would drift away from what Vercel actually does.

const { execFileSync } = require('node:child_process');

const [baseRef = 'HEAD^', headRef = 'HEAD'] = process.argv.slice(2);

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
  changedFiles = execFileSync('git', ['diff', '--name-only', baseRef, headRef], {
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
