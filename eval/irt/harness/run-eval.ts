// eval/irt/harness/run-eval.ts
//
// Phase 3 E2 — IRT shadow-eval harness: the PURE-assembly runner.
//
// Mirrors the eval/rag/harness pattern: this module takes INJECTED deps (the
// two offline read functions + the committed baseline) and assembles the
// report. It performs NO I/O itself except writeReport(); the CLI (cli.ts)
// wires the real service-role reads. This keeps the runner unit-testable with
// hand-rolled fakes and keeps every DB/network concern in one file.
//
// Offline tooling only — NEVER imported by production / client code.

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

import {
  compareModels,
  summariseShadowSamples,
  type CalibratedResponseRow,
  type ModelComparison,
  type ShadowSampleRow,
  type ShadowSummary,
} from './metrics';
import { evaluateIrtVerdict, type IrtVerdictResult } from './verdict';

// ─── Baseline shape (committed JSON) ─────────────────────────────────────────

export interface IrtBaseline {
  version: string;
  /** True until a reviewed populated run replaces the placeholder values. */
  metrics_placeholder: boolean;
  metrics: {
    deltaAUC: number | null;
    deltaBrier: number | null;
    medianSpearman: number | null;
    medianTop10Overlap: number | null;
  };
}

// ─── Injected deps ────────────────────────────────────────────────────────────

export interface IrtEvalDeps {
  /** Days of history to read (CLI --window-days; default 30). */
  windowDays: number;
  /** Offline read: irt_shadow_divergence samples from system_metrics. */
  fetchShadowSamples: (windowDays: number) => Promise<ShadowSampleRow[]>;
  /** Offline read: calibrated responses (quiz_responses × question_bank with
   *  2PL params at calibration_n >= 30, joined to the student's theta). */
  fetchCalibratedResponses: (windowDays: number) => Promise<CalibratedResponseRow[]>;
  baseline: IrtBaseline;
}

// ─── Report shape ─────────────────────────────────────────────────────────────

export interface IrtEvalReport {
  run: {
    kind: 'irt-shadow-eval';
    window_days: number;
    generated_at: string;
    baseline_version: string;
    baseline_placeholder: boolean;
  };
  shadow: ShadowSummary;
  model: ModelComparison;
  /** Informational drift vs the committed baseline (null-safe deltas). */
  baselineDrift: {
    deltaAUC_vs_baseline: number | null;
    deltaBrier_vs_baseline: number | null;
  };
  verdict: IrtVerdictResult;
}

// ─── Runner ───────────────────────────────────────────────────────────────────

export async function runIrtEval(deps: IrtEvalDeps): Promise<IrtEvalReport> {
  const [shadowRows, responseRows] = await Promise.all([
    deps.fetchShadowSamples(deps.windowDays),
    deps.fetchCalibratedResponses(deps.windowDays),
  ]);

  const shadow = summariseShadowSamples(shadowRows);
  const model = compareModels(responseRows);
  const verdict = evaluateIrtVerdict(model, shadow);

  const drift = (cur: number | null, base: number | null): number | null =>
    cur !== null && base !== null && Number.isFinite(cur) && Number.isFinite(base)
      ? cur - base
      : null;

  return {
    run: {
      kind: 'irt-shadow-eval',
      window_days: deps.windowDays,
      generated_at: new Date().toISOString(),
      baseline_version: deps.baseline.version,
      baseline_placeholder: deps.baseline.metrics_placeholder === true,
    },
    shadow,
    model,
    baselineDrift: {
      deltaAUC_vs_baseline: drift(model.deltaAUC, deps.baseline.metrics.deltaAUC),
      deltaBrier_vs_baseline: drift(model.deltaBrier, deps.baseline.metrics.deltaBrier),
    },
    verdict,
  };
}

/** Write the report artifact; returns the resolved path. */
export function writeReport(report: IrtEvalReport, outPath: string): string {
  const abs = resolve(outPath);
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, JSON.stringify(report, null, 2) + '\n', 'utf-8');
  return abs;
}
