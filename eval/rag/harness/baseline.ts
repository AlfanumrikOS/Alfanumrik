// eval/rag/harness/baseline.ts
//
// B1 retrieval-quality eval harness — Task 5: the BASELINE LOADER.
// PURE (no I/O beyond an optional fs read helper). Offline tooling, NEVER
// imported by production / client code (enforced by the import-boundary test).
//
// ── What this does ───────────────────────────────────────────────────────────
// Turns the committed `eval/rag/baseline/ncert-baseline-v1.json` document into
// the `BaselineConfig` shape the (done) Task 7 verdict module consumes
// (`{ metrics, bands }`), AND surfaces the `metrics_placeholder` flag the
// runner uses to enforce the CARRY-FORWARD CONDITION:
//
//   metrics_placeholder === true  ⇒  the baseline metric VALUES are NOT a real
//   measurement (they ship as zeros in Task 7 and are populated by a reviewed
//   full-path run in Task 10). The runner MUST force the verdict to
//   INCONCLUSIVE against such a baseline — you can NEVER declare PASS/REGRESS
//   against a placeholder baseline. (Pinned by run-eval.test.ts.)
//
// The verdict logic itself lives in verdict.ts (Task 7); this module only
// LOADS + SHAPES the baseline and reports the placeholder bit. It does not
// re-implement any band/threshold math.

import { readFileSync } from 'node:fs';

import {
  PRIMARY_METRICS,
  type BaselineConfig,
  type BandType,
  type PrimaryMetric,
  type RegressBand,
} from './verdict';

/**
 * The loaded baseline: the verdict-ready `BaselineConfig` PLUS the carry-forward
 * `metricsPlaceholder` flag and the raw parsed document (for the report header).
 */
export interface LoadedBaseline {
  config: BaselineConfig;
  /**
   * True when the committed baseline's `metrics` are PLACEHOLDERS (not a real
   * full-path measurement). The runner forces INCONCLUSIVE in this case — the
   * carry-forward condition. A MISSING field is treated as `false` (a populated
   * baseline need not carry the flag).
   */
  metricsPlaceholder: boolean;
  /** The raw parsed JSON (for echoing version/notes into the report header). */
  raw: Record<string, unknown>;
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function parseBand(raw: unknown): RegressBand | undefined {
  if (!isPlainObject(raw)) return undefined;
  const band = raw.band;
  const type = raw.type;
  if (typeof band !== 'number' || !Number.isFinite(band)) return undefined;
  if (type !== 'relative' && type !== 'absolute') return undefined;
  return { band, type: type as BandType };
}

/**
 * Parse a baseline JSON document into a `LoadedBaseline`. PURE — never reads a
 * file (the file read is `loadBaselineFile` below). Only the five primary
 * metrics / bands (verdict.ts `PRIMARY_METRICS`) are projected; any extra keys
 * in the document are ignored. A metric value that is not a finite number is
 * carried as `null` (the verdict module treats null as unmeasurable →
 * INCONCLUSIVE, which is correct for a not-yet-populated baseline).
 */
export function loadBaselineConfig(doc: unknown): LoadedBaseline {
  if (!isPlainObject(doc)) {
    throw new Error('baseline document must be an object');
  }

  const rawMetrics = isPlainObject(doc.metrics) ? doc.metrics : {};
  const rawBands = isPlainObject(doc.bands) ? doc.bands : {};

  const metrics: Partial<Record<PrimaryMetric, number | null>> = {};
  const bands: Partial<Record<PrimaryMetric, RegressBand>> = {};

  for (const metric of PRIMARY_METRICS) {
    const v = rawMetrics[metric];
    metrics[metric] = typeof v === 'number' && Number.isFinite(v) ? v : null;
    const band = parseBand(rawBands[metric]);
    if (band) bands[metric] = band;
  }

  // metrics_placeholder: explicit true is a placeholder; ANYTHING else
  // (false / absent / non-boolean) is treated as NOT a placeholder.
  const metricsPlaceholder = doc.metrics_placeholder === true;

  return {
    config: { metrics, bands },
    metricsPlaceholder,
    raw: doc,
  };
}

/**
 * Read + parse the committed baseline file from disk. Thin fs wrapper over
 * `loadBaselineConfig` — used by the runner / integration test. Throws on a
 * missing file or malformed JSON (a missing baseline is an operator error, not
 * a degraded run).
 */
export function loadBaselineFile(path: string): LoadedBaseline {
  const text = readFileSync(path, 'utf-8');
  const doc = JSON.parse(text) as unknown;
  return loadBaselineConfig(doc);
}
