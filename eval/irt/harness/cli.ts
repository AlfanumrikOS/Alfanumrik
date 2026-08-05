// eval/irt/harness/cli.ts
//
// Phase 3 E2 — IRT shadow-eval harness: the STANDALONE CLI entrypoint.
//
// Mirrors eval/rag/harness/cli.ts: the runner (run-eval.ts) is a pure
// assembler over injected deps; this file wires the REAL service-role reads,
// runs the harness once, writes the report artifact, prints the verdict, and
// exits 0 for every COMPLETED run (PASS, FAIL, and INCONCLUSIVE alike — the
// exit code is not the signal; the report's verdict field is). A non-zero
// exit (2) is reserved for operator/config errors that prevented a run.
//
// Flags:
//   --window-days N   history window (default 30)
//   --baseline PATH   baseline JSON (default eval/irt/baseline/irt-baseline-v1.json)
//   --out PATH        report artifact (default eval/irt/reports/irt-eval-<ts>.json)
//
// Offline READ-ONLY measurement: service-role SELECTs on system_metrics,
// quiz_responses (+ question_bank embed), student_learning_profiles. It never
// writes to the DB, never calls an AI SDK, and is never imported by
// production code.
//
// Run from the REPO ROOT: `npm run eval:irt:harness` (see eval/irt/README.md
// for the cwd rationale — the script deliberately lives in the ROOT
// package.json, avoiding the eval:rag cwd mismatch).

import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { loadDotenv } from '../../../agents/runtime/env';
import {
  runIrtEval,
  writeReport,
  type IrtBaseline,
  type IrtEvalDeps,
} from './run-eval';
import type { CalibratedResponseRow, ShadowSampleRow } from './metrics';

const REPO_ROOT = resolve(__dirname, '..', '..', '..');
loadDotenv(REPO_ROOT);

const DEFAULT_BASELINE = resolve(REPO_ROOT, 'eval', 'irt', 'baseline', 'irt-baseline-v1.json');
const DEFAULT_WINDOW_DAYS = 30;
const PAGE_SIZE = 1000;
const MAX_PAGES = 50; // 50k row hard cap per read — offline sanity bound

const EXIT_OK = 0;
const EXIT_CONFIG_ERROR = 2;

// ─── Flag parsing (tiny, no dependency) ──────────────────────────────────────

interface CliFlags {
  windowDays: number;
  baselinePath: string;
  outPath: string;
}

function parseFlags(argv: string[]): CliFlags {
  const get = (name: string): string | undefined => {
    const i = argv.indexOf(name);
    return i >= 0 && i + 1 < argv.length ? argv[i + 1] : undefined;
  };
  const windowRaw = get('--window-days');
  const windowDays = windowRaw ? Number(windowRaw) : DEFAULT_WINDOW_DAYS;
  if (!Number.isFinite(windowDays) || windowDays <= 0) {
    throw new Error(`--window-days must be a positive number (got "${windowRaw}")`);
  }
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  return {
    windowDays,
    baselinePath: get('--baseline') ?? DEFAULT_BASELINE,
    outPath:
      get('--out') ?? resolve(REPO_ROOT, 'eval', 'irt', 'reports', `irt-eval-${ts}.json`),
  };
}

// ─── Creds + baseline loading ────────────────────────────────────────────────

function readCreds(): { url: string; serviceKey: string } | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) return null;
  if (/placeholder/i.test(url) || /placeholder/i.test(serviceKey)) return null;
  return { url, serviceKey };
}

function loadBaseline(path: string): IrtBaseline {
  if (!existsSync(path)) {
    throw new Error(`baseline not found at ${path}`);
  }
  const doc = JSON.parse(readFileSync(path, 'utf-8')) as Partial<IrtBaseline>;
  if (typeof doc.version !== 'string' || typeof doc.metrics !== 'object' || doc.metrics === null) {
    throw new Error(`baseline at ${path} is malformed (need { version, metrics, metrics_placeholder })`);
  }
  return {
    version: doc.version,
    metrics_placeholder: doc.metrics_placeholder === true,
    metrics: {
      deltaAUC: numOrNull(doc.metrics.deltaAUC),
      deltaBrier: numOrNull(doc.metrics.deltaBrier),
      medianSpearman: numOrNull(doc.metrics.medianSpearman),
      medianTop10Overlap: numOrNull(doc.metrics.medianTop10Overlap),
    },
  };
}

function numOrNull(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

// ─── Real dep wiring (service-role, read-only) ───────────────────────────────

/* eslint-disable @typescript-eslint/no-explicit-any */

async function buildDeps(
  creds: { url: string; serviceKey: string },
  flags: CliFlags,
): Promise<IrtEvalDeps> {
  const { createClient } = await import('@supabase/supabase-js');
  const supabase = createClient(creds.url, creds.serviceKey, {
    auth: { persistSession: false },
  });

  const windowStartIso = (days: number) =>
    new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

  /** Tolerant tag read: accepts camelCase and snake_case keys. */
  const tagNum = (tags: any, camel: string, snake: string): number | null => {
    const v = tags?.[camel] ?? tags?.[snake];
    return typeof v === 'number' && Number.isFinite(v) ? v : null;
  };

  const fetchShadowSamples = async (windowDays: number): Promise<ShadowSampleRow[]> => {
    const out: ShadowSampleRow[] = [];
    for (let page = 0; page < MAX_PAGES; page++) {
      const { data, error } = await supabase
        .from('system_metrics')
        .select('tags, recorded_at')
        .eq('metric_name', 'irt_shadow_divergence')
        .gte('recorded_at', windowStartIso(windowDays))
        .order('recorded_at', { ascending: true })
        .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1);
      if (error) throw new Error(`system_metrics read failed: ${error.message}`);
      for (const row of (data ?? []) as any[]) {
        const t = row.tags ?? {};
        out.push({
          spearmanRho: tagNum(t, 'spearmanRho', 'spearman_rho'),
          top5Overlap: tagNum(t, 'top5Overlap', 'top5_overlap'),
          top10Overlap: tagNum(t, 'top10Overlap', 'top10_overlap'),
          nCandidates: tagNum(t, 'nCandidates', 'n_candidates') ?? 0,
          nCalibrated: tagNum(t, 'nCalibrated', 'n_calibrated') ?? 0,
        });
      }
      if (!data || data.length < PAGE_SIZE) break;
    }
    return out;
  };

  const fetchCalibratedResponses = async (
    windowDays: number,
  ): Promise<CalibratedResponseRow[]> => {
    // 1. Responses on calibrated items (2PL params present at n >= 30).
    const raw: any[] = [];
    for (let page = 0; page < MAX_PAGES; page++) {
      const { data, error } = await supabase
        .from('quiz_responses')
        .select(
          'student_id, subject, is_correct, created_at, ' +
            'question_bank!inner(irt_a, irt_b, irt_calibration_n, irt_difficulty)',
        )
        .gte('created_at', windowStartIso(windowDays))
        .gte('question_bank.irt_calibration_n', 30)
        .not('question_bank.irt_a', 'is', null)
        .not('question_bank.irt_b', 'is', null)
        .not('question_bank.irt_difficulty', 'is', null)
        .order('created_at', { ascending: true })
        .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1);
      if (error) throw new Error(`quiz_responses read failed: ${error.message}`);
      raw.push(...((data ?? []) as any[]));
      if (!data || data.length < PAGE_SIZE) break;
    }

    // 2. Student thetas per (student, subject).
    const studentIds = [...new Set(raw.map((r) => r.student_id).filter(Boolean))];
    const thetaByKey = new Map<string, number>();
    for (let i = 0; i < studentIds.length; i += 200) {
      const chunk = studentIds.slice(i, i + 200);
      const { data, error } = await supabase
        .from('student_learning_profiles')
        .select('student_id, subject, irt_theta')
        .in('student_id', chunk)
        .not('irt_theta', 'is', null);
      if (error) throw new Error(`student_learning_profiles read failed: ${error.message}`);
      for (const p of (data ?? []) as any[]) {
        if (typeof p.irt_theta === 'number') {
          thetaByKey.set(`${p.student_id}|${p.subject}`, p.irt_theta);
        }
      }
    }

    // 3. Join in-process. Rows without a theta are dropped (unmeasurable).
    const out: CalibratedResponseRow[] = [];
    for (const r of raw) {
      const qb = Array.isArray(r.question_bank) ? r.question_bank[0] : r.question_bank;
      const theta = thetaByKey.get(`${r.student_id}|${r.subject}`);
      if (!qb || theta === undefined) continue;
      out.push({
        studentId: r.student_id,
        correct: r.is_correct === true,
        theta,
        irtA: qb.irt_a,
        irtB: qb.irt_b,
        irtDifficulty: qb.irt_difficulty,
      });
    }
    return out;
  };

  return {
    windowDays: flags.windowDays,
    fetchShadowSamples,
    fetchCalibratedResponses,
    baseline: loadBaseline(flags.baselinePath),
  };
}

/* eslint-enable @typescript-eslint/no-explicit-any */

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main(): Promise<number> {
  // eslint-disable-next-line no-console
  const log = console.log.bind(console);

  let flags: CliFlags;
  try {
    flags = parseFlags(process.argv.slice(2));
  } catch (err) {
    log(`[irt-eval:harness] flag error: ${err instanceof Error ? err.message : String(err)}`);
    return EXIT_CONFIG_ERROR;
  }

  const creds = readCreds();
  if (!creds) {
    log('[irt-eval:harness] INCONCLUSIVE (no run) — Supabase creds absent.');
    log(
      '  Set NEXT_PUBLIC_SUPABASE_URL (or SUPABASE_URL) + SUPABASE_SERVICE_ROLE_KEY. ' +
        'This is the expected smoke-test message when run without creds — not a crash.',
    );
    return EXIT_CONFIG_ERROR;
  }

  let deps: IrtEvalDeps;
  try {
    deps = await buildDeps(creds, flags);
  } catch (err) {
    log(`[irt-eval:harness] config error: ${err instanceof Error ? err.message : String(err)}`);
    return EXIT_CONFIG_ERROR;
  }

  if (deps.baseline.metrics_placeholder) {
    log(
      '[irt-eval:harness] NOTE: baseline is a PLACEHOLDER (metrics_placeholder=true) — ' +
        'baselineDrift fields will be null until a reviewed run populates it.',
    );
  }

  const report = await runIrtEval(deps);
  const reportPath = writeReport(report, flags.outPath);

  const fmt = (v: number | null): string => (v === null ? 'n/a' : v.toFixed(4));

  log('');
  log('─── IRT shadow-eval harness (E2) summary ───');
  log(`window_days     : ${report.run.window_days}`);
  log(`shadow samples  : ${report.shadow.nSamples}`);
  log(`  median rho    : ${fmt(report.shadow.medianSpearman)}`);
  log(`  median top5   : ${fmt(report.shadow.medianTop5Overlap)}`);
  log(`  median top10  : ${fmt(report.shadow.medianTop10Overlap)}`);
  log(`calibrated set  : ${report.model.n} responses / ${report.model.nStudents} students`);
  log(`  AUC   2PL/proxy : ${fmt(report.model.auc2pl)} / ${fmt(report.model.aucProxy)} (delta ${fmt(report.model.deltaAUC)})`);
  log(`  Brier 2PL/proxy : ${fmt(report.model.brier2pl)} / ${fmt(report.model.brierProxy)} (delta ${fmt(report.model.deltaBrier)})`);
  log('');
  log(`VERDICT         : ${report.verdict.verdict}`);
  for (const r of report.verdict.reasons) log(`  - ${r}`);
  log('');
  log(`report written  : ${reportPath}`);
  log(
    '[irt-eval:harness] exit 0 — measurement tool. The ramp decision reads the VERDICT ' +
      'in the report artifact, not this exit code.',
  );
  return EXIT_OK;
}

// Import-safe guard (mirrors eval/rag/harness/cli.ts).
if (require.main === module) {
  main()
    .then((code) => process.exit(code))
    .catch((err) => {
      // eslint-disable-next-line no-console
      console.error(
        `[irt-eval:harness] unexpected error: ${err instanceof Error ? err.stack : String(err)}`,
      );
      process.exit(EXIT_CONFIG_ERROR);
    });
}

export { main, parseFlags, loadBaseline };
