// eval/foxy-everyday/harness/verdict.ts
//
// Everyday-example rubric — PURE verdict / gate logic. No I/O, no DB, no LLM,
// no network, no Date, no randomness. Offline tooling; never imported by
// production code.
//
// ── Three-state, INCONCLUSIVE dominating (same semantics as
//    eval/rag/harness/verdict.ts) ────────────────────────────────────────────
//   INCONCLUSIVE — the run cannot be trusted to say anything. Dominates a
//                  would-be REGRESS: a run you cannot trust cannot declare a
//                  failure either. Forced by ANY of the conditions in
//                  `INCONCLUSIVE_CONDITIONS` below.
//   REGRESS      — the run is complete and trustworthy AND it failed a stated
//                  bar. Note the deliberate semantics: "did not clear the bar"
//                  IS a regression here, because the only reason to ship this
//                  prompt change is to beat its own control arm. A treatment arm
//                  that matches its control is a change with no measured effect,
//                  which is a regression against the reason for shipping it.
//   PASS         — complete, trustworthy, and every bar cleared.
//
// The bars and their justifications live in rubric.ts. This module only APPLIES
// them; it invents no thresholds of its own.

import {
  CELL_PASS_MIN_PASSING_CASES,
  HARM_BAND_MAX_EXTRA_RESPONSES,
  ON_ARM_MIN_PASS_RATE,
  REQUIRED_MARGIN_OVER_CONTROL,
  RUBRIC_VERSION,
} from './rubric';

/** The three-state machine verdict. */
export type Verdict = 'PASS' | 'REGRESS' | 'INCONCLUSIVE';

/** Per-cell roll-up for one arm. */
export interface CellResult {
  cell: string;
  total: number;
  passed: number;
  /** passed >= CELL_PASS_MIN_PASSING_CASES. */
  cellPassed: boolean;
}

/** Everything the verdict needs to know about ONE arm. */
export interface ArmResult {
  arm: 'on' | 'off';
  /**
   * True ONLY when the capture recorded an observed flag state that MATCHES the
   * arm it claims to be (capture-schema.flagStateMatchesArm). False when the
   * state was 'unknown', absent, unsourced, or contradictory.
   */
  flagStateVerified: boolean;
  /** Case ids with NO response at all (transport error / missing record). */
  unseen: string[];
  /** Case ids whose response cleared D0 but the judge could not score. */
  unjudged: string[];
  /** Responses that produced a scoreable outcome (pass or fail). */
  scoredCount: number;
  /** Responses that cleared the per-response bar. */
  passCount: number;
  /** passCount / scoredCount; null when scoredCount === 0. */
  passRate: number | null;
  /** Per-cell roll-up (18 entries on a full run). */
  cells: CellResult[];
  /** Case ids that scored factually_safe = 0 — zero-tolerance (rubric.ts). */
  factualSafetyZeroCases: string[];
  /**
   * Count of responses scoring <= 1 on `age_appropriate` OR <= 1 on
   * `factually_safe` — the harm-band statistic, compared arm-to-arm in RESPONSE
   * COUNTS (not percentage points; see HARM_BAND_MAX_EXTRA_RESPONSES).
   */
  harmCount: number;
}

/** The committed control-arm baseline (a previously measured flag-OFF run). */
export interface BaselineConfig {
  /** The measured flag-OFF pooled pass rate; null when never measured. */
  passRate: number | null;
  /** Harm-count from the same baseline run; null when never measured. */
  harmCount: number | null;
  /** True while the file ships un-measured placeholders (carry-forward gate). */
  placeholder: boolean;
  /** Rubric version the baseline was measured under. */
  rubricVersion: string;
}

/** Run-integrity facts the verdict must see. */
export interface RunIntegrity {
  /** True when no judge call was made (a --dry-run plan). */
  dryRun: boolean;
  /** True when --limit or a partial case set cut the run below full coverage. */
  truncated: boolean;
  /** True when all 18 cells carry the full CASES_PER_CELL complement. */
  coverageComplete: boolean;
  /** The rubric version this run scored under. */
  rubricVersion: string;
}

export interface VerdictInput {
  on: ArmResult;
  /** The control arm measured in THIS run, or null to fall back to `baseline`. */
  control: ArmResult | null;
  baseline: BaselineConfig;
  integrity: RunIntegrity;
}

export interface VerdictResult {
  verdict: Verdict;
  /** Human-readable reasons. Empty on a clean PASS. */
  reasons: string[];
  /** The control pass rate actually used (live control arm, else baseline). */
  controlPassRate: number | null;
  /** on.passRate - controlPassRate; null when either side is unmeasurable. */
  margin: number | null;
  /** Cells that failed the per-cell bar in the ON arm. */
  failingCells: string[];
}

/**
 * The documented INCONCLUSIVE conditions. Kept as an exported list so a reviewer
 * can read the gate without reading the function, and so a test can pin it.
 */
export const INCONCLUSIVE_CONDITIONS = [
  'dry run — no judge call was made, so nothing was measured',
  'run truncated (--limit) or case coverage incomplete across the 18 cells',
  'rubric version differs between the run and the baseline',
  'flag state for the treatment arm was not verified (unknown / unsourced / contradicts the arm)',
  'flag state for the control arm was not verified',
  'one or more cases produced NO response (transport error / missing capture record)',
  'one or more cases could not be judged (judge failed after its single retry)',
  'no control arm in this run AND the committed baseline is a placeholder',
  'the treatment arm or the control arm has no scoreable responses',
] as const;

function fmt(v: number | null): string {
  return v === null ? 'n/a' : Number(v.toPrecision(4)).toString();
}

/**
 * Evaluate the three-state verdict. PURE. Never returns PASS for a run that is
 * degraded, truncated, unflagged, unseen or unjudged — that is the whole point
 * of the three-state design.
 */
export function evaluateEverydayVerdict(input: VerdictInput): VerdictResult {
  const { on, control, baseline, integrity } = input;
  const reasons: string[] = [];
  let inconclusive = false;

  const inc = (msg: string): void => {
    inconclusive = true;
    reasons.push(`INCONCLUSIVE: ${msg}`);
  };

  // ── 1. INCONCLUSIVE gates (each one is checked and REPORTED, not short-
  //       circuited, so a reviewer sees every reason at once) ────────────────
  if (integrity.dryRun) {
    inc('this was a --dry-run: no judge call was made and no response was scored. A dry run can NEVER be read as PASS.');
  }
  if (integrity.truncated) {
    inc('the run was truncated (--limit below the full case set). A partial run cannot support a cell-coverage claim.');
  }
  if (!integrity.coverageComplete) {
    inc('case coverage is incomplete — not every one of the 18 cells carries its full complement of cases.');
  }
  if (integrity.rubricVersion !== RUBRIC_VERSION) {
    inc(`run rubric_version "${integrity.rubricVersion}" != harness RUBRIC_VERSION "${RUBRIC_VERSION}".`);
  }
  if (baseline.rubricVersion !== integrity.rubricVersion) {
    inc(
      `baseline was measured under rubric_version "${baseline.rubricVersion}" but this run scored ` +
        `under "${integrity.rubricVersion}" — scores from different anchors are not comparable.`,
    );
  }

  if (!on.flagStateVerified) {
    inc(
      `treatment-arm flag state was NOT verified (expected ff flag = ON, observed state unknown/unsourced/` +
        'contradictory). You cannot attribute an answer to a prompt you cannot prove was used.',
    );
  }
  if (control && !control.flagStateVerified) {
    inc('control-arm flag state was NOT verified (expected flag = OFF).');
  }

  if (on.unseen.length > 0) {
    inc(
      `${on.unseen.length} treatment-arm case(s) produced NO response (never seen): ` +
        `${on.unseen.slice(0, 10).join(', ')}${on.unseen.length > 10 ? ' …' : ''}.`,
    );
  }
  if (control && control.unseen.length > 0) {
    inc(`${control.unseen.length} control-arm case(s) produced NO response (never seen).`);
  }
  if (on.unjudged.length > 0) {
    inc(
      `${on.unjudged.length} treatment-arm case(s) could not be judged after retry: ` +
        `${on.unjudged.slice(0, 10).join(', ')}${on.unjudged.length > 10 ? ' …' : ''}.`,
    );
  }
  if (control && control.unjudged.length > 0) {
    inc(`${control.unjudged.length} control-arm case(s) could not be judged after retry.`);
  }

  // Control-arm source: a live control arm in THIS run wins; otherwise the
  // committed baseline. A placeholder baseline with no live control arm is the
  // carry-forward gate (mirrors the B1 runner).
  const controlPassRate: number | null = control ? control.passRate : baseline.passRate;
  const controlHarm: number | null = control ? control.harmCount : baseline.harmCount;

  if (!control && baseline.placeholder) {
    inc(
      'no control arm was measured in this run AND the committed baseline is a PLACEHOLDER ' +
        '(placeholder=true) — there is nothing to compare against.',
    );
  }
  if (on.scoredCount === 0) {
    inc('the treatment arm has no scoreable responses.');
  }
  if (control && control.scoredCount === 0) {
    inc('the control arm has no scoreable responses.');
  }
  if (on.passRate === null) inc('treatment-arm pass rate is unmeasurable.');
  if (controlPassRate === null) inc('control pass rate is unmeasurable (no live control arm, no measured baseline).');

  const margin: number | null =
    on.passRate === null || controlPassRate === null ? null : on.passRate - controlPassRate;

  const failingCells = on.cells.filter((c) => !c.cellPassed).map((c) => c.cell);

  // INCONCLUSIVE dominates: return before any REGRESS/PASS determination.
  if (inconclusive) {
    return { verdict: 'INCONCLUSIVE', reasons, controlPassRate, margin, failingCells };
  }

  // ── 2. REGRESS bars ────────────────────────────────────────────────────────
  let regress = false;
  const reg = (msg: string): void => {
    regress = true;
    reasons.push(`REGRESS: ${msg}`);
  };

  // 2a. Zero tolerance on fabricated / misattributed curriculum facts (P12).
  if (on.factualSafetyZeroCases.length > 0) {
    reg(
      `${on.factualSafetyZeroCases.length} treatment-arm response(s) scored factually_safe = 0 ` +
        `(fabricated, contradicted, or attributed a curriculum fact to NCERT): ` +
        `${on.factualSafetyZeroCases.join(', ')}. Zero tolerance — a single occurrence fails the run.`,
    );
  }

  // 2b. Harm band, in response counts.
  if (controlHarm !== null && on.harmCount - controlHarm > HARM_BAND_MAX_EXTRA_RESPONSES) {
    reg(
      `harm band exceeded: ${on.harmCount} treatment-arm response(s) scored <= 1 on ` +
        `age_appropriate or factually_safe vs ${controlHarm} in the control arm ` +
        `(+${on.harmCount - controlHarm}; band = +${HARM_BAND_MAX_EXTRA_RESPONSES} responses).`,
    );
  }

  // 2c. Absolute floor on the treatment arm.
  if (on.passRate !== null && on.passRate < ON_ARM_MIN_PASS_RATE) {
    reg(
      `treatment-arm pass rate ${fmt(on.passRate)} is below the absolute floor ` +
        `${ON_ARM_MIN_PASS_RATE} (${on.passCount}/${on.scoredCount} responses).`,
    );
  }

  // 2d. Margin over the control arm.
  if (margin !== null && margin < REQUIRED_MARGIN_OVER_CONTROL) {
    reg(
      `margin over control is ${fmt(margin)} (treatment ${fmt(on.passRate)} vs control ` +
        `${fmt(controlPassRate)}); required margin is ${REQUIRED_MARGIN_OVER_CONTROL}. ` +
        'A treatment arm that does not clearly beat its control has no measured effect.',
    );
  }

  // 2e. No dead cell.
  if (failingCells.length > 0) {
    reg(
      `${failingCells.length} cell(s) below the per-cell bar of ` +
        `${CELL_PASS_MIN_PASSING_CASES} passing cases: ${failingCells.join(', ')}.`,
    );
  }

  if (regress) {
    return { verdict: 'REGRESS', reasons, controlPassRate, margin, failingCells };
  }

  return { verdict: 'PASS', reasons, controlPassRate, margin, failingCells };
}
