import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Audit remediation regression (2026-08-14): webhook dedupe on SUCCESSFUL
 * PROCESSING, not on row existence.
 *
 * Pins the semantic introduced by
 * `supabase/migrations/20260814000006_webhook_dedupe_on_processed_not_existence.sql`.
 *
 * DEFECT BEING PINNED
 * -------------------
 * `public.record_webhook_event` committed a `payment_webhook_events` receipt
 * BEFORE any activation work, then reported `is_new = false` on every later
 * delivery. The webhook route short-circuited on `is_new === false` and answered
 * 200 `{received:true, note:'dedupe'}` WITHOUT re-attempting activation — so the
 * retry that the route's own 503 asked Razorpay for was consumed, not honoured,
 * and a crash between the dedupe commit and activation lost the event
 * permanently. The fix adds an `already_processed` output column derived from
 * `processed_at` + `outcome`, so only outcomes the route pairs with a 2xx
 * suppress a retry.
 *
 * Structural/source-level checks only (same pattern as
 * `anon-execute-revoke-batch.test.ts`): Postgres is not run from Vitest. To keep
 * the migration's long explanatory header prose from satisfying an assertion,
 * every content check runs against `ddl` — the migration text with all `--`
 * comment lines stripped — not against the raw file.
 */

const MIGRATION_FILE =
  'supabase/migrations/20260814000006_webhook_dedupe_on_processed_not_existence.sql';

function resolveRepo(rel: string): string | null {
  for (const c of [path.resolve(process.cwd(), rel), path.resolve(process.cwd(), '..', rel)]) {
    if (fs.existsSync(c)) return c;
  }
  return null;
}

function readFile(rel: string): string {
  const resolved = resolveRepo(rel);
  if (!resolved) return '';
  return fs.readFileSync(resolved, 'utf-8');
}

/** Strip `--` comment lines so header prose cannot satisfy a DDL assertion. */
function stripComments(sql: string): string {
  return sql
    .split('\n')
    .filter((l) => !/^\s*--/.test(l))
    .join('\n');
}

/** Extract a specific `DO $tag$ ... $tag$;` block by its dollar-quote tag. */
function doBlock(ddl: string, tag: string): string | null {
  const m = ddl.match(new RegExp(String.raw`DO\s+\$${tag}\$([\s\S]*?)\$${tag}\$\s*;`));
  return m ? m[0] : null;
}

/** The `$fn$ ... $fn$` function body of the recreated RPC. */
function fnBody(ddl: string): string | null {
  const m = ddl.match(/AS\s+\$fn\$([\s\S]*?)\$fn\$\s*;/);
  return m ? m[1] : null;
}

const MIGRATION_PRESENT = resolveRepo(MIGRATION_FILE) !== null;

describe.skipIf(!MIGRATION_PRESENT)(
  '20260814000006 webhook dedupe on successful processing',
  () => {
    const sql = readFile(MIGRATION_FILE);
    const ddl = stripComments(sql);

    it('migration exists', () => {
      expect(MIGRATION_PRESENT).toBe(true);
    });

    it('is transactional (BEGIN ... COMMIT)', () => {
      expect(ddl).toMatch(/^BEGIN;/m);
      expect(ddl).toMatch(/^COMMIT;/m);
    });

    it('comment stripping actually removed the header prose', () => {
      // Sanity check on the helper itself: the header explains the failure mode
      // and none of that prose may leak into `ddl` and satisfy an assertion.
      expect(sql).toMatch(/FALSE-ACKNOWLEDGEMENT FAILURE MODE/);
      expect(ddl).not.toMatch(/FALSE-ACKNOWLEDGEMENT FAILURE MODE/);
      expect(sql).toMatch(/BACKEND HANDOFF/);
      expect(ddl).not.toMatch(/BACKEND HANDOFF/);
    });

    // ── Return shape: ADDITIVE, never subtractive ───────────────────────────
    describe('return shape adds already_processed and keeps id + is_new', () => {
      const returnsTable = () =>
        ddl.match(/RETURNS\s+TABLE\s*\(([\s\S]*?)\)\s*\n?\s*LANGUAGE/i);

      it('declares a RETURNS TABLE list on record_webhook_event', () => {
        expect(ddl).toMatch(
          /CREATE\s+OR\s+REPLACE\s+FUNCTION\s+public\.record_webhook_event\s*\(/i,
        );
        expect(returnsTable()).not.toBeNull();
      });

      it('already_processed is in the RETURNS TABLE / OUT list and is boolean', () => {
        const cols = returnsTable()![1];
        expect(cols).toMatch(/\balready_processed\s+boolean\b/i);
      });

      it('REGRESSION WITNESS: id and is_new are STILL present (the route reads both)', () => {
        // apps/host/src/app/api/payments/webhook/route.ts reads `row.is_new`
        // (short-circuit) and `row.id` (stamped later via
        // mark_webhook_event_processed). Removing either breaks the live route
        // before backend's follow-up lands.
        const cols = returnsTable()![1];
        expect(cols).toMatch(/\bis_new\s+boolean\b/i);
        expect(cols).toMatch(/\bid\s+uuid\b/i);
      });

      it('appends already_processed LAST, preserving the baseline is_new -> id order', () => {
        const cols = returnsTable()![1];
        const iIsNew = cols.search(/\bis_new\b/i);
        const iId = cols.search(/\bid\s+uuid\b/i);
        const iNew = cols.search(/\balready_processed\b/i);
        expect(iIsNew).toBeGreaterThanOrEqual(0);
        expect(iIsNew).toBeLessThan(iId);
        expect(iId).toBeLessThan(iNew);
      });

      it('keeps the input signature byte-identical (no new overload)', () => {
        // 20260516040000:77 and 20260516050000:99 REVOKE by EXACT signature and
        // carry no IF EXISTS — a drifted input list breaks fresh-DB replay.
        const args = ddl.match(
          /CREATE\s+OR\s+REPLACE\s+FUNCTION\s+public\.record_webhook_event\s*\(([\s\S]*?)\)\s*\n?\s*RETURNS/i,
        );
        expect(args).not.toBeNull();
        const a = args![1];
        expect(a).toMatch(/p_account_id\s+text/i);
        expect(a).toMatch(/p_event_id\s+text/i);
        expect(a).toMatch(/p_event_type\s+text/i);
        expect(a).toMatch(/p_raw_payload\s+jsonb\s+DEFAULT\s+'\{\}'::jsonb/i);
      });
    });

    // ── Concurrency ─────────────────────────────────────────────────────────
    describe('advisory lock serialises the read-modify decision per event id', () => {
      it('takes pg_advisory_xact_lock keyed on account id + event id', () => {
        const m = ddl.match(
          /PERFORM\s+pg_advisory_xact_lock\s*\(\s*hashtextextended\s*\(([\s\S]*?)\)\s*\)\s*;/i,
        );
        expect(m).not.toBeNull();
        const key = m![1];
        expect(key).toMatch(/'webhook_event:'/);
        expect(key).toMatch(/p_account_id/);
        expect(key).toMatch(/p_event_id/);
      });

      it('the lock is taken BEFORE the INSERT (otherwise it serialises nothing)', () => {
        const body = fnBody(ddl);
        expect(body).not.toBeNull();
        const iLock = body!.search(/pg_advisory_xact_lock/i);
        const iInsert = body!.search(/INSERT\s+INTO\s+public\.payment_webhook_events/i);
        const iSelect = body!.search(/SELECT\s+pwe\.id/i);
        expect(iLock).toBeGreaterThanOrEqual(0);
        expect(iInsert).toBeGreaterThan(iLock);
        expect(iSelect).toBeGreaterThan(iLock);
      });
    });

    // ── Success determination ───────────────────────────────────────────────
    describe('already_processed is derived from processed_at + a success outcome', () => {
      it('requires processed_at IS NOT NULL', () => {
        const body = fnBody(ddl)!;
        expect(body).toMatch(/v_processed_at\s+IS\s+NOT\s+NULL/i);
      });

      it('reads processed_at and outcome off the existing row', () => {
        const body = fnBody(ddl)!;
        expect(body).toMatch(/pwe\.processed_at/i);
        expect(body).toMatch(/pwe\.outcome/i);
      });

      it('counts only the terminal-2xx outcomes as success', () => {
        const m = ddl.match(/v_outcome\s+IN\s*\(([^)]*)\)/i);
        expect(m).not.toBeNull();
        const list = m![1];
        expect(list).toMatch(/'ack'/);
        expect(list).toMatch(/'activated'/);
        expect(list).toMatch(/'downgraded'/);
      });

      it('EXCLUDES every retryable outcome — failed, unresolved and dedupe', () => {
        // 'failed'     -> route returns 503 asking Razorpay to retry.
        // 'unresolved' -> handleUnresolved returns 500 asking Razorpay to retry.
        // 'dedupe'     -> asserts "duplicate seen", NOT "work completed";
        //                 admitting it would re-create this defect one level up.
        const list = ddl.match(/v_outcome\s+IN\s*\(([^)]*)\)/i)![1];
        expect(list).not.toMatch(/'failed'/);
        expect(list).not.toMatch(/'unresolved'/);
        expect(list).not.toMatch(/'dedupe'/);
      });

      it('a brand-new row reports is_new=true AND already_processed=false', () => {
        const body = fnBody(ddl)!;
        expect(body).toMatch(
          /SELECT\s+true\s+AS\s+is_new\s*,[\s\S]{0,60}?false\s+AS\s+already_processed/i,
        );
      });

      it('an existing row still reports is_new=false (backward compatible)', () => {
        const body = fnBody(ddl)!;
        expect(body).toMatch(/SELECT\s*\n?\s*false\s+AS\s+is_new/i);
      });
    });

    // ── Shape of the change: function-level only, never the table ───────────
    describe('CREATE OR REPLACE of the FUNCTION; the table is never dropped or mutated', () => {
      it('uses CREATE OR REPLACE FUNCTION', () => {
        expect(ddl).toMatch(
          /CREATE\s+OR\s+REPLACE\s+FUNCTION\s+public\.record_webhook_event/i,
        );
      });

      it('never drops, truncates or deletes from payment_webhook_events', () => {
        expect(ddl).not.toMatch(/DROP\s+TABLE/i);
        expect(ddl).not.toMatch(/TRUNCATE/i);
        expect(ddl).not.toMatch(/DELETE\s+FROM\s+(?:public\.)?payment_webhook_events/i);
        expect(ddl).not.toMatch(/ALTER\s+TABLE/i);
      });

      it('the only DROP is the FUNCTION drop Postgres requires to add a TABLE column', () => {
        // A RETURNS TABLE column cannot be added via CREATE OR REPLACE alone
        // ("cannot change return type of existing function"), so exactly one
        // DROP FUNCTION IF EXISTS, by exact signature, is expected — and
        // nothing else may be dropped.
        const drops = ddl.match(/^\s*DROP\s+[A-Z]+/gim) ?? [];
        expect(drops).toHaveLength(1);
        expect(ddl).toMatch(
          /DROP\s+FUNCTION\s+IF\s+EXISTS\s+public\.record_webhook_event\s*\(\s*text\s*,\s*text\s*,\s*text\s*,\s*jsonb\s*\)\s*;/i,
        );
        // RESTRICT (default) — never cascade a dependent away.
        expect(ddl).not.toMatch(/DROP\s+FUNCTION[^;]*CASCADE/i);
      });

      it('performs no DML against payment_webhook_events outside the function body', () => {
        const body = fnBody(ddl)!;
        const topLevel = ddl.replace(body, ' ');
        expect(topLevel).not.toMatch(/INSERT\s+INTO\s+(?:public\.)?payment_webhook_events/i);
        expect(topLevel).not.toMatch(/UPDATE\s+(?:public\.)?payment_webhook_events/i);
      });

      it('keeps SECURITY DEFINER with a pinned search_path', () => {
        expect(ddl).toMatch(/SECURITY\s+DEFINER/i);
        expect(ddl).toMatch(/SET\s+search_path\s*=\s*public/i);
      });
    });

    // ── ACL posture ─────────────────────────────────────────────────────────
    describe('grant posture is re-asserted after the DROP and does NOT widen', () => {
      it('revokes from PUBLIC, anon AND authenticated', () => {
        // Mandatory: the baseline ALTER DEFAULT PRIVILEGES grants EXECUTE on
        // every newly-created public function to anon + authenticated, so a
        // DROP+CREATE silently re-opens them without this.
        const revoke = ddl.match(
          /REVOKE\s+ALL\s+ON\s+FUNCTION\s+public\.record_webhook_event\s*\([^)]*\)\s+FROM\s+([^;]+);/i,
        );
        expect(revoke).not.toBeNull();
        const targets = revoke![1].toLowerCase();
        expect(targets).toMatch(/\bpublic\b/);
        expect(targets).toMatch(/\banon\b/);
        expect(targets).toMatch(/\bauthenticated\b/);
      });

      it('grants EXECUTE to service_role ONLY — never anon, never authenticated', () => {
        const grants = ddl.match(/GRANT[^;]*record_webhook_event[^;]*;/gi);
        expect(grants).not.toBeNull();
        expect(grants!).toHaveLength(1);
        const targets = grants![0].toLowerCase();
        expect(targets).toMatch(/\bservice_role\b/);
        expect(targets).not.toMatch(/\banon\b/);
        expect(targets).not.toMatch(/\bauthenticated\b/);
        expect(targets).not.toMatch(/\bto\s+public\b/);
      });

      it('grants nothing at all to anon anywhere in active DDL', () => {
        const grants = ddl.match(/^\s*GRANT[^;]*;/gim) ?? [];
        for (const g of grants) {
          expect(g.toLowerCase()).not.toMatch(/\banon\b/);
        }
      });

      it('documents the new dedupe semantic + ACL posture in a COMMENT', () => {
        expect(ddl).toMatch(/COMMENT\s+ON\s+FUNCTION\s+public\.record_webhook_event/i);
        expect(ddl).toMatch(/already_processed/);
      });
    });

    // ── Self-verifying apply ────────────────────────────────────────────────
    describe('post-flight assertions make the migration self-verifying', () => {
      it('has a $post$ block that aborts if anon regains EXECUTE', () => {
        const b = doBlock(ddl, 'post');
        expect(b).not.toBeNull();
        expect(b!).toMatch(/has_function_privilege\s*\(\s*'anon'/i);
        expect(b!).toMatch(/RAISE\s+EXCEPTION/i);
      });

      it('asserts the result type still carries id, is_new and already_processed', () => {
        const b = doBlock(ddl, 'post')!;
        expect(b).toMatch(/'already_processed'\s*=\s*ANY/i);
        expect(b).toMatch(/'is_new'\s*=\s*ANY/i);
        expect(b).toMatch(/'id'\s*=\s*ANY/i);
      });

      it('asserts service_role did NOT lose EXECUTE', () => {
        const b = doBlock(ddl, 'post')!;
        expect(b).toMatch(/has_function_privilege\s*\(\s*'service_role'/i);
      });

      it('asserts exactly one overload survives (no stale binding target)', () => {
        const b = doBlock(ddl, 'post')!;
        expect(b).toMatch(/v_overloads\s*<>\s*1/i);
      });
    });
  },
);
