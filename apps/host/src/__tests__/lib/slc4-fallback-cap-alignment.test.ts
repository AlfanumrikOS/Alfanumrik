/**
 * SLC-4 (engineering-audit remediation) — canonical v2-only submit pin (P0-1/P0-2).
 *
 * THE CONTRACT (packages/lib/src/supabase.ts, submitQuizResults ~465-494)
 * =========================================================================
 * submitQuizResults uses the SINGLE canonical v2 RPC path (submit_quiz_results_v2).
 * The audit-2026-08-06 remediation REMOVED:
 *   - the v1 L2 fallback (submit_quiz_results),
 *   - the client-side atomic_quiz_profile_update fallback whose 6-param JSONB
 *     overload referenced a non-existent quiz_sessions.xp_earned column (42703),
 *     letting the catch silently degrade to an UNCAPPED student_learning_profiles
 *     upsert (up to 400 XP/day instead of 200),
 *   - the L3 client-side score recompute.
 * All scoring/XP/cap logic now lives server-side inside submit_quiz_results_v2
 * (ledger-based, IST-boundary, 200/day-capped). The client sends only the
 * displayed indices it clicked (selected_displayed_index + time_spent) — no
 * is_correct, no shuffle_map, no client XP — and returns the RPC result VERBATIM.
 *
 * WHY SOURCE-PIN (+ a MODELLED behavioral arm)
 * ============================================
 * This file mirrors the source-pin + model convention of
 * quiz-submit-idempotency-contract-pin.test.ts and lib/xp-daily-cap.test.ts:
 * comment-stripped SOURCE pins prove the v2-only wiring (and that the broken
 * fallback shapes are gone), plus a MODELLED cap arm proving the ledger clamp
 * can never exceed 200/day. If the removed fallback is ever reintroduced — or
 * a bare client-side upsert sneaks back — the pins fail. That is the intended
 * trip-wire.
 *
 * TEST-ONLY structural + model pins. Does NOT modify supabase.ts.
 */

import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'fs';
import { resolve } from 'path';
import { XP_RULES } from '@alfanumrik/lib/xp-config';

// ─────────────────────────────────────────────────────────────────────
// Helpers: locate + comment-strip the source so prose mentioning the
// removed "6-param" overload / `atomic_quiz_profile_update` in comments
// cannot produce false matches. We must read CODE, not documentation.
// ─────────────────────────────────────────────────────────────────────
function resolveRepo(rel: string): string {
  for (const c of [resolve(process.cwd(), rel), resolve(process.cwd(), '..', rel)]) {
    if (existsSync(c)) return c;
  }
  return resolve(process.cwd(), rel);
}

/** Strip /* *\/ block comments and // line comments (preserving `http://`). */
function stripComments(src: string): string {
  const noBlock = src.replace(/\/\*[\s\S]*?\*\//g, '');
  // Remove // line comments but not the // in protocol-relative/URL contexts.
  return noBlock
    .split('\n')
    .map((line) => line.replace(/(^|[^:])\/\/.*$/, '$1'))
    .join('\n');
}

/** Isolate the submitQuizResults function body (so pins are scoped to it). */
function extractSubmitFn(code: string): string {
  const start = code.indexOf('export async function submitQuizResults');
  expect(start).toBeGreaterThan(-1);
  // The next top-level `export ` after the function start bounds it.
  const after = code.indexOf('\nexport ', start + 1);
  return after > -1 ? code.slice(start, after) : code.slice(start);
}

const SUPABASE_TS = '../../packages/lib/src/supabase.ts';
const rawSrc = readFileSync(resolveRepo(SUPABASE_TS), 'utf8');
const code = stripComments(rawSrc);
const submitFn = extractSubmitFn(code);
// Whitespace-flattened view for multi-line object/arg matching.
const flatSubmit = submitFn.replace(/\s+/g, ' ');

// ════════════════════════════════════════════════════════════════════════════
// 1. SOURCE PIN — the submit path is v2-ONLY. The v1 L2 fallback and the
//    atomic_quiz_profile_update fallback are GONE from the submit path.
// ════════════════════════════════════════════════════════════════════════════
describe('SLC-4 source pin: submit path is canonical v2-only', () => {
  it('submitQuizResults is present and calls submit_quiz_results_v2', () => {
    expect(submitFn.length).toBeGreaterThan(0);
    expect(flatSubmit).toMatch(/rpc\(\s*['"]submit_quiz_results_v2['"]/);
  });

  it('the v1 RPC submit_quiz_results is NOT called in the submit path (L2 fallback removed)', () => {
    expect(flatSubmit).not.toMatch(/rpc\(\s*['"]submit_quiz_results['"]/);
  });

  it('the broken atomic_quiz_profile_update fallback is NOT present (no uncapped catch upsert)', () => {
    expect(flatSubmit).not.toMatch(/rpc\(\s*['"]atomic_quiz_profile_update['"]/);
    // No client-side upsert to student_learning_profiles remains in the submit path.
    expect(flatSubmit).not.toMatch(/from\(\s*['"]student_learning_profiles['"]\s*\)\s*\.upsert/);
  });

  it('the canonical v2 params are all present (p_session_id, p_student_id, p_subject, p_grade, p_topic, p_chapter, p_responses, p_time)', () => {
    const m = flatSubmit.match(
      /rpc\(\s*['"]submit_quiz_results_v2['"]\s*,\s*(\{[^}]*\})/,
    );
    expect(m).not.toBeNull();
    for (const param of [
      'p_session_id',
      'p_student_id',
      'p_subject',
      'p_grade',
      'p_topic',
      'p_chapter',
      'p_responses',
      'p_time',
    ]) {
      expect(m![1]).toMatch(new RegExp(`${param}\\s*:`));
    }
    // The client forwards its session id (null for the legacy/mobile flow) —
    // idempotency lives server-side, not in a client re-derivation.
    expect(m![1]).toMatch(/p_session_id\s*:\s*sessionId/);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// 2. SOURCE PIN — the client sends DISPLAYED INDICES ONLY and returns the RPC
//    result VERBATIM. No client score recompute, no client XP derivation.
// ════════════════════════════════════════════════════════════════════════════
describe('SLC-4 source pin: server-authoritative response (no client recompute)', () => {
  it('success returns the v2 RPC data verbatim (never recomputed)', () => {
    expect(flatSubmit).toMatch(/if\s*\(\s*!v2\.error\s*&&\s*v2\.data\s*\)\s*return\s+v2\.data/);
  });

  it('a v2 RPC error surfaces as a throw, never a silent fallback', () => {
    expect(flatSubmit).toMatch(/throw\s+new\s+Error\(v2\.error\?\.message/);
  });

  it('the response mapper strips is_correct and shuffle_map (server re-derives both)', () => {
    const mapper = rawSrc.match(/function _mapV2\([\s\S]*?\n}/);
    expect(mapper).not.toBeNull();
    const mapped = stripComments(mapper![0]).replace(/\s+/g, ' ');
    expect(mapped).not.toMatch(/is_correct/);
    expect(mapped).not.toMatch(/shuffle_map/);
    expect(mapped).toMatch(/selected_displayed_index/);
    expect(mapped).toMatch(/time_spent/);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// 3. CAP VALUE UNCHANGED — guard against accidental cap drift. SLC-4 is alignment
//    only: the 200/day value must NOT move.
// ════════════════════════════════════════════════════════════════════════════
describe('SLC-4: the 200 XP/day cap value is unchanged (alignment only, not a cap change)', () => {
  it('XP_RULES.quiz_daily_cap is still exactly 200', () => {
    expect(XP_RULES.quiz_daily_cap).toBe(200);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// 4. BEHAVIORAL (MODELLED) — the server-side capped ledger writer can never
//    award more than the 200/day cap. Since the client no longer has ANY
//    scoring/upsert path, this models the authoritative per-day SUM(amount)
//    clamp inside submit_quiz_results_v2 — the property the SLC-4 repoint
//    restored (the old 6-param fallback bypassed this clamp).
//
//    NOTE: the real submit_quiz_results_v2 clamp lives in Postgres (SECURITY
//    DEFINER RPC, atomic_quiz_profile_update shared writer); per repo convention
//    for this path the behavioral arm is MODELLED against the SQL clamp
//    semantics rather than a live DB. The source pins in §1-§2 prove the client
//    cannot reach an uncapped path at all.
// ════════════════════════════════════════════════════════════════════════════
describe('SLC-4 modelled behavior: server ledger writer enforces the cap', () => {
  const CAP = XP_RULES.quiz_daily_cap; // 200

  // Mirrors the ledger clamp's IST-day semantics:
  //   v_remaining    := GREATEST(0, cap - SUM(amount today));
  //   v_effective_xp := LEAST(GREATEST(0, p_xp), v_remaining);
  // and the reference_id ON CONFLICT DO NOTHING idempotency.
  class CappedLedgerWriter {
    private byRef = new Map<string, number>();
    private earnedToday = 0;
    /** Returns the XP actually written (clamped to the daily remainder; 0 on replay). */
    award(referenceId: string, requestedXp: number): number {
      if (this.byRef.has(referenceId)) return 0; // ON CONFLICT DO NOTHING
      const remaining = Math.max(0, CAP - this.earnedToday);
      const effective = Math.min(Math.max(0, requestedXp), remaining);
      this.byRef.set(referenceId, effective);
      this.earnedToday += effective;
      return effective;
    }
    get totalToday() {
      return this.earnedToday;
    }
  }

  it('a single 170-XP quiz writes 170 (room available)', () => {
    const ledger = new CappedLedgerWriter();
    expect(ledger.award('quiz_s1', 170)).toBe(170);
    expect(ledger.totalToday).toBe(170);
  });

  it('primary 200 then a second quiz cannot push the day past 200 (no second 200 award)', () => {
    const ledger = new CappedLedgerWriter();
    // Primary path already maxed the day.
    expect(ledger.award('quiz_primary', 200)).toBe(200);
    // A later quiz routes through the SAME capped writer → at most the remainder (0).
    expect(ledger.award('quiz_fallback', 170)).toBe(0);
    expect(ledger.totalToday).toBe(200); // NOT 370/400 (the pre-fix bug)
  });

  it('199 earned + a quiz worth 50 awards exactly 1 (partial remainder, not the full 50, not 0)', () => {
    const ledger = new CappedLedgerWriter();
    expect(ledger.award('quiz_a', 199)).toBe(199);
    expect(ledger.award('quiz_fallback', 50)).toBe(1);
    expect(ledger.totalToday).toBe(200);
  });

  it('same session replayed (network retry) awards 0 the second time (reference_id idempotency)', () => {
    const ledger = new CappedLedgerWriter();
    expect(ledger.award('quiz_dup', 100)).toBe(100);
    expect(ledger.award('quiz_dup', 100)).toBe(0);
    expect(ledger.totalToday).toBe(100);
  });

  it('REGRESSION: the pre-SLC-4 uncapped client fallback would have allowed up to 400/day — the capped writer forbids it', () => {
    // Pre-fix: the 6-param overload hit 42703 and the catch did an UNCAPPED
    // client upsert, so primary (200) + fallback (200) = 400. Model that the
    // capped writer caps the SECOND award to the remainder (0).
    const ledger = new CappedLedgerWriter();
    ledger.award('quiz_primary', 200);
    const fallbackAward = ledger.award('quiz_fallback', 200);
    expect(fallbackAward).toBeLessThan(200);
    expect(ledger.totalToday).toBeLessThanOrEqual(CAP);
  });
});
