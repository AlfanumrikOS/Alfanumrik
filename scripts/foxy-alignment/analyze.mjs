#!/usr/bin/env node
/**
 * Foxy North-Star alignment analyzer — Phase T0 governance gate.
 *
 * Enforces the CEO-approved Foxy North-Star implementation plan
 * (approved 2026-08-05; governing spec:
 * docs/superpowers/specs/2026-08-05-foxy-north-star-alignment-design.md,
 * sections 3 "TRACKER + ANALYZER" and 4 "NO-DUPLICATE POLICY").
 *
 * Ten checks against the tracker (docs/trackers/foxy-north-star/tracker.json)
 * and the REAL tree — assert against files on disk, never trust prose (house
 * pattern of scripts/check-bundle-size.mjs + .claude/hooks/verify-hook-patterns.sh):
 *
 *    1. COVERAGE        (gate)  all 79 reqIds exist in the tracker, none deleted
 *    2. ARTIFACTS       (gate)  built+ records: every layers + evidence[] path exists
 *    3. TESTS           (gate)  tested+ records: test files exist, regressionIds
 *                               resolve in .claude/regression/ shards
 *    4. REVIEW CHAINS   (gate)  verified+ records: completed ⊇ required (P14)
 *    5. FLAG POSTURE    (warn)  flags[] vs scripts/feature-flag-matrix.json
 *    6. NO-DUP CODE     (gate)  BKT / SM-2 / IRT-selection / model-router
 *                               signatures only at KNOWN_LOCATIONS
 *    7. NO-DUP SCHEMA   (gate)  no new mastery|misconception|memory tables after
 *                               the plan cutoff; retired-table refs never increase
 *    8. INVARIANT GUARDS(gate)  XP_RULES single-source, no AI-path mastery writes
 *                               (E6), no XP-to-money path (U11), getUserMedia only
 *                               under voice/scan (PR3), banned-phrase lint (T1/PR1)
 *    9. WRITERLESS WATCH(gate)  writer-needed tables gain writers once their
 *                               record is built+; cme_concept_state refs reach zero
 *                               once E3 is built+
 *   10. STALENESS       (warn)  in_progress records with lastVerified null/>14d
 *
 * Exit codes:
 *   0 — all gating checks (1-4, 6-9) pass (warnings from 5/10 do not gate)
 *   1 — any gating check fails, or the tracker is missing/unreadable
 *
 * Zero npm dependencies (node:fs / node:path only) so CI can run it with a
 * bare checkout + node — no `npm ci` required.
 *
 * Usage:
 *   node scripts/foxy-alignment/analyze.mjs
 *   node scripts/foxy-alignment/analyze.mjs --tracker=path/to/tracker.json
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * BASELINE FREEZE — 2026-08-05 (measured directly against the tree, commit on
 * branch Alfanumrik/foxy-system-spec-22f565). READ BEFORE EDITING.
 *
 * KNOWN_LOCATIONS, RETIRED_TABLE_REF_BASELINE and BASELINE_EXCEPTIONS below
 * were produced by running every grep in this file against the real tree on
 * the freeze date. They are a RATCHET, not an amnesty:
 *   - a NEW file matching a duplicate-code signature FAILS (check 6);
 *   - retired-table reference counts may only go DOWN (check 7);
 *   - every BASELINE_EXCEPTIONS entry carries the tracker reqId whose
 *     completion removes it (check 8). Do not add entries to make a new
 *     violation pass — that is the exact rot this analyzer exists to stop.
 * When debt is paid down, DELETE the entry / LOWER the count in the same PR,
 * so the ratchet locks in the improvement (mirrors the bundle-size ratchet).
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';

const ROOT = process.cwd();

// ── CLI ─────────────────────────────────────────────────────────────────────
const DEFAULT_TRACKER = 'docs/trackers/foxy-north-star/tracker.json';
let trackerPath = DEFAULT_TRACKER;
for (const arg of process.argv.slice(2)) {
  if (arg.startsWith('--tracker=')) trackerPath = arg.slice('--tracker='.length);
}
trackerPath = resolve(ROOT, trackerPath);

// ── Requirement universe (spec section 1; hardcoded per plan §3.2 check 1) ──
// 79 reqIds. NOTE: P1-P11 here are the spec §3 learner-model PARAMETERS
// (mastery probability, uncertainty, …), NOT the product invariants P1-P15
// in .claude/CLAUDE.md — same prefix, different namespace.
const REQ_IDS = [
  'S1.1', 'S1.2', 'S1.3', 'S1.4', 'S1.5', 'S1.6', 'S1.7', 'S1.8',
  'D1', 'D2', 'D3', 'D4', 'D5', 'D6', 'D7', 'D8', 'D9', 'D10', 'D11', 'D12',
  'PR1', 'PR2', 'PR3', 'PR4', 'PR5', 'PR6',
  'T1', 'T2',
  'P1', 'P2', 'P3', 'P4', 'P5', 'P6', 'P7', 'P8', 'P9', 'P10', 'P11',
  'E1', 'E2', 'E3', 'E4', 'E5', 'E6',
  'L1', 'L2', 'L3', 'L4', 'L5', 'L6', 'L7',
  'U1', 'U2', 'U3', 'U4', 'U5', 'U6', 'U7', 'U8', 'U9', 'U10', 'U11',
  'K1', 'K2', 'K3', 'K4', 'K5', 'K6', 'K7', 'K8', 'K9',
  'R1', 'R2', 'R3', 'R4', 'R5', 'R6', 'R7',
];

const STATUS_ORDER = ['planned', 'in_progress', 'built', 'tested', 'verified', 'shipped'];
const statusRank = (s) => STATUS_ORDER.indexOf(String(s || '').toLowerCase());
const atLeast = (record, floor) =>
  statusRank(record?.status) >= STATUS_ORDER.indexOf(floor) && statusRank(record?.status) !== -1;

// ── Tree-scan scope ─────────────────────────────────────────────────────────
// The no-duplicate scope from the task brief: apps, packages,
// supabase/functions — excluding tests, archives, build output, and mobile
// (mobile is additive-contract, reviewed by the mobile agent separately).
const CODE_ROOTS = ['apps', 'packages', 'supabase/functions'];
const CODE_EXTS = new Set(['.ts', '.tsx', '.js', '.mjs']);
const EXCLUDE_DIRS = new Set([
  'node_modules', '__tests__', '_archive', 'mobile',
  '.next', 'dist', 'coverage', '.turbo', '.git',
]);
const isTestFile = (name) => /\.(test|spec)\.[cm]?[jt]sx?$/.test(name);

function walk(dir, out = []) {
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (EXCLUDE_DIRS.has(entry.name)) continue;
      walk(join(dir, entry.name), out);
    } else if (entry.isFile()) {
      const dot = entry.name.lastIndexOf('.');
      const ext = dot >= 0 ? entry.name.slice(dot) : '';
      if (CODE_EXTS.has(ext) && !isTestFile(entry.name)) out.push(join(dir, entry.name));
    }
  }
  return out;
}

const toRel = (abs) => abs.slice(ROOT.length + 1).split(sep).join('/');
const readText = (abs) => {
  try { return readFileSync(abs, 'utf8'); } catch { return null; }
};

// Cached one-pass scan of all in-scope, non-test source files.
let CODE_FILES = null;
function codeFiles() {
  if (!CODE_FILES) {
    CODE_FILES = [];
    for (const root of CODE_ROOTS) walk(join(ROOT, ...root.split('/')), CODE_FILES);
  }
  return CODE_FILES;
}

// ── Check 6 constants — NO-DUPLICATE CODE allowlist ─────────────────────────
// Frozen 2026-08-05 by running each regex against the tree (scope above).
// Legend: [canonical] = the single blessed implementation per plan §4;
//         [debt→reqId] = known duplicate the named tracker record retires —
//         when that record ships, DELETE the entry here in the same PR.
const DUP_SIGNATURES = [
  {
    name: 'BKT update',
    re: /(?:function|const)\s+bktUpdate/,
    // Canonical per plan §1.3 E1 is the SQL in update_learner_state_post_quiz;
    // the ONE approved TS mirror lives in packages/lib/src/learner-model/
    // (bktPosterior — a different symbol, not matched by this grep).
    // 2026-08-05 (post-consolidation, Phase 2): the quiz-completion-service
    // and queue-consumer duplicate copies were DELETED (E1 debt paid) and
    // their allowlist entries removed in the same PR (ratchet locked).
    allow: [
      // [module-private, display-only] cognitive-engine's exported BKT copy
      // was deleted in the E1 consolidation; what remains is a module-PRIVATE
      // `function bktUpdate` used only by recordExperimentEvidence (simulation
      // /experiment evidence display signal — not a learner-state writer).
      // The grep cannot distinguish private from exported, so this entry
      // stays, documented, until that internal helper is folded into the
      // learner-model facade.
      'packages/lib/src/cognitive-engine.ts',
    ],
  },
  {
    name: 'SM-2 update',
    re: /function\s+sm2Update|applySm2/,
    // Match semantics: the regex runs against FILE CONTENT (not symbol defs),
    // so a mere `export { applySm2 } from …` re-export or an import in a
    // caller matches identically to a definition. That is why the grade
    // endpoint's helpers.ts (re-export) and route.ts (importer) must stay
    // allowlisted even though the one true implementation moved to
    // packages/lib. Test files never match (walk() skips __tests__/ and
    // *.test.* — see CODE_EXTS/EXCLUDE_DIRS above).
    allow: [
      'packages/lib/src/learn/sm2.ts',                           // [canonical] THE TS SM-2 (Phase 3 E4/F10); params frozen = SQL RPC values
      'apps/host/src/app/api/learner/review/grade/helpers.ts',   // [re-export] 2-line SM-2 re-export of the canonical module (route glue otherwise)
      'apps/host/src/app/api/learner/review/grade/route.ts',     // [caller] imports applySm2 via the helpers re-export
      // 2026-08-05 (post-consolidation, Phase 2): cognitive-engine's divergent
      // SM-2 impl (sm2Update) was DELETED in the E1/E4 consolidation — its
      // [debt→E4] entry removed in the same PR (ratchet locked).
    ],
  },
  {
    name: 'IRT selection (select_questions_by_irt_info)',
    re: /select_questions_by_irt_info/,
    allow: [
      'supabase/functions/quiz-generator/index.ts',              // [canonical] the only RPC caller (flag-gated, E2)
      'packages/lib/src/irt/fisher-info.ts',                     // [canonical] documented TS twin of the SQL RPC
      'apps/host/src/app/api/super-admin/ai/irt-readiness/route.ts', // doc-comment reference only (readiness dashboard)
      'apps/host/src/types/database.types.ts',                   // generated Supabase types (RPC signature)
      'packages/lib/src/flags/registries/pedagogy.ts',           // flag-registry doc comments only
    ],
  },
  {
    name: 'Model router (selectModelChain)',
    re: /selectModelChain/,
    // Plan §1.7 R3 consolidates 3 routers to ONE gateway; this signature only
    // exists in the blessed gateway today. The 2 duplicate routers to retire
    // (_shared/mol Deno, python mol shadow) do not carry this symbol — their
    // retirement is tracked by R3's own record, not this grep.
    allow: [
      'packages/lib/src/ai/gateway/router.ts',                   // [canonical] definition
      'packages/lib/src/ai/gateway/gateway.ts',                  // [canonical] caller
      'packages/lib/src/ai/gateway/rollout.ts',                  // [canonical] rollout twin, same module
      'packages/lib/src/ai/gateway/index.ts',                    // [canonical] re-export
      'packages/lib/src/ai/index.ts',                            // [canonical] re-export
    ],
  },
  {
    // R3 consolidation, 2026-08-05: the Deno-side BASE_MATRIX is now
    // GENERATED from packages/lib/src/ai/gateway/registry.ts via
    // scripts/gen-mol-matrix.mjs. The `selectProviderChain` / `BASE_MATRIX`
    // symbols may only appear at:
    //   - packages/lib/src/ai/gateway/**            (the canonical gateway)
    //   - supabase/functions/_shared/mol/generated-matrix.ts (generated)
    //   - supabase/functions/_shared/mol/router.ts  (import + call-site policy)
    // A new hand-authored copy anywhere else re-introduces the drift R3
    // consolidation was created to close — refuse it here.
    name: 'MOL BASE_MATRIX (Deno)',
    re: /BASE_MATRIX\s*[:=]|selectProviderChain/,
    // Note: the gateway's own router uses `selectModelChain` (already
    // covered by the previous signature above), NOT selectProviderChain
    // — so the gateway files intentionally do NOT appear here.
    allow: [
      'supabase/functions/_shared/mol/generated-matrix.ts', // [canonical] the generated Deno matrix
      'supabase/functions/_shared/mol/router.ts',           // [canonical] the router that imports it
      'supabase/functions/_shared/mol/index.ts',            // [caller] MOL orchestrator entry
    ],
  },
];

// ── Check 7 constants — NO-DUPLICATE SCHEMA ─────────────────────────────────
// Migrations with a timestamp AFTER the plan approval may not CREATE TABLE
// matching /(mastery|misconception|memory)/i unless the table is approved here.
const MIGRATION_CUTOFF = '20260805000000';
const APPROVED_NEW_TABLES = ['safeguarding_escalations']; // plan §2 Phase 1 (U6)
// Retired tables (plan §1.3 E3 / §4.5): references may only DECREASE.
// Baselines measured 2026-08-05 (word-bounded occurrences in the code scope
// above; migrations and tests excluded). When you remove references, LOWER
// the number here in the same PR to lock the ratchet.
const RETIRED_TABLES = ['cme_concept_state', 'topic_mastery'];
const RETIRED_TABLE_REF_BASELINE = {
  // Ratchet history: 20 (frozen 2026-08-05) → 6 (re-measured 2026-08-05
  // post-consolidation, Phase 2 — E3 cleanup removed the bulk of the
  // cme-engine/board-score/docs references).
  // 6 = foxy cognitive-context (1) + foxy learning-action (1)
  //   + database.types.ts (1) + agents/registry (1) + supabase.ts (1)
  //   + cme-engine EF (1)
  // ratcheted 2026-08-05: 6 -> 0 after CI-fix sweep (comment refs + database.types key renamed to _retired_cme_concept_state; see PR #1465)
  // ratcheted 2026-08-26: 0 -> 1 after database.types.ts regeneration (auto-gen file always includes all tables in schema)
  cme_concept_state: 1,
  // Ratchet history: 23 (frozen 2026-08-05) → 20 (re-measured 2026-08-05
  // post-consolidation, Phase 2).
  // 20 = domains/assessment (4) + api/v2 progress (3) + foxy page (2)
  //    + api/v2 contract (2) + daily-cron EF (2) + foxy route (1)
  //    + foxy fetch-mastery (1) + domains/practice (1) + domains/types (1)
  //    + quiz/submit-side-effects (1) + score-config (1)
  //    + database.types.ts (1)
  topic_mastery: 20,
};

// ── Check 8 constants — INVARIANT GUARDS ────────────────────────────────────
const XP_RULES_ALLOWED = [
  'packages/lib/src/xp-config.ts', // canonical definition (P2 invariant)
  'packages/lib/src/xp-rules.ts',  // canonical re-export surface
];
// AI code paths that must NEVER write mastery tables (plan §1.3 E6).
const AI_PATHS = [
  'apps/host/src/app/api/foxy',
  'packages/lib/src/ai',
  'packages/lib/src/foxy',
  'supabase/functions/grounded-answer',
  'supabase/functions/quiz-generator',
];
// Pre-existing hits measured 2026-08-05. Each entry names the tracker reqId
// whose completion removes it. These are exceptions for DAY-ONE hits only —
// never park a new violation here.
const BASELINE_EXCEPTIONS = {
  // 8c — /xp[^\n]{0,40}(money|rupee|cash|voucher|redeem)/i
  xpMoney: [
    'packages/ui/src/xp/XPRewardShop.tsx',    // [audit→U11] COIN_SHOP digital goods (streak protection/boosts), no monetary conversion — but it is a redeem surface, so U11's safety review must clear or remove it
    'packages/lib/src/link-code-otp.ts',      // false positive: "export const REDEEM_IP_LIMIT" — parent-link OTP redemption, no XP involved [remove with U11 copy audit]
    'packages/lib/src/foxy/schema.ts',        // false positive: CBSE Accountancy sample content ("purchased for cash … expense") [remove with U11 copy audit]
    'packages/lib/src/school/pending-invite.ts', // false positive: "export … Redeem" — school invite redemption, no XP involved [remove with U11 copy audit]
  ],
  // 8d — getUserMedia outside voice/scan paths
  getUserMedia: [
    'packages/ui/src/foxy/v2/SnapDoubt.tsx',  // [audit→PR3] comment-only mention ("No getUserMedia/camera") documenting that camera capture is deliberately disabled — PR3 policy module should re-home or reword it
  ],
  // 8e — banned phrases in student-facing source.
  // 2026-08-05: the demo-page 'Weak Student' entry was REMOVED (frontend is
  // renaming the persona label in the same wave the policy module landed).
  // The two entries below are DAY-ONE hits of the WIDENED list (check 8e now
  // source-parses ALL_BANNED_PHRASES — incl. 'struggling student' — out of
  // packages/lib/src/policy/prohibited-inferences.ts instead of a 4-phrase
  // hardcoded regex). Teacher-facing copy, not student-visible, but T1's
  // copy audit must move it to evidence language, then DELETE these entries.
  bannedPhrases: [
    'apps/host/src/app/teacher/students/page.tsx', // [fix→T1] "struggling student(s)" in comments + summary copy
    'apps/host/src/app/for-teachers/page.tsx',     // [fix→T1] marketing copy "Identify struggling students before they fall behind."
  ],
};

// ── Check 8e source of truth ────────────────────────────────────────────────
// The banned-phrase list is SOURCE-PARSED from the policy module (PR1 —
// single denylist consumed by prompts + analyzer; REG-48 SQL/TS-parity
// pattern). Parity between this parser and the module's ALL_BANNED_PHRASES
// export is pinned by packages/lib/src/__tests__/policy/
// prohibited-inferences.test.ts — if you change the module's array format,
// that test and this parser must move together.
const PROHIBITED_INFERENCES_MODULE = 'packages/lib/src/policy/prohibited-inferences.ts';
const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
function parseBannedPhrases() {
  const text = readText(join(ROOT, ...PROHIBITED_INFERENCES_MODULE.split('/')));
  if (!text) return null;
  const phrases = [];
  const arrRe = /bannedPhrases\s*:\s*\[([^\]]*)\]/g;
  let m;
  while ((m = arrRe.exec(text))) {
    const litRe = /'([^'\\]+)'|"([^"\\]+)"/g;
    let lm;
    while ((lm = litRe.exec(m[1]))) phrases.push(lm[1] ?? lm[2]);
  }
  return [...new Set(phrases)];
}

// ── Check 9 constants — WRITERLESS WATCH ────────────────────────────────────
// table → the tracker record that builds its writer. Once that record is
// built+, a non-test write site (insert/upsert) must exist or the gate fails.
const WRITER_NEEDED = {
  student_misconceptions: 'D7',
  student_skill_state: 'E2',
};
// Once E3 (retire cme-engine + cme_concept_state) is built+, non-migration
// references to cme_concept_state must be ZERO.
const RETIRED_AFTER = { cme_concept_state: 'E3' };

const STALENESS_DAYS = 14;

// ── Shared measurement helpers ──────────────────────────────────────────────
function countBounded(table) {
  const re = new RegExp(`\\b${table}\\b`, 'g');
  const perFile = [];
  let total = 0;
  for (const abs of codeFiles()) {
    const text = readText(abs);
    if (!text) continue;
    const n = (text.match(re) || []).length;
    if (n > 0) { perFile.push({ file: toRel(abs), n }); total += n; }
  }
  return { total, perFile };
}

function findWriteSite(table) {
  // TS/JS: .from('<table>') chained (possibly across lines) into insert/upsert.
  const chained = new RegExp(
    `from\\(\\s*["']${table}["']\\s*\\)[\\s\\S]{0,300}?\\.\\s*(insert|upsert)\\s*\\(`,
  );
  for (const abs of codeFiles()) {
    const text = readText(abs);
    if (text && chained.test(text)) return toRel(abs);
  }
  // SQL: a writer may legitimately live inside a migration RPC
  // (e.g. an additive extension of update_learner_state_post_quiz).
  const sqlRe = new RegExp(
    `(insert\\s+into|update)\\s+(public\\.)?${table}\\b`, 'i',
  );
  const migDir = join(ROOT, 'supabase', 'migrations');
  if (existsSync(migDir)) {
    for (const entry of readdirSync(migDir, { withFileTypes: true })) {
      if (!entry.isFile() || !entry.name.endsWith('.sql')) continue;
      const text = readText(join(migDir, entry.name));
      if (text && sqlRe.test(text)) return `supabase/migrations/${entry.name}`;
    }
  }
  return null;
}

// ── Checks ──────────────────────────────────────────────────────────────────
// Each returns { id, name, verdict: 'PASS'|'FAIL'|'WARN', detail, lines[] }.

function check1Coverage(records) {
  const lines = [];
  const seen = new Map();
  for (const r of records) seen.set(r.reqId, (seen.get(r.reqId) || 0) + 1);
  const missing = REQ_IDS.filter((id) => !seen.has(id));
  const dupes = [...seen.entries()].filter(([, n]) => n > 1).map(([id]) => id);
  const unknown = [...seen.keys()].filter((id) => !REQ_IDS.includes(id));
  for (const id of missing) lines.push(`FAIL missing reqId: ${id}`);
  for (const id of dupes) lines.push(`FAIL duplicated reqId: ${id}`);
  for (const id of unknown) lines.push(`WARN unknown reqId (not in the 79-id spec universe): ${id}`);
  const verdict = missing.length || dupes.length ? 'FAIL' : unknown.length ? 'WARN' : 'PASS';
  return {
    id: 1, name: 'COVERAGE', verdict, lines,
    detail: `${REQ_IDS.length - missing.length}/${REQ_IDS.length} reqIds present` +
      (dupes.length ? `, ${dupes.length} duplicated` : '') +
      (unknown.length ? `, ${unknown.length} unknown` : ''),
  };
}

const SKIP_VALUES = new Set(['', 'inherit', 'n/a', 'n-a', 'none']);
function normalizePathEntry(entry) {
  let s = String(entry ?? '').trim();
  // Tracker evidence entries may annotate the path: "path:line" (plan §3.1
  // schema) or "path — free-text note" (the seeded tracker's format). Strip
  // both before the disk check.
  const emDash = s.indexOf(' — ');
  if (emDash >= 0) s = s.slice(0, emDash).trim();
  if (SKIP_VALUES.has(s.toLowerCase())) return null;
  return s.includes(':') ? s.slice(0, s.indexOf(':')) : s;
}
function recordPaths(record) {
  const out = [];
  const layers = record.layers || {};
  for (const key of ['db', 'backend', 'middleware', 'frontend', 'mobile']) {
    const v = layers[key];
    for (const entry of Array.isArray(v) ? v : v != null ? [v] : []) {
      const p = normalizePathEntry(entry);
      if (p) out.push(p);
    }
  }
  for (const entry of record.evidence || []) {
    const p = normalizePathEntry(entry);
    if (p) out.push(p);
  }
  return out;
}

function check2Artifacts(records) {
  const lines = [];
  let checked = 0;
  for (const r of records) {
    if (!atLeast(r, 'built')) continue;
    for (const p of recordPaths(r)) {
      checked++;
      if (!existsSync(join(ROOT, ...p.split('/')))) {
        lines.push(`FAIL ${r.reqId} (${r.status}): missing artifact path: ${p}`);
      }
    }
  }
  return {
    id: 2, name: 'ARTIFACTS', verdict: lines.length ? 'FAIL' : 'PASS', lines,
    detail: `${checked} paths checked on built+ records, ${lines.length} missing`,
  };
}

function check3Tests(records) {
  const lines = [];
  const regDir = join(ROOT, '.claude', 'regression');
  let regCorpus = null;
  if (existsSync(regDir)) {
    regCorpus = readdirSync(regDir)
      .filter((f) => f.endsWith('.md'))
      .map((f) => readText(join(regDir, f)) || '')
      .join('\n');
  } else {
    lines.push('WARN .claude/regression/ not found — regressionIds cannot be resolved (format still enforced)');
  }
  let testFiles = 0, regIds = 0;
  for (const r of records) {
    if (!atLeast(r, 'tested')) continue;
    const tests = r.tests || [];
    if (tests.length === 0 && (r.regressionIds || []).length === 0) {
      // Advisory, not gating: the brief only requires LISTED tests to exist.
      // But a tested+ record naming neither tests nor regression pins is
      // verifying nothing — keep that visible until the record lists one.
      lines.push(`WARN ${r.reqId} (${r.status}): tested+ with empty tests[] AND empty regressionIds[] — nothing pins this record`);
    }
    for (const t of tests) {
      const p = normalizePathEntry(t);
      if (!p) continue;
      testFiles++;
      if (!existsSync(join(ROOT, ...p.split('/')))) {
        lines.push(`FAIL ${r.reqId}: test file missing: ${p}`);
      }
    }
    for (const id of r.regressionIds || []) {
      regIds++;
      if (!/^(REG|SG)-\d+/.test(String(id))) {
        lines.push(`FAIL ${r.reqId}: regressionId "${id}" does not match /^(REG|SG)-\\d+/`);
      } else if (regCorpus !== null && !new RegExp(`\\b${id}\\b`).test(regCorpus)) {
        lines.push(`FAIL ${r.reqId}: regressionId "${id}" not found in .claude/regression/ shards`);
      }
    }
  }
  const failed = lines.some((l) => l.startsWith('FAIL'));
  return {
    id: 3, name: 'TESTS', verdict: failed ? 'FAIL' : lines.length ? 'WARN' : 'PASS', lines,
    detail: `${testFiles} test files + ${regIds} regressionIds checked on tested+ records`,
  };
}

function check4ReviewChains(records) {
  const lines = [];
  let checked = 0;
  for (const r of records) {
    if (!atLeast(r, 'verified')) continue;
    checked++;
    const required = r.reviewChain?.required || [];
    const completed = new Set(r.reviewChain?.completed || []);
    const missing = required.filter((rev) => !completed.has(rev));
    if (missing.length) {
      lines.push(`FAIL ${r.reqId} (${r.status}): review chain incomplete — missing: ${missing.join(', ')} (P14)`);
    }
  }
  return {
    id: 4, name: 'REVIEW CHAINS', verdict: lines.length ? 'FAIL' : 'PASS', lines,
    detail: `${checked} verified+ records checked`,
  };
}

function loadFlagMatrix() {
  const flags = new Map();
  const base = readText(join(ROOT, 'scripts', 'feature-flag-matrix.json'));
  if (!base) return null;
  try {
    for (const f of JSON.parse(base).flags || []) flags.set(f.name, f);
  } catch { return null; }
  const overrides = readText(join(ROOT, 'scripts', 'feature-flag-matrix.overrides.json'));
  if (overrides) {
    try {
      for (const f of JSON.parse(overrides).flags || []) flags.set(f.name, f); // override wins
    } catch { /* overrides unreadable → base matrix stands */ }
  }
  return flags;
}

function check5FlagPosture(records) {
  // WARN-ONLY initially (per the Phase T0 brief): the matrix snapshot lags
  // live Supabase, so a mismatch is a signal to investigate, not a gate.
  const lines = [];
  const matrix = loadFlagMatrix();
  if (!matrix) {
    return {
      id: 5, name: 'FLAG POSTURE', verdict: 'WARN',
      lines: ['WARN scripts/feature-flag-matrix.json missing or unreadable — flag posture not verifiable'],
      detail: 'matrix unavailable',
    };
  }
  const EXPECT_ON = new Set(['on', 'enabled', 'true', 'live']);
  const EXPECT_OFF = new Set(['off', 'disabled', 'false', 'shadow', 'dark']);
  let checked = 0;
  for (const r of records) {
    for (const f of r.flags || []) {
      checked++;
      const entry = matrix.get(f.name);
      if (!entry) {
        lines.push(`WARN ${r.reqId}: flag "${f.name}" not found in the feature-flag matrix`);
        continue;
      }
      const want = String(f.requiredState ?? '').toLowerCase();
      const actualOn = entry.productionEnabled === true;
      if (EXPECT_ON.has(want) && !actualOn) {
        lines.push(`WARN ${r.reqId}: flag "${f.name}" requiredState=${f.requiredState} but matrix says production OFF`);
      } else if (EXPECT_OFF.has(want) && actualOn) {
        lines.push(`WARN ${r.reqId}: flag "${f.name}" requiredState=${f.requiredState} but matrix says production ON`);
      } else if (!EXPECT_ON.has(want) && !EXPECT_OFF.has(want)) {
        lines.push(`WARN ${r.reqId}: flag "${f.name}" has unrecognized requiredState "${f.requiredState}" (use on/off/shadow)`);
      }
    }
  }
  return {
    id: 5, name: 'FLAG POSTURE', verdict: lines.length ? 'WARN' : 'PASS', lines,
    detail: `${checked} flag expectations checked, ${lines.length} warnings`,
  };
}

function check6NoDuplicateCode() {
  const lines = [];
  for (const sig of DUP_SIGNATURES) {
    const allow = new Set(sig.allow);
    const hits = new Set();
    for (const abs of codeFiles()) {
      const text = readText(abs);
      if (text && sig.re.test(text)) hits.add(toRel(abs));
    }
    for (const hit of hits) {
      if (!allow.has(hit)) {
        lines.push(`FAIL ${sig.name}: NEW implementation/reference outside KNOWN_LOCATIONS: ${hit} — plan §4 forbids duplicates; extend the canonical module instead`);
      }
    }
    for (const a of allow) {
      if (!hits.has(a)) {
        lines.push(`WARN ${sig.name}: allowlist entry no longer matches (debt paid down?) — remove it: ${a}`);
      }
    }
  }
  const failed = lines.some((l) => l.startsWith('FAIL'));
  return {
    id: 6, name: 'NO-DUPLICATE CODE', verdict: failed ? 'FAIL' : lines.length ? 'WARN' : 'PASS', lines,
    detail: `${DUP_SIGNATURES.length} signatures scanned across ${codeFiles().length} files`,
  };
}

function check7NoDuplicateSchema() {
  const lines = [];
  // (a) New tables after the cutoff.
  const migDir = join(ROOT, 'supabase', 'migrations');
  let scanned = 0;
  if (!existsSync(migDir)) {
    lines.push('FAIL supabase/migrations/ not found — schema check cannot run (failing closed)');
  } else {
    for (const entry of readdirSync(migDir, { withFileTypes: true })) {
      if (!entry.isFile() || !entry.name.endsWith('.sql')) continue;
      const ts = (entry.name.match(/^(\d{14})/) || [])[1];
      if (!ts || ts <= MIGRATION_CUTOFF) continue;
      scanned++;
      let text = readText(join(migDir, entry.name)) || '';
      text = text.replace(/--.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
      const re = /create\s+table(?:\s+if\s+not\s+exists)?\s+(?:"?public"?\.)?"?([a-z0-9_]+)"?/gi;
      let m;
      while ((m = re.exec(text)) !== null) {
        const table = m[1].toLowerCase();
        if (/(mastery|misconception|memory)/i.test(table) && !APPROVED_NEW_TABLES.includes(table)) {
          lines.push(`FAIL ${entry.name}: CREATE TABLE ${table} matches mastery|misconception|memory and is not in APPROVED_NEW_TABLES — plan §4/§3.2-7 requires reusing the canonical store`);
        }
      }
    }
  }
  // (b) Retired-table reference ratchet.
  for (const table of RETIRED_TABLES) {
    const { total, perFile } = countBounded(table);
    const baseline = RETIRED_TABLE_REF_BASELINE[table];
    if (total > baseline) {
      lines.push(`FAIL retired table ${table}: ${total} references > frozen baseline ${baseline} — retired tables gain NO new readers`);
      for (const { file, n } of perFile) lines.push(`      ${n}x ${file}`);
    } else if (total < baseline) {
      lines.push(`WARN ratchet opportunity: ${table} references dropped to ${total} (baseline ${baseline}) — lower RETIRED_TABLE_REF_BASELINE to lock it in`);
    }
  }
  const failed = lines.some((l) => l.startsWith('FAIL'));
  return {
    id: 7, name: 'NO-DUPLICATE SCHEMA', verdict: failed ? 'FAIL' : lines.length ? 'WARN' : 'PASS', lines,
    detail: `${scanned} post-cutoff migrations scanned; retired-table refs vs baseline`,
  };
}

function check8InvariantGuards() {
  const lines = [];
  const usedExceptions = new Set();
  const applyExceptions = (hits, exceptions, label, reason) => {
    for (const hit of hits) {
      if (exceptions.includes(hit)) {
        usedExceptions.add(hit);
      } else {
        lines.push(`FAIL ${label}: ${hit}${reason ? ` — ${reason}` : ''}`);
      }
    }
  };

  // (a) XP_RULES definitions single-source (P2).
  {
    const hits = [];
    const re = /XP_RULES\s*=/;
    for (const abs of codeFiles()) {
      const rel = toRel(abs);
      if (XP_RULES_ALLOWED.includes(rel)) continue;
      const text = readText(abs);
      if (text && re.test(text)) hits.push(rel);
    }
    applyExceptions(hits, [], '8a XP_RULES defined outside xp-config/xp-rules',
      'P2: all XP constants live in packages/lib/src/xp-config.ts');
  }

  // (b) No mastery writes from AI paths (plan §1.3 E6).
  {
    const aiFiles = codeFiles().filter((abs) => {
      const rel = toRel(abs);
      return AI_PATHS.some((p) => rel === p || rel.startsWith(p + '/'));
    });
    const inlineRe = /from\(\s*["']concept_mastery["']\s*\)\s*\.\s*(insert|update|upsert|delete)/;
    const fromRe = /from\(\s*["']concept_mastery["']\s*\)/;
    const writeRe = /\.\s*(insert|update|upsert|delete)\s*\(/;
    for (const abs of aiFiles) {
      const text = readText(abs);
      if (!text) continue;
      let flagged = inlineRe.test(text);
      if (!flagged) {
        // Multiline-tolerant: .from("concept_mastery") followed within 2 lines
        // by a write verb.
        const linesArr = text.split('\n');
        for (let i = 0; i < linesArr.length && !flagged; i++) {
          if (!fromRe.test(linesArr[i])) continue;
          const window = linesArr.slice(i, i + 3).join('\n');
          if (writeRe.test(window)) flagged = true;
        }
      }
      if (flagged) {
        lines.push(`FAIL 8b AI path writes concept_mastery: ${toRel(abs)} — E6: mastery is written ONLY by the atomic SQL chain; AI/foxy paths are read-only`);
      }
    }
  }

  // (c) No XP-to-money conversion path (U11).
  {
    const hits = [];
    const re = /xp[^\n]{0,40}(money|rupee|cash|voucher|redeem)/i;
    for (const abs of codeFiles()) {
      const rel = toRel(abs);
      if (!rel.startsWith('apps/') && !rel.startsWith('packages/')) continue;
      if (!/\.tsx?$/.test(rel)) continue;
      const text = readText(abs);
      if (text && re.test(text)) hits.push(rel);
    }
    applyExceptions(hits, BASELINE_EXCEPTIONS.xpMoney, '8c XP-to-money signature',
      'U11: no monetary XP conversion until safety review');
  }

  // (d) getUserMedia only under voice/scan paths (PR3).
  {
    const hits = [];
    for (const abs of codeFiles()) {
      const rel = toRel(abs);
      if (!rel.startsWith('apps/') && !rel.startsWith('packages/')) continue;
      if (/voice|scan/i.test(rel)) continue;
      const text = readText(abs);
      if (text && /getUserMedia/.test(text)) hits.push(rel);
    }
    applyExceptions(hits, BASELINE_EXCEPTIONS.getUserMedia, '8d getUserMedia outside voice/scan',
      'PR3: no passive camera/mic observation — capture only in explicit voice/scan surfaces');
  }

  // (e) Banned-phrase lint on student-facing source (T1/PR1). The phrase list
  // is derived from the policy module (see parseBannedPhrases above) so the
  // prompt rail and this gate can never drift apart.
  {
    const phrases = parseBannedPhrases();
    if (!phrases || phrases.length === 0) {
      lines.push(`FAIL 8e cannot derive banned-phrase list from ${PROHIBITED_INFERENCES_MODULE} — module missing or no bannedPhrases string literals parsed`);
    } else {
      const hits = [];
      const re = new RegExp(`(${phrases.map(escapeRegex).join('|')})`, 'i');
      for (const abs of codeFiles()) {
        const rel = toRel(abs);
        if (!rel.startsWith('apps/host/src/app/') && !rel.startsWith('packages/ui/')) continue;
        const text = readText(abs);
        if (text && re.test(text)) hits.push(rel);
      }
      applyExceptions(hits, BASELINE_EXCEPTIONS.bannedPhrases, '8e banned phrase in student-facing source',
        `T1: describe evidence, never judge identity (list: ${PROHIBITED_INFERENCES_MODULE})`);
    }
  }

  // Anti-rot: exceptions that no longer match anything should be deleted.
  for (const [group, entries] of Object.entries(BASELINE_EXCEPTIONS)) {
    for (const e of entries) {
      if (!usedExceptions.has(e)) {
        lines.push(`WARN BASELINE_EXCEPTIONS.${group} entry no longer matches — remove it: ${e}`);
      }
    }
  }

  const failed = lines.some((l) => l.startsWith('FAIL'));
  return {
    id: 8, name: 'INVARIANT GUARDS', verdict: failed ? 'FAIL' : lines.length ? 'WARN' : 'PASS', lines,
    detail: `5 sub-checks (XP source, AI mastery writes, XP-to-money, getUserMedia, banned phrases)`,
  };
}

function check9WriterlessWatch(records) {
  const lines = [];
  const byId = new Map(records.map((r) => [r.reqId, r]));
  let applicable = 0;
  for (const [table, reqId] of Object.entries(WRITER_NEEDED)) {
    const record = byId.get(reqId);
    if (!record || !atLeast(record, 'built')) continue; // not yet due
    applicable++;
    const site = findWriteSite(table);
    if (!site) {
      lines.push(`FAIL ${reqId} is ${record.status} but no non-test write site (insert/upsert) found for ${table} — the record claims a writer that does not exist`);
    }
  }
  for (const [table, reqId] of Object.entries(RETIRED_AFTER)) {
    const record = byId.get(reqId);
    if (!record || !atLeast(record, 'built')) continue;
    applicable++;
    const { total, perFile } = countBounded(table);
    if (total > 0) {
      lines.push(`FAIL ${reqId} is ${record.status} but ${total} non-migration references to retired table ${table} remain:`);
      for (const { file, n } of perFile) lines.push(`      ${n}x ${file}`);
    }
  }
  return {
    id: 9, name: 'WRITERLESS WATCH', verdict: lines.length ? 'FAIL' : 'PASS', lines,
    detail: applicable === 0
      ? 'no watched record is built+ yet — check dormant by design'
      : `${applicable} watched condition(s) active`,
  };
}

function check10Staleness(records) {
  const lines = [];
  const now = Date.now();
  const cutoffMs = STALENESS_DAYS * 24 * 60 * 60 * 1000;
  for (const r of records) {
    if (String(r.status).toLowerCase() !== 'in_progress') continue;
    const lv = r.lastVerified ? Date.parse(r.lastVerified) : NaN;
    if (Number.isNaN(lv)) {
      lines.push(`WARN ${r.reqId}: in_progress with no lastVerified date`);
    } else if (now - lv > cutoffMs) {
      lines.push(`WARN ${r.reqId}: in_progress, lastVerified ${r.lastVerified} is older than ${STALENESS_DAYS} days`);
    }
  }
  return {
    id: 10, name: 'STALENESS', verdict: lines.length ? 'WARN' : 'PASS', lines,
    detail: `${lines.length} stale in_progress record(s)`,
  };
}

// ── Main ────────────────────────────────────────────────────────────────────
function main() {
  console.log('=== Foxy North-Star Alignment Report ===');

  if (!existsSync(trackerPath)) {
    console.error('');
    console.error(`ERROR: tracker not found: ${trackerPath}`);
    console.error('');
    console.error('The Foxy North-Star tracker (docs/trackers/foxy-north-star/tracker.json)');
    console.error('is the single source of truth for the 79 requirement records (plan §3.1).');
    console.error('Without it this analyzer cannot verify anything — failing CLOSED rather');
    console.error('than reporting a vacuous pass. If the tracker lives elsewhere, pass');
    console.error('--tracker=<path>.');
    process.exit(1);
  }

  let tracker;
  try {
    tracker = JSON.parse(readFileSync(trackerPath, 'utf8'));
  } catch (err) {
    console.error(`ERROR: tracker is not valid JSON (${trackerPath}): ${err.message}`);
    process.exit(1);
  }
  const records = Array.isArray(tracker.records) ? tracker.records : [];
  console.log(`tracker: ${trackerPath}`);
  console.log(`records: ${records.length} | spec: ${tracker.spec || 'unspecified'} | approved: ${tracker.approvedBy || '?'} ${tracker.approvedOn || ''}`);

  // Vacuity floor on the tree scan itself: a gate that scans zero files is the
  // failure mode this repo has been burned by (see check-bundle-size.mjs).
  if (codeFiles().length < 100) {
    console.error(`ERROR: code scan found only ${codeFiles().length} source files under ${CODE_ROOTS.join(', ')} — the analyzer is not looking at the real tree. Failing closed.`);
    process.exit(1);
  }

  const results = [
    check1Coverage(records),
    check2Artifacts(records),
    check3Tests(records),
    check4ReviewChains(records),
    check5FlagPosture(records),
    check6NoDuplicateCode(),
    check7NoDuplicateSchema(),
    check8InvariantGuards(),
    check9WriterlessWatch(records),
    check10Staleness(records),
  ];

  console.log('');
  console.log(' #   Check               Verdict  Detail');
  console.log(' --  ------------------  -------  ------------------------------------------');
  for (const r of results) {
    console.log(
      ` ${String(r.id).padStart(2)}  ${r.name.padEnd(18)}  ${r.verdict.padEnd(7)}  ${r.detail}`,
    );
  }

  const withLines = results.filter((r) => r.lines.length > 0);
  if (withLines.length) {
    console.log('');
    console.log('--- Details ---');
    for (const r of withLines) {
      console.log(`[check ${r.id} ${r.name}]`);
      for (const l of r.lines) console.log(`  ${l}`);
    }
  }

  const GATING = new Set([1, 2, 3, 4, 6, 7, 8, 9]);
  const gateFailures = results.filter((r) => GATING.has(r.id) && r.verdict === 'FAIL');
  console.log('');
  if (gateFailures.length) {
    console.log(`VERDICT: FAIL — ${gateFailures.length} gating check(s) failed: ${gateFailures.map((r) => `#${r.id} ${r.name}`).join(', ')}`);
    console.log('Gating checks are 1-4 and 6-9. Fix the findings or (for genuine day-one');
    console.log('debt only) extend the documented baseline in scripts/foxy-alignment/analyze.mjs');
    console.log('with a reqId that retires it — never to make a new violation pass.');
    process.exit(1);
  }
  const warned = results.filter((r) => r.verdict === 'WARN').length;
  console.log(`VERDICT: PASS${warned ? ` (${warned} check(s) carry warnings — see details above)` : ''}`);
  process.exit(0);
}

main();
