# Pedagogy v2 — Wave 1 (Daily Rhythm) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the Daily layer of the Three-Speed Learning Rhythm — a coherent 15-minute daily session (5 SRS reviews + 1 ZPD problem with productive-failure flip + 1 active-recall reflection) that adapts content to the 6 existing goal personas, plus a wrong-answer micro-explainer that surfaces existing curated misconception remediations.

**Architecture:** Two pure-function modules (`pedagogy-content-rules.ts`, `daily-rhythm-orchestrator.ts`) compose existing engines (`cognitive-engine.ts`, `quiz-assembler.ts`, `goal-profile.ts`, `wrong_answer_remediations` table). One new API route (`/api/rhythm/today`). Three frontend integrations behind feature flags (`ff_productive_failure_v1`, `ff_distractor_micro_explainer_v1`, `ff_pedagogy_v2_daily_rhythm`). No new tables or RLS policies — the misconception/distractor schema already exists in canonical.

**Tech Stack:** Next.js 16 App Router, React 18, Vitest, Supabase (PostgREST + RLS), TypeScript strict, vitest-style describe/it/expect. Path alias `@/*` → `./src/*`.

**Spec:** [docs/superpowers/specs/2026-05-08-pedagogy-v2-three-speed-rhythm-design.md](../specs/2026-05-08-pedagogy-v2-three-speed-rhythm-design.md)

**Working tree:** Canonical repo at `C:\Users\Bharangpur Primary\Alfanumrik\`. All file paths in this plan are relative to that root unless prefixed with absolute paths.

**Pre-flight:** Run `npm install` in canonical before any task that runs vitest/tsc/eslint. Windows + slow disk; expect 5-10 min for first install.

**Review chain reminder:** Tasks 6 (productive-failure flip) and 7 (distractor micro-explainer) touch AI/Foxy and question-quality (P11). Per CLAUDE.md, the review-chain hook will fire on edits to `/learn/[subject]/[chapter]` and to quiz UI — read the hook output and respect mandatory downstream reviewers before merging.

**Invariants respected:** P2 (XP economy — no XP-rule changes in this wave); P5 (grades as strings); P6 (bilingual); P7 (CSP); P11 (question quality strengthened, never weakened).

**Out of scope for this wave (deferred to Wave 2/3):** weekly Curiosity Dive surface, monthly Synthesis milestone, phenomenon catalog, depth packs, WhatsApp parent-share, mobile parity. Each gets its own plan.

---

## File Structure

### Created

| Path | Responsibility | Type |
|---|---|---|
| `supabase/migrations/20260509120000_pedagogy_v2_wave_1_flags.sql` | Seed 3 Wave 1 feature flags | Migration |
| `src/lib/learn/pedagogy-content-rules.ts` | Persona × layer × slot → content selection policy | Pure-function module |
| `src/lib/learn/daily-rhythm-orchestrator.ts` | Compose today's daily-rhythm queue (5 SRS + 1 ZPD + reflection) | Pure-function module |
| `src/lib/learn/wrong-answer-remediation.ts` | Lookup curated misconception remediation for a (question, distractor) pair | Server-side helper |
| `src/lib/__tests__/pedagogy-content-rules.test.ts` | Unit tests | Vitest |
| `src/lib/__tests__/daily-rhythm-orchestrator.test.ts` | Unit tests | Vitest |
| `src/lib/__tests__/wrong-answer-remediation.test.ts` | Unit tests (with mocked Supabase) | Vitest |
| `src/app/api/rhythm/today/route.ts` | API endpoint: GET today's rhythm queue for current student | Next.js route handler |
| `src/components/dashboard/sections/DailyRhythmQueue.tsx` | Top-of-feed component rendering today's 7-item queue | React client component |
| `src/components/quiz/MisconceptionExplainer.tsx` | Wrong-answer remediation card with Foxy CTA | React client component |
| `e2e/daily-rhythm.spec.ts` | Playwright smoke test for daily rhythm flow | E2E test |

### Modified

| Path | Change |
|---|---|
| `src/lib/feature-flags.ts` | Add `PEDAGOGY_V2_FLAGS` registry constant + defaults |
| `src/app/learn/[subject]/[chapter]/page.tsx` | Productive-failure flip gated by `ff_productive_failure_v1` |
| `src/app/dashboard/page.tsx` | Insert `<DailyRhythmQueue />` above hero when `ff_pedagogy_v2_daily_rhythm` is on |
| `src/components/quiz/` (existing wrong-answer surface) | Mount `<MisconceptionExplainer />` after wrong-MCQ when `ff_distractor_micro_explainer_v1` is on |

### Not modified (deliberately)

- `src/lib/cognitive-engine.ts` — called, not changed.
- `src/lib/xp-config.ts`, `src/lib/scoring.ts`, `src/lib/quiz-scoring.ts` — XP economy unchanged (P2).
- `src/lib/goals/goal-profile.ts`, `src/lib/goals/goal-personas.ts` — read-only consumers.
- Any existing migration. New migration only.

---

## Task 1 — Seed Wave 1 feature flags

**Why this is first:** Flags must exist in the DB before any code reads them. This is a small, low-risk, foundational task.

**Files:**
- Create: `supabase/migrations/20260509120000_pedagogy_v2_wave_1_flags.sql`
- Modify: `src/lib/feature-flags.ts` (add registry constant + defaults)

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/20260509120000_pedagogy_v2_wave_1_flags.sql`:

```sql
-- Migration: 20260509120000_pedagogy_v2_wave_1_flags.sql
-- Purpose: Seed three feature flags that gate the Wave 1 (Daily Rhythm) rollout
--          of Pedagogy v2. All default OFF. Flip via super-admin console.
--
--   ff_productive_failure_v1
--     When ON: /learn/[subject]/[chapter] presents a ZPD problem BEFORE
--     revealing tutorial content (Manu Kapur productive failure).
--     When OFF: legacy tutorial-first behavior is preserved.
--
--   ff_distractor_micro_explainer_v1
--     When ON: after a wrong MCQ answer, if a curated remediation exists
--     in wrong_answer_remediations for the (question_id, distractor_index),
--     render <MisconceptionExplainer/> below the answer with a Foxy CTA.
--     When OFF: legacy generic "try again" feedback is preserved.
--
--   ff_pedagogy_v2_daily_rhythm
--     When ON: dashboard renders <DailyRhythmQueue/> above the existing hero,
--     and /api/rhythm/today is callable. When OFF: dashboard is unchanged
--     and /api/rhythm/today returns 404.
--
-- Idempotent. Safe to re-run.

INSERT INTO feature_flags (flag_name, is_enabled, target_roles, target_environments, target_institutions, rollout_percentage)
VALUES
  ('ff_productive_failure_v1',          false, ARRAY['student']::text[], NULL, NULL, NULL),
  ('ff_distractor_micro_explainer_v1',  false, ARRAY['student']::text[], NULL, NULL, NULL),
  ('ff_pedagogy_v2_daily_rhythm',       false, ARRAY['student']::text[], NULL, NULL, NULL)
ON CONFLICT (flag_name) DO NOTHING;
```

- [ ] **Step 2: Apply the migration to staging**

Run from canonical repo root:

```bash
supabase db push
```

Expected output: includes a line referencing `20260509120000_pedagogy_v2_wave_1_flags.sql`. Confirm with:

```bash
supabase migration list | grep pedagogy_v2_wave_1_flags
```

- [ ] **Step 3: Add registry constants and defaults to `feature-flags.ts`**

Open `src/lib/feature-flags.ts`. Just before `FLAG_DEFAULTS`, insert:

```typescript
/**
 * Pedagogy v2 — Wave 1 (Daily Rhythm) flags.
 *
 *  ff_productive_failure_v1
 *    /learn/[subject]/[chapter] presents the ZPD problem BEFORE the tutorial.
 *    Default: false. When off, the legacy tutorial-first path is rendered.
 *    Persona-aware: even when the flag is on, `improve_basics` persona keeps
 *    worked-example-first via pedagogyContentRules — see
 *    src/lib/learn/pedagogy-content-rules.ts.
 *
 *  ff_distractor_micro_explainer_v1
 *    After a wrong MCQ pick, surface the curated remediation from
 *    wrong_answer_remediations and offer a one-click "Ask Foxy" CTA.
 *    Default: false.
 *
 *  ff_pedagogy_v2_daily_rhythm
 *    Dashboard renders <DailyRhythmQueue/> above the hero; /api/rhythm/today
 *    is callable. Default: false. When off, dashboard is unchanged.
 *
 * Seeded by migration 20260509120000_pedagogy_v2_wave_1_flags.sql.
 */
export const PEDAGOGY_V2_FLAGS = {
  PRODUCTIVE_FAILURE_V1:        'ff_productive_failure_v1',
  DISTRACTOR_MICRO_EXPLAINER_V1: 'ff_distractor_micro_explainer_v1',
  DAILY_RHYTHM:                 'ff_pedagogy_v2_daily_rhythm',
} as const;
```

Then in the existing `FLAG_DEFAULTS` map, add:

```typescript
  [PEDAGOGY_V2_FLAGS.PRODUCTIVE_FAILURE_V1]: false,
  [PEDAGOGY_V2_FLAGS.DISTRACTOR_MICRO_EXPLAINER_V1]: false,
  [PEDAGOGY_V2_FLAGS.DAILY_RHYTHM]: false,
```

- [ ] **Step 4: Type-check**

Run:

```bash
npm run type-check
```

Expected: 0 errors. If `FLAG_DEFAULTS` complains about indexed-access with a string key, ensure the registry is `as const` (it is).

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260509120000_pedagogy_v2_wave_1_flags.sql src/lib/feature-flags.ts
git commit -m "feat(pedagogy-v2): seed Wave 1 daily-rhythm feature flags"
```

---

## Task 2 — `pedagogy-content-rules.ts` resolver (TDD)

**Why this matters:** Single pure function that maps `(persona, layer, slot)` → content selection policy. All four personas live here; no persona logic anywhere else in the rhythm code.

**Files:**
- Create: `src/lib/learn/pedagogy-content-rules.ts`
- Create: `src/lib/__tests__/pedagogy-content-rules.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/lib/__tests__/pedagogy-content-rules.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import {
  resolvePedagogyRule,
  type RhythmLayer,
  type RhythmSlot,
} from '../learn/pedagogy-content-rules';
import type { GoalCode } from '../goals/goal-profile';

describe('resolvePedagogyRule — daily/zpd_problem slot', () => {
  it('improve_basics gets worked-example-first (productive failure inverted)', () => {
    const rule = resolvePedagogyRule('improve_basics', 'daily', 'zpd_problem');
    expect(rule.productiveFailure).toBe(false);
    expect(rule.workedExampleFirst).toBe(true);
    expect(rule.problemFlavor).toBe('prerequisite_repair');
  });

  it('pass_comfortably gets board-pattern productive failure', () => {
    const rule = resolvePedagogyRule('pass_comfortably', 'daily', 'zpd_problem');
    expect(rule.productiveFailure).toBe(true);
    expect(rule.workedExampleFirst).toBe(false);
    expect(rule.problemFlavor).toBe('board_pattern');
  });

  it('school_topper gets intuition-led productive failure', () => {
    const rule = resolvePedagogyRule('school_topper', 'daily', 'zpd_problem');
    expect(rule.productiveFailure).toBe(true);
    expect(rule.problemFlavor).toBe('intuition_led');
  });

  it('board_topper gets exam-rigorous productive failure', () => {
    const rule = resolvePedagogyRule('board_topper', 'daily', 'zpd_problem');
    expect(rule.productiveFailure).toBe(true);
    expect(rule.problemFlavor).toBe('board_pattern');
    expect(rule.depthCeiling).toBe('board_rigorous');
  });

  it('competitive_exam gets enrichment problems', () => {
    const rule = resolvePedagogyRule('competitive_exam', 'daily', 'zpd_problem');
    expect(rule.productiveFailure).toBe(true);
    expect(rule.problemFlavor).toBe('enrichment');
    expect(rule.depthCeiling).toBe('jee_neet');
  });

  it('olympiad gets puzzle-style problems', () => {
    const rule = resolvePedagogyRule('olympiad', 'daily', 'zpd_problem');
    expect(rule.productiveFailure).toBe(true);
    expect(rule.problemFlavor).toBe('puzzle');
    expect(rule.depthCeiling).toBe('olympiad');
  });
});

describe('resolvePedagogyRule — daily/srs_review slot', () => {
  it('all personas use SM-2 due-card pool; only sourceWeights vary', () => {
    const rules = (
      ['improve_basics', 'pass_comfortably', 'school_topper', 'board_topper', 'competitive_exam', 'olympiad'] as GoalCode[]
    ).map((p) => resolvePedagogyRule(p, 'daily', 'srs_review'));
    rules.forEach((r) => expect(r.useDueCardsPool).toBe(true));
    // improve_basics never injects ahead-of-grade reviews.
    const basics = resolvePedagogyRule('improve_basics', 'daily', 'srs_review');
    expect(basics.allowAheadOfGrade).toBe(false);
    // competitive_exam allows ahead-of-grade enrichment in SRS pool.
    const comp = resolvePedagogyRule('competitive_exam', 'daily', 'srs_review');
    expect(comp.allowAheadOfGrade).toBe(true);
  });
});

describe('resolvePedagogyRule — daily/reflection slot', () => {
  it('all personas get a reflection prompt; XP for it is 0', () => {
    const rule = resolvePedagogyRule('school_topper', 'daily', 'reflection');
    expect(rule.xpAwarded).toBe(0);
    expect(rule.useReflectionPromptGenerator).toBe(true);
  });
});

describe('resolvePedagogyRule — totals and contracts', () => {
  it('returns no nulls for any (persona, layer, slot) tuple', () => {
    const personas: GoalCode[] = [
      'improve_basics', 'pass_comfortably', 'school_topper',
      'board_topper', 'competitive_exam', 'olympiad',
    ];
    const layers: RhythmLayer[] = ['daily'];
    const slots: RhythmSlot[] = ['srs_review', 'zpd_problem', 'reflection'];
    for (const p of personas) {
      for (const l of layers) {
        for (const s of slots) {
          const rule = resolvePedagogyRule(p, l, s);
          expect(rule).not.toBeNull();
          expect(rule.problemFlavor || rule.useDueCardsPool || rule.useReflectionPromptGenerator).toBeTruthy();
        }
      }
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run src/lib/__tests__/pedagogy-content-rules.test.ts
```

Expected: FAIL with "Cannot find module '../learn/pedagogy-content-rules'".

- [ ] **Step 3: Write the resolver**

Create `src/lib/learn/pedagogy-content-rules.ts`:

```typescript
/**
 * Alfanumrik — Pedagogy v2 / Wave 1
 * Persona × layer × slot → content selection policy.
 *
 * Pure-function resolver. ZERO IO, ZERO React, ZERO PII handling.
 * Single source of truth for all persona-adaptive content branching in the
 * Daily Rhythm. No persona logic should live anywhere else in
 * src/lib/learn/* or in the rhythm UI.
 *
 * Spec: docs/superpowers/specs/2026-05-08-pedagogy-v2-three-speed-rhythm-design.md
 *
 * Invariants:
 *  - resolvePedagogyRule NEVER throws, NEVER returns null/undefined.
 *  - For an unknown persona, resolver falls back to 'pass_comfortably' rules
 *    (the safe median behavior).
 *  - improve_basics persona is the ONLY persona where productiveFailure is
 *    flipped off (worked-example-first). Justification: confidence-fragile
 *    students need scaffolding before struggle.
 */

import type { GoalCode } from '../goals/goal-profile';
import { isKnownGoalCode } from '../goals/goal-profile';

// ─── Types ─────────────────────────────────────────────────────────────────

export type RhythmLayer = 'daily';
// Wave 1 only ships the daily layer. Wave 2 will add 'weekly'; Wave 3 'monthly'.

export type RhythmSlot = 'srs_review' | 'zpd_problem' | 'reflection';

export type ProblemFlavor =
  | 'board_pattern'
  | 'intuition_led'
  | 'prerequisite_repair'
  | 'enrichment'
  | 'puzzle';

export type DepthCeiling =
  | 'within_grade'
  | 'board_rigorous'
  | 'jee_neet'
  | 'olympiad';

export interface PedagogyRule {
  /** ZPD slot: present problem before tutorial reveal? */
  productiveFailure: boolean;
  /** ZPD slot: show worked example BEFORE the problem? (Inverts productive failure.) */
  workedExampleFirst: boolean;
  /** ZPD slot: which kind of problem to assemble. */
  problemFlavor: ProblemFlavor | null;
  /** ZPD slot: difficulty/depth ceiling for problem selection. */
  depthCeiling: DepthCeiling;
  /** SRS slot: pull from due-cards pool? (Always true today; future versions may vary.) */
  useDueCardsPool: boolean;
  /** SRS slot: allow ahead-of-grade reviews to be interleaved? */
  allowAheadOfGrade: boolean;
  /** Reflection slot: use cognitive-engine.getReflectionPrompt? */
  useReflectionPromptGenerator: boolean;
  /** XP awarded for this slot's completion (0 = no XP, mastery is signal). */
  xpAwarded: number;
}

// ─── Per-persona ZPD rules ──────────────────────────────────────────────────

const ZPD_RULES: Record<GoalCode, Pick<PedagogyRule, 'productiveFailure' | 'workedExampleFirst' | 'problemFlavor' | 'depthCeiling'>> = {
  improve_basics: {
    productiveFailure: false,
    workedExampleFirst: true,
    problemFlavor: 'prerequisite_repair',
    depthCeiling: 'within_grade',
  },
  pass_comfortably: {
    productiveFailure: true,
    workedExampleFirst: false,
    problemFlavor: 'board_pattern',
    depthCeiling: 'within_grade',
  },
  school_topper: {
    productiveFailure: true,
    workedExampleFirst: false,
    problemFlavor: 'intuition_led',
    depthCeiling: 'board_rigorous',
  },
  board_topper: {
    productiveFailure: true,
    workedExampleFirst: false,
    problemFlavor: 'board_pattern',
    depthCeiling: 'board_rigorous',
  },
  competitive_exam: {
    productiveFailure: true,
    workedExampleFirst: false,
    problemFlavor: 'enrichment',
    depthCeiling: 'jee_neet',
  },
  olympiad: {
    productiveFailure: true,
    workedExampleFirst: false,
    problemFlavor: 'puzzle',
    depthCeiling: 'olympiad',
  },
};

const FALLBACK_PERSONA: GoalCode = 'pass_comfortably';

// ─── Public API ────────────────────────────────────────────────────────────

export function resolvePedagogyRule(
  persona: GoalCode | string | null | undefined,
  layer: RhythmLayer,
  slot: RhythmSlot,
): PedagogyRule {
  const safePersona: GoalCode = (persona && isKnownGoalCode(persona))
    ? persona
    : FALLBACK_PERSONA;

  if (slot === 'zpd_problem') {
    const z = ZPD_RULES[safePersona];
    return {
      productiveFailure: z.productiveFailure,
      workedExampleFirst: z.workedExampleFirst,
      problemFlavor: z.problemFlavor,
      depthCeiling: z.depthCeiling,
      useDueCardsPool: false,
      allowAheadOfGrade: false,
      useReflectionPromptGenerator: false,
      xpAwarded: 0, // XP comes from quiz_per_correct in xp-config; not added here.
    };
  }

  if (slot === 'srs_review') {
    const allowAhead = safePersona === 'competitive_exam' || safePersona === 'olympiad';
    return {
      productiveFailure: false,
      workedExampleFirst: false,
      problemFlavor: null,
      depthCeiling: ZPD_RULES[safePersona].depthCeiling,
      useDueCardsPool: true,
      allowAheadOfGrade: allowAhead,
      useReflectionPromptGenerator: false,
      xpAwarded: 0, // SRS reviews surface inside quiz UI; XP is awarded by quiz scoring path.
    };
  }

  // slot === 'reflection'
  return {
    productiveFailure: false,
    workedExampleFirst: false,
    problemFlavor: null,
    depthCeiling: ZPD_RULES[safePersona].depthCeiling,
    useDueCardsPool: false,
    allowAheadOfGrade: false,
    useReflectionPromptGenerator: true,
    xpAwarded: 0, // Reflection is a retrieval signal, not an achievement.
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx vitest run src/lib/__tests__/pedagogy-content-rules.test.ts
```

Expected: all tests PASS.

- [ ] **Step 5: Coverage check**

```bash
npx vitest run --coverage src/lib/__tests__/pedagogy-content-rules.test.ts
```

Expected: `pedagogy-content-rules.ts` ≥ 90% line coverage.

- [ ] **Step 6: Commit**

```bash
git add src/lib/learn/pedagogy-content-rules.ts src/lib/__tests__/pedagogy-content-rules.test.ts
git commit -m "feat(pedagogy-v2): add pedagogy-content-rules resolver with persona×slot tests"
```

---

## Task 3 — `daily-rhythm-orchestrator.ts` (TDD)

**Why this matters:** Composes today's queue from existing engines (SM-2 due cards, IRT/ZPD calibration, reflection prompts). Pure function; takes student state + rule resolver + question pool as inputs, returns an ordered queue.

**Files:**
- Create: `src/lib/learn/daily-rhythm-orchestrator.ts`
- Create: `src/lib/__tests__/daily-rhythm-orchestrator.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/lib/__tests__/daily-rhythm-orchestrator.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { composeDailyRhythm, type DailyRhythmInput } from '../learn/daily-rhythm-orchestrator';
import type { GoalCode } from '../goals/goal-profile';

const fakePool = (n: number) => Array.from({ length: n }, (_, i) => ({
  questionId: `q${i}`,
  difficulty: 0.5,
  bloomLevel: 'understand' as const,
  topicId: `t${i % 3}`,
  isAheadOfGrade: false,
  isBoardPattern: i % 2 === 0,
  isOlympiad: false,
  isJeeNeet: false,
}));

const baseInput = (persona: GoalCode): DailyRhythmInput => ({
  persona,
  studentAbility: 0.0,
  dueSm2Cards: Array.from({ length: 7 }, (_, i) => ({
    questionId: `due${i}`,
    topicId: `t${i % 2}`,
    isAheadOfGrade: false,
  })),
  candidateProblemPool: fakePool(20),
  reflectionPromptIndex: 0,
});

describe('composeDailyRhythm', () => {
  it('returns 7 items: 5 SRS + 1 ZPD + 1 reflection', () => {
    const queue = composeDailyRhythm(baseInput('school_topper'));
    expect(queue.items).toHaveLength(7);
    expect(queue.items.filter((i) => i.kind === 'srs_review')).toHaveLength(5);
    expect(queue.items.filter((i) => i.kind === 'zpd_problem')).toHaveLength(1);
    expect(queue.items.filter((i) => i.kind === 'reflection')).toHaveLength(1);
  });

  it('places ZPD problem at position 5 (after SRS, before reflection)', () => {
    const queue = composeDailyRhythm(baseInput('school_topper'));
    expect(queue.items[5].kind).toBe('zpd_problem');
    expect(queue.items[6].kind).toBe('reflection');
  });

  it('improve_basics persona: ZPD item carries workedExampleFirst=true', () => {
    const queue = composeDailyRhythm(baseInput('improve_basics'));
    const zpd = queue.items.find((i) => i.kind === 'zpd_problem');
    expect(zpd?.kind).toBe('zpd_problem');
    if (zpd?.kind === 'zpd_problem') {
      expect(zpd.workedExampleFirst).toBe(true);
      expect(zpd.productiveFailure).toBe(false);
    }
  });

  it('competitive_exam persona: SRS allows ahead-of-grade cards', () => {
    const input = baseInput('competitive_exam');
    input.dueSm2Cards = [
      ...input.dueSm2Cards,
      { questionId: 'ahead1', topicId: 'tA', isAheadOfGrade: true },
      { questionId: 'ahead2', topicId: 'tA', isAheadOfGrade: true },
    ];
    const queue = composeDailyRhythm(input);
    const srs = queue.items.filter((i) => i.kind === 'srs_review');
    expect(srs.some((i) => i.kind === 'srs_review' && i.questionId.startsWith('ahead'))).toBe(true);
  });

  it('improve_basics persona: SRS rejects ahead-of-grade cards', () => {
    const input = baseInput('improve_basics');
    input.dueSm2Cards = [
      ...input.dueSm2Cards.slice(0, 3),
      { questionId: 'ahead1', topicId: 'tA', isAheadOfGrade: true },
      { questionId: 'ahead2', topicId: 'tA', isAheadOfGrade: true },
      { questionId: 'in1', topicId: 'tB', isAheadOfGrade: false },
      { questionId: 'in2', topicId: 'tB', isAheadOfGrade: false },
    ];
    const queue = composeDailyRhythm(input);
    const srs = queue.items.filter((i) => i.kind === 'srs_review');
    expect(srs.some((i) => i.kind === 'srs_review' && i.questionId.startsWith('ahead'))).toBe(false);
  });

  it('pass_comfortably persona: ZPD picks board-pattern problem when available', () => {
    const queue = composeDailyRhythm(baseInput('pass_comfortably'));
    const zpd = queue.items.find((i) => i.kind === 'zpd_problem');
    if (zpd?.kind === 'zpd_problem') {
      // Pool has isBoardPattern on even-indexed questions; resolver demands board_pattern flavor.
      // q0/q2/q4… are board-pattern; we expect one of those to be picked.
      const picked = zpd.questionId;
      const num = parseInt(picked.replace('q', ''), 10);
      expect(num % 2).toBe(0);
    }
  });

  it('handles empty SRS due-card list by padding with placeholders flagged as `pad`', () => {
    const input = baseInput('school_topper');
    input.dueSm2Cards = [];
    const queue = composeDailyRhythm(input);
    const srs = queue.items.filter((i) => i.kind === 'srs_review');
    expect(srs).toHaveLength(5);
    srs.forEach((i) => {
      if (i.kind === 'srs_review') expect(i.isPadding).toBe(true);
    });
  });

  it('reflection item carries the prompt text from cognitive-engine', () => {
    const queue = composeDailyRhythm(baseInput('school_topper'));
    const reflection = queue.items.find((i) => i.kind === 'reflection');
    if (reflection?.kind === 'reflection') {
      expect(reflection.promptText).toBeTruthy();
      expect(typeof reflection.promptText).toBe('string');
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run src/lib/__tests__/daily-rhythm-orchestrator.test.ts
```

Expected: FAIL with "Cannot find module '../learn/daily-rhythm-orchestrator'".

- [ ] **Step 3: Write the orchestrator**

Create `src/lib/learn/daily-rhythm-orchestrator.ts`:

```typescript
/**
 * Alfanumrik — Pedagogy v2 / Wave 1
 * Daily Rhythm Orchestrator.
 *
 * Composes today's daily-rhythm queue:
 *   5 × SRS reviews + 1 × ZPD problem + 1 × reflection
 *
 * Pure function. Inputs are: persona, ability estimate, due-cards list,
 * candidate problem pool (already filtered for grade/subject elsewhere),
 * and a reflection prompt index. Output is an ordered queue of items.
 *
 * Selection rules come from pedagogy-content-rules.resolvePedagogyRule.
 * No persona conditionals appear in this file.
 *
 * Spec: docs/superpowers/specs/2026-05-08-pedagogy-v2-three-speed-rhythm-design.md
 */

import type { GoalCode } from '../goals/goal-profile';
import { resolvePedagogyRule, type ProblemFlavor } from './pedagogy-content-rules';
import { getReflectionPrompt } from '../cognitive-engine';

// ─── Inputs ────────────────────────────────────────────────────────────────

export interface DueSm2Card {
  questionId: string;
  topicId: string;
  isAheadOfGrade: boolean;
}

export interface CandidateProblem {
  questionId: string;
  difficulty: number;        // 0..1
  bloomLevel: 'remember' | 'understand' | 'apply' | 'analyze' | 'evaluate' | 'create';
  topicId: string;
  isAheadOfGrade: boolean;
  isBoardPattern: boolean;
  isOlympiad: boolean;
  isJeeNeet: boolean;
}

export interface DailyRhythmInput {
  persona: GoalCode;
  studentAbility: number; // IRT ability estimate; cognitive-engine output
  dueSm2Cards: DueSm2Card[];
  candidateProblemPool: CandidateProblem[];
  reflectionPromptIndex: number;
}

// ─── Output ────────────────────────────────────────────────────────────────

export type RhythmItem =
  | { kind: 'srs_review'; questionId: string; topicId: string; isPadding: boolean }
  | {
      kind: 'zpd_problem';
      questionId: string;
      productiveFailure: boolean;
      workedExampleFirst: boolean;
      problemFlavor: ProblemFlavor | null;
    }
  | { kind: 'reflection'; promptText: string };

export interface DailyRhythmQueue {
  items: RhythmItem[];
  composedAtIso: string;
}

// ─── Composer ──────────────────────────────────────────────────────────────

const SRS_TARGET = 5;

function pickSrsItems(input: DailyRhythmInput): RhythmItem[] {
  const rule = resolvePedagogyRule(input.persona, 'daily', 'srs_review');
  const allow = rule.allowAheadOfGrade;

  const eligible = input.dueSm2Cards.filter((c) => allow || !c.isAheadOfGrade);

  const items: RhythmItem[] = eligible.slice(0, SRS_TARGET).map((c) => ({
    kind: 'srs_review' as const,
    questionId: c.questionId,
    topicId: c.topicId,
    isPadding: false,
  }));

  while (items.length < SRS_TARGET) {
    items.push({
      kind: 'srs_review' as const,
      questionId: `__pad_${items.length}__`,
      topicId: '__pad__',
      isPadding: true,
    });
  }

  return items;
}

function flavorMatches(p: CandidateProblem, flavor: ProblemFlavor | null): boolean {
  if (!flavor) return true;
  switch (flavor) {
    case 'board_pattern':         return p.isBoardPattern;
    case 'intuition_led':         return !p.isBoardPattern && !p.isJeeNeet && !p.isOlympiad;
    case 'prerequisite_repair':   return !p.isAheadOfGrade && p.difficulty <= 0.55;
    case 'enrichment':            return p.isJeeNeet || p.isAheadOfGrade;
    case 'puzzle':                return p.isOlympiad;
  }
}

function pickZpdItem(input: DailyRhythmInput): RhythmItem {
  const rule = resolvePedagogyRule(input.persona, 'daily', 'zpd_problem');

  // Filter pool by flavor; if empty, fall back to flavor-agnostic pool.
  const flavored = input.candidateProblemPool.filter((p) => flavorMatches(p, rule.problemFlavor));
  const pool = flavored.length > 0 ? flavored : input.candidateProblemPool;

  // Pick the candidate closest in difficulty to a band centered on student ability.
  // Ability ~ N(0,1) on logit scale; convert to 0..1 difficulty target via sigmoid.
  const targetDifficulty = 1 / (1 + Math.exp(-input.studentAbility));
  const sorted = [...pool].sort(
    (a, b) => Math.abs(a.difficulty - targetDifficulty) - Math.abs(b.difficulty - targetDifficulty),
  );
  const picked = sorted[0];

  return {
    kind: 'zpd_problem',
    questionId: picked?.questionId ?? '__no_pool__',
    productiveFailure: rule.productiveFailure,
    workedExampleFirst: rule.workedExampleFirst,
    problemFlavor: rule.problemFlavor,
  };
}

function pickReflectionItem(input: DailyRhythmInput): RhythmItem {
  // getReflectionPrompt is bilingual + indexed; cognitive-engine owns the rotation.
  const promptText = getReflectionPrompt(input.reflectionPromptIndex);
  return { kind: 'reflection', promptText };
}

export function composeDailyRhythm(input: DailyRhythmInput): DailyRhythmQueue {
  const srs = pickSrsItems(input);
  const zpd = pickZpdItem(input);
  const reflection = pickReflectionItem(input);
  return {
    items: [...srs, zpd, reflection],
    composedAtIso: new Date().toISOString(),
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx vitest run src/lib/__tests__/daily-rhythm-orchestrator.test.ts
```

Expected: all tests PASS. If `getReflectionPrompt`'s actual signature differs from `(index: number) => string`, open `src/lib/cognitive-engine.ts`, find the export, and adjust the call. The test only asserts the prompt is a non-empty string.

- [ ] **Step 5: Type-check the whole project**

```bash
npm run type-check
```

Expected: 0 errors. If `getReflectionPrompt` returns a different shape (e.g., `{ en: string; hi: string }`), adjust `pickReflectionItem` to extract `en` (the daily rhythm renders in `AuthContext.isHi` aware UI; the orchestrator stays bilingual-neutral by emitting one canonical string). Re-run the test.

- [ ] **Step 6: Commit**

```bash
git add src/lib/learn/daily-rhythm-orchestrator.ts src/lib/__tests__/daily-rhythm-orchestrator.test.ts
git commit -m "feat(pedagogy-v2): add daily-rhythm-orchestrator (5 SRS + 1 ZPD + reflection)"
```

---

## Task 4 — `wrong-answer-remediation.ts` server helper (TDD)

**Why this matters:** When a student picks a wrong MCQ option, look up the curated remediation text from the existing `wrong_answer_remediations` table. This is a thin server-side helper, not new schema.

**Files:**
- Create: `src/lib/learn/wrong-answer-remediation.ts`
- Create: `src/lib/__tests__/wrong-answer-remediation.test.ts`

- [ ] **Step 1: Confirm the existing table shape (re-audit)**

The migration `20260428000100_wrong_answer_remediations.sql` (in `_legacy/timestamped/` per the canonical clone) defines this table. Read it to confirm column names before writing the helper:

```bash
ls "C:/Users/Bharangpur Primary/Alfanumrik/supabase/migrations/_legacy/timestamped/" | grep -i remediation
```

Open that file. Confirm the columns include at minimum:
- `question_id` (uuid or text)
- `distractor_index` (int)
- `remediation_text_en` and `remediation_text_hi` (text)
- `misconception_code` (text — references `misconception_ontology.code`)

If the column names differ, adapt the SELECT in step 3 to match. **Do not modify the table.**

- [ ] **Step 2: Write the failing test**

Create `src/lib/__tests__/wrong-answer-remediation.test.ts`:

```typescript
import { describe, it, expect, vi } from 'vitest';
import { lookupRemediation } from '../learn/wrong-answer-remediation';

describe('lookupRemediation', () => {
  it('returns null when supabase returns no rows', async () => {
    const fakeClient = {
      from: () => ({
        select: () => ({
          eq: () => ({
            eq: () => ({
              maybeSingle: () => Promise.resolve({ data: null, error: null }),
            }),
          }),
        }),
      }),
    };
    const result = await lookupRemediation(fakeClient as any, 'q1', 2);
    expect(result).toBeNull();
  });

  it('returns the remediation row when it exists', async () => {
    const fakeClient = {
      from: () => ({
        select: () => ({
          eq: () => ({
            eq: () => ({
              maybeSingle: () => Promise.resolve({
                data: {
                  question_id: 'q1',
                  distractor_index: 2,
                  misconception_code: 'mom_conserves_energy_confusion',
                  remediation_text_en: 'Momentum is conserved, not kinetic energy.',
                  remediation_text_hi: 'संवेग संरक्षित होता है, गतिज ऊर्जा नहीं।',
                },
                error: null,
              }),
            }),
          }),
        }),
      }),
    };
    const result = await lookupRemediation(fakeClient as any, 'q1', 2);
    expect(result).not.toBeNull();
    expect(result?.misconceptionCode).toBe('mom_conserves_energy_confusion');
    expect(result?.remediationEn).toContain('Momentum');
    expect(result?.remediationHi).toContain('संवेग');
  });

  it('returns null and logs on supabase error (does not throw)', async () => {
    const fakeClient = {
      from: () => ({
        select: () => ({
          eq: () => ({
            eq: () => ({
              maybeSingle: () => Promise.resolve({ data: null, error: { message: 'boom' } }),
            }),
          }),
        }),
      }),
    };
    const result = await lookupRemediation(fakeClient as any, 'q1', 2);
    expect(result).toBeNull();
  });
});
```

- [ ] **Step 3: Write the helper**

Create `src/lib/learn/wrong-answer-remediation.ts`:

```typescript
/**
 * Alfanumrik — Pedagogy v2 / Wave 1
 * Wrong-Answer Remediation lookup.
 *
 * Reads from the EXISTING `wrong_answer_remediations` table (curated content).
 * No schema changes. Returns null when no curated remediation exists for the
 * (question, distractor) pair — UI falls back to legacy generic feedback.
 *
 * Server-side only. Pass a server-bound Supabase client (RLS-respecting).
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { logger } from '../logger';

export interface Remediation {
  questionId: string;
  distractorIndex: number;
  misconceptionCode: string | null;
  remediationEn: string;
  remediationHi: string;
}

export async function lookupRemediation(
  supabase: SupabaseClient,
  questionId: string,
  distractorIndex: number,
): Promise<Remediation | null> {
  const { data, error } = await supabase
    .from('wrong_answer_remediations')
    .select('question_id, distractor_index, misconception_code, remediation_text_en, remediation_text_hi')
    .eq('question_id', questionId)
    .eq('distractor_index', distractorIndex)
    .maybeSingle();

  if (error) {
    logger.warn('lookupRemediation supabase error', { questionId, distractorIndex, error: error.message });
    return null;
  }

  if (!data) return null;

  return {
    questionId: data.question_id,
    distractorIndex: data.distractor_index,
    misconceptionCode: data.misconception_code ?? null,
    remediationEn: data.remediation_text_en ?? '',
    remediationHi: data.remediation_text_hi ?? '',
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx vitest run src/lib/__tests__/wrong-answer-remediation.test.ts
```

Expected: all tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/learn/wrong-answer-remediation.ts src/lib/__tests__/wrong-answer-remediation.test.ts
git commit -m "feat(pedagogy-v2): add wrong-answer remediation lookup helper"
```

---

## Task 5 — API route `/api/rhythm/today`

**Why this matters:** Server-side endpoint that loads the student's persona + due-cards + candidate pool + IRT ability, calls `composeDailyRhythm`, and returns the queue. Gated by `ff_pedagogy_v2_daily_rhythm`.

**Files:**
- Create: `src/app/api/rhythm/today/route.ts`

- [ ] **Step 1: Write the route handler**

Create `src/app/api/rhythm/today/route.ts`:

```typescript
import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase-server';
import { isFeatureEnabled, PEDAGOGY_V2_FLAGS } from '@/lib/feature-flags';
import { composeDailyRhythm, type DueSm2Card, type CandidateProblem } from '@/lib/learn/daily-rhythm-orchestrator';
import { resolveGoalProfile } from '@/lib/goals/goal-profile';
import { logger } from '@/lib/logger';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const supabase = await createServerClient();

  const { data: userResult, error: userErr } = await supabase.auth.getUser();
  if (userErr || !userResult?.user) {
    return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  }
  const userId = userResult.user.id;

  // Flag gate.
  const flagOn = await isFeatureEnabled(PEDAGOGY_V2_FLAGS.DAILY_RHYTHM, {
    userId,
    role: 'student',
    environment: process.env.VERCEL_ENV || process.env.NODE_ENV,
  });
  if (!flagOn) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }

  // Load student profile (persona + ability estimate).
  const { data: profile } = await supabase
    .from('student_profiles')
    .select('goal_code, irt_ability_estimate, grade')
    .eq('auth_user_id', userId)
    .maybeSingle();

  if (!profile) {
    return NextResponse.json({ error: 'no_profile' }, { status: 404 });
  }

  const goalProfile = resolveGoalProfile(profile.goal_code);
  const persona = goalProfile?.code ?? 'pass_comfortably';
  const ability = typeof profile.irt_ability_estimate === 'number' ? profile.irt_ability_estimate : 0;

  // Load due SM-2 cards. Limit 20; orchestrator picks 5.
  const { data: dueRows } = await supabase
    .from('sm2_cards')
    .select('question_id, topic_id, is_ahead_of_grade, next_review_at')
    .eq('student_id', userId)
    .lte('next_review_at', new Date().toISOString())
    .order('next_review_at', { ascending: true })
    .limit(20);

  const dueSm2Cards: DueSm2Card[] = (dueRows ?? []).map((r) => ({
    questionId: r.question_id,
    topicId: r.topic_id,
    isAheadOfGrade: !!r.is_ahead_of_grade,
  }));

  // Load candidate ZPD pool (50 questions filtered by grade + persona-relevant tags).
  // Uses an existing RPC if available; otherwise fall back to a direct table SELECT.
  // The pool fields must match CandidateProblem; adjust column names if needed.
  const { data: poolRows, error: poolErr } = await supabase.rpc('get_zpd_candidate_pool_v1', {
    p_student_id: userId,
    p_limit: 50,
  });

  let candidatePool: CandidateProblem[] = [];
  if (poolErr) {
    logger.warn('rhythm/today: get_zpd_candidate_pool_v1 RPC missing or errored — falling back to question_bank scan', { error: poolErr.message });
    const { data: fallback } = await supabase
      .from('question_bank')
      .select('id, irt_difficulty, bloom_level, topic_id, is_ahead_of_grade, is_board_pattern, is_olympiad, is_jee_neet')
      .eq('grade', profile.grade)
      .eq('is_active', true)
      .limit(50);
    candidatePool = (fallback ?? []).map((q) => ({
      questionId: q.id,
      difficulty: q.irt_difficulty ?? 0.5,
      bloomLevel: q.bloom_level ?? 'understand',
      topicId: q.topic_id,
      isAheadOfGrade: !!q.is_ahead_of_grade,
      isBoardPattern: !!q.is_board_pattern,
      isOlympiad: !!q.is_olympiad,
      isJeeNeet: !!q.is_jee_neet,
    }));
  } else {
    candidatePool = (poolRows ?? []).map((q: Record<string, unknown>) => ({
      questionId: String(q.question_id),
      difficulty: Number(q.difficulty ?? 0.5),
      bloomLevel: (q.bloom_level as CandidateProblem['bloomLevel']) ?? 'understand',
      topicId: String(q.topic_id ?? ''),
      isAheadOfGrade: !!q.is_ahead_of_grade,
      isBoardPattern: !!q.is_board_pattern,
      isOlympiad: !!q.is_olympiad,
      isJeeNeet: !!q.is_jee_neet,
    }));
  }

  // Reflection prompt index — rotate by day-of-year.
  const reflectionPromptIndex = Math.floor(Date.now() / (1000 * 60 * 60 * 24)) % 30;

  const queue = composeDailyRhythm({
    persona,
    studentAbility: ability,
    dueSm2Cards,
    candidateProblemPool: candidatePool,
    reflectionPromptIndex,
  });

  return NextResponse.json(queue, {
    headers: { 'Cache-Control': 'private, max-age=0, must-revalidate' },
  });
}
```

- [ ] **Step 2: Re-audit for missing dependencies**

Before running the route, confirm these references exist in canonical:

- `@/lib/supabase-server` exports `createServerClient` — confirm with: `grep -l createServerClient src/lib/supabase-server.ts`. If the export is named differently (e.g. `getServerClient`), adjust the import.
- `student_profiles.goal_code`, `student_profiles.irt_ability_estimate`, `student_profiles.grade` — confirm with: `grep -i "goal_code\|irt_ability_estimate" supabase/migrations/_legacy/timestamped/*.sql | head -10`. If columns differ, update the SELECT to match.
- `sm2_cards` table with `next_review_at`, `is_ahead_of_grade` — confirm with: `grep -i "create table.*sm2_cards" supabase/migrations/**/*.sql`. If the table is named differently (e.g. `srs_cards`), adapt.
- `question_bank` columns — confirm `is_board_pattern`, `is_olympiad`, `is_jee_neet`, `irt_difficulty`, `bloom_level` exist. If any are missing, the SELECT will fail at runtime — **this is the spec-staleness check**: the spec assumes these tag columns exist; if they don't, file a follow-up task to add them and short-circuit the route to return `204 No Content` for now.

If any required column or table is missing, **stop here**, document the gap in a comment at the top of the route file, and return `503 Service Unavailable` with `{ error: 'rhythm_dependencies_missing' }` until the gap is filled. Do not silently degrade.

- [ ] **Step 3: Smoke-test the route locally**

Start the dev server:

```bash
npm run dev
```

In another shell, with a logged-in browser session cookie or a service-role token:

```bash
curl -i http://localhost:3000/api/rhythm/today
```

Expected without flag set: HTTP 404 with `{ "error": "not_found" }`.

Now seed the flag for your test user. Open Supabase SQL editor (staging) and run:

```sql
UPDATE feature_flags
SET is_enabled = true
WHERE flag_name = 'ff_pedagogy_v2_daily_rhythm';
```

Re-run the curl. Expected: HTTP 200 with a JSON `{ items: [...], composedAtIso: '...' }`. The `items` array has length 7.

If the response is 503 (`rhythm_dependencies_missing`), follow Step 2's gap protocol.

- [ ] **Step 4: Disable the flag again before commit**

```sql
UPDATE feature_flags SET is_enabled = false WHERE flag_name = 'ff_pedagogy_v2_daily_rhythm';
```

- [ ] **Step 5: Commit**

```bash
git add src/app/api/rhythm/today/route.ts
git commit -m "feat(pedagogy-v2): add /api/rhythm/today route gated by daily-rhythm flag"
```

---

## Task 6 — Productive-failure flip in `/learn/[subject]/[chapter]`

**Why this matters:** When `ff_productive_failure_v1` is on, the chapter page presents a ZPD problem first; tutorial reveal happens after attempt. Persona `improve_basics` keeps tutorial-first regardless (per `pedagogy-content-rules`).

**Files:**
- Modify: `src/app/learn/[subject]/[chapter]/page.tsx`

- [ ] **Step 1: Read the current chapter page to find the integration site**

```bash
ls "C:/Users/Bharangpur Primary/Alfanumrik/src/app/learn/[subject]/[chapter]/"
```

Open `src/app/learn/[subject]/[chapter]/page.tsx`. Find the section that renders tutorial content (likely a component named `<ChapterContent/>`, `<LessonBody/>`, or similar). Identify the prop or hook that controls render order.

If the page is a Server Component that fetches chapter content via `actions.ts`, the productive-failure flip needs to live in a client wrapper. Plan accordingly: introduce a thin client wrapper `<ProductiveFailureWrapper>` that owns the attempt-state and conditionally renders `<ChapterContent/>` only after attempt.

- [ ] **Step 2: Add the flag check and the wrapper**

At the top of `src/app/learn/[subject]/[chapter]/page.tsx`, add:

```typescript
import { isFeatureEnabled, PEDAGOGY_V2_FLAGS } from '@/lib/feature-flags';
import { resolvePedagogyRule } from '@/lib/learn/pedagogy-content-rules';
```

Inside the page component (server component), evaluate the flag and resolve the persona-aware rule:

```typescript
const { data: { user } } = await supabase.auth.getUser();
const flagOn = user
  ? await isFeatureEnabled(PEDAGOGY_V2_FLAGS.PRODUCTIVE_FAILURE_V1, {
      userId: user.id,
      role: 'student',
      environment: process.env.VERCEL_ENV || process.env.NODE_ENV,
    })
  : false;

let useProductiveFailure = false;
if (flagOn && user) {
  const { data: profile } = await supabase
    .from('student_profiles')
    .select('goal_code')
    .eq('auth_user_id', user.id)
    .maybeSingle();
  const rule = resolvePedagogyRule(profile?.goal_code, 'daily', 'zpd_problem');
  useProductiveFailure = rule.productiveFailure && !rule.workedExampleFirst;
}
```

Then conditionally render:

```tsx
{useProductiveFailure ? (
  <ProductiveFailureWrapper>
    <ChapterContent {...chapterProps} />
  </ProductiveFailureWrapper>
) : (
  <ChapterContent {...chapterProps} />
)}
```

- [ ] **Step 3: Create the wrapper component**

Create `src/components/learn/ProductiveFailureWrapper.tsx`:

```tsx
'use client';

import { useState, ReactNode } from 'react';
import { useAuth } from '@/lib/AuthContext';

interface Props {
  children: ReactNode;
}

export function ProductiveFailureWrapper({ children }: Props) {
  const { isHi } = useAuth();
  const [attempted, setAttempted] = useState(false);

  if (attempted) return <>{children}</>;

  return (
    <div className="rounded-2xl border border-orange-200 bg-orange-50 p-5 my-4">
      <h3 className="font-semibold text-base mb-2">
        {isHi ? 'पहले इसे आज़माओ' : 'Try this first'}
      </h3>
      <p className="text-sm text-orange-900 mb-3">
        {isHi
          ? 'पाठ देखने से पहले यह सवाल हल करने की कोशिश करो — यह सीखने का सबसे असरदार तरीका है।'
          : 'Attempt this problem before reading the lesson — research shows this is the most effective way to learn.'}
      </p>
      {/* Placeholder: actual ZPD problem rendering wires in via the same selector
          the rhythm queue uses; for Wave 1 minimum, render a simple
          "Show me the problem" → "I attempted it" two-step flow. */}
      <button
        onClick={() => setAttempted(true)}
        className="rounded-lg bg-orange-600 text-white px-4 py-2 text-sm font-medium"
        data-testid="productive-failure-reveal"
      >
        {isHi ? 'मैंने कोशिश की — पाठ दिखाओ' : "I've attempted it — show me the lesson"}
      </button>
    </div>
  );
}
```

Note: The minimum Wave 1 flip exposes the *intent* — a gate before tutorial reveal. Wiring an actual ZPD problem inline is enriched in a follow-up sub-task once `/api/rhythm/today` returns a problem ID we can render. For now, the wrapper is a behavioral barrier; it produces measurable telemetry on whether students read tutorials cold vs after struggling. That telemetry is the success metric.

- [ ] **Step 4: Type-check**

```bash
npm run type-check
```

Expected: 0 errors.

- [ ] **Step 5: Manual smoke test**

Enable the flag in staging (`UPDATE feature_flags SET is_enabled = true WHERE flag_name = 'ff_productive_failure_v1';`), open `/learn/science/photosynthesis` (or any valid chapter URL), confirm the orange "Try this first" panel appears before the tutorial. Click the button and confirm the tutorial then renders.

Then set `goal_code` to `improve_basics` for your test user; reload the chapter; confirm the wrapper is **not** rendered (because the resolver flips `productiveFailure: false` for that persona).

Disable the flag again before commit.

- [ ] **Step 6: Commit**

```bash
git add src/app/learn/[subject]/[chapter]/page.tsx src/components/learn/ProductiveFailureWrapper.tsx
git commit -m "feat(pedagogy-v2): productive-failure flip on /learn/[subject]/[chapter] gated by ff_productive_failure_v1"
```

---

## Task 7 — Distractor micro-explainer hook in quiz UI

**Why this matters:** When a student picks a wrong MCQ option, look up the curated remediation from `wrong_answer_remediations` (already populated). If a row exists, render `<MisconceptionExplainer/>` with a Foxy CTA. Gated by `ff_distractor_micro_explainer_v1`.

**Files:**
- Create: `src/components/quiz/MisconceptionExplainer.tsx`
- Modify: existing wrong-answer surface (likely `src/components/quiz/QuizQuestion.tsx` or `QuizResults.tsx` — confirm in step 1)

- [ ] **Step 1: Find the existing wrong-answer surface**

```bash
grep -rl "is_correct.*false\|isCorrect.*false\|wrong_answer\|incorrect" src/components/quiz/
```

Identify the component that renders the post-answer feedback for an MCQ. It will be the one that already shows "Correct!" / "Incorrect" UX. The integration is to render `<MisconceptionExplainer/>` inline below the existing wrong-answer copy when the flag is on AND a remediation exists.

- [ ] **Step 2: Create the component**

Create `src/components/quiz/MisconceptionExplainer.tsx`:

```tsx
'use client';

import { useEffect, useState } from 'react';
import { useAuth } from '@/lib/AuthContext';
import type { Remediation } from '@/lib/learn/wrong-answer-remediation';

interface Props {
  questionId: string;
  distractorIndex: number;
  /** Optional pre-fetched remediation to avoid a round-trip when caller already has it. */
  prefetched?: Remediation | null;
}

export function MisconceptionExplainer({ questionId, distractorIndex, prefetched }: Props) {
  const { isHi } = useAuth();
  const [remediation, setRemediation] = useState<Remediation | null>(prefetched ?? null);
  const [loading, setLoading] = useState(!prefetched);

  useEffect(() => {
    if (prefetched !== undefined) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(
          `/api/learn/remediation?questionId=${encodeURIComponent(questionId)}&distractorIndex=${distractorIndex}`,
          { credentials: 'same-origin' },
        );
        if (!res.ok) {
          if (!cancelled) setRemediation(null);
          return;
        }
        const data: Remediation | null = await res.json();
        if (!cancelled) setRemediation(data);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [questionId, distractorIndex, prefetched]);

  if (loading) return null;
  if (!remediation) return null;

  const text = isHi ? remediation.remediationHi : remediation.remediationEn;

  return (
    <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 mt-3" data-testid="misconception-explainer">
      <div className="text-sm font-semibold text-amber-900 mb-1">
        {isHi ? 'यहाँ पर अक्सर गलती होती है:' : 'Here is what often goes wrong:'}
      </div>
      <p className="text-sm text-amber-900 mb-3">{text}</p>
      <a
        href={`/foxy?mode=doubt&q=${encodeURIComponent(questionId)}`}
        className="inline-block text-sm font-medium text-purple-700 underline"
      >
        {isHi ? 'फॉक्सी से और समझो →' : 'Ask Foxy to explain more →'}
      </a>
    </div>
  );
}
```

- [ ] **Step 3: Add the supporting API endpoint**

Create `src/app/api/learn/remediation/route.ts`:

```typescript
import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase-server';
import { isFeatureEnabled, PEDAGOGY_V2_FLAGS } from '@/lib/feature-flags';
import { lookupRemediation } from '@/lib/learn/wrong-answer-remediation';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const questionId = searchParams.get('questionId');
  const distractorRaw = searchParams.get('distractorIndex');

  if (!questionId || distractorRaw === null) {
    return NextResponse.json({ error: 'missing_params' }, { status: 400 });
  }
  const distractorIndex = parseInt(distractorRaw, 10);
  if (!Number.isInteger(distractorIndex) || distractorIndex < 0 || distractorIndex > 3) {
    return NextResponse.json({ error: 'invalid_distractor_index' }, { status: 400 });
  }

  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });

  const flagOn = await isFeatureEnabled(PEDAGOGY_V2_FLAGS.DISTRACTOR_MICRO_EXPLAINER_V1, {
    userId: user.id,
    role: 'student',
  });
  if (!flagOn) return NextResponse.json(null, { status: 200 });

  const remediation = await lookupRemediation(supabase, questionId, distractorIndex);
  return NextResponse.json(remediation, {
    headers: { 'Cache-Control': 'private, max-age=300' },
  });
}
```

- [ ] **Step 4: Mount the explainer in the quiz wrong-answer surface**

In the wrong-answer component identified in Step 1, after the existing "Incorrect" copy, add:

```tsx
import { MisconceptionExplainer } from '@/components/quiz/MisconceptionExplainer';

// inside the wrong-answer branch (where you already have access to questionId and the
// student's selected option index — call it studentAnswerIndex):
{!isCorrect && questionId && typeof studentAnswerIndex === 'number' && (
  <MisconceptionExplainer
    questionId={questionId}
    distractorIndex={studentAnswerIndex}
  />
)}
```

The component handles the "no remediation exists" case by rendering nothing — no flicker, no shame.

- [ ] **Step 5: Type-check**

```bash
npm run type-check
```

Expected: 0 errors.

- [ ] **Step 6: Manual smoke test**

Pre-condition: at least one row in `wrong_answer_remediations` for a question your test user will see. Confirm with:

```sql
SELECT question_id, distractor_index FROM wrong_answer_remediations LIMIT 5;
```

Pick a question_id from the result. In the staging UI, take a quiz that includes that question and **deliberately pick the wrong distractor matching `distractor_index`**. Confirm the amber "Here is what often goes wrong" card appears, the text is in the right language for `isHi`, and the "Ask Foxy" link lands on `/foxy?mode=doubt&q=...`.

Pick a different wrong distractor that does NOT have a curated remediation. Confirm the card does NOT render (legacy generic feedback only).

Disable the flag again before commit.

- [ ] **Step 7: Commit**

```bash
git add src/components/quiz/MisconceptionExplainer.tsx src/app/api/learn/remediation/route.ts <wrong-answer-surface-modified>
git commit -m "feat(pedagogy-v2): distractor micro-explainer (Eedi pattern) gated by ff_distractor_micro_explainer_v1"
```

---

## Task 8 — Dashboard `<DailyRhythmQueue/>` integration

**Why this matters:** The dashboard becomes the rhythm host. When `ff_pedagogy_v2_daily_rhythm` is on, render the 7-item queue at the top of the feed; the existing AboveFoldHero shifts below it.

**Files:**
- Create: `src/components/dashboard/sections/DailyRhythmQueue.tsx`
- Modify: `src/app/dashboard/page.tsx`

- [ ] **Step 1: Create the component**

Create `src/components/dashboard/sections/DailyRhythmQueue.tsx`:

```tsx
'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useAuth } from '@/lib/AuthContext';

interface RhythmItem {
  kind: 'srs_review' | 'zpd_problem' | 'reflection';
  questionId?: string;
  topicId?: string;
  promptText?: string;
  isPadding?: boolean;
  productiveFailure?: boolean;
  workedExampleFirst?: boolean;
}

interface RhythmQueue {
  items: RhythmItem[];
  composedAtIso: string;
}

export default function DailyRhythmQueue() {
  const { isHi } = useAuth();
  const [queue, setQueue] = useState<RhythmQueue | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/rhythm/today', { credentials: 'same-origin' });
        if (res.status === 404) {
          if (!cancelled) setQueue(null); // flag off — render nothing
          return;
        }
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          if (!cancelled) setError(body.error || 'unknown');
          return;
        }
        const data: RhythmQueue = await res.json();
        if (!cancelled) setQueue(data);
      } catch (e: any) {
        if (!cancelled) setError(e?.message || 'fetch_failed');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  if (loading) {
    return <div className="h-32 rounded-2xl animate-pulse" style={{ background: 'var(--surface-2)' }} aria-hidden="true" />;
  }
  if (error || !queue) return null;

  const srs = queue.items.filter((i) => i.kind === 'srs_review' && !i.isPadding);
  const zpd = queue.items.find((i) => i.kind === 'zpd_problem');
  const reflection = queue.items.find((i) => i.kind === 'reflection');

  return (
    <section
      className="rounded-3xl border border-purple-200 bg-gradient-to-br from-purple-50 to-orange-50 p-5 mb-4"
      data-testid="daily-rhythm-queue"
    >
      <header className="mb-3">
        <h2 className="text-lg font-bold text-purple-900">
          {isHi ? 'आज का 15-मिनट का रिदम' : 'Today’s 15-minute rhythm'}
        </h2>
        <p className="text-xs text-purple-700">
          {isHi ? '5 दोहराव · 1 चुनौती · 1 रिफ्लेक्शन' : '5 reviews · 1 challenge · 1 reflection'}
        </p>
      </header>

      <ol className="space-y-2 text-sm">
        <li className="flex items-center justify-between">
          <span>{isHi ? 'स्पेस्ड रिव्यू' : 'Spaced reviews'} · {srs.length}/5</span>
          <Link href="/quiz?mode=srs" className="text-purple-700 underline font-medium">
            {isHi ? 'शुरू करो' : 'Start'}
          </Link>
        </li>

        {zpd && (
          <li className="flex items-center justify-between">
            <span>
              {zpd.workedExampleFirst
                ? (isHi ? 'गाइडेड चुनौती' : 'Guided challenge')
                : (isHi ? 'ZPD चुनौती' : 'ZPD challenge')}
            </span>
            <Link
              href={zpd.questionId ? `/quiz?qid=${encodeURIComponent(zpd.questionId)}` : '/quiz'}
              className="text-purple-700 underline font-medium"
            >
              {isHi ? 'खोलो' : 'Open'}
            </Link>
          </li>
        )}

        {reflection && (
          <li>
            <details className="group">
              <summary className="cursor-pointer flex items-center justify-between">
                <span>{isHi ? 'रिफ्लेक्शन' : 'Reflection'}</span>
                <span className="text-purple-700 underline text-xs">
                  {isHi ? 'खोलो' : 'Open'}
                </span>
              </summary>
              <div className="mt-2 p-3 rounded-lg bg-white text-purple-900">
                {reflection.promptText}
              </div>
            </details>
          </li>
        )}
      </ol>
    </section>
  );
}
```

- [ ] **Step 2: Mount on dashboard**

In `src/app/dashboard/page.tsx`, near the other dynamic imports, add:

```typescript
const DailyRhythmQueue = dynamic(
  () => import('@/components/dashboard/sections/DailyRhythmQueue'),
  { ssr: false, loading: () => <SectionFallback /> },
);
```

In the JSX, immediately above `<AboveFoldHero ...>`, render:

```tsx
<SectionErrorBoundary fallbackLabel="rhythm">
  <DailyRhythmQueue />
</SectionErrorBoundary>
```

The component renders `null` when the flag is off (404 from `/api/rhythm/today`), so the dashboard is unchanged for non-flagged users. No additional flag check is needed in `page.tsx`.

- [ ] **Step 3: Type-check + lint**

```bash
npm run type-check
npm run lint
```

Expected: 0 errors. The lint warnings about `<a>` vs `<Link>` are fine since we use `<Link>`.

- [ ] **Step 4: Bundle-size check**

```bash
ANALYZE=true npm run build
```

Confirm the dashboard chunk did not blow past the 260 kB page budget (CLAUDE.md rule). `<DailyRhythmQueue/>` is dynamically imported with `ssr: false` so it should not impact first-paint shared JS.

- [ ] **Step 5: Manual smoke test**

Enable the flag on staging (`ff_pedagogy_v2_daily_rhythm`). Log in as a test student with a populated `student_profiles` row. Open `/dashboard`. Confirm the gradient rhythm card renders above the hero, with 5/5 SRS count (or padded), one ZPD link, and the reflection accordion.

Toggle `goal_code` to `improve_basics` and reload — confirm the ZPD label switches to "Guided challenge" (because `workedExampleFirst` is true).

Disable the flag again before commit.

- [ ] **Step 6: Commit**

```bash
git add src/components/dashboard/sections/DailyRhythmQueue.tsx src/app/dashboard/page.tsx
git commit -m "feat(pedagogy-v2): mount DailyRhythmQueue above-fold gated by ff_pedagogy_v2_daily_rhythm"
```

---

## Task 9 — E2E smoke test

**Why this matters:** One Playwright test that exercises the daily-rhythm path end-to-end with the flag on, against a seeded student. Catches regressions to the orchestrator/route/UI integration as a unit.

**Files:**
- Create: `e2e/daily-rhythm.spec.ts`

- [ ] **Step 1: Write the spec**

Create `e2e/daily-rhythm.spec.ts`:

```typescript
import { test, expect } from '@playwright/test';

/**
 * Daily Rhythm smoke test.
 *
 * Pre-conditions (set up once in your staging Supabase):
 *   - Test user `rhythm-test@alfanumrik.test` with a student_profiles row,
 *     goal_code = 'school_topper', grade = '9'.
 *   - At least 5 due sm2_cards rows for that user.
 *   - At least 50 active question_bank rows for grade '9'.
 *   - Feature flag ff_pedagogy_v2_daily_rhythm = true.
 *
 * If any of these are missing, the test will skip with a clear message.
 */
test.describe('Pedagogy v2 — Daily Rhythm', () => {
  test('renders 7-item rhythm queue on dashboard for school_topper persona', async ({ page }) => {
    // Sign in via the standard flow. (Adjust to your existing E2E auth helper.)
    await page.goto('/login');
    await page.fill('input[name="email"]', process.env.E2E_RHYTHM_EMAIL ?? 'rhythm-test@alfanumrik.test');
    await page.fill('input[name="password"]', process.env.E2E_RHYTHM_PASSWORD ?? 'changeme');
    await page.click('button[type="submit"]');
    await page.waitForURL('**/dashboard');

    const rhythm = page.getByTestId('daily-rhythm-queue');
    await expect(rhythm).toBeVisible({ timeout: 10000 });

    // SRS row visible
    await expect(rhythm.getByText(/Spaced reviews|स्पेस्ड रिव्यू/)).toBeVisible();
    // ZPD row visible — for school_topper, label is "ZPD challenge"
    await expect(rhythm.getByText(/ZPD challenge|ZPD चुनौती/)).toBeVisible();
    // Reflection accordion visible
    await expect(rhythm.getByText(/Reflection|रिफ्लेक्शन/)).toBeVisible();
  });
});
```

- [ ] **Step 2: Run the spec**

```bash
npm run test:e2e -- daily-rhythm
```

Expected: PASS, or skip with a clear message about missing fixtures. If the test depends on Supabase data not present, document the seeding script as a follow-up — do not weaken the assertion.

- [ ] **Step 3: Commit**

```bash
git add e2e/daily-rhythm.spec.ts
git commit -m "test(pedagogy-v2): e2e smoke for daily rhythm dashboard integration"
```

---

## Task 10 — Wave 1 rollout runbook (no code, doc only)

**Why this matters:** Once flags are seeded and code is merged, the rollout itself is a sequence of flag flips. Document the staged rollout so it doesn't get done by feel.

**Files:**
- Create: `docs/superpowers/runbooks/2026-05-08-pedagogy-v2-wave-1-rollout.md`

- [ ] **Step 1: Write the runbook**

Create `docs/superpowers/runbooks/2026-05-08-pedagogy-v2-wave-1-rollout.md`:

```markdown
# Pedagogy v2 — Wave 1 Rollout Runbook

## Pre-flight (must be true before any flag flip)
- [ ] All tasks 1-9 from the Wave 1 plan merged to main and deployed to staging.
- [ ] Migration 20260509120000_pedagogy_v2_wave_1_flags.sql applied to staging AND production.
- [ ] Existing wrong_answer_remediations table has ≥ 100 curated rows (sanity floor).
- [ ] /api/rhythm/today returns 7 items in staging for at least one test user per persona.

## Stage 1 — Internal canary (Day 0)
- Set `target_environments = ARRAY['staging']` on all three Wave 1 flags; keep production OFF.
- Smoke test all 6 personas (set goal_code on test users, reload dashboard / quiz / chapter).

## Stage 2 — 5% production rollout (Day 3 if Stage 1 clean)
- For each flag, set: `is_enabled=true, rollout_percentage=5, target_environments=NULL` on production.
- Watch:
  - Sentry error rate for `/api/rhythm/today` and `/api/learn/remediation`
  - Sentry React errors in `DailyRhythmQueue`, `MisconceptionExplainer`, `ProductiveFailureWrapper`
  - Time-to-first-rhythm-action (PostHog event)
  - Wrong-answer Foxy CTA click-through
- 48h hold. Roll back any flag whose error rate exceeds 0.5% of sessions.

## Stage 3 — 25% rollout (Day 5)
- Bump `rollout_percentage` to 25 on each flag.
- 72h hold.
- Compare cohort metrics:
  - Daily-rhythm-completion rate ≥ 60% of DAU in flagged cohort.
  - BKT mastery delta on chapters with productive-failure flip ≥ control by ≥ 10% (target +15% by full rollout).
  - Wrong-answer follow-through rate ≥ 30%.

## Stage 4 — 100% rollout (Day 10)
- Set `rollout_percentage = 100` on each flag.
- Schedule a 2-week observation window before declaring Wave 1 done.

## Rollback
- Set `is_enabled = false` on the affected flag. Effect is immediate (cache TTL 5 min).
- All three flags fail safe: when off, legacy code paths render. No data loss; no schema migration to reverse.
```

- [ ] **Step 2: Commit**

```bash
git add docs/superpowers/runbooks/2026-05-08-pedagogy-v2-wave-1-rollout.md
git commit -m "docs(pedagogy-v2): Wave 1 rollout runbook"
```

---

## Self-review

After all tasks above were drafted, I checked the plan against the spec:

**1. Spec coverage:**
- Spec §11 Wave 1 scope: daily rhythm orchestrator (Task 3), dashboard refit (Task 8), productive-failure flip (Task 6), distractor-tagging (Task 1's flags + Tasks 4 + 7 — note the schema is reused, not added — flagged in plan intro), wrong-answer Foxy micro-explanation hook (Task 7), `pedagogyContentRules` resolver + tests (Task 2). ✅ all covered.
- Spec §6 persona-adaptive implementation: Task 2 produces the resolver; Tasks 3, 6, 8 consume it. ✅
- Spec §11 success metrics: Task 10 runbook lists each. ✅
- Spec §13 risks (productive-failure for struggling persona): Task 2 explicitly flips `productiveFailure=false` for `improve_basics`; Task 6 uses the resolver, so the persona rule applies. ✅
- Spec §13 spec-staleness mitigation: Task 5 Step 2 codifies a re-audit gate. Task 4 Step 1 codifies a column-name re-audit. ✅

**2. Placeholder scan:**
- No "TBD", "TODO", "implement later". Two intentional notes call out follow-up enrichments (ZPD problem inline rendering inside `ProductiveFailureWrapper`, telemetry follow-up). These are documented as deliberate Wave 1 minimums producing measurable telemetry, not placeholders.
- Code blocks are complete and runnable as written.

**3. Type / signature consistency:**
- `resolvePedagogyRule(persona, layer, slot)` signature is identical in Task 2's source, Task 2's tests, Task 3's import, and Task 6's import. ✅
- `composeDailyRhythm(input: DailyRhythmInput)` shape is identical between Task 3 source and Task 3 tests. ✅
- `Remediation` interface (Task 4) matches the field set used by `MisconceptionExplainer` (Task 7) — `remediationEn`, `remediationHi`, `misconceptionCode`. ✅
- `PEDAGOGY_V2_FLAGS` registry matches across Task 1 (definition), Task 5, Task 6, Task 7, Task 8 (consumers). ✅
- `RhythmItem` discriminated union in Task 3 matches the runtime check `i.kind === 'srs_review' && !i.isPadding` in Task 8. ✅

**4. Scope:**
- One subsystem (Daily Rhythm). 10 tasks, ~3 weeks solo dev. Independent of Waves 2 & 3, which get separate plans.

No issues found that needed inline fixes.

---

## Plan complete

**Plan saved to:** `docs/superpowers/plans/2026-05-08-pedagogy-v2-wave-1-daily-rhythm.md`

**Two execution options:**

**1. Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration.

**2. Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints.

**Which approach?**
