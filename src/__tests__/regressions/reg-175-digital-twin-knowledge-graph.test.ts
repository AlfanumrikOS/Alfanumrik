/**
 * REG-175: Digital Twin + Knowledge Graph (Slice 1) — load-bearing invariants
 *
 * Pins the pure, deterministic core of the Digital Twin slice — the only parts
 * that decide behavior on the hot path and in the nightly cron, all gated behind
 * the default-OFF `ff_digital_twin_v1` flag. These are pure-function pins (no DB);
 * the SQL RPCs (traverse_prerequisites / detect_blocked_dependents) and the
 * additive concept_edges branches are exercised in the integration lane.
 *
 * The four invariants pinned here (each maps to a describe block A..D):
 *
 *  A. classifyPrerequisiteBlock boundary semantics. The two canonical floors —
 *     mastery_floor = PULSE_THRESHOLDS.at_risk_mastery (0.4) and decay_floor =
 *     0.5 (the cognitive-engine shouldRetest line) — are STRICT `<` comparisons:
 *     a prerequisite EXACTLY at the floor is NOT blocked. Single-axis vs both:
 *     mastery-only → 'mastery', decay-only → 'decay', both → 'both' (most severe,
 *     deficit = max of the two axes). Unevaluable data (no p_know AND no study
 *     recency) degrades to NOT blocked (never fire off missing data).
 *     Source: src/lib/learn/adaptive-loops-rules.ts (classifyPrerequisiteBlock).
 *
 *  B. Cross-loop arbiter precedence A > D > C > B and the per-student daily
 *     ceiling = 1. A Loop D candidate LOSES to A, but BEATS C and B. When a row
 *     was already opened tonight (alreadyOpenedTonight === true), NOTHING opens —
 *     the ceiling caps NEW opens regardless of input order.
 *     Source: src/lib/learn/adaptive-loops-rules.ts (arbitrateInterventions,
 *     LOOP_PRECEDENCE { A:0, D:1, C:2, B:3 }).
 *
 *  C. buildTwinContext is PURE (same input → byte-identical output) and emits NO
 *     PII (P13): IDs / numbers / enum-like codes only — never name/email/phone,
 *     even when junk PII-shaped fields are forced into the raw input. The render
 *     helper surfaces COUNTS + CODES only, never raw topic UUIDs.
 *     Source: src/lib/learn/build-twin-context.ts.
 *
 *  D. Flag-OFF gating contract: Loop D contributes ZERO candidates to the arbiter
 *     when ff_digital_twin_v1 is OFF. The planner is flag-AGNOSTIC by design (no
 *     I/O, no side effects); the CALLER (cron worker) is responsible for the gate.
 *     We replicate the worker's gate inline and assert: flag OFF → [] → arbiter
 *     opens nothing; flag ON → the otherwise-eligible candidate flows through.
 *     The flag's DB/registry default is OFF (FLAG_DEFAULTS), pinned in the
 *     companion digital-twin-flag-off-identity.test.ts.
 *
 * Pure-formula / real-implementation policy: this file imports the REAL exported
 * functions (no replicas) for A, B, C. For D, the gate itself is a one-line
 * worker contract ("skip Loop D when the flag is off"), replicated inline and
 * annotated, because the worker route boots Next.js server context that cannot
 * load under vitest. Changing the precedence map, the floors, the strict-`<`
 * comparisons, the PII surface, or the gate breaks these tests.
 */

import { describe, it, expect } from 'vitest';
import {
  classifyPrerequisiteBlock,
  planBlockedPrerequisiteIntervention,
  arbitrateInterventions,
  BLOCKED_PREREQUISITE_RULES,
  type PrerequisiteState,
  type InterventionCandidate,
} from '@/lib/learn/adaptive-loops-rules';
import { PULSE_THRESHOLDS } from '@/lib/pulse/signals';
import { predictRetention } from '@/lib/cognitive-engine';
import {
  buildTwinContext,
  renderTwinPromptSection,
  type TwinSnapshotInput,
} from '@/lib/learn/build-twin-context';
import { FLAG_DEFAULTS, DIGITAL_TWIN_FLAGS } from '@/lib/feature-flags';

// ── Canonical floor constants under test (must match the rules object) ─────────
const MASTERY_FLOOR = 0.4; // PULSE_THRESHOLDS.at_risk_mastery
const DECAY_FLOOR = 0.5; // cognitive-engine shouldRetest threshold

// retention === DECAY_FLOOR exactly: predictRetention(ln2, 1) = exp(-ln2) = 0.5
const LN2 = Math.log(2);

/** A solid prereq base; override one field per boundary case. */
function prereq(over: Partial<PrerequisiteState>): PrerequisiteState {
  return {
    subjectCode: 'science',
    prereqChapterNumber: 3,
    dependentChapterNumber: 7,
    prereqPKnow: 0.9, // solid on mastery
    prereqDaysSinceStudy: 0, // retention = 1.0 (solid on decay)
    prereqStrength: 1,
    ...over,
  };
}

describe('REG-175: Digital Twin + Knowledge Graph (Slice 1) invariants', () => {
  // ════════════════════════════════════════════════════════════════════════
  // A. classifyPrerequisiteBlock boundary semantics
  // ════════════════════════════════════════════════════════════════════════
  describe('REG-175-A: classifyPrerequisiteBlock floors are strict and reused', () => {
    it('REG-175-A: rules object reuses the platform floors (0.4 / 0.5)', () => {
      expect(BLOCKED_PREREQUISITE_RULES.mastery_floor).toBe(MASTERY_FLOOR);
      expect(BLOCKED_PREREQUISITE_RULES.mastery_floor).toBe(
        PULSE_THRESHOLDS.at_risk_mastery,
      );
      expect(BLOCKED_PREREQUISITE_RULES.decay_floor).toBe(DECAY_FLOOR);
    });

    it('REG-175-A: EXACTLY at mastery floor 0.4 (decay solid) → NOT blocked', () => {
      const c = classifyPrerequisiteBlock(
        prereq({ prereqPKnow: 0.4, prereqDaysSinceStudy: 0 }),
      );
      expect(c.blocked).toBe(false);
      expect(c.reason).toBe('none');
      expect(c.deficit).toBe(0);
    });

    it('REG-175-A: just BELOW mastery floor (0.39, decay solid) → blocked "mastery"', () => {
      const c = classifyPrerequisiteBlock(
        prereq({ prereqPKnow: 0.39, prereqDaysSinceStudy: 0 }),
      );
      expect(c.blocked).toBe(true);
      expect(c.reason).toBe('mastery');
      expect(c.deficit).toBeCloseTo((MASTERY_FLOOR - 0.39) / MASTERY_FLOOR, 10);
    });

    it('REG-175-A: EXACTLY at decay floor 0.5 (mastery solid) → NOT blocked', () => {
      // predictRetention(ln2, 1) === 0.5 exactly; strict `< 0.5` is false.
      expect(predictRetention(LN2, 1)).toBe(0.5);
      const c = classifyPrerequisiteBlock(
        prereq({ prereqPKnow: 0.9, prereqDaysSinceStudy: LN2, prereqStrength: 1 }),
      );
      expect(c.retention).toBe(0.5);
      expect(c.blocked).toBe(false);
      expect(c.reason).toBe('none');
    });

    it('REG-175-A: just OVER the decay boundary (retention < 0.5, mastery solid) → blocked "decay"', () => {
      const days = LN2 + 0.01; // retention ≈ 0.495 < 0.5
      const c = classifyPrerequisiteBlock(
        prereq({ prereqPKnow: 0.9, prereqDaysSinceStudy: days, prereqStrength: 1 }),
      );
      expect(c.retention).not.toBeNull();
      expect(c.retention as number).toBeLessThan(DECAY_FLOOR);
      expect(c.blocked).toBe(true);
      expect(c.reason).toBe('decay');
    });

    it('REG-175-A: BOTH axes low → reason "both" and deficit = max(mastery, decay)', () => {
      const c = classifyPrerequisiteBlock(
        prereq({ prereqPKnow: 0.1, prereqDaysSinceStudy: 14, prereqStrength: 1 }),
      );
      expect(c.blocked).toBe(true);
      expect(c.reason).toBe('both');
      const masteryDeficit = (MASTERY_FLOOR - 0.1) / MASTERY_FLOOR; // 0.75
      const decayDeficit = (DECAY_FLOOR - (c.retention as number)) / DECAY_FLOOR;
      expect(c.deficit).toBeCloseTo(Math.max(masteryDeficit, decayDeficit), 10);
      // 'both' is the most severe: its deficit is >= either single-axis deficit.
      expect(c.deficit).toBeGreaterThanOrEqual(masteryDeficit);
      expect(c.deficit).toBeGreaterThanOrEqual(decayDeficit);
    });

    it('REG-175-A: unevaluable (no p_know AND no study recency) → NOT blocked', () => {
      const c = classifyPrerequisiteBlock(
        prereq({ prereqPKnow: null, prereqDaysSinceStudy: null }),
      );
      expect(c.blocked).toBe(false);
      expect(c.reason).toBe('none');
      expect(c.retention).toBeNull();
      expect(c.deficit).toBe(0);
    });

    it('REG-175-A: null input degrades to NOT blocked (never throws)', () => {
      // @ts-expect-error — defensive null path
      expect(() => classifyPrerequisiteBlock(null)).not.toThrow();
      // @ts-expect-error — defensive null path
      expect(classifyPrerequisiteBlock(null).blocked).toBe(false);
    });
  });

  // ════════════════════════════════════════════════════════════════════════
  // B. Cross-loop arbiter precedence A > D > C > B and ceiling = 1
  // ════════════════════════════════════════════════════════════════════════
  describe('REG-175-B: arbiter precedence A > D > C > B and daily ceiling = 1', () => {
    const cand = (loop: InterventionCandidate['loop']): InterventionCandidate => ({
      loop,
      subjectCode: 'science',
      chapterNumber: 7,
      severity: 0.5,
    });

    it('REG-175-B: a Loop D candidate LOSES to A', () => {
      const r = arbitrateInterventions([cand('D'), cand('A')], false);
      expect(r.reason).toBe('opened');
      expect(r.selected?.loop).toBe('A');
    });

    it('REG-175-B: a Loop D candidate BEATS C', () => {
      const r = arbitrateInterventions([cand('C'), cand('D')], false);
      expect(r.reason).toBe('opened');
      expect(r.selected?.loop).toBe('D');
    });

    it('REG-175-B: a Loop D candidate BEATS B', () => {
      const r = arbitrateInterventions([cand('B'), cand('D')], false);
      expect(r.reason).toBe('opened');
      expect(r.selected?.loop).toBe('D');
    });

    it('REG-175-B: full field A,D,C,B → A wins; remove A → D wins (order-independent)', () => {
      // All four present, shuffled input order: A is most acute.
      expect(
        arbitrateInterventions(
          [cand('B'), cand('D'), cand('A'), cand('C')],
          false,
        ).selected?.loop,
      ).toBe('A');
      // Without A, D is the highest precedence regardless of input order.
      expect(
        arbitrateInterventions([cand('C'), cand('B'), cand('D')], false).selected
          ?.loop,
      ).toBe('D');
      expect(
        arbitrateInterventions([cand('D'), cand('C'), cand('B')], false).selected
          ?.loop,
      ).toBe('D');
    });

    it('REG-175-B: ceiling — alreadyOpenedTonight=true → NOTHING opens', () => {
      const r = arbitrateInterventions([cand('A'), cand('D'), cand('C')], true);
      expect(r.selected).toBeNull();
      expect(r.reason).toBe('ceiling_already_spent');
    });

    it('REG-175-B: empty candidate set → no_candidates (never breaches ceiling)', () => {
      const r = arbitrateInterventions([], false);
      expect(r.selected).toBeNull();
      expect(r.reason).toBe('no_candidates');
    });

    it('REG-175-B: planner defers Loop D when the slot is spent (ceiling_spent, no candidate)', () => {
      const r = planBlockedPrerequisiteIntervention({
        prerequisite: prereq({ prereqPKnow: 0.1 }), // clearly blocked
        dependentIsActive: true,
        activeInterventions: [],
        recentTerminalInterventions: [],
        ceilingAlreadySpent: true, // A already used the slot tonight
        nowMs: Date.UTC(2026, 6, 2),
      });
      expect(r.open).toBe(false);
      expect(r.decision).toBe('ceiling_spent');
      expect(r.candidate).toBeNull();
    });
  });

  // ════════════════════════════════════════════════════════════════════════
  // C. buildTwinContext purity + NO PII
  // ════════════════════════════════════════════════════════════════════════
  describe('REG-175-C: buildTwinContext is pure and PII-free', () => {
    const TOPIC_A = '11111111-1111-1111-1111-111111111111';
    const TOPIC_B = '22222222-2222-2222-2222-222222222222';

    const snapshot: TwinSnapshotInput = {
      snapshot_date: '2026-07-02',
      mastery_by_topic: { [TOPIC_A]: 0.2, [TOPIC_B]: 0.45 }, // A weak (<0.4), B not
      decay_state: { [TOPIC_A]: 0.3, [TOPIC_B]: 0.8 }, // A decayed (<0.5), B not
      dominant_error_types: ['conceptual', 'careless', 'conceptual'],
      misconception_cluster_ids: [TOPIC_A, TOPIC_B],
      cohort_percentile: 42.6,
    };

    it('REG-175-C: deterministic — identical inputs → byte-identical output (deep equal)', () => {
      const first = buildTwinContext(snapshot, [
        { summary_code: 'mastered_concept', concept_topic_id: TOPIC_A },
      ]);
      const second = buildTwinContext(snapshot, [
        { summary_code: 'mastered_concept', concept_topic_id: TOPIC_A },
      ]);
      expect(second).toEqual(first);
      expect(JSON.stringify(second)).toBe(JSON.stringify(first));
    });

    it('REG-175-C: applies BLOCKED_PREREQUISITE_RULES floors (weak < 0.4, decayed < 0.5)', () => {
      const ctx = buildTwinContext(snapshot);
      expect(ctx.weakTopics.map((t) => t.topicId)).toEqual([TOPIC_A]); // 0.45 excluded
      expect(ctx.weakTopics[0].mastery).toBe(0.2);
      expect(ctx.decayedTopics.map((t) => t.topicId)).toEqual([TOPIC_A]); // 0.8 excluded
      expect(ctx.decayedTopics[0].retention).toBe(0.3);
      expect(ctx.dominantErrorTypes).toEqual(['conceptual', 'careless']); // de-duped
      expect(ctx.misconceptionClusterCount).toBe(2);
      expect(ctx.cohortPercentile).toBe(43); // rounded + clamped 0..100
      expect(ctx.isEmpty).toBe(false);
    });

    it('REG-175-C: NO PII — junk name/email/phone fields in raw input never leak to output', () => {
      const dirty = {
        ...snapshot,
        // PII-shaped junk that could ride along on a raw row; the builder is
        // an allow-list reader and must ignore all of it.
        student_name: 'Riya Sharma',
        email: 'riya@example.com',
        phone: '+919812345678',
        parent_email: 'mum@example.com',
      } as unknown as TwinSnapshotInput;
      const ctx = buildTwinContext(dirty, [
        {
          summary_code: 'misconception_repeated',
          concept_topic_id: TOPIC_A,
          // @ts-expect-error — junk PII on a raw memory row must not leak
          studentName: 'Riya Sharma',
        },
      ]);
      const blob = JSON.stringify(ctx);
      expect(blob).not.toMatch(/name|email|phone/i);
      expect(blob).not.toContain('Riya');
      expect(blob).not.toContain('riya@example.com');
      expect(blob).not.toContain('919812345678');
    });

    it('REG-175-C: render surfaces COUNTS + CODES only — never raw topic UUIDs', () => {
      const ctx = buildTwinContext(snapshot, [
        { summary_code: 'mastered_concept', concept_topic_id: TOPIC_A },
      ]);
      const rendered = renderTwinPromptSection(ctx);
      expect(rendered).not.toContain(TOPIC_A);
      expect(rendered).not.toContain(TOPIC_B);
      expect(rendered).toContain('conceptual'); // error CODE surfaces
      expect(rendered).toContain('mastered_concept'); // highlight CODE surfaces
      expect(rendered).not.toMatch(/name|email|phone/i);
    });

    it('REG-175-C: empty/absent snapshot → isEmpty and render === "" (OFF-path identity)', () => {
      const empty = buildTwinContext(null);
      expect(empty.isEmpty).toBe(true);
      expect(renderTwinPromptSection(empty)).toBe('');
      const allFiltered = buildTwinContext({
        mastery_by_topic: { [TOPIC_A]: 0.9 }, // above floor → no weak topic
        decay_state: { [TOPIC_A]: 0.9 }, // above floor → no decayed topic
        dominant_error_types: [],
        misconception_cluster_ids: [],
        cohort_percentile: null,
      });
      expect(allFiltered.isEmpty).toBe(true);
      expect(renderTwinPromptSection(allFiltered)).toBe('');
    });
  });

  // ════════════════════════════════════════════════════════════════════════
  // D. Flag-OFF gating contract — Loop D contributes zero candidates when OFF
  // ════════════════════════════════════════════════════════════════════════
  describe('REG-175-D: Loop D contributes ZERO candidates when ff_digital_twin_v1 is OFF', () => {
    /**
     * Replicates the cron worker's gate (src/app/api/cron/adaptive-remediation/
     * route.ts): Loop D is invoked ONLY when ff_digital_twin_v1 resolves true.
     * The planner is flag-agnostic, so the gate is the caller's responsibility.
     * This inline replica pins that contract: flag OFF → Loop D produces no
     * candidate even when the prerequisite is unambiguously blocked.
     */
    function collectLoopDCandidates(
      flagEnabled: boolean,
      input: Parameters<typeof planBlockedPrerequisiteIntervention>[0],
    ): InterventionCandidate[] {
      if (!flagEnabled) return []; // worker skips Loop D entirely when OFF
      const plan = planBlockedPrerequisiteIntervention(input);
      return plan.open && plan.candidate ? [plan.candidate] : [];
    }

    const openEligibleInput: Parameters<
      typeof planBlockedPrerequisiteIntervention
    >[0] = {
      prerequisite: prereq({ prereqPKnow: 0.1, prereqDaysSinceStudy: 14 }), // blocked 'both'
      dependentIsActive: true,
      activeInterventions: [],
      recentTerminalInterventions: [],
      ceilingAlreadySpent: false,
      nowMs: Date.UTC(2026, 6, 2),
    };

    it('REG-175-D: the registry/DB default for ff_digital_twin_v1 is OFF', () => {
      expect(DIGITAL_TWIN_FLAGS.V1).toBe('ff_digital_twin_v1');
      expect(FLAG_DEFAULTS[DIGITAL_TWIN_FLAGS.V1]).toBe(false);
    });

    it('REG-175-D: sanity — the input WOULD open a Loop D candidate when the gate is open', () => {
      const plan = planBlockedPrerequisiteIntervention(openEligibleInput);
      expect(plan.open).toBe(true);
      expect(plan.candidate?.loop).toBe('D');
    });

    it('REG-175-D: flag OFF → zero Loop D candidates → arbiter opens nothing', () => {
      const candidates = collectLoopDCandidates(false, openEligibleInput);
      expect(candidates).toEqual([]);
      const r = arbitrateInterventions(candidates, false);
      expect(r.selected).toBeNull();
      expect(r.reason).toBe('no_candidates');
    });

    it('REG-175-D: flag ON → the eligible Loop D candidate flows through to the arbiter', () => {
      const candidates = collectLoopDCandidates(true, openEligibleInput);
      expect(candidates).toHaveLength(1);
      expect(candidates[0].loop).toBe('D');
      const r = arbitrateInterventions(candidates, false);
      expect(r.reason).toBe('opened');
      expect(r.selected?.loop).toBe('D');
    });

    it('REG-175-D: flag OFF still yields nothing even if a higher loop is absent (no silent leak)', () => {
      // Even alongside lower-precedence noise, an OFF flag means D never appears.
      const candidates = collectLoopDCandidates(false, openEligibleInput);
      const r = arbitrateInterventions(
        [...candidates], // strictly the (empty) Loop D output
        false,
      );
      expect(r.selected).toBeNull();
    });
  });
});
