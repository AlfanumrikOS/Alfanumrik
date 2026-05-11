/**
 * scripts/run-l8-attribution.ts — Phase 5 L8 attribution runner.
 *
 * Reads shipped cycles, computes before/after metric deltas against
 * domain_events, writes outcome_metrics rows. Idempotent — running
 * twice produces zero additional rows on already-attributed cycles.
 *
 * Usage:
 *   npx tsx scripts/run-l8-attribution.ts [--dry-run] [--window-days 7] [--max-cycles 50]
 *
 * Environment:
 *   NEXT_PUBLIC_SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 *
 * Deployment options:
 *   - Manual: `npm run mesh:l8` (one-off attribution run).
 *   - Cron: a daily GitHub Actions job (sibling of mesh-cron.yml) or
 *     Vercel cron at /api/internal/mesh-l8-tick.
 *
 * --dry-run skips the insert: useful while the flag is OFF to validate
 * the math against staging data without touching outcome_metrics.
 */

import { createClient } from '@supabase/supabase-js';
import { runL8Attribution } from '../agents/runtime/layers/l8-evolution';

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error(
    'run-l8-attribution: NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set.',
  );
  process.exit(1);
}

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const windowDaysIdx = args.indexOf('--window-days');
const windowDays = windowDaysIdx > -1 ? Math.max(1, Number(args[windowDaysIdx + 1])) : 7;
const maxCyclesIdx = args.indexOf('--max-cycles');
const maxCycles = maxCyclesIdx > -1 ? Math.max(1, Number(args[maxCyclesIdx + 1])) : 50;

const sb = createClient(url, key, { auth: { persistSession: false } });

// In dry-run, we wrap the supabase client so .insert(...) on outcome_metrics
// is a no-op. We still let reads (cycles, domain_events, outcome_metrics
// existence check) hit the live DB so the math runs end-to-end.
const wrappedSb = dryRun
  ? new Proxy(sb, {
      get(target, prop, receiver) {
        if (prop !== 'from') return Reflect.get(target, prop, receiver);
        return (table: string) => {
          const real = (target as unknown as { from: (t: string) => unknown }).from(table);
          if (table !== 'outcome_metrics') return real;
          return new Proxy(real as Record<string, unknown>, {
            get(t, p, r) {
              if (p === 'insert') {
                return async (payload: unknown) => {
                  console.info(
                    `[dry-run] would insert outcome_metrics row: ${JSON.stringify(payload).slice(0, 400)}`,
                  );
                  return { error: null };
                };
              }
              return Reflect.get(t, p, r);
            },
          });
        };
      },
    })
  : sb;

console.info(
  `run-l8-attribution: starting (dryRun=${dryRun} windowDays=${windowDays} maxCycles=${maxCycles})`,
);

runL8Attribution({
  sb: wrappedSb,
  windowDays,
  maxCycles,
  // In dry-run we still want to honour the flag — the flag protects
  // against accidentally running on production data before the bus
  // has accumulated enough events.
})
  .then(result => {
    console.info('run-l8-attribution: complete', {
      reason: result.reason,
      attributed_count: result.attributed.length,
      skipped_count: result.skipped.length,
      errors_count: result.errors.length,
    });
    if (result.attributed.length > 0) {
      for (const a of result.attributed) {
        console.info(
          `  attributed cycle=${a.cycleId.slice(0, 8)} metric=${a.metric} `
          + `delta=${a.delta.toFixed(3)} n=${a.sampleSizeBefore}/${a.sampleSizeAfter} `
          + `significant=${a.statisticallySignificant}`,
        );
      }
    }
    if (result.skipped.length > 0) {
      const reasons = new Map<string, number>();
      for (const s of result.skipped) reasons.set(s.reason, (reasons.get(s.reason) ?? 0) + 1);
      console.info('  skipped breakdown:', Object.fromEntries(reasons));
    }
    if (result.errors.length > 0) {
      for (const e of result.errors) {
        console.error(`  ERROR cycle=${e.cycleId} metric=${e.metric}: ${e.message}`);
      }
      process.exit(1);
    }
    process.exit(0);
  })
  .catch(err => {
    console.error(
      `run-l8-attribution: crashed: ${err instanceof Error ? err.stack : String(err)}`,
    );
    process.exit(1);
  });
