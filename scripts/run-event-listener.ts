/**
 * scripts/run-event-listener.ts — standalone event listener runner.
 *
 * Usage:
 *   npx tsx scripts/run-event-listener.ts [--dry-run] [--interval-ms 1000]
 *
 * Environment:
 *   NEXT_PUBLIC_SUPABASE_URL  — Supabase project URL
 *   SUPABASE_SERVICE_ROLE_KEY — service-role JWT
 *
 * Deployment options:
 *   - Local dev: `npm run dev:bus` (one process, runs forever)
 *   - Staging / prod: a single small worker (Railway / Fly / EC2)
 *     started by `npx tsx scripts/run-event-listener.ts`. One global
 *     replica is enough until event volume justifies sharding by
 *     tenant.
 *   - Optional: a Vercel cron at 60s cadence calling /api/internal/bus-tick
 *     can serve as a lightweight backup if the worker dies; in that
 *     case the cron route would call tick() once per invocation.
 *
 * Graceful shutdown:
 *   - SIGINT and SIGTERM cleanly abort the loop. The current tick
 *     finishes (so the cursor advance lands) before the process exits.
 */

import { createClient } from '@supabase/supabase-js';
import { run } from '../src/lib/state/runtime/event-listener';

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error(
    'run-event-listener: NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set.',
  );
  process.exit(1);
}

const args = new Set(process.argv.slice(2));
const intervalIdx = process.argv.indexOf('--interval-ms');
const intervalMs =
  intervalIdx > 0 ? Math.max(100, Number(process.argv[intervalIdx + 1])) : 1000;
const dryRun = args.has('--dry-run');

const sb = createClient(url, key, { auth: { persistSession: false } });

const controller = new AbortController();
for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sig, () => {
    console.info(`run-event-listener: received ${sig}, draining...`);
    controller.abort();
  });
}

console.info(
  `run-event-listener: starting (dryRun=${dryRun} intervalMs=${intervalMs})`,
);

run({ sb, intervalMs, dryRun, signal: controller.signal })
  .then(() => {
    console.info('run-event-listener: stopped cleanly');
    process.exit(0);
  })
  .catch(err => {
    console.error(`run-event-listener: crashed: ${err instanceof Error ? err.stack : String(err)}`);
    process.exit(1);
  });
