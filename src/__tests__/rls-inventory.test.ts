import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * RLS INVENTORY assertion (P8) — XC-3 Phase 0c.
 *
 * WHY THIS EXISTS
 * ===============
 * RLS is the platform's schema-level data boundary (P8). The XC-3 audit confirmed
 * the baseline is strong: 270 tables, all 270 with RLS ENABLED, and only TWO that
 * are RLS-on-but-policy-less (deny-all / service-role-only): `mass_gen_log` and
 * `school_subscriptions` (both intentional). This guard FREEZES that posture across
 * the WHOLE effective migration chain so no future migration can:
 *   (a) ship a public table without RLS enabled, or
 *   (b) silently add a new RLS-on-but-ZERO-policy table (which is invisible to every
 *       RLS-scoped client and only reachable via the service-role key — a posture
 *       that must be a deliberate, reviewed choice, never an accident).
 *
 * The `post-edit-check.sh` content hook already nags a single missing-RLS migration;
 * this is the durable, chain-wide static confirmation that there is no drift.
 *
 * SCOPE NOTE (audit "2" vs effective-chain "36")
 * ==============================================
 * The audit's "deny-all is exactly {mass_gen_log, school_subscriptions}" is a
 * property of the 270-table BASELINE — pinned verbatim below. The full EFFECTIVE
 * chain (baseline + root migrations) is larger: ~95 new tables were added and
 * `20260516020000_tighten_rls_policy_always_true.sql` deliberately STRIPPED the
 * `USING (true)` policies off several rag/log tables (converting them to
 * service-role-only). So the effective-chain deny-all set is 36, not 2. Both are
 * pinned: the baseline set proves the audit claim, and the full set is the explicit
 * service-role-only ledger that catches any NEW policy-less table.
 *
 * HOW IT WORKS (static SQL-text — no live Postgres)
 * =================================================
 * Consistent with the sibling pins (`rls-no-cross-table-recursion.test.ts`,
 * `rls-student-id-policies.test.ts`). Scans the root migration chain (baseline +
 * later root `*.sql` in timestamp order; `_legacy/` excluded because Supabase
 * `db push` only applies files at the immediate migrations root), then builds:
 *   • CREATED  = public tables with a CREATE TABLE (DROP TABLE removes);
 *   • RLS      = public tables with effective ENABLE ROW LEVEL SECURITY
 *                (ALTER … ENABLE; ALTER … DISABLE removes);
 *   • POLICIED = public tables with ≥1 surviving CREATE POLICY (DROPs applied).
 * Views / materialized views are never matched (CREATE TABLE only); non-public
 * schemas are excluded.
 *
 * Plan: docs/superpowers/plans/2026-07-02-xc3-systemic-rls-defense-in-depth.md (§5c).
 * Owner: testing (architect reviews exemptions). Catalog: REG-214.
 */

// ── repo / file resolution (cwd or one level up, matching the sibling pins) ──
function resolveRepo(rel: string): string | null {
  for (const c of [resolve(process.cwd(), rel), resolve(process.cwd(), '..', rel)]) {
    if (existsSync(c)) return c;
  }
  return null;
}

const MIGRATIONS_ABS = resolveRepo('supabase/migrations');
const BASELINE_FILE = '00000000000000_baseline_from_prod.sql';

/** Strip `-- …` line comments so only EXECUTABLE SQL is inspected. */
function stripLineComments(sql: string): string {
  return sql
    .replace(/\r/g, '')
    .split('\n')
    .map((line) => line.replace(/--.*$/, ''))
    .join('\n');
}

// CREATE TABLE [IF NOT EXISTS] ["public".]"<t>"  — views/matviews never match.
const CREATE_TABLE_RE =
  /^\s*CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:"?([a-z_][a-z0-9_]*)"?\s*\.\s*)?"?([a-z_][a-z0-9_]*)"?/i;
const DROP_TABLE_RE =
  /^\s*DROP\s+TABLE\s+(?:IF\s+EXISTS\s+)?(?:"?([a-z_][a-z0-9_]*)"?\s*\.\s*)?"?([a-z_][a-z0-9_]*)"?/i;
const ENABLE_RE =
  /^\s*ALTER\s+TABLE\s+(?:ONLY\s+)?(?:"?([a-z_][a-z0-9_]*)"?\s*\.\s*)?"?([a-z_][a-z0-9_]*)"?\s+ENABLE\s+ROW\s+LEVEL\s+SECURITY/i;
const DISABLE_RE =
  /^\s*ALTER\s+TABLE\s+(?:ONLY\s+)?(?:"?([a-z_][a-z0-9_]*)"?\s*\.\s*)?"?([a-z_][a-z0-9_]*)"?\s+DISABLE\s+ROW\s+LEVEL\s+SECURITY/i;
// CREATE POLICY accepts BOTH a "quoted" name (pg_dump baseline) AND an unquoted
// identifier (hand-written root migrations) — both forms appear in this chain.
const CREATE_POLICY_RE =
  /^\s*CREATE\s+POLICY\s+(?:"([^"]+)"|([a-z_][a-z0-9_]*))\s+ON\s+(?:"?([a-z_][a-z0-9_]*)"?\s*\.\s*)?"?([a-z_][a-z0-9_]*)"?/i;
const DROP_POLICY_RE =
  /^\s*DROP\s+POLICY\s+(?:IF\s+EXISTS\s+)?(?:"([^"]+)"|([a-z_][a-z0-9_]*))\s+ON\s+(?:"?([a-z_][a-z0-9_]*)"?\s*\.\s*)?"?([a-z_][a-z0-9_]*)"?/i;

interface Inventory {
  created: Set<string>;
  rls: Set<string>;
  /** "<table>::<policyName>" → final effective policy presence. */
  policyKeys: Set<string>;
}

function publicSchema(captured?: string): boolean {
  return !captured || captured.toLowerCase() === 'public';
}

function parseChain(files: string[]): Inventory {
  const created = new Set<string>();
  const rls = new Set<string>();
  const policyKeys = new Set<string>();
  if (!MIGRATIONS_ABS) return { created, rls, policyKeys };

  for (const file of files) {
    const exec = stripLineComments(readFileSync(resolve(MIGRATIONS_ABS, file), 'utf8'));
    for (const raw of exec.split(';')) {
      const stmt = raw.replace(/\s+/g, ' ').trim();
      if (!stmt) continue;
      let m: RegExpExecArray | null;
      if ((m = CREATE_TABLE_RE.exec(stmt))) {
        if (publicSchema(m[1])) created.add(m[2].toLowerCase());
        continue;
      }
      if ((m = DROP_TABLE_RE.exec(stmt))) {
        if (publicSchema(m[1])) created.delete(m[2].toLowerCase());
        continue;
      }
      if ((m = ENABLE_RE.exec(stmt))) {
        if (publicSchema(m[1])) rls.add(m[2].toLowerCase());
        continue;
      }
      if ((m = DISABLE_RE.exec(stmt))) {
        if (publicSchema(m[1])) rls.delete(m[2].toLowerCase());
        continue;
      }
      if ((m = CREATE_POLICY_RE.exec(stmt))) {
        const name = m[1] !== undefined ? m[1] : m[2];
        if (publicSchema(m[3])) policyKeys.add(`${m[4].toLowerCase()}::${name}`);
        continue;
      }
      if ((m = DROP_POLICY_RE.exec(stmt))) {
        const name = m[1] !== undefined ? m[1] : m[2];
        if (publicSchema(m[3])) policyKeys.delete(`${m[4].toLowerCase()}::${name}`);
      }
    }
  }
  return { created, rls, policyKeys };
}

function denyAll(inv: Inventory): string[] {
  const policied = new Set([...inv.policyKeys].map((k) => k.slice(0, k.indexOf('::'))));
  return [...inv.rls].filter((t) => !policied.has(t)).sort();
}

// Root-only `.sql`, lexicographically sorted == apply order. readdirSync is
// non-recursive so `_legacy/` is naturally excluded (matches `db push`).
const ALL_FILES = MIGRATIONS_ABS
  ? readdirSync(MIGRATIONS_ABS).filter((f) => f.endsWith('.sql')).sort()
  : [];

const CHAIN = parseChain(ALL_FILES);
const BASELINE = parseChain([BASELINE_FILE]);

// ── the two intentional deny-all tables the audit found (BASELINE scope) ──
const AUDIT_DENY_ALL = ['mass_gen_log', 'school_subscriptions'];

// ── the full effective-chain service-role-only (RLS-on, ZERO-policy) ledger ──
// Reviewed set as of 2026-06-30. Beyond the two audit tables these are
// service-role-only by design: agent/AI orchestration (agent_*, principal_ai_*,
// cycles, cycle_evaluations, lessons_learned, tasks, outcome_metrics,
// experiment_observations, phenomena), AlfaBot infra (alfabot_*), event-bus /
// queue / dead-letter substrate (mol_shadow_text_buffer, payment_reconciliation_queue,
// *_number_sequences), forensic/log tables hardened to deny-all by
// 20260516020000_tighten_rls_policy_always_true.sql (rag_query_logs,
// rag_retrieval_logs, rag_content_audit, question_bank_fix_history), and a handful
// of builder/lab/mock tables read only via the service role. Any NEW table that
// lands here without an entry trips the freeze below and must be a reviewed choice.
const SERVICE_ROLE_ONLY_TABLES = [
  'agent_prompts',
  'agent_runs',
  'agent_steps',
  'alfabot_denylist',
  'alfabot_kb_chunks',
  'alfabot_leads',
  'alfabot_messages',
  'alfabot_sessions',
  'contract_number_sequences',
  'cycle_evaluations',
  'cycles',
  'dive_artifacts',
  'exam_papers',
  'experiment_observations',
  'foxy_served_items',
  'invoice_number_sequences',
  'lessons_learned',
  'link_code_otp_challenges',
  'mass_gen_log',
  'mock_test_attempts',
  'mock_test_responses',
  'mol_shadow_text_buffer',
  'monthly_synthesis_runs',
  'outcome_metrics',
  'payment_reconciliation_queue',
  'phenomena',
  'principal_ai_messages',
  'principal_ai_sessions',
  'question_bank_fix_history',
  'rag_content_audit',
  'rag_query_logs',
  'rag_retrieval_logs',
  'school_subscriptions',
  'student_lab_badges',
  'student_lab_streaks',
  'tasks',
].sort();

// ════════════════════════════════════════════════════════════════════════════
// 0. Parser non-vacuity — if the sets are empty/wrong every assertion is hollow.
// ════════════════════════════════════════════════════════════════════════════
describe('RLS inventory: parser non-vacuity', () => {
  it('resolves the migrations root and the baseline file', () => {
    expect(MIGRATIONS_ABS).not.toBeNull();
    expect(existsSync(resolve(MIGRATIONS_ABS!, BASELINE_FILE))).toBe(true);
  });

  it('builds a large CREATED + RLS set from the live chain (not hardcoded)', () => {
    expect(CHAIN.created.size).toBeGreaterThanOrEqual(270);
    expect(CHAIN.rls.size).toBeGreaterThanOrEqual(270);
    expect(CHAIN.policyKeys.size).toBeGreaterThanOrEqual(500);
    // baseline alone is the audited 270/270.
    expect(BASELINE.created.size).toBeGreaterThanOrEqual(270);
    expect(BASELINE.rls.size).toBeGreaterThanOrEqual(270);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// 1. EVERY public table created in the chain has RLS enabled (no un-protected
//    table can be added).
// ════════════════════════════════════════════════════════════════════════════
describe('RLS inventory: every created public table has RLS enabled', () => {
  it('CREATED ⊆ RLS — no public table lacks ENABLE ROW LEVEL SECURITY', () => {
    const missing = [...CHAIN.created].filter((t) => !CHAIN.rls.has(t)).sort();
    expect(
      missing,
      missing.length === 0
        ? ''
        : `P8 — ${missing.length} public table(s) are CREATEd in the migration chain ` +
            `WITHOUT a matching ENABLE ROW LEVEL SECURITY:\n` +
            missing.map((t) => `  • ${t}`).join('\n') +
            `\n\nEvery new table MUST enable RLS (and add policies) in the SAME migration. ` +
            `See post-edit-check.sh and ` +
            `docs/superpowers/plans/2026-07-02-xc3-systemic-rls-defense-in-depth.md (§5c).`,
    ).toEqual([]);
  });

  it('RLS ⊆ CREATED — no ENABLE RLS targets a table not created in the chain', () => {
    // Sanity that the two scans are over the same universe (no typo'd ALTER).
    const orphan = [...CHAIN.rls].filter((t) => !CHAIN.created.has(t)).sort();
    expect(orphan).toEqual([]);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// 2. DENY-ALL (RLS on, ZERO policy = service-role-only) is frozen.
//    Baseline == the two audit tables EXACTLY; full chain == the reviewed ledger.
// ════════════════════════════════════════════════════════════════════════════
describe('RLS inventory: deny-all (service-role-only) set is frozen', () => {
  it('BASELINE deny-all is EXACTLY {mass_gen_log, school_subscriptions} (audit pin)', () => {
    expect(denyAll(BASELINE)).toEqual(AUDIT_DENY_ALL);
  });

  it('the two audit tables remain deny-all in the full effective chain', () => {
    const chainDenyAll = new Set(denyAll(CHAIN));
    for (const t of AUDIT_DENY_ALL) {
      expect(chainDenyAll.has(t), `${t} must stay RLS-on-but-policy-less`).toBe(true);
    }
  });

  it('full-chain deny-all set matches the reviewed service-role-only ledger EXACTLY', () => {
    // Freeze: a NEW RLS-on-but-ZERO-policy table (not in the reviewed ledger) FAILS
    // here, and a table that GAINS policies (left in the ledger) also fails — keeping
    // the ledger an exact, reviewable mirror.
    const actual = denyAll(CHAIN);
    const newUnannounced = actual.filter((t) => !SERVICE_ROLE_ONLY_TABLES.includes(t));
    const noLongerDenyAll = SERVICE_ROLE_ONLY_TABLES.filter((t) => !actual.includes(t));
    expect(
      { newUnannounced, noLongerDenyAll },
      newUnannounced.length === 0 && noLongerDenyAll.length === 0
        ? ''
        : `P8 deny-all drift:\n` +
            (newUnannounced.length
              ? `  NEW RLS-on-but-ZERO-policy table(s) — add explicit policies OR, if ` +
                `service-role-only is intentional, add to SERVICE_ROLE_ONLY_TABLES with ` +
                `review: ${newUnannounced.join(', ')}\n`
              : '') +
            (noLongerDenyAll.length
              ? `  ledger entry(ies) that now HAVE policies — prune from ` +
                `SERVICE_ROLE_ONLY_TABLES: ${noLongerDenyAll.join(', ')}`
              : ''),
    ).toEqual({ newUnannounced: [], noLongerDenyAll: [] });
  });
});
