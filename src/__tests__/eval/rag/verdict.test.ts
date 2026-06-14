// src/__tests__/eval/rag/verdict.test.ts
//
// RED-first pure-function unit tests for the B1 retrieval-quality VERDICT/GATE
// logic (Task 7). The verdict turns a measured run + a committed baseline into a
// three-state machine verdict `PASS | REGRESS | INCONCLUSIVE` using the A7
// per-metric regress bands. Every expected value below is HAND-COMPUTED from the
// spec §B1.5 / A7 band table — no value is read back from the implementation.
//
// Spec anchors (docs/superpowers/specs/2026-06-13-rag-retrieval-quality-design.md):
//   §B1.5 / A7 — per-metric regress bands. A run REGRESSES if ANY primary metric
//                crosses its band vs baseline:
//                  nDCG@10           2%  RELATIVE  (drop > 0.02 * baseline)
//                  recall@10         2%  RELATIVE  (drop > 0.02 * baseline)
//                  MRR               3%  RELATIVE  (drop > 0.03 * baseline)
//                  hit-rate@10       2pp ABSOLUTE  (drop > 0.02)
//                  groundedness-rate 3pp ABSOLUTE  (drop > 0.03)
//   §B1.5 Guard — a verdict is only PASS/REGRESS when the run used the FULL PATH
//                 (live embeddings + rerank, VOYAGE_API_KEY present). A degraded
//                 (FTS-only) run, OR any null/unmeasurable primary metric, is
//                 INCONCLUSIVE — NEVER PASS/REGRESS. You cannot gate a tuning
//                 decision on a degraded measurement.
//   §B1.5 PASS otherwise — a within-band move OR an improvement PASSES.
//
// Pure/offline lane: no DB, no LLM, no network. Relative import (the `@/*` Vitest
// alias does not reach the eval harness, which lives outside src/) — matches the
// convention in `metrics.test.ts` / `golden-schema.test.ts`.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, it, expect } from 'vitest';

import {
  evaluateVerdict,
  REGRESS_BANDS,
  PRIMARY_METRICS,
  type CurrentMetrics,
  type BaselineConfig,
} from '../../../../eval/rag/harness/verdict';

// ─── Baseline fixture (synthetic — NOT the committed baseline values) ─────────
//
// Chosen so band math is hand-checkable:
//   nDCG@10 = 0.8000  → 2% rel band = 0.0160 → regress floor at 0.7840
//   recall@10 = 0.7000 → 2% rel band = 0.0140 → regress floor at 0.6860
//   MRR = 0.6000      → 3% rel band = 0.0180 → regress floor at 0.5820
//   hit-rate@10 = 0.5000 → 2pp abs band = 0.0200 → regress floor at 0.4800
//   groundedness-rate = 0.9000 → 3pp abs band = 0.0300 → regress floor at 0.8700
const BASELINE: BaselineConfig = {
  metrics: {
    'nDCG@10': 0.8,
    'recall@10': 0.7,
    MRR: 0.6,
    'hit-rate@10': 0.5,
    'groundedness-rate': 0.9,
  },
  bands: {
    'nDCG@10': { band: 0.02, type: 'relative' },
    'recall@10': { band: 0.02, type: 'relative' },
    MRR: { band: 0.03, type: 'relative' },
    'hit-rate@10': { band: 0.02, type: 'absolute' },
    'groundedness-rate': { band: 0.03, type: 'absolute' },
  },
};

/** A full-path current run equal to baseline (perfect no-change). */
function atBaseline(): CurrentMetrics {
  return {
    degraded: false,
    metrics: {
      'nDCG@10': 0.8,
      'recall@10': 0.7,
      MRR: 0.6,
      'hit-rate@10': 0.5,
      'groundedness-rate': 0.9,
    },
  };
}

describe('evaluateVerdict — three-state gate (Task 7, A7 bands)', () => {
  // ── PASS: clean improvement on every metric ────────────────────────────────
  it('a clean improvement on every metric → PASS', () => {
    const current: CurrentMetrics = {
      degraded: false,
      metrics: {
        'nDCG@10': 0.85,
        'recall@10': 0.75,
        MRR: 0.65,
        'hit-rate@10': 0.6,
        'groundedness-rate': 0.95,
      },
    };
    const result = evaluateVerdict(current, BASELINE);
    expect(result.verdict).toBe('PASS');
    // every perMetric row is non-regressing
    expect(result.perMetric.every((m) => !m.regressed)).toBe(true);
    expect(result.reasons).toHaveLength(0);
  });

  it('exactly at baseline (no change) → PASS', () => {
    expect(evaluateVerdict(atBaseline(), BASELINE).verdict).toBe('PASS');
  });

  // ── REGRESS: nDCG drop JUST OVER 2% relative ────────────────────────────────
  // baseline 0.8, 2% rel = 0.016 → floor 0.7840. A drop to 0.7839 is > band.
  it('nDCG@10 drop just over the 2% relative band → REGRESS', () => {
    const current = atBaseline();
    current.metrics['nDCG@10'] = 0.7839; // drop 0.0161 > 0.0160 band
    const result = evaluateVerdict(current, BASELINE);
    expect(result.verdict).toBe('REGRESS');
    const row = result.perMetric.find((m) => m.metric === 'nDCG@10');
    expect(row?.regressed).toBe(true);
    expect(result.reasons.some((r) => r.includes('nDCG@10'))).toBe(true);
  });

  // baseline 0.8, floor exactly 0.7840 → a drop landing EXACTLY at the floor is
  // NOT beyond the band (band is "drop > band×baseline", strict).
  it('nDCG@10 drop exactly to the 2% relative floor → PASS (boundary, not beyond)', () => {
    const current = atBaseline();
    current.metrics['nDCG@10'] = 0.784; // drop 0.0160 == band, not > band
    expect(evaluateVerdict(current, BASELINE).verdict).toBe('PASS');
  });

  // ── ABSOLUTE pp band: hit-rate drop of 2.1pp → REGRESS ──────────────────────
  it('hit-rate@10 drop of 2.1pp → REGRESS (absolute band)', () => {
    const current = atBaseline();
    current.metrics['hit-rate@10'] = 0.479; // drop 0.021 > 0.020 band
    const result = evaluateVerdict(current, BASELINE);
    expect(result.verdict).toBe('REGRESS');
    expect(result.reasons.some((r) => r.includes('hit-rate@10'))).toBe(true);
  });

  it('hit-rate@10 drop of 1.9pp → PASS (within absolute band)', () => {
    const current = atBaseline();
    current.metrics['hit-rate@10'] = 0.481; // drop 0.019 < 0.020 band
    expect(evaluateVerdict(current, BASELINE).verdict).toBe('PASS');
  });

  it('hit-rate@10 drop of exactly 2.0pp → PASS (boundary, not beyond)', () => {
    const current = atBaseline();
    current.metrics['hit-rate@10'] = 0.48; // drop 0.020 == band, not > band
    expect(evaluateVerdict(current, BASELINE).verdict).toBe('PASS');
  });

  // ── RELATIVE-vs-ABSOLUTE distinction (the spec's explicit example) ──────────
  // "a 2% RELATIVE move on a 0.5 hit-rate would be only 0.01 — too loose; 2pp
  // absolute is the right floor." So a 0.01 drop on hit-rate (which is 2% of
  // 0.5) must NOT trip the 2pp-ABSOLUTE band, but a 0.03 absolute drop MUST.
  it('a 0.01 drop on the 0.5 hit-rate (= 2% relative) does NOT trip the 2pp absolute band → PASS', () => {
    const current = atBaseline();
    current.metrics['hit-rate@10'] = 0.49; // 0.01 drop = 2% relative, < 2pp abs
    expect(evaluateVerdict(current, BASELINE).verdict).toBe('PASS');
  });

  it('a 0.03 absolute drop on the 0.5 hit-rate trips the 2pp absolute band → REGRESS', () => {
    const current = atBaseline();
    current.metrics['hit-rate@10'] = 0.47; // 0.03 drop > 0.02 abs band
    expect(evaluateVerdict(current, BASELINE).verdict).toBe('REGRESS');
  });

  // ── recall@10 RELATIVE band (2%) ────────────────────────────────────────────
  // baseline 0.7, 2% rel = 0.014 → floor 0.686.
  it('recall@10 drop just over 2% relative → REGRESS', () => {
    const current = atBaseline();
    current.metrics['recall@10'] = 0.6859; // drop 0.0141 > 0.0140 band
    expect(evaluateVerdict(current, BASELINE).verdict).toBe('REGRESS');
  });

  it('recall@10 drop just under 2% relative → PASS', () => {
    const current = atBaseline();
    current.metrics['recall@10'] = 0.6861; // drop 0.0139 < 0.0140 band
    expect(evaluateVerdict(current, BASELINE).verdict).toBe('PASS');
  });

  // ── MRR RELATIVE band (3%) — noisier metric gets the looser band ────────────
  // baseline 0.6, 3% rel = 0.018 → floor 0.582.
  it('MRR drop just over 3% relative → REGRESS', () => {
    const current = atBaseline();
    current.metrics.MRR = 0.5819; // drop 0.0181 > 0.0180 band
    expect(evaluateVerdict(current, BASELINE).verdict).toBe('REGRESS');
  });

  it('MRR drop just under 3% relative → PASS', () => {
    const current = atBaseline();
    current.metrics.MRR = 0.5821; // drop 0.0179 < 0.0180 band
    expect(evaluateVerdict(current, BASELINE).verdict).toBe('PASS');
  });

  // a 2.5% relative MRR move would TRIP a 2% band but NOT the 3% MRR band —
  // pins that MRR genuinely uses its own looser 3% band, not the nDCG 2% band.
  it('MRR drop of 2.5% relative → PASS (uses the 3% MRR band, not 2%)', () => {
    const current = atBaseline();
    current.metrics.MRR = 0.585; // drop 0.015 = 2.5% rel; < 3% (0.018), > 2% (0.012)
    expect(evaluateVerdict(current, BASELINE).verdict).toBe('PASS');
  });

  // ── groundedness-rate ABSOLUTE band (3pp) ───────────────────────────────────
  it('groundedness-rate drop of 3.1pp → REGRESS (absolute band)', () => {
    const current = atBaseline();
    current.metrics['groundedness-rate'] = 0.869; // drop 0.031 > 0.030 band
    expect(evaluateVerdict(current, BASELINE).verdict).toBe('REGRESS');
  });

  it('groundedness-rate drop of 2.9pp → PASS (within absolute band)', () => {
    const current = atBaseline();
    current.metrics['groundedness-rate'] = 0.871; // drop 0.029 < 0.030 band
    expect(evaluateVerdict(current, BASELINE).verdict).toBe('PASS');
  });

  // ── "ANY single metric regresses ⇒ REGRESS" ─────────────────────────────────
  it('four metrics improve but ONE regresses → REGRESS (any single metric trips it)', () => {
    const current: CurrentMetrics = {
      degraded: false,
      metrics: {
        'nDCG@10': 0.9, // improve
        'recall@10': 0.8, // improve
        MRR: 0.7, // improve
        'hit-rate@10': 0.47, // 0.03 abs drop → REGRESS
        'groundedness-rate': 0.95, // improve
      },
    };
    const result = evaluateVerdict(current, BASELINE);
    expect(result.verdict).toBe('REGRESS');
    expect(result.reasons.some((r) => r.includes('hit-rate@10'))).toBe(true);
  });
});

describe('evaluateVerdict — INCONCLUSIVE never silently PASS/REGRESS', () => {
  // ── Degraded (FTS-only / no VOYAGE_API_KEY) run → INCONCLUSIVE ───────────────
  // Even when every metric is WITHIN band (would otherwise PASS), a degraded run
  // CANNOT be gated on — it must short-circuit to INCONCLUSIVE.
  it('a degraded (FTS-only) run with otherwise-passing metrics → INCONCLUSIVE (never PASS)', () => {
    const current: CurrentMetrics = { ...atBaseline(), degraded: true };
    const result = evaluateVerdict(current, BASELINE);
    expect(result.verdict).toBe('INCONCLUSIVE');
    expect(result.verdict).not.toBe('PASS');
    expect(result.verdict).not.toBe('REGRESS');
    expect(result.reasons.some((r) => /degrad|fts|voyage/i.test(r))).toBe(true);
  });

  // A degraded run whose metrics would otherwise REGRESS must STILL be
  // INCONCLUSIVE — degradation dominates the regress signal (you cannot trust a
  // degraded measurement to declare a regression either).
  it('a degraded run whose metrics would otherwise REGRESS → still INCONCLUSIVE', () => {
    const current: CurrentMetrics = {
      degraded: true,
      metrics: {
        'nDCG@10': 0.5, // huge drop
        'recall@10': 0.4,
        MRR: 0.3,
        'hit-rate@10': 0.2,
        'groundedness-rate': 0.5,
      },
    };
    const result = evaluateVerdict(current, BASELINE);
    expect(result.verdict).toBe('INCONCLUSIVE');
  });

  // ── A null/unmeasurable primary metric on a full-path run → INCONCLUSIVE ─────
  // (e.g. groundedness could not be measured, or an empty measurable set made a
  // metric's aggregate mean null). You cannot PASS a run with a missing metric.
  it('a null primary metric on a full-path run → INCONCLUSIVE (never PASS)', () => {
    const current: CurrentMetrics = {
      degraded: false,
      metrics: {
        'nDCG@10': 0.85,
        'recall@10': 0.75,
        MRR: 0.65,
        'hit-rate@10': 0.6,
        'groundedness-rate': null, // unmeasurable
      },
    };
    const result = evaluateVerdict(current, BASELINE);
    expect(result.verdict).toBe('INCONCLUSIVE');
    expect(result.verdict).not.toBe('PASS');
    expect(result.reasons.some((r) => r.includes('groundedness-rate'))).toBe(true);
  });

  // A null metric that would also have regressed must NOT report REGRESS — it is
  // unmeasurable, so the only honest verdict is INCONCLUSIVE.
  it('a null primary metric → INCONCLUSIVE even when other metrics regress', () => {
    const current: CurrentMetrics = {
      degraded: false,
      metrics: {
        'nDCG@10': 0.5, // would regress
        'recall@10': null, // unmeasurable
        MRR: 0.6,
        'hit-rate@10': 0.5,
        'groundedness-rate': 0.9,
      },
    };
    const result = evaluateVerdict(current, BASELINE);
    expect(result.verdict).toBe('INCONCLUSIVE');
    expect(result.verdict).not.toBe('REGRESS');
  });

  // ── A missing metric key (undefined) on a full-path run → INCONCLUSIVE ───────
  it('a missing metric key (undefined) → INCONCLUSIVE (treated as unmeasurable, never PASS)', () => {
    const current: CurrentMetrics = {
      degraded: false,
      metrics: {
        'nDCG@10': 0.85,
        'recall@10': 0.75,
        MRR: 0.65,
        'hit-rate@10': 0.6,
        // 'groundedness-rate' intentionally omitted
      },
    };
    const result = evaluateVerdict(current, BASELINE);
    expect(result.verdict).toBe('INCONCLUSIVE');
  });

  // ── A baseline metric value that is itself null/missing → INCONCLUSIVE ───────
  // (a relative band against a null baseline cannot be computed; honest fail).
  it('a null baseline value for a metric → INCONCLUSIVE (cannot compute the band)', () => {
    const baseline: BaselineConfig = {
      ...BASELINE,
      metrics: { ...BASELINE.metrics, 'nDCG@10': null },
    };
    const result = evaluateVerdict(atBaseline(), baseline);
    expect(result.verdict).toBe('INCONCLUSIVE');
  });
});

describe('evaluateVerdict — perMetric rows + reasons shape', () => {
  it('emits one perMetric row per primary metric with computed deltas', () => {
    const result = evaluateVerdict(atBaseline(), BASELINE);
    const metrics = result.perMetric.map((m) => m.metric).sort();
    expect(metrics).toEqual(
      ['MRR', 'groundedness-rate', 'hit-rate@10', 'nDCG@10', 'recall@10'].sort(),
    );
    const ndcg = result.perMetric.find((m) => m.metric === 'nDCG@10');
    expect(ndcg).toMatchObject({
      metric: 'nDCG@10',
      baseline: 0.8,
      current: 0.8,
      delta: 0,
      bandType: 'relative',
      regressed: false,
    });
  });

  it('a regressing row carries the threshold it crossed in its reason', () => {
    const current = atBaseline();
    current.metrics['recall@10'] = 0.65; // big drop
    const result = evaluateVerdict(current, BASELINE);
    const row = result.perMetric.find((m) => m.metric === 'recall@10');
    expect(row?.regressed).toBe(true);
    // the regress reason names the metric and is human-readable
    expect(result.reasons.some((r) => r.includes('recall@10'))).toBe(true);
  });
});

describe('REGRESS_BANDS — the A7 band constants', () => {
  it('match the spec A7 table exactly (relative vs absolute, per metric)', () => {
    expect(REGRESS_BANDS['nDCG@10']).toEqual({ band: 0.02, type: 'relative' });
    expect(REGRESS_BANDS['recall@10']).toEqual({ band: 0.02, type: 'relative' });
    expect(REGRESS_BANDS.MRR).toEqual({ band: 0.03, type: 'relative' });
    expect(REGRESS_BANDS['hit-rate@10']).toEqual({ band: 0.02, type: 'absolute' });
    expect(REGRESS_BANDS['groundedness-rate']).toEqual({ band: 0.03, type: 'absolute' });
  });

  it('cover exactly the five primary gate metrics', () => {
    expect(Object.keys(REGRESS_BANDS).sort()).toEqual(
      ['MRR', 'groundedness-rate', 'hit-rate@10', 'nDCG@10', 'recall@10'].sort(),
    );
  });
});

describe('committed baseline JSON — conforms to BaselineConfig + is verdict-consumable', () => {
  // Read the on-disk committed baseline at runtime (not a static import) so this
  // pins the ACTUAL committed file, not a copy. Path is relative to this test.
  const baselinePath = resolve(
    __dirname,
    '../../../../eval/rag/baseline/ncert-baseline-v1.json',
  );
  // The file carries documentation/placeholder keys alongside the two consumed
  // keys; we narrow to the BaselineConfig shape the verdict reads.
  const raw = JSON.parse(readFileSync(baselinePath, 'utf8')) as Record<string, unknown>;

  it('has a `bands` block matching the A7 table exactly (assessment-reviewed, never auto-refreshed)', () => {
    const bands = raw.bands as BaselineConfig['bands'];
    for (const metric of PRIMARY_METRICS) {
      expect(bands[metric]).toEqual(REGRESS_BANDS[metric]);
    }
  });

  it('carries REAL populated metric VALUES (Task 11 reviewed full-path run)', () => {
    // Task 11 populated the baseline from a reviewed full-path harness run on
    // production settings; the placeholder flag is now cleared so the verdict
    // module can declare PASS/REGRESS against it.
    expect(raw.metrics_placeholder).toBe(false);
    // The note no longer warns the values are unusable — it documents a real run.
    expect(String(raw.placeholder_note)).not.toMatch(/MUST NOT be used to gate/i);
    expect(String(raw.placeholder_note)).toMatch(/real measurement/i);
    // Every primary metric is a finite number in [0,1] (not the 0.0 placeholder
    // for all five — at least one must be strictly positive for a real run).
    const metrics = raw.metrics as Record<string, unknown>;
    let anyPositive = false;
    for (const metric of PRIMARY_METRICS) {
      const v = metrics[metric];
      expect(typeof v).toBe('number');
      expect(Number.isFinite(v as number)).toBe(true);
      expect(v as number).toBeGreaterThanOrEqual(0);
      expect(v as number).toBeLessThanOrEqual(1);
      if ((v as number) > 0) anyPositive = true;
    }
    expect(anyPositive).toBe(true);
  });

  it('documents the bands as assessment-reviewed + never auto-refreshed', () => {
    expect(String(raw.bands_note)).toMatch(/ASSESSMENT-REVIEWED/i);
    expect(String(raw.bands_note)).toMatch(/NEVER AUTO-REFRESHED/i);
  });

  it('feeds through evaluateVerdict as a valid BaselineConfig', () => {
    const baseline: BaselineConfig = {
      metrics: raw.metrics as BaselineConfig['metrics'],
      bands: raw.bands as BaselineConfig['bands'],
    };
    // A full-path current run equal to the (now populated) baseline → PASS.
    const current: CurrentMetrics = { degraded: false, metrics: { ...baseline.metrics } };
    const result = evaluateVerdict(current, baseline);
    expect(result.verdict).toBe('PASS');
    expect(result.perMetric).toHaveLength(PRIMARY_METRICS.length);
  });
});
