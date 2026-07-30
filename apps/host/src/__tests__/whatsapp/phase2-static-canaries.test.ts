/**
 * WhatsApp bot Phase 2 — static-source contract canaries (REG-118/REG-125
 * style: read the SQL/TS from disk and pin the load-bearing strings so a
 * later edit cannot silently drop the contract).
 *
 * Pins:
 *   A. supabase/migrations/20260801100200_whatsapp_bot_rpcs.sql
 *      - whatsapp_claim_inbound: atomic pending→processing claim (conditional
 *        UPDATE + attempts increment + RETURN FOUND), SECURITY DEFINER with a
 *        pinned search_path
 *      - whatsapp_record_send: the send caps are CONSTANTS in the function
 *        body — 40 sends/day, 1 template/day ("sent_today at most 40,
 *        templates_today at most 1" — plan send-gate chain). Raising either
 *        requires an architect-reviewed migration AND this test.
 *      - REVOKE-from-everyone / GRANT-to-service_role posture on BOTH
 *        functions (the function surface is the privilege boundary)
 *      - no-window-row = no send, ever; free-form requires an open window
 *      - SELECT ... FOR UPDATE serialization; no destructive DDL
 *   B. The two R4 hard-disable guards (quality finding #5, Phase 1): the
 *      broken legacy whatsapp-notify callers in daily-cron and
 *      school-admin/parents are pinned OFF (`WHATSAPP_SEND_ENABLED = false`)
 *      and the constant must actually gate the send loop. Flipping either
 *      back to `true` without going through the new whatsapp-send path FAILS
 *      here by design — re-enable only via whatsapp-send.
 *
 * If a test here fails after an intentional change, update the source AND
 * this pin together with review — that is the point.
 *
 * Owner: testing.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// apps/host/src/__tests__/whatsapp → 5 levels up = repo root
// (supabase/ lives at the REPO root, not under apps/host — CLAUDE.md monorepo map).
const REPO_ROOT = resolve(__dirname, '..', '..', '..', '..', '..');

function readRepo(...segments: string[]): string {
  return readFileSync(resolve(REPO_ROOT, ...segments), 'utf8');
}

const rpcSql = readRepo('supabase', 'migrations', '20260801100200_whatsapp_bot_rpcs.sql');

// ─────────────────────────────────────────────────────────────────────────────
// A1 — whatsapp_claim_inbound
// ─────────────────────────────────────────────────────────────────────────────
describe('20260801100200 — whatsapp_claim_inbound (atomic claim arbiter)', () => {
  it('declares the function with the uuid parameter the route calls', () => {
    expect(rpcSql).toMatch(
      /CREATE OR REPLACE FUNCTION public\.whatsapp_claim_inbound\(p_id uuid\)/,
    );
    expect(rpcSql).toMatch(/RETURNS boolean/);
  });

  it('claims via a CONDITIONAL update: only a pending row can be claimed', () => {
    expect(rpcSql).toMatch(/status\s*=\s*'processing'/);
    expect(rpcSql).toMatch(/AND status = 'pending'/);
  });

  it('increments attempts in the same statement (termination accounting)', () => {
    expect(rpcSql).toMatch(/attempts\s*=\s*attempts \+ 1/);
  });

  it('clears processed_at on claim (a retried row never carries a stale completion)', () => {
    expect(rpcSql).toMatch(/processed_at\s*=\s*NULL/);
  });

  it('returns FOUND — exactly one claimant wins', () => {
    expect(rpcSql).toMatch(/RETURN FOUND;/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// A2 — whatsapp_record_send: the caps
// ─────────────────────────────────────────────────────────────────────────────
describe('20260801100200 — whatsapp_record_send (send-gate caps)', () => {
  it('DAILY SEND CAP is a constant pinned at 40 (plan: sent_today at most 40)', () => {
    expect(rpcSql).toMatch(/c_daily_send_cap\s+CONSTANT int := 40;/);
  });

  it('DAILY TEMPLATE CAP is a constant pinned at 1 (the ONE daily alarm OR Sunday note)', () => {
    expect(rpcSql).toMatch(/c_daily_template_cap\s+CONSTANT int := 1;/);
  });

  it('caps are compared strictly (< cap), so 40/1 are the maxima not the deny points', () => {
    expect(rpcSql).toMatch(/v_sent < c_daily_send_cap/);
    expect(rpcSql).toMatch(/v_templates < c_daily_template_cap/);
  });

  it('no window row → (false, false, 0, 0): outbound NEVER creates a window', () => {
    expect(rpcSql).toMatch(/RETURN QUERY SELECT false, false, 0, 0;/);
  });

  it('free-form sends REQUIRE an open window (the cost thesis)', () => {
    expect(rpcSql).toMatch(/ELSE v_window_open/);
  });

  it('serializes concurrent sends per phone with SELECT ... FOR UPDATE', () => {
    expect(rpcSql).toMatch(/FOR UPDATE;/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// A3 — SECURITY DEFINER + privilege posture
// ─────────────────────────────────────────────────────────────────────────────
describe('20260801100200 — SECURITY DEFINER + REVOKE/GRANT posture', () => {
  it('both functions are SECURITY DEFINER with a pinned search_path', () => {
    // Anchor the pin inside each CREATE FUNCTION header (comments and the
    // COMMENT ON strings also say "SECURITY DEFINER" — counting is unsafe).
    expect(rpcSql).toMatch(
      /whatsapp_claim_inbound\(p_id uuid\)[\s\S]{0,200}?SECURITY DEFINER\s*\r?\nSET search_path = public/,
    );
    expect(rpcSql).toMatch(
      /whatsapp_record_send\([\s\S]{0,300}?SECURITY DEFINER\s*\r?\nSET search_path = public/,
    );
  });

  it('REVOKEs both functions from PUBLIC, anon, authenticated', () => {
    expect(rpcSql).toMatch(
      /REVOKE ALL ON FUNCTION public\.whatsapp_claim_inbound\(uuid\)\s*\n?\s*FROM PUBLIC, anon, authenticated;/,
    );
    expect(rpcSql).toMatch(
      /REVOKE ALL ON FUNCTION public\.whatsapp_record_send\(text, boolean\)\s*\n?\s*FROM PUBLIC, anon, authenticated;/,
    );
  });

  it('GRANTs EXECUTE to service_role only', () => {
    expect(rpcSql).toMatch(
      /GRANT EXECUTE ON FUNCTION public\.whatsapp_claim_inbound\(uuid\)\s+TO service_role;/,
    );
    expect(rpcSql).toMatch(
      /GRANT EXECUTE ON FUNCTION public\.whatsapp_record_send\(text, boolean\) TO service_role;/,
    );
    // No grant to any broader principal anywhere in the file.
    expect(rpcSql).not.toMatch(/GRANT EXECUTE[^;]*TO (PUBLIC|anon|authenticated)/i);
  });

  it('contains no destructive DDL against data (DROP TABLE/COLUMN, TRUNCATE)', () => {
    const executable = rpcSql
      .split('\n')
      .map((line) => line.replace(/--.*$/, ''))
      .join('\n');
    expect(executable).not.toMatch(/\bDROP\s+TABLE\b/i);
    expect(executable).not.toMatch(/\bDROP\s+COLUMN\b/i);
    expect(executable).not.toMatch(/\bTRUNCATE\b/i);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// B — R4 hard-disable guards (Phase 1 quality finding #5)
// ─────────────────────────────────────────────────────────────────────────────
describe('R4 hard-disable guards — broken legacy whatsapp-notify callers stay OFF', () => {
  const dailyCron = readRepo('supabase', 'functions', 'daily-cron', 'index.ts');
  const parentsRoute = readRepo(
    'apps', 'host', 'src', 'app', 'api', 'school-admin', 'parents', 'route.ts',
  );

  it('daily-cron: WHATSAPP_SEND_ENABLED is pinned false', () => {
    // If this fails because someone flipped it to true: the legacy payload
    // shape is double-broken (wrong body, no signing headers) and would
    // hammer the provider with malformed sends the moment credentials exist.
    // Re-enable ONLY via the new whatsapp-send Edge Function.
    expect(dailyCron).toMatch(/const WHATSAPP_SEND_ENABLED = false as boolean/);
    expect(dailyCron).not.toMatch(/WHATSAPP_SEND_ENABLED\s*=\s*true/);
  });

  it('daily-cron: the constant actually gates the send loop (not decorative)', () => {
    expect(dailyCron).toMatch(/WHATSAPP_SEND_ENABLED && i < waTargets\.length/);
  });

  it('daily-cron: the guard is documented as the R4 hard-disable', () => {
    expect(dailyCron).toContain('HARD-DISABLED');
    expect(dailyCron).toContain('whatsapp-send');
  });

  it('school-admin/parents: WHATSAPP_SEND_ENABLED is pinned false', () => {
    expect(parentsRoute).toMatch(/const WHATSAPP_SEND_ENABLED = false as boolean/);
    expect(parentsRoute).not.toMatch(/WHATSAPP_SEND_ENABLED\s*=\s*true/);
  });

  it('school-admin/parents: the constant actually gates the send loop', () => {
    expect(parentsRoute).toMatch(/WHATSAPP_SEND_ENABLED && i < guardiansWithPhone\.length/);
  });

  it('school-admin/parents: the guard is documented as the R4 hard-disable', () => {
    expect(parentsRoute).toContain('HARD-DISABLED');
    expect(parentsRoute).toContain('whatsapp-send');
  });
});
