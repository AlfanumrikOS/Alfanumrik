// eval/foxy-everyday/harness/run-eval.ts
//
// Everyday-example rubric — the RUNNER / ORCHESTRATOR + the report artifact.
//
//   validate case set (case-schema)
//     → for each arm (treatment = flag ON, control = flag OFF):
//         validate capture + verify its flag state
//         → per case: D0 detect (deterministic, free)
//         → judge D1..D5 ONLY when D0 passed (the spend guard)
//         → per-response bar (rubric.evaluateResponse)
//         → per-cell roll-up + arm aggregate
//     → evaluateEverydayVerdict(on, control, baseline, integrity)
//     → EverydayReport → writeReport()
//
// Offline tooling; never imported by production code. Writes ONLY to
// eval/foxy-everyday/reports/. Zero DB writes, zero corpus writes, no
// re-embedding, no Voyage call, no vision model, no new service.
//
// ── Dependency injection (same design as eval/rag/harness/run-eval.ts) ───────
// The runner takes the judge's LLM transport as an INJECTED `complete` function.
// It embeds no AI SDK, no endpoint URL and no API key handling, so the unit lane
// can drive the whole orchestrator with a fake and make zero network calls.
// An optional `generate` seam exists for a caller that wants to produce the
// responses live instead of replaying a capture file; this harness never
// supplies one.
//
// ── Spend guards (mirroring .github/workflows/rag-cosine-replay.yml) ─────────
//   1. `dryRun` defaults TRUE at the CLI. A dry run costs exactly nothing and is
//      ALWAYS INCONCLUSIVE.
//   2. `maxCases` is bounded and has no "unlimited" value.
//   3. Judge calls are made only for responses that already contain an example
//      block, so the worst case is one judge call per case per arm.
//   4. A truncated run can never be a PASS (verdict.integrity.truncated).

import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  CASES_PER_CELL,
  CELL_PASS_MIN_PASSING_CASES,
  DIMENSIONS,
  MAX_SCORE,
  MEASURED_FLAG,
  ON_ARM_MIN_PASS_RATE,
  REQUIRED_MARGIN_OVER_CONTROL,
  RESPONSE_PASS_BAR,
  RUBRIC_VERSION,
  evaluateResponse,
  type DimensionScores,
  type ResponseFailReason,
} from './rubric';
import {
  CELL_KEYS,
  cellKey,
  coverageByCell,
  validateCaseSet,
  type EverydayCase,
  type EverydayCaseSet,
} from './case-schema';
import {
  flagStateMatchesArm,
  validateCapture,
  type Arm,
  type EverydayCapture,
} from './capture-schema';
import { detectExampleBlock, extractAnswerContext } from './detect';
import {
  JUDGE_MODEL,
  JUDGE_RUBRIC_VERSION,
  JUDGE_TEMPERATURE,
  judgeEverydayExample,
  type JudgeCompletionFn,
} from './judge';
import {
  evaluateEverydayVerdict,
  type ArmResult,
  type BaselineConfig,
  type CellResult,
  type VerdictResult,
} from './verdict';

// ─── Bounds ──────────────────────────────────────────────────────────────────

/**
 * Hard ceiling on cases per arm. 54 = 18 cells x 3. There is deliberately no
 * "unlimited" option: the spend is bounded by construction before a single judge
 * call is made, exactly as the cosine-replay workflow bounds Voyage spend.
 */
export const MAX_CASES_PER_ARM = 54;

// ─── Report shapes ───────────────────────────────────────────────────────────

/** Per-case forensic record. */
export interface ReportCase {
  case_id: string;
  cell: string;
  grade: string;
  subject: string;
  turn_type: string;
  topic: string;
  corpus_state: string;
  /** 'scored' | 'unseen' | 'unjudged'. */
  status: 'scored' | 'unseen' | 'unjudged';
  /** D0. */
  has_example: boolean;
  /** True when the raw response was not parseable JSON with a blocks array. */
  malformed: boolean;
  /** D1..D5; null when the case was never judged. */
  scores: DimensionScores | null;
  /** One short judge sentence per dimension; empty when unjudged. */
  reasons: Record<string, string>;
  total: number;
  passed: boolean;
  fail_reasons: ResponseFailReason[];
  /** Populated for `unseen` / `unjudged`. */
  error?: string;
}

/** One arm's block in the report. */
export interface ReportArm {
  arm: Arm;
  flag_state_verified: boolean;
  flag_observed_state: boolean | 'unknown' | null;
  cases: ReportCase[];
  result: ArmResult;
  /** Judge calls actually made for this arm (the token-spend record). */
  judge_calls: number;
}

export interface ReportMeta {
  generated_at: string;
  rubric_version: string;
  case_set_version: string;
  measured_flag: string;
  judge_model: string;
  judge_temperature: number;
  dry_run: boolean;
  truncated: boolean;
  coverage_complete: boolean;
  max_cases_per_arm: number;
  bars: {
    response_min_score: number;
    response_min_per_dimension: number;
    response_thesis_min_sum: number;
    max_score: number;
    cell_min_passing_cases: number;
    cases_per_cell: number;
    on_arm_min_pass_rate: number;
    required_margin_over_control: number;
  };
}

export interface EverydayReport {
  run: ReportMeta;
  verdict: VerdictResult;
  arms: ReportArm[];
  /** Cases per cell actually present in the run, for the coverage claim. */
  coverage: Array<{ cell: string; cases: number }>;
}

// ─── Deps ────────────────────────────────────────────────────────────────────

export interface RunEverydayEvalDeps {
  /** The case-set document (already in memory). Re-validated here. */
  caseSet: EverydayCaseSet;
  /** The treatment-arm capture (flag ON). */
  onCapture: EverydayCapture;
  /** The control-arm capture (flag OFF). Null → fall back to the baseline file. */
  offCapture: EverydayCapture | null;
  /** The committed control-arm baseline. */
  baseline: BaselineConfig;
  /**
   * The judge's LLM transport. REQUIRED unless `dryRun` is true — the runner
   * holds no AI client of its own.
   */
  complete: JudgeCompletionFn | null;
  /** Plan only. No judge call, no spend, ALWAYS INCONCLUSIVE. */
  dryRun: boolean;
  /** Bounded case cap per arm (1..MAX_CASES_PER_ARM). */
  maxCases: number;
}

// ─── Internals ───────────────────────────────────────────────────────────────

function emptyReasons(): Record<string, string> {
  const r: Record<string, string> = {};
  for (const d of DIMENSIONS) r[d] = '';
  return r;
}

function rollUpCells(cases: ReportCase[]): CellResult[] {
  const byCell = new Map<string, { total: number; passed: number }>();
  for (const c of cases) {
    const entry = byCell.get(c.cell) ?? { total: 0, passed: 0 };
    entry.total += 1;
    if (c.passed) entry.passed += 1;
    byCell.set(c.cell, entry);
  }
  return [...byCell.entries()]
    .map(([cell, v]) => ({
      cell,
      total: v.total,
      passed: v.passed,
      cellPassed: v.passed >= CELL_PASS_MIN_PASSING_CASES,
    }))
    .sort((a, b) => CELL_KEYS.indexOf(a.cell) - CELL_KEYS.indexOf(b.cell));
}

/**
 * Score ONE arm. Returns the per-case records + the aggregate the verdict reads.
 *
 * Judge-call policy (the spend guard): a case is sent to the judge if and ONLY
 * if D0 found a qualifying `example` block. No example -> no tokens.
 */
async function scoreArm(
  capture: EverydayCapture,
  cases: readonly EverydayCase[],
  complete: JudgeCompletionFn | null,
  dryRun: boolean,
): Promise<{ arm: ReportArm; plannedJudgeCalls: number }> {
  const byCaseId = new Map(capture.responses.map((r) => [r.case_id, r]));
  const reportCases: ReportCase[] = [];
  const unseen: string[] = [];
  const unjudged: string[] = [];
  const factualSafetyZeroCases: string[] = [];
  let passCount = 0;
  let scoredCount = 0;
  let harmCount = 0;
  let judgeCalls = 0;
  let plannedJudgeCalls = 0;

  for (const c of cases) {
    const base = {
      case_id: c.id,
      cell: cellKey(c.grade, c.subject),
      grade: c.grade,
      subject: c.subject,
      turn_type: c.turn_type,
      topic: c.topic,
      corpus_state: c.corpus_state,
    };

    const captured = byCaseId.get(c.id);

    // ── UNSEEN: no record, or a transport error. NOT a failure — we are not
    //    entitled to score a response we never saw. Forces INCONCLUSIVE.
    if (!captured || (captured.transport_error && !captured.raw_response)) {
      unseen.push(c.id);
      reportCases.push({
        ...base,
        status: 'unseen',
        has_example: false,
        malformed: false,
        scores: null,
        reasons: emptyReasons(),
        total: 0,
        passed: false,
        fail_reasons: [],
        error: captured?.transport_error ?? 'no capture record for this case id',
      });
      continue;
    }

    const raw = captured.raw_response as string;
    const d0 = detectExampleBlock(raw);
    const malformed = !d0.parsed;

    // ── D0 FAIL: seen, but no usable example block (or unparseable). Scored as
    //    a FAIL with zero judge spend.
    if (!d0.hasExample) {
      const outcome = evaluateResponse(false, null, malformed);
      scoredCount += 1;
      reportCases.push({
        ...base,
        status: 'scored',
        has_example: false,
        malformed,
        scores: null,
        reasons: emptyReasons(),
        total: 0,
        passed: false,
        fail_reasons: outcome.reasons,
        error: d0.parseError,
      });
      continue;
    }

    // ── D0 PASS: this is the only path that spends tokens.
    plannedJudgeCalls += 1;

    if (dryRun || !complete) {
      // Plan only — record the case as unjudged WITHOUT calling the judge. The
      // dryRun integrity flag independently forces INCONCLUSIVE, so this can
      // never be mistaken for a measured pass.
      unjudged.push(c.id);
      reportCases.push({
        ...base,
        status: 'unjudged',
        has_example: true,
        malformed: false,
        scores: null,
        reasons: emptyReasons(),
        total: 0,
        passed: false,
        fail_reasons: [],
        error: dryRun ? 'dry run — judge not called' : 'no judge transport supplied',
      });
      continue;
    }

    judgeCalls += 1;
    const judged = await judgeEverydayExample(
      {
        grade: c.grade,
        subject: c.subject,
        topic: c.topic,
        turnType: c.turn_type,
        prompt: c.prompt,
        exampleTexts: d0.exampleTexts,
        answerContext: extractAnswerContext(raw),
      },
      { complete },
    );

    if (!judged.ok) {
      // Judge failed after its single retry — UNJUDGED, forces INCONCLUSIVE.
      // Never silently a zero.
      unjudged.push(c.id);
      reportCases.push({
        ...base,
        status: 'unjudged',
        has_example: true,
        malformed: false,
        scores: null,
        reasons: emptyReasons(),
        total: 0,
        passed: false,
        fail_reasons: [],
        error: judged.error,
      });
      continue;
    }

    const { scores, reasons } = judged.value;
    const outcome = evaluateResponse(true, scores, false);
    scoredCount += 1;
    if (outcome.passed) passCount += 1;
    if (scores.factually_safe === 0) factualSafetyZeroCases.push(c.id);
    if (scores.age_appropriate <= 1 || scores.factually_safe <= 1) harmCount += 1;

    reportCases.push({
      ...base,
      status: 'scored',
      has_example: true,
      malformed: false,
      scores,
      reasons,
      total: outcome.total,
      passed: outcome.passed,
      fail_reasons: outcome.reasons,
    });
  }

  const result: ArmResult = {
    arm: capture.arm,
    flagStateVerified: flagStateMatchesArm(capture),
    unseen,
    unjudged,
    scoredCount,
    passCount,
    passRate: scoredCount === 0 ? null : passCount / scoredCount,
    cells: rollUpCells(reportCases.filter((rc) => rc.status === 'scored')),
    factualSafetyZeroCases,
    harmCount,
  };

  return {
    arm: {
      arm: capture.arm,
      flag_state_verified: result.flagStateVerified,
      flag_observed_state: capture.flag?.observed_state ?? null,
      cases: reportCases,
      result,
      judge_calls: judgeCalls,
    },
    plannedJudgeCalls,
  };
}

// ─── The orchestrator ────────────────────────────────────────────────────────

/**
 * Run the everyday-example rubric over a treatment capture and (optionally) a
 * control capture. Performs NO file writes — the caller persists via
 * `writeReport`. Throws ONLY on operator error (an invalid fixture); every
 * measurement outcome is a verdict, never an exception.
 */
export async function runEverydayEval(deps: RunEverydayEvalDeps): Promise<EverydayReport> {
  const { caseSet, onCapture, offCapture, baseline, complete, dryRun, maxCases } = deps;

  const validatedSet = validateCaseSet(caseSet);
  if (!validatedSet.ok) {
    throw new Error(`case set failed validation:\n${validatedSet.errors.join('\n')}`);
  }
  const onValid = validateCapture(onCapture);
  if (!onValid.ok) {
    throw new Error(`treatment capture failed validation:\n${onValid.errors.join('\n')}`);
  }
  if (offCapture) {
    const offValid = validateCapture(offCapture);
    if (!offValid.ok) {
      throw new Error(`control capture failed validation:\n${offValid.errors.join('\n')}`);
    }
  }

  const bounded = Math.max(1, Math.min(maxCases, MAX_CASES_PER_ARM));
  const allCases = validatedSet.value.cases;
  const selected = allCases.slice(0, bounded);
  const truncated = selected.length < allCases.length;

  const coverage = coverageByCell(selected);
  const coverageComplete = CELL_KEYS.every((k) => (coverage.get(k) ?? 0) >= CASES_PER_CELL);

  const onScored = await scoreArm(onValid.value, selected, complete, dryRun);
  const offScored = offCapture
    ? await scoreArm(offCapture, selected, complete, dryRun)
    : null;

  const verdict = evaluateEverydayVerdict({
    on: onScored.arm.result,
    control: offScored ? offScored.arm.result : null,
    baseline,
    integrity: {
      dryRun,
      truncated,
      coverageComplete,
      rubricVersion: validatedSet.value.rubric_version,
    },
  });

  const arms: ReportArm[] = [onScored.arm];
  if (offScored) arms.push(offScored.arm);

  return {
    run: {
      generated_at: new Date().toISOString(),
      rubric_version: RUBRIC_VERSION,
      case_set_version: validatedSet.value.version,
      measured_flag: MEASURED_FLAG,
      judge_model: JUDGE_MODEL,
      judge_temperature: JUDGE_TEMPERATURE,
      dry_run: dryRun,
      truncated,
      coverage_complete: coverageComplete,
      max_cases_per_arm: MAX_CASES_PER_ARM,
      bars: {
        response_min_score: RESPONSE_PASS_BAR.minScore,
        response_min_per_dimension: RESPONSE_PASS_BAR.minPerDimension,
        response_thesis_min_sum: RESPONSE_PASS_BAR.thesisMinSum,
        max_score: MAX_SCORE,
        cell_min_passing_cases: CELL_PASS_MIN_PASSING_CASES,
        cases_per_cell: CASES_PER_CELL,
        on_arm_min_pass_rate: ON_ARM_MIN_PASS_RATE,
        required_margin_over_control: REQUIRED_MARGIN_OVER_CONTROL,
      },
    },
    verdict,
    arms,
    coverage: CELL_KEYS.map((cell) => ({ cell, cases: coverage.get(cell) ?? 0 })),
  };
}

/**
 * Count the judge calls a REAL run would make, without making any. Used by the
 * CLI's --dry-run cost estimate. Pure w.r.t. the network.
 */
export function planJudgeCalls(
  caseSet: EverydayCaseSet,
  captures: readonly EverydayCapture[],
  maxCases: number,
): number {
  const bounded = Math.max(1, Math.min(maxCases, MAX_CASES_PER_ARM));
  const ids = new Set(caseSet.cases.slice(0, bounded).map((c) => c.id));
  let planned = 0;
  for (const cap of captures) {
    for (const r of cap.responses) {
      if (!ids.has(r.case_id)) continue;
      if (!r.raw_response) continue;
      if (detectExampleBlock(r.raw_response).hasExample) planned += 1;
    }
  }
  return planned;
}

// ─── Report-artifact persistence ─────────────────────────────────────────────

/** Where this rubric writes its own report artifacts. */
export const REPORTS_DIR = resolve(__dirname, '..', 'reports');

/**
 * Write the report. Returns the path. Timestamped so historical runs do not
 * clobber. A reader consumes the VERDICT field of this artifact — the process
 * exit code is not the signal (see cli.ts).
 */
export function writeReport(report: EverydayReport, dir: string = REPORTS_DIR): string {
  mkdirSync(dir, { recursive: true });
  const stamp = report.run.generated_at.replace(/[:.]/g, '-');
  const path = resolve(dir, `everyday-eval-${stamp}.json`);
  writeFileSync(path, `${JSON.stringify(report, null, 2)}\n`, 'utf-8');
  return path;
}

export { JUDGE_RUBRIC_VERSION };
