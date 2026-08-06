#!/usr/bin/env node
/**
 * Governance health check script (Phase 3 continuous operations).
 *
 * Calls /api/cron/governance-health to run data quality checks,
 * backup verification, policy drift detection, and table classification audit.
 * Intended to run daily via Vercel cron or scheduled CI.
 *
 * Usage:
 *   node scripts/governance-health-check.mjs
 *   CRON_SECRET=<secret> node scripts/governance-health-check.mjs
 *
 * Requires CRON_SECRET env var for authentication.
 */

const cronSecret = process.env.CRON_SECRET;
if (!cronSecret) {
  console.error('CRON_SECRET env var required');
  process.exit(1);
}

const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
const url = `${baseUrl}/api/cron/governance-health`;

async function main() {
  const t0 = Date.now();
  console.log(`[${new Date().toISOString()}] Running governance health check...`);

  let response;
  try {
    response = await fetch(url, {
      headers: {
        'x-cron-secret': cronSecret,
      },
    });
  } catch (e) {
    console.error('Health check request failed:', e.message);
    process.exit(2);
  }

  const elapsed = Date.now() - t0;

  if (!response.ok) {
    console.error(`Health check returned ${response.status}: ${response.statusText}`);
    const body = await response.text();
    console.error(body.slice(0, 500));
    process.exit(1);
  }

  const result = await response.json();

  // ── Report ──
  console.log(`\nGovernance Health Summary (${elapsed}ms):`);
  console.log('─────────────────────────────────────────────');

  // Data quality
  if (result.data_quality) {
    const dq = result.data_quality;
    if (dq.error) {
      console.log(`  Data Quality: ERROR - ${dq.error}`);
    } else {
      const status = dq.failures === 0 ? 'PASS' : `FAIL (${dq.failures} failures, ${dq.critical} CRITICAL, ${dq.high} HIGH)`;
      console.log(`  Data Quality: ${status}`);
      if (dq.details?.length > 0) {
        for (const d of dq.details) {
          console.log(`    [${d.severity}] ${d.check}: ${d.detail}`);
        }
      }
    }
  }

  // Backup
  if (result.backup) {
    const bk = result.backup;
    if (bk.error) {
      console.log(`  Backup: ERROR - ${bk.error}`);
    } else {
      const status = bk.backup_status === 'healthy' ? 'PASS' : `FAIL (${bk.backup_status})`;
      console.log(`  Backup: ${status}`);
      console.log(`    Last healthy: ${bk.last_healthy || 'never'}`);
      console.log(`    Backups 7d: ${bk.backups_7d}`);
      console.log(`    Last drill: ${bk.last_drill || 'never'} | Cadence: ${bk.drill_cadence}`);
    }
  }

  // Policy drift
  if (result.vacuous_policies) {
    const vp = result.vacuous_policies;
    if (vp.error) {
      console.log(`  Policy Drift: ERROR - ${vp.error}`);
    } else {
      const status = vp.count === 0 ? 'PASS' : `FAIL (${vp.count} vacuous policies)`;
      console.log(`  Policy Drift: ${status}`);
      if (vp.policies?.length > 0) {
        for (const p of vp.policies) {
          console.log(`    - ${p}`);
        }
      }
    }
  }

  // Table classification
  if (result.unclassified_tables) {
    const ut = result.unclassified_tables;
    if (ut.error) {
      console.log(`  Unclassified Tables: ERROR - ${ut.error}`);
    } else {
      const status = ut.count === 0 ? 'PASS' : `FAIL (${ut.count} unclassified tables)`;
      console.log(`  Unclassified Tables: ${status}`);
      if (ut.tables?.length > 0) {
        for (const t of ut.tables) {
          console.log(`    - ${t}`);
        }
      }
    }
  }

  console.log(`\nChecked at: ${result.checked_at}`);
  console.log('─────────────────────────────────────────────');

  // Compute overall verdict
  const failures = [
    result.data_quality?.failures > 0,
    result.backup?.backup_status !== 'healthy',
    result.vacuous_policies?.count > 0,
    result.unclassified_tables?.count > 0,
  ].filter(Boolean).length;

  if (failures > 0) {
    console.log(`VERDICT: DEGRADED (${failures} domains with failures)`);
    process.exit(1);
  } else {
    console.log('VERDICT: HEALTHY');
    process.exit(0);
  }
}

main();
