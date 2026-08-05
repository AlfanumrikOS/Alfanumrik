// packages/lib/src/irt/shadow-metrics.ts
//
// Phase 3 E2 (IRT enablement) — PURE shadow-divergence metrics.
//
// When ff_irt_shadow_v1 is ON, the live adaptive selector scores every
// candidate question BOTH ways — the live serving path (fisher_info gated by
// ff_irt_question_selection, in practice proxy_distance while that flag is
// OFF) and the shadow path (fisher_info always allowed for calibrated items).
// These two score vectors are compared here to quantify how DIFFERENT IRT
// serving would be from today's serving, without changing a single served
// question. The divergence sample rides fire-and-forget to
// /api/telemetry/irt-shadow and is aggregated offline by eval/irt/.
//
// Pure functions, zero dependencies, no I/O, no Date, no randomness.
// Owning agent: ai-engineer. Assessment reviews correctness.

/**
 * Shadow-divergence sample emitted by selectAdaptiveQuestions when
 * `computeShadow` is on. Shape mirrors the /api/telemetry/irt-shadow POST
 * contract (subject/grade are added by the caller, which knows them).
 */
export interface IrtShadowSample {
  /** Student ability estimate used for both scorings. */
  theta: number;
  /** Number of candidates scored both ways. */
  nCandidates: number;
  /** Candidates with calibrated 2PL params (irt_calibration_n >= 30, a/b non-null). */
  nCalibrated: number;
  /** Spearman rank correlation between serving scores and shadow scores.
   *  null when undefined (fewer than 2 candidates, or zero variance). */
  spearmanRho: number | null;
  /** Jaccard overlap of the top-5 candidate sets (serving vs shadow order). */
  top5Overlap: number | null;
  /** Jaccard overlap of the top-10 candidate sets (serving vs shadow order). */
  top10Overlap: number | null;
  /** How the LIVE serving path scored the candidates (selection-path counts). */
  servedPathCounts: {
    fisher_info: number;
    proxy_distance: number;
    uncalibrated: number;
  };
}

/**
 * Average ranks for a numeric vector, ties receive the MEAN of the ranks they
 * span (the standard "fractional ranking" Spearman requires). Rank 1 = the
 * SMALLEST value. Returns a rank array aligned with the input indices.
 */
function averageRanks(values: number[]): number[] {
  const n = values.length;
  const order = values
    .map((v, i) => ({ v, i }))
    .sort((a, b) => a.v - b.v);
  const ranks = new Array<number>(n);
  let pos = 0;
  while (pos < n) {
    let end = pos;
    while (end + 1 < n && order[end + 1].v === order[pos].v) end++;
    // ranks pos..end (0-based) share the average of (pos+1)..(end+1).
    const avg = (pos + 1 + (end + 1)) / 2;
    for (let k = pos; k <= end; k++) ranks[order[k].i] = avg;
    pos = end + 1;
  }
  return ranks;
}

/**
 * Spearman rank correlation between two aligned score vectors.
 *
 * Computed as the Pearson correlation of the (tie-averaged) ranks — the
 * general definition that stays correct in the presence of ties (the popular
 * 6·Σd²/(n(n²−1)) shortcut is only valid tie-free).
 *
 * Returns null when it is undefined:
 *   - vectors of different length, or length < 2
 *   - either vector has zero rank variance (all values tied)
 *   - any non-finite input
 */
export function spearmanRank(a: number[], b: number[]): number | null {
  if (!Array.isArray(a) || !Array.isArray(b)) return null;
  if (a.length !== b.length || a.length < 2) return null;
  if (!a.every(Number.isFinite) || !b.every(Number.isFinite)) return null;

  const ra = averageRanks(a);
  const rb = averageRanks(b);
  const n = ra.length;

  const meanA = ra.reduce((s, v) => s + v, 0) / n;
  const meanB = rb.reduce((s, v) => s + v, 0) / n;

  let cov = 0;
  let varA = 0;
  let varB = 0;
  for (let i = 0; i < n; i++) {
    const da = ra[i] - meanA;
    const db = rb[i] - meanB;
    cov += da * db;
    varA += da * da;
    varB += db * db;
  }
  if (varA === 0 || varB === 0) return null; // zero variance → rho undefined
  return cov / Math.sqrt(varA * varB);
}

/**
 * Jaccard overlap of the top-K prefixes of two ranked id lists:
 *   |topK(A) ∩ topK(B)| / |topK(A) ∪ topK(B)|
 *
 * Duplicated ids within a list are collapsed (set semantics). Returns null
 * when either list is empty or k <= 0 — an overlap over nothing is not a
 * measurement. When a list is shorter than k, its full length is used (the
 * top-K of a 3-item list is those 3 items).
 */
export function topKOverlap(idsA: string[], idsB: string[], k: number): number | null {
  if (!Array.isArray(idsA) || !Array.isArray(idsB)) return null;
  if (!Number.isFinite(k) || k <= 0) return null;
  if (idsA.length === 0 || idsB.length === 0) return null;

  const setA = new Set(idsA.slice(0, k));
  const setB = new Set(idsB.slice(0, k));

  let intersection = 0;
  for (const id of setA) if (setB.has(id)) intersection++;
  const union = setA.size + setB.size - intersection;
  if (union === 0) return null;
  return intersection / union;
}
