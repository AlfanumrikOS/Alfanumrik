// eval/rag/harness/verdict.ts
//
// B1 retrieval-quality eval harness — Task 7: PURE verdict / gate logic.
// No I/O, no DB, no LLM, no network, no Date, no randomness. Offline tooling,
// NEVER imported by production / client code (enforced by the import-boundary
// test). Consumes the Task 2 metric outputs (each primary metric is a
// `number | null`, exactly the shape of `MetricStat.mean` from `metrics.ts`).
//
// ── What this module does ────────────────────────────────────────────────────
// Turns a measured run + a committed baseline into a deterministic three-state
// machine verdict: `PASS | REGRESS | INCONCLUSIVE`, applying the spec §B1.5 /
// A7 per-metric regress bands. This is the gate B2 tuning must beat.
//
// ── Three-state design (spec §B1.5 — the whole point) ────────────────────────
// You CANNOT gate a tuning decision on a measurement you do not trust.
//   INCONCLUSIVE  — the run is degraded (FTS-only because VOYAGE_API_KEY was
//                   absent, i.e. NOT the full embeddings+rerank path), OR any
//                   primary metric is null/undefined/unmeasurable, OR a baseline
//                   metric value needed for the band is null/missing. In ANY of
//                   these cases the verdict is INCONCLUSIVE and the function
//                   NEVER returns PASS or REGRESS. INCONCLUSIVE takes precedence
//                   over a would-be REGRESS — a degraded/incomplete run cannot be
//                   trusted to declare a regression either.
//   REGRESS       — the run is full-path AND complete AND ANY single primary
//                   metric crosses its A7 band vs baseline.
//   PASS          — the run is full-path AND complete AND every primary metric is
//                   within band (or improved).
//
// ── A7 per-metric bands (spec §B1.5) ─────────────────────────────────────────
//   nDCG@10           2%   RELATIVE  → drop > 0.02 * baseline ⇒ regress
//   recall@10         2%   RELATIVE  → drop > 0.02 * baseline ⇒ regress
//   MRR               3%   RELATIVE  → drop > 0.03 * baseline ⇒ regress
//   hit-rate@10       2pp  ABSOLUTE  → drop > 0.02            ⇒ regress
//   groundedness-rate 3pp  ABSOLUTE  → drop > 0.03            ⇒ regress
// The band test is STRICT ("> band"): a drop landing EXACTLY on the band floor is
// NOT a regression. The multi_hop full-coverage metric is reported per-cell but
// is NOT a primary gate metric in B1 (too noisy on small per-band counts).

// ─── Primary gate metrics ────────────────────────────────────────────────────

/** The five primary gate metric keys (spec §B1.5 / A7). Order is canonical. */
export const PRIMARY_METRICS = [
  'nDCG@10',
  'recall@10',
  'MRR',
  'hit-rate@10',
  'groundedness-rate',
] as const;

/** A primary gate metric key. */
export type PrimaryMetric = (typeof PRIMARY_METRICS)[number];

/** How a band is applied: relative to baseline, or absolute percentage points. */
export type BandType = 'relative' | 'absolute';

/** A single metric's regress band (the A7 row). */
export interface RegressBand {
  /** The band magnitude. RELATIVE = fraction of baseline; ABSOLUTE = pp as a
   *  fraction (2pp = 0.02). */
  band: number;
  type: BandType;
}

/**
 * The A7 per-metric regress bands (spec §B1.5 table). These are the
 * DEFAULT/canonical bands; the committed baseline JSON stores its own copy
 * inline (assessment-reviewed, NEVER auto-refreshed). `evaluateVerdict` uses the
 * bands carried IN the baseline argument — `REGRESS_BANDS` is the single source
 * of truth exported for the baseline file + the boundary tests to pin against.
 */
export const REGRESS_BANDS: Readonly<Record<PrimaryMetric, RegressBand>> = {
  'nDCG@10': { band: 0.02, type: 'relative' },
  'recall@10': { band: 0.02, type: 'relative' },
  MRR: { band: 0.03, type: 'relative' },
  'hit-rate@10': { band: 0.02, type: 'absolute' },
  'groundedness-rate': { band: 0.03, type: 'absolute' },
};

// ─── Input shapes ─────────────────────────────────────────────────────────────

/**
 * Per-metric measured value for a primary metric. `number | null | undefined`:
 *   - number    → a measured value (matches `MetricStat.mean` from metrics.ts);
 *   - null      → measured-but-unmeasurable (e.g. aggregate over an empty
 *                 measurable set, a missing groundedness sample);
 *   - undefined → the metric key was never produced by the run.
 * The last two BOTH force INCONCLUSIVE — a missing/unmeasurable metric can never
 * be silently treated as a PASS.
 */
export type MetricValue = number | null | undefined;

/** The measured current run. */
export interface CurrentMetrics {
  /**
   * True when the run did NOT use the full embeddings+rerank path (e.g. FTS-only
   * because `VOYAGE_API_KEY` was absent). A degraded run is ALWAYS INCONCLUSIVE.
   */
  degraded: boolean;
  /** The measured primary-metric values (each `number | null | undefined`). */
  metrics: Partial<Record<PrimaryMetric, MetricValue>>;
}

/**
 * The committed baseline. Holds the per-metric baseline values AND the per-metric
 * A7 bands inline (the bands are assessment-reviewed and NEVER auto-refreshed —
 * the verdict reads the bands FROM here, not from a hard-coded copy, so a
 * reviewed baseline change is the only way to move a band). A baseline value may
 * be `null`/`undefined` only before Task 10 populates it — in which case the
 * affected metric is unmeasurable-against and forces INCONCLUSIVE.
 */
export interface BaselineConfig {
  metrics: Partial<Record<PrimaryMetric, number | null>>;
  bands: Partial<Record<PrimaryMetric, RegressBand>>;
}

// ─── Output shapes ────────────────────────────────────────────────────────────

/** The three-state machine verdict. */
export type Verdict = 'PASS' | 'REGRESS' | 'INCONCLUSIVE';

/** Per-metric verdict detail row. */
export interface PerMetricVerdict {
  metric: PrimaryMetric;
  /** The baseline value (null when missing). */
  baseline: number | null;
  /** The measured current value (null when missing/unmeasurable). */
  current: number | null;
  /** `current - baseline` (null when either side is unmeasurable). A negative
   *  delta is a drop. */
  delta: number | null;
  /** The band type that applies to this metric. */
  bandType: BandType;
  /** The computed regress threshold (the max tolerated drop). null when it
   *  cannot be computed (e.g. relative band against a null baseline). */
  threshold: number | null;
  /** True when this metric crossed its band (a measurable regression). */
  regressed: boolean;
  /** True when this metric could not be evaluated (current OR baseline missing/
   *  unmeasurable) — contributes to INCONCLUSIVE, never to PASS/REGRESS. */
  inconclusive: boolean;
}

/** The full verdict result. */
export interface VerdictResult {
  verdict: Verdict;
  perMetric: PerMetricVerdict[];
  /** Human-readable reasons (degradation, each unmeasurable metric, each
   *  regression). Empty on a clean PASS. */
  reasons: string[];
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** A finite number (rejects null/undefined/NaN/Infinity). */
function isFiniteNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

/**
 * Float-noise tolerance for the STRICT band comparison. Metrics are tracked to 4
 * significant figures (spec §B1.7), so band math down at the ~1e-9 level is pure
 * IEEE-754 noise (e.g. `0.8 - 0.784 = 0.016000000000000014`). Without this, a
 * drop landing EXACTLY on the band floor would spuriously trip the strict `>`
 * test. EPS is far below any band magnitude (smallest band is 0.02) so it cannot
 * mask a real regression — it only neutralizes representation noise at the
 * boundary. The boundary tests pin this behavior.
 */
const BAND_EPSILON = 1e-9;

/**
 * Format a value to 4 significant figures for human-readable reasons (spec
 * §B1.7 — metrics reported to 4 sig-figs). Pure, no locale.
 */
function fmt(v: number): string {
  return Number(v.toPrecision(4)).toString();
}

/**
 * Compute the regress threshold (max tolerated drop) for a metric:
 *   relative → band * baseline
 *   absolute → band (already pp-as-fraction)
 * Returns null when it cannot be computed (e.g. relative band needs a finite
 * baseline).
 */
function thresholdFor(band: RegressBand, baseline: number | null): number | null {
  if (band.type === 'absolute') return band.band;
  // relative: needs a finite baseline.
  if (!isFiniteNumber(baseline)) return null;
  return band.band * baseline;
}

// ─── The verdict function ─────────────────────────────────────────────────────

/**
 * Evaluate the three-state verdict for a measured run against a committed
 * baseline, applying the A7 per-metric bands.
 *
 * Precedence (the three-state guard — spec §B1.5):
 *   1. INCONCLUSIVE if the run is degraded (FTS-only / no full path), OR if ANY
 *      primary metric is unmeasurable on either side (current null/undefined, or
 *      baseline null/undefined). INCONCLUSIVE dominates a would-be REGRESS — you
 *      cannot trust a degraded/incomplete run to declare PASS *or* REGRESS.
 *   2. REGRESS if (and only if) the run is full-path + complete AND ANY single
 *      primary metric's drop exceeds its band.
 *   3. PASS otherwise.
 *
 * This function NEVER silently PASSes a degraded or incomplete run — that is the
 * entire purpose of the three-state design.
 */
export function evaluateVerdict(
  current: CurrentMetrics,
  baseline: BaselineConfig,
): VerdictResult {
  const reasons: string[] = [];
  const perMetric: PerMetricVerdict[] = [];

  // The degraded guard is evaluated first and recorded, but we STILL build the
  // per-metric rows for the report. The final verdict respects precedence below.
  const degraded = current.degraded === true;
  if (degraded) {
    reasons.push(
      'INCONCLUSIVE: run was degraded (FTS-only — VOYAGE_API_KEY absent, not the full embeddings+rerank path); cannot gate a tuning decision on a degraded measurement.',
    );
  }

  let anyUnmeasurable = false;
  let anyRegressed = false;

  for (const metric of PRIMARY_METRICS) {
    const band = baseline.bands[metric] ?? REGRESS_BANDS[metric];
    const baseRaw = baseline.metrics[metric];
    const curRaw = current.metrics[metric];

    const baseVal: number | null = isFiniteNumber(baseRaw) ? baseRaw : null;
    const curVal: number | null = isFiniteNumber(curRaw) ? curRaw : null;

    // A metric is unmeasurable if EITHER side is missing/null/non-finite, OR the
    // threshold cannot be computed (e.g. relative band against a null baseline).
    const threshold = thresholdFor(band, baseVal);
    const unmeasurable =
      baseVal === null || curVal === null || threshold === null;

    let delta: number | null = null;
    let regressed = false;

    if (!unmeasurable && baseVal !== null && curVal !== null && threshold !== null) {
      delta = curVal - baseVal;
      const drop = baseVal - curVal; // positive when current is below baseline
      // STRICT band: only a drop strictly GREATER than the threshold regresses.
      // A drop landing EXACTLY on the floor is NOT a regression (spec §B1.5);
      // BAND_EPSILON absorbs IEEE-754 noise so the boundary is honest.
      regressed = drop - threshold > BAND_EPSILON;
      if (regressed) {
        anyRegressed = true;
        reasons.push(
          `REGRESS: ${metric} dropped ${fmt(drop)} ` +
            `(baseline ${fmt(baseVal)} → ${fmt(curVal)}); ` +
            `band = ${band.type === 'relative' ? `${band.band * 100}% relative` : `${band.band * 100}pp absolute`} ` +
            `(max tolerated drop ${fmt(threshold)}).`,
        );
      }
    } else {
      anyUnmeasurable = true;
      reasons.push(
        `INCONCLUSIVE: ${metric} is unmeasurable ` +
          `(current=${curRaw === undefined ? 'missing' : String(curRaw)}, ` +
          `baseline=${baseRaw === undefined ? 'missing' : String(baseRaw)}); ` +
          `cannot evaluate its band.`,
      );
    }

    perMetric.push({
      metric,
      baseline: baseVal,
      current: curVal,
      delta,
      bandType: band.type,
      threshold,
      regressed,
      inconclusive: unmeasurable,
    });
  }

  // ── Precedence (spec §B1.5) ─────────────────────────────────────────────────
  // 1. Degraded OR any unmeasurable metric ⇒ INCONCLUSIVE (dominates REGRESS).
  if (degraded || anyUnmeasurable) {
    return { verdict: 'INCONCLUSIVE', perMetric, reasons };
  }
  // 2. Any single metric crossed its band ⇒ REGRESS.
  if (anyRegressed) {
    return { verdict: 'REGRESS', perMetric, reasons };
  }
  // 3. Otherwise PASS.
  return { verdict: 'PASS', perMetric, reasons };
}
