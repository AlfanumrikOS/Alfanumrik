#!/usr/bin/env -S npx tsx
/**
 * Pre-rollout checklist verifier — Phase 4 Task 4-prep-D.
 *
 * Verifies the code-side items in spec §11.3 before ops starts Day 1 of the
 * grounded-answer rollout. Run from repo root:
 *
 *   npx tsx scripts/pre-rollout-checklist.ts
 *
 * Exit codes:
 *   0  — all checks passed; safe for ops to proceed to Day 1
 *   1  — one or more checks failed; fix before proceeding
 *
 * Checks are intentionally file-presence and shape-only (fast, no network,
 * no Supabase required). They catch the classes of mistake that would cause
 * Day 1 to abort: missing migrations, missing Edge Functions, missing prompt
 * templates, config drift between web and Deno sides, ESLint rules not
 * registered, runbooks not written, POST handlers missing, P1 scoring fix
 * not wired into all 5 client push sites.
 *
 * The checks are exported as individual functions so the vitest suite can
 * assert they pass on the current worktree state.
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'fs';
import { execSync } from 'child_process';
import { join, resolve } from 'path';

// ─── Repo root resolution ────────────────────────────────────────────
// When invoked via `npx tsx scripts/pre-rollout-checklist.ts` cwd is repo
// root. When invoked from a worktree, __dirname is .../scripts/.
const REPO_ROOT = resolve(__dirname, '..');

// ─── Check result types ──────────────────────────────────────────────

export interface CheckResult {
  name: string;
  pass: boolean;
  detail?: string;
}

function ok(name: string, detail?: string): CheckResult {
  return { name, pass: true, detail };
}
function fail(name: string, detail: string): CheckResult {
  return { name, pass: false, detail };
}

// ─── Individual checks (exported for testing) ────────────────────────

const PHASE_1_4_MIGRATION_TIMESTAMPS = [
  '20260418100000', // cbse_syllabus
  '20260418100100', // rag_chunks_constraints
  '20260418100200', // question_bank_verification
  '20260418100300', // grounded_ai_traces
  '20260418100400', // feedback_and_failures
  '20260418100500', // syllabus_status_triggers
  '20260418100600', // ingestion_gaps_view
  '20260418100700', // backfill_helper_rpcs
  '20260418100800', // feature_flags
  '20260418100900', // content_requests_ist_day
  '20260418101000', // subjects_chapters_rpcs_v2
  '20260418101100', // claim_verification_batch_rpc
  '20260418101200', // coverage_audit_helpers
  '20260418110000', // fix_quiz_shuffle_scoring
  '20260418120000', // super_admin_access_permission_seed
];

export function checkPhase14MigrationsPresent(): CheckResult {
  const dir = join(REPO_ROOT, 'supabase', 'migrations');
  if (!existsSync(dir)) return fail('phase1-4 migrations', `directory missing: ${dir}`);
  const files = readdirSync(dir).filter((f) => f.endsWith('.sql'));
  const missing: string[] = [];
  for (const ts of PHASE_1_4_MIGRATION_TIMESTAMPS) {
    if (!files.some((f) => f.startsWith(ts + '_'))) missing.push(ts);
  }
  if (missing.length > 0) {
    return fail(
      'phase1-4 migrations',
      `missing migration timestamps: ${missing.join(', ')}`,
    );
  }
  return ok('phase1-4 migrations', `${PHASE_1_4_MIGRATION_TIMESTAMPS.length} present`);
}

export function checkGroundedAnswerEdgeFunction(): CheckResult {
  const p = join(REPO_ROOT, 'supabase', 'functions', 'grounded-answer', 'index.ts');
  if (!existsSync(p)) return fail('grounded-answer Edge Function', `missing: ${p}`);
  const src = readFileSync(p, 'utf8');
  if (!/Deno\.serve\s*\(/.test(src)) {
    return fail('grounded-answer Edge Function', 'index.ts does not call Deno.serve');
  }
  return ok('grounded-answer Edge Function');
}

export function checkVerifyQuestionBankEdgeFunction(): CheckResult {
  const p = join(REPO_ROOT, 'supabase', 'functions', 'verify-question-bank', 'index.ts');
  if (!existsSync(p)) return fail('verify-question-bank Edge Function', `missing: ${p}`);
  return ok('verify-question-bank Edge Function');
}

export function checkCoverageAuditEdgeFunction(): CheckResult {
  const p = join(REPO_ROOT, 'supabase', 'functions', 'coverage-audit', 'index.ts');
  if (!existsSync(p)) return fail('coverage-audit Edge Function', `missing: ${p}`);
  return ok('coverage-audit Edge Function');
}

const REQUIRED_PROMPT_TEMPLATES = [
  'foxy_tutor_v1.txt',
  'ncert_solver_v1.txt',
  'quiz_question_generator_v1.txt',
  'quiz_answer_verifier_v1.txt',
];

export function checkPromptTemplates(): CheckResult {
  const dir = join(REPO_ROOT, 'supabase', 'functions', 'grounded-answer', 'prompts');
  if (!existsSync(dir)) return fail('prompt templates', `directory missing: ${dir}`);
  const missing: string[] = [];
  for (const name of REQUIRED_PROMPT_TEMPLATES) {
    const p = join(dir, name);
    if (!existsSync(p)) {
      missing.push(name);
      continue;
    }
    // Non-empty sanity check
    if (statSync(p).size === 0) missing.push(`${name} (empty)`);
  }
  if (missing.length > 0) {
    return fail('prompt templates', `missing/empty: ${missing.join(', ')}`);
  }
  return ok('prompt templates', `${REQUIRED_PROMPT_TEMPLATES.length} present`);
}

export function checkConfigFilesPresent(): CheckResult {
  const web = join(REPO_ROOT, 'src', 'lib', 'grounding-config.ts');
  const deno = join(REPO_ROOT, 'supabase', 'functions', 'grounded-answer', 'config.ts');
  const missing: string[] = [];
  if (!existsSync(web)) missing.push('src/lib/grounding-config.ts');
  if (!existsSync(deno)) missing.push('supabase/functions/grounded-answer/config.ts');
  if (missing.length > 0) return fail('config files', `missing: ${missing.join(', ')}`);
  return ok('config files');
}

export function checkConfigParity(): CheckResult {
  // Delegates to the existing shell script. On Windows we invoke via bash if
  // available (git bash is present per repo convention).
  const script = join(REPO_ROOT, 'scripts', 'check-config-parity.sh');
  if (!existsSync(script)) return fail('config parity', `script missing: ${script}`);
  try {
    execSync(`bash "${script}"`, { cwd: REPO_ROOT, stdio: 'pipe' });
    return ok('config parity', 'web + deno config constants match');
  } catch (err) {
    const out = err instanceof Error && 'stdout' in err
      ? String((err as { stdout?: Buffer }).stdout ?? '')
      : '';
    return fail('config parity', out || 'check-config-parity.sh exited non-zero');
  }
}

export function checkEslintRulesRegistered(): CheckResult {
  const p = join(REPO_ROOT, '.eslintrc.ai-boundary.json');
  if (!existsSync(p)) return fail('eslint ai-boundary config', `missing: ${p}`);
  const cfg = JSON.parse(readFileSync(p, 'utf8')) as {
    rules?: Record<string, unknown>;
  };
  const rules = cfg.rules ?? {};
  const missing: string[] = [];
  if (!('alfanumrik/no-direct-ai-calls' in rules)) missing.push('alfanumrik/no-direct-ai-calls');
  if (!('alfanumrik/no-direct-rag-rpc' in rules)) missing.push('alfanumrik/no-direct-rag-rpc');
  if (missing.length > 0) return fail('eslint ai-boundary rules', `not registered: ${missing.join(', ')}`);
  return ok('eslint ai-boundary rules');
}

const REQUIRED_RUNBOOKS = [
  'voyage-outage.md',
  'claude-outage.md',
  'coverage-regression.md',
  'verifier-queue-stuck.md',
  'student-complaint-triage.md',
];

export function checkOperationalRunbooks(): CheckResult {
  const dir = join(REPO_ROOT, 'docs', 'runbooks', 'grounding');
  if (!existsSync(dir)) return fail('operational runbooks', `directory missing: ${dir}`);
  const missing: string[] = [];
  for (const name of REQUIRED_RUNBOOKS) {
    if (!existsSync(join(dir, name))) missing.push(name);
  }
  if (missing.length > 0) return fail('operational runbooks', `missing: ${missing.join(', ')}`);
  return ok('operational runbooks', `${REQUIRED_RUNBOOKS.length} present`);
}

export function checkRolloutSequenceRunbook(): CheckResult {
  const p = join(REPO_ROOT, 'docs', 'runbooks', 'grounding', 'rollout-sequence.md');
  if (!existsSync(p)) return fail('rollout sequence runbook', `missing: ${p}`);
  const src = readFileSync(p, 'utf8');
  // Sanity: runbook should reference Day 1 and Emergency rollback section
  if (!/Day 1/i.test(src) || !/rollback/i.test(src)) {
    return fail('rollout sequence runbook', 'content missing Day 1 / rollback sections');
  }
  return ok('rollout sequence runbook');
}

export function checkSuperAdminAccessMigration(): CheckResult {
  const dir = join(REPO_ROOT, 'supabase', 'migrations');
  if (!existsSync(dir)) return fail('super_admin.access migration', `directory missing: ${dir}`);
  const files = readdirSync(dir);
  const found = files.find((f) => /super_admin_access_permission_seed/i.test(f));
  if (!found) return fail('super_admin.access migration', 'no migration named *super_admin_access_permission_seed*');
  const src = readFileSync(join(dir, found), 'utf8');
  if (!/'super_admin\.access'/.test(src)) {
    return fail('super_admin.access migration', 'migration found but does not reference permission code');
  }
  return ok('super_admin.access migration', found);
}

export function checkPostHandlers(): CheckResult {
  const targets: Array<{ path: string; label: string }> = [
    {
      path: join(REPO_ROOT, 'src', 'app', 'api', 'super-admin', 'grounding', 'verification-queue', 'route.ts'),
      label: 'verification-queue',
    },
    {
      path: join(REPO_ROOT, 'src', 'app', 'api', 'super-admin', 'grounding', 'ai-issues', 'route.ts'),
      label: 'ai-issues',
    },
  ];
  const missing: string[] = [];
  for (const t of targets) {
    if (!existsSync(t.path)) {
      missing.push(`${t.label} (file missing)`);
      continue;
    }
    const src = readFileSync(t.path, 'utf8');
    if (!/export\s+async\s+function\s+POST\s*\(/.test(src)) {
      missing.push(`${t.label} (no POST export)`);
    }
  }
  if (missing.length > 0) return fail('POST handlers on grounding routes', missing.join(', '));
  return ok('POST handlers on grounding routes');
}

export function checkQuizResponseShuffleMap(): CheckResult {
  const p = join(REPO_ROOT, 'src', 'lib', 'types.ts');
  if (!existsSync(p)) return fail('QuizResponse.shuffle_map', `missing: ${p}`);
  const src = readFileSync(p, 'utf8');
  if (!/shuffle_map\s*\?:\s*number\[\]\s*\|\s*null/.test(src)) {
    return fail('QuizResponse.shuffle_map', 'shuffle_map field not declared on QuizResponse');
  }
  return ok('QuizResponse.shuffle_map');
}

const EXPECTED_SHUFFLE_MAP_PUSH_SITES = 5;

export function checkQuizPushSites(): CheckResult {
  const p = join(REPO_ROOT, 'src', 'app', 'quiz', 'page.tsx');
  if (!existsSync(p)) return fail('quiz page shuffle_map pushes', `missing: ${p}`);
  const src = readFileSync(p, 'utf8');
  // Count occurrences of shuffle_map: ... in push payloads. Our spec says 5.
  // Each push site writes one occurrence; type declaration is in types.ts not here.
  const matches = src.match(/shuffle_map:\s*/g) ?? [];
  if (matches.length !== EXPECTED_SHUFFLE_MAP_PUSH_SITES) {
    return fail(
      'quiz page shuffle_map pushes',
      `expected ${EXPECTED_SHUFFLE_MAP_PUSH_SITES} occurrences, found ${matches.length}`,
    );
  }
  return ok('quiz page shuffle_map pushes', `${matches.length} sites`);
}

// ─── Runner ──────────────────────────────────────────────────────────

export const ALL_CHECKS: Array<() => CheckResult> = [
  checkPhase14MigrationsPresent,
  checkGroundedAnswerEdgeFunction,
  checkVerifyQuestionBankEdgeFunction,
  checkCoverageAuditEdgeFunction,
  checkPromptTemplates,
  checkConfigFilesPresent,
  checkConfigParity,
  checkEslintRulesRegistered,
  checkOperationalRunbooks,
  checkRolloutSequenceRunbook,
  checkSuperAdminAccessMigration,
  checkPostHandlers,
  checkQuizResponseShuffleMap,
  checkQuizPushSites,
];

export function runAllChecks(): { results: CheckResult[]; allPass: boolean } {
  const results = ALL_CHECKS.map((fn) => {
    try {
      return fn();
    } catch (err) {
      return fail(fn.name, `threw: ${err instanceof Error ? err.message : String(err)}`);
    }
  });
  const allPass = results.every((r) => r.pass);
  return { results, allPass };
}

function formatReport(results: CheckResult[]): string {
  const lines: string[] = [];
  const passMark = '[PASS]';
  const failMark = '[FAIL]';
  for (const r of results) {
    const mark = r.pass ? passMark : failMark;
    const detail = r.detail ? ` — ${r.detail}` : '';
    lines.push(`${mark} ${r.name}${detail}`);
  }
  return lines.join('\n');
}

// CLI entry point
// Compare realpath to avoid worktree symlink mismatches.
const invokedDirectly = (() => {
  try {
    // `require.main === module` is the CJS standard; tsx transpiles to CJS.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require.main === module;
  } catch {
    return false;
  }
})();

if (invokedDirectly) {
  const { results, allPass } = runAllChecks();
  // eslint-disable-next-line no-console
  console.log('\nPre-rollout checklist\n=====================\n');
  // eslint-disable-next-line no-console
  console.log(formatReport(results));
  // eslint-disable-next-line no-console
  console.log(`\nSummary: ${results.filter((r) => r.pass).length}/${results.length} checks passed.\n`);
  process.exit(allPass ? 0 : 1);
}
