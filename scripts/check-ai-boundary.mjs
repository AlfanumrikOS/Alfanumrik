#!/usr/bin/env node
// scripts/check-ai-boundary.mjs
//
// AI-boundary architectural gate, baseline-ratcheted.
//
// WHY THIS EXISTS
// ---------------
// `.eslintrc.ai-boundary.json` promotes three architectural rules to `error`:
//
//   alfanumrik/no-direct-ai-calls                  (one provider choke point)
//   alfanumrik/no-direct-rag-rpc                   (one retrieval choke point)
//   alfanumrik/no-canonical-write-outside-projector (ADR-005 canonical writes)
//
// The gate was declared as `lint:ai-boundary` in apps/host/package.json but
// was UNREACHABLE for the whole post-monorepo period, for two independent
// reasons, both fixed on 2026-08-31:
//
//   1. It was chained `bash scripts/check-config-parity.sh && eslint ...`.
//      That script's hardcoded paths were pre-monorepo, so it `exit 1`-ed on
//      every checkout with no message — and `&&` meant the eslint never ran.
//      (The script has been deleted; its NAME-only comparison is superseded by
//      apps/host/src/__tests__/grounding/config-parity-values.test.ts, which
//      compares parsed VALUES.)
//   2. `lint:ai-boundary` was referenced by nothing in .github/workflows/ or
//      the root package.json. The gate was not in CI at all.
//
// So the rules were at `error` and enforcing nothing. This script is what
// makes them enforce something, without requiring the 8 pre-existing
// violations to be fixed in the same change that turns the gate on.
//
// THE RULE: the baseline is a CEILING, per (file, rule) pair.
//   - a (file, rule) pair NOT in the baseline          -> FAIL (new violation)
//   - a pair in the baseline with MORE hits than recorded -> FAIL (regression)
//   - a pair in the baseline with FEWER hits             -> PASS + "ratchet
//     opportunity" hint (mirrors scripts/check-route-wrapper-ratchet.mjs and
//     scripts/check-bundle-size.mjs, which also hint rather than fail on
//     improvement, so a drive-by fix never blocks an unrelated PR)
//
// WHY (file, rule) COUNTS AND NOT file:line
// -----------------------------------------
// Line numbers churn on every unrelated edit above a violation. A line-keyed
// baseline would fail CI for changes that did not touch the boundary at all,
// and the fix for each spurious failure would be "regenerate the baseline" —
// which trains people to regenerate it reflexively, which is exactly how a
// baseline stops being a control. (file, rule) + count is stable under
// unrelated edits while still catching a genuinely new violation, an extra
// violation in an already-listed file, and a violation moved to a new file.
//
// HOW TO REMOVE AN ENTRY (the only direction that should be common)
// -----------------------------------------------------------------
//   1. Fix the code (see scripts/ai-boundary-baseline.json for what each
//      entry is and what the fix is).
//   2. node scripts/check-ai-boundary.mjs --update
//   3. Commit the shrunken scripts/ai-boundary-baseline.json in the same PR.
// `--update` will only ever SHRINK the baseline. It refuses to add a new
// entry, so it cannot be used to launder a new violation.
//
// HOW TO ADD AN ENTRY (should be rare and is deliberately loud)
// -------------------------------------------------------------
//   node scripts/check-ai-boundary.mjs --accept-new
// This prints a warning naming every entry it is adding. The baseline is
// checked in, so the addition shows up as a reviewable diff hunk — that diff
// IS the approval gate. Adding a violation to the baseline instead of fixing
// it needs architect sign-off in the PR (P14 review chain: RBAC/auth +
// AI-boundary changes are architect-owned).
//
// Do NOT instead downgrade the three rules from `error` to `warn`. A warning
// in a 600-warning lint run is not a control.
//
// Usage:
//   node scripts/check-ai-boundary.mjs              # gate (CI)
//   node scripts/check-ai-boundary.mjs --update     # shrink baseline
//   node scripts/check-ai-boundary.mjs --accept-new # grow baseline (loud)
//
// Exit 0: no new violations.
// Exit 1: new/increased violations, malformed baseline, or a vacuous run.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ESLint } from 'eslint';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');
const CONFIG_PATH = path.join(REPO_ROOT, '.eslintrc.ai-boundary.json');
const BASELINE_PATH = path.join(REPO_ROOT, 'scripts', 'ai-boundary-baseline.json');

// Must match `lint:ai-boundary` in apps/host/package.json.
const LINT_ROOTS = [
  'apps/host/src',
  'packages/lib/src',
  'packages/ui/src',
  'supabase/functions',
];

// The rules this gate is responsible for. A violation of any OTHER rule that
// happens to be an error under this config is NOT this gate's business — the
// ordinary `npm run lint` owns those.
const GATED_RULES = new Set([
  'alfanumrik/no-direct-ai-calls',
  'alfanumrik/no-direct-rag-rpc',
  'alfanumrik/no-canonical-write-outside-projector',
]);

// Vacuity floor. A real run lints thousands of files across four roots. If a
// config typo, a bad glob, or a moved directory makes ESLint see almost
// nothing, the gate would report a triumphant green while measuring nothing.
// Fail CLOSED instead — same posture as the `quality` job's npm-audit
// dependency floor and its auth-gate PASS_COUNT check.
const MIN_FILES_LINTED = 500;

const args = new Set(process.argv.slice(2));
const MODE_UPDATE = args.has('--update');
const MODE_ACCEPT_NEW = args.has('--accept-new');

/** repo-relative, POSIX-separated. */
function relPosix(abs) {
  return path.relative(REPO_ROOT, abs).split(path.sep).join('/');
}

async function collectLiveViolations() {
  const eslint = new ESLint({
    cwd: REPO_ROOT,
    overrideConfigFile: CONFIG_PATH,
    useEslintrc: true,
    extensions: ['.ts', '.tsx'],
    errorOnUnmatchedPattern: true,
  });

  const results = await eslint.lintFiles(LINT_ROOTS);

  /** @type {Map<string, number>} key = `${file}::${ruleId}` */
  const live = new Map();
  let filesLinted = 0;
  let parseErrors = 0;

  for (const r of results) {
    filesLinted += 1;
    for (const m of r.messages) {
      if (m.severity !== 2) continue;
      if (m.fatal || !m.ruleId) {
        // A parse error is not a boundary violation, but it means the file was
        // never actually analysed — silently ignoring it would let someone
        // hide a violation behind a syntax error.
        parseErrors += 1;
        continue;
      }
      if (!GATED_RULES.has(m.ruleId)) continue;
      const key = `${relPosix(r.filePath)}::${m.ruleId}`;
      live.set(key, (live.get(key) ?? 0) + 1);
    }
  }

  return { live, filesLinted, parseErrors };
}

function readBaseline() {
  if (!fs.existsSync(BASELINE_PATH)) {
    console.error(`::error::AI-boundary baseline missing: ${relPosix(BASELINE_PATH)}`);
    console.error('The gate cannot distinguish new violations from known ones without it.');
    process.exit(1);
  }
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(BASELINE_PATH, 'utf8'));
  } catch (err) {
    console.error(`::error::AI-boundary baseline is not valid JSON: ${err.message}`);
    process.exit(1);
  }
  if (!parsed || typeof parsed.violations !== 'object' || parsed.violations === null) {
    console.error('::error::AI-boundary baseline is malformed (expected a `violations` object).');
    process.exit(1);
  }
  return parsed;
}

function writeBaseline(baseline, live) {
  const violations = {};
  for (const key of [...live.keys()].sort()) {
    violations[key] = live.get(key);
  }
  const next = { ...baseline, violations, generated: new Date().toISOString().slice(0, 10) };
  fs.writeFileSync(BASELINE_PATH, `${JSON.stringify(next, null, 2)}\n`, 'utf8');
}

async function main() {
  const { live, filesLinted, parseErrors } = await collectLiveViolations();

  if (filesLinted < MIN_FILES_LINTED) {
    console.error(
      `::error::AI-boundary gate linted only ${filesLinted} files (floor: ${MIN_FILES_LINTED}). ` +
        'It did not see the real source tree — failing CLOSED rather than reporting a vacuous pass. ' +
        `Check LINT_ROOTS in ${relPosix(fileURLToPath(import.meta.url))} against the four roots in ` +
        "apps/host/package.json's lint:ai-boundary.",
    );
    process.exit(1);
  }
  if (parseErrors > 0) {
    console.error(
      `::error::AI-boundary gate hit ${parseErrors} parse error(s). Those files were never analysed, ` +
        'so the gate cannot vouch for them. Fix the syntax/parser config first.',
    );
    process.exit(1);
  }

  const baseline = readBaseline();
  const recorded = baseline.violations;

  const added = [];
  const increased = [];
  const decreased = [];
  const cleared = [];

  for (const [key, count] of [...live.entries()].sort()) {
    const was = recorded[key];
    if (was === undefined) added.push({ key, count });
    else if (count > was) increased.push({ key, count, was });
    else if (count < was) decreased.push({ key, count, was });
  }
  for (const key of Object.keys(recorded).sort()) {
    if (!live.has(key)) cleared.push(key);
  }

  const liveTotal = [...live.values()].reduce((a, b) => a + b, 0);
  const baseTotal = Object.values(recorded).reduce((a, b) => a + b, 0);

  console.log(`AI-boundary gate: ${filesLinted} files linted.`);
  console.log(`  live violations: ${liveTotal}   baseline: ${baseTotal}`);

  if (MODE_UPDATE || MODE_ACCEPT_NEW) {
    if (added.length > 0 && !MODE_ACCEPT_NEW) {
      console.error(
        '::error::--update refuses to ADD baseline entries. It can only shrink the baseline. ' +
          'New violations must be fixed, or accepted deliberately with --accept-new (which is ' +
          'reviewed as a diff hunk in the checked-in baseline). New entries:',
      );
      for (const a of added) console.error(`    + ${a.key}  (${a.count})`);
      process.exit(1);
    }
    if (added.length > 0 || increased.length > 0) {
      console.warn('::warning::Widening the AI-boundary baseline. Every line below is enforcement being GIVEN UP:');
      for (const a of added) console.warn(`    + ${a.key}  (${a.count})`);
      for (const i of increased) console.warn(`    ^ ${i.key}  ${i.was} -> ${i.count}`);
      console.warn('  This needs architect sign-off in the PR (P14).');
    }
    writeBaseline(baseline, live);
    console.log(`Baseline rewritten: ${relPosix(BASELINE_PATH)}`);
    console.log(`  cleared: ${cleared.length}   reduced: ${decreased.length}   added: ${added.length}`);
    return;
  }

  let failed = false;

  if (added.length > 0) {
    failed = true;
    console.error(`::error::${added.length} NEW AI-boundary violation(s) not in the baseline:`);
    for (const a of added) console.error(`    ${a.key}   (${a.count} occurrence(s))`);
  }
  if (increased.length > 0) {
    failed = true;
    console.error(`::error::${increased.length} AI-boundary violation(s) got WORSE:`);
    for (const i of increased) console.error(`    ${i.key}   ${i.was} -> ${i.count}`);
  }

  if (failed) {
    console.error('');
    console.error('Fix the violation, or route the call through the sanctioned choke point:');
    console.error('  no-direct-ai-calls  -> supabase/functions/_shared/grounded-client.ts (Deno)');
    console.error('                         or packages/lib/src/ai/gateway/ (Node)');
    console.error('  no-canonical-write-outside-projector -> packages/lib/src/state/subscribers/**');
    console.error('');
    console.error('If the violation is genuinely sanctioned, it needs an entry in');
    console.error('docs/architecture/EXCEPTIONS.md plus an inline eslint-disable with a');
    console.error('`-- see EXCEPTIONS.md E<n>` reason, NOT a silent baseline addition.');
    process.exit(1);
  }

  if (cleared.length > 0 || decreased.length > 0) {
    console.log('');
    console.log('Ratchet opportunity (not a failure) — the baseline is now looser than reality:');
    for (const key of cleared) console.log(`    FIXED    ${key}`);
    for (const d of decreased) console.log(`    REDUCED  ${d.key}   ${d.was} -> ${d.count}`);
    console.log('  Run `node scripts/check-ai-boundary.mjs --update` and commit the result.');
  }

  console.log('AI-boundary gate: PASS (no new violations).');
}

main().catch((err) => {
  console.error(`::error::AI-boundary gate crashed: ${err && err.stack ? err.stack : err}`);
  process.exit(1);
});
