/**
 * D7.1 follow-up — account-purge Edge Function (DPDP Section 17 right-to-erasure).
 *
 * The Edge Function lives in Deno-land and can't be loaded directly under
 * Vitest (it imports from https://esm.sh and uses Deno.serve). We use the
 * same pattern as the rest of `src/__tests__/edge-functions/` — static-source
 * inspection — to pin the public contract that the cron route depends on.
 *
 * What's pinned by these tests:
 *   1. Constant-time secret compare (no timing oracle on CRON_SECRET).
 *   2. 401 on missing/wrong secret BEFORE any DB read.
 *   3. 422 on missing or malformed body fields (no log mutation — invalid
 *      input cannot be retried).
 *   4. Idempotent short-circuit when log status ∈ {'purged','cancelled_by_user'}.
 *   5. Payment-FK columns are UPDATEd (anonymised), NEVER deleted (8-year IT
 *      Act §44AA retention).
 *   6. PII tables are DELETEd hard.
 *   7. auth.admin.deleteUser is called with the auth_user_id.
 *   8. On any thrown error inside runPurge, log row is flipped to 'failed'
 *      and a 5xx is returned (so the cron retries).
 *   9. Synthetic anon ID is generated via crypto.randomUUID() (non-deterministic).
 *  10. PII discipline: console.log calls inside the function never include
 *      email/name/phone/free-text — only IDs and counts.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';

const FN_PATH = resolve(
  process.cwd(),
  'supabase/functions/account-purge/index.ts',
);

describe('account-purge Edge Function — file shape', () => {
  it('exists at supabase/functions/account-purge/index.ts', () => {
    expect(existsSync(FN_PATH)).toBe(true);
  });

  it('uses Deno.serve (Edge Function runtime contract)', () => {
    const src = readFileSync(FN_PATH, 'utf8');
    expect(src).toMatch(/Deno\.serve\s*\(/);
  });

  it('imports @supabase/supabase-js@2 from esm.sh (no node_modules)', () => {
    const src = readFileSync(FN_PATH, 'utf8');
    expect(src).toContain("from 'https://esm.sh/@supabase/supabase-js@2'");
  });

  it('imports shared CORS helper (consistent with other Edge Functions)', () => {
    const src = readFileSync(FN_PATH, 'utf8');
    expect(src).toMatch(/from ['"]\.\.\/_shared\/cors\.ts['"]/);
  });
});

describe('account-purge — auth (constant-time CRON_SECRET compare)', () => {
  it('reads CRON_SECRET from env', () => {
    const src = readFileSync(FN_PATH, 'utf8');
    expect(src).toMatch(/Deno\.env\.get\(['"]CRON_SECRET['"]\)/);
  });

  it('reads x-cron-secret header from request', () => {
    const src = readFileSync(FN_PATH, 'utf8');
    expect(src).toMatch(/headers\.get\(['"]x-cron-secret['"]\)/);
  });

  it('uses a constant-time comparison (no early return on mismatch)', () => {
    const src = readFileSync(FN_PATH, 'utf8');
    // Pin the loop-XOR pattern used by daily-cron.
    expect(src).toMatch(/constantTimeEqual/);
    expect(src).toMatch(/diff\s*\|=/);
  });

  it('returns 401 on missing/wrong secret BEFORE any DB read in the handler', () => {
    const src = readFileSync(FN_PATH, 'utf8');
    // Scope the check to the Deno.serve handler block — markLogPurged /
    // markLogFailed live above the handler and reference the same table,
    // which would otherwise confuse the order check.
    const handlerStart = src.indexOf('Deno.serve(');
    expect(handlerStart).toBeGreaterThan(0);
    const handler = src.slice(handlerStart);

    const status401 = handler.indexOf('status: 401');
    const firstDbRead = handler.indexOf(".from('account_deletion_log')");
    expect(status401).toBeGreaterThan(0);
    expect(firstDbRead).toBeGreaterThan(0);
    expect(status401).toBeLessThan(firstDbRead);
  });
});

describe('account-purge — body validation (422 on bad input)', () => {
  it('validates account_id as UUID', () => {
    const src = readFileSync(FN_PATH, 'utf8');
    expect(src).toMatch(/UUID_RE/);
    expect(src).toMatch(/account_id must be a UUID/);
  });

  it('validates deletion_log_id as UUID', () => {
    const src = readFileSync(FN_PATH, 'utf8');
    expect(src).toMatch(/deletion_log_id must be a UUID/);
  });

  it('validates account_role ∈ {student, teacher, parent}', () => {
    const src = readFileSync(FN_PATH, 'utf8');
    expect(src).toMatch(/VALID_ROLES/);
    expect(src).toContain("'student'");
    expect(src).toContain("'teacher'");
    expect(src).toContain("'parent'");
  });

  it('returns HTTP 422 (not 400) on validation failure — semantic match for the cron', () => {
    const src = readFileSync(FN_PATH, 'utf8');
    expect(src).toMatch(/status:\s*422/);
  });

  it('rejects invalid JSON body with 422 (parse error path)', () => {
    const src = readFileSync(FN_PATH, 'utf8');
    expect(src).toContain('invalid JSON body');
  });
});

describe('account-purge — idempotent short-circuit', () => {
  it('reads account_deletion_log.status before any purge work', () => {
    const src = readFileSync(FN_PATH, 'utf8');
    expect(src).toMatch(/from\(['"]account_deletion_log['"]\)/);
    expect(src).toMatch(/select\(['"]status['"]\)/);
  });

  it('short-circuits with 200 + idempotent:true when status is terminal', () => {
    const src = readFileSync(FN_PATH, 'utf8');
    expect(src).toContain("'purged'");
    expect(src).toContain("'cancelled_by_user'");
    expect(src).toMatch(/idempotent:\s*true/);
  });

  it('does NOT mutate the log when short-circuiting (re-runs are free)', () => {
    const src = readFileSync(FN_PATH, 'utf8');
    // Find the short-circuit block and check it returns before runPurge.
    const idemIdx = src.indexOf('idempotent: true');
    const runPurgeCall = src.indexOf('runPurge(sb,');
    expect(idemIdx).toBeGreaterThan(0);
    expect(runPurgeCall).toBeGreaterThan(0);
    expect(idemIdx).toBeLessThan(runPurgeCall);
  });
});

describe('account-purge — payment FK anonymisation (IT Act §44AA: 8-year retention)', () => {
  it('UPDATEs subscription_events.student_id (does NOT delete)', () => {
    const src = readFileSync(FN_PATH, 'utf8');
    // The UPDATE call on subscription_events must use .update({ student_id: ... }).
    expect(src).toMatch(/from\(['"]subscription_events['"]\)\s*\.update\(\s*\{\s*student_id/);
    // Belt-and-braces: there must NOT be a .delete() call against this table.
    expect(src).not.toMatch(/from\(['"]subscription_events['"]\)\s*\.delete\(/);
  });

  it('UPDATEs student_subscriptions.student_id (does NOT delete)', () => {
    const src = readFileSync(FN_PATH, 'utf8');
    expect(src).toMatch(/from\(['"]student_subscriptions['"]\)\s*\.update\(\s*\{\s*student_id/);
    expect(src).not.toMatch(/from\(['"]student_subscriptions['"]\)\s*\.delete\(/);
  });

  it('UPDATEs payment_history.student_id (does NOT delete)', () => {
    const src = readFileSync(FN_PATH, 'utf8');
    expect(src).toMatch(/from\(['"]payment_history['"]\)\s*\.update\(\s*\{\s*student_id/);
    expect(src).not.toMatch(/from\(['"]payment_history['"]\)\s*\.delete\(/);
  });

  it('uses crypto.randomUUID() for the synthetic anon ID (non-deterministic)', () => {
    const src = readFileSync(FN_PATH, 'utf8');
    expect(src).toMatch(/crypto\.randomUUID\(\)/);
  });

  it('generates the synthetic ID exactly ONCE per call (consistency across rewrites)', () => {
    const src = readFileSync(FN_PATH, 'utf8');
    // Strip block + line comments so a docstring mention of crypto.randomUUID()
    // doesn't inflate the count. Then assert exactly one INVOCATION lives in
    // executable code — so the same syntheticId is reused across every
    // payment-FK rewrite in a single call.
    const stripped = src
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/(^|[^:])\/\/.*$/gm, '$1');
    const matches = stripped.match(/crypto\.randomUUID\(\)/g) ?? [];
    expect(matches.length).toBe(1);
  });

  it('does NOT touch payment_webhook_events (no student FK on that table)', () => {
    const src = readFileSync(FN_PATH, 'utf8');
    // The function must not pretend to anonymise a non-existent column. A
    // .from('payment_webhook_events').update(...) call would silently fail
    // on prod (no matching column) — pin the exclusion in the source comment.
    expect(src).toMatch(/payment_webhook_events.*no student FK/);
    expect(src).not.toMatch(/from\(['"]payment_webhook_events['"]\)\s*\.update\(/);
  });
});

describe('account-purge — PII hard-delete (no soft-delete for student history)', () => {
  it('DELETEs quiz_responses for the student', () => {
    const src = readFileSync(FN_PATH, 'utf8');
    // The list of PII tables is centralised in STUDENT_PII_TABLES; pin each
    // member of the list so a future "tidy-up" that drops a table is loud.
    expect(src).toContain("'quiz_responses'");
  });

  it('DELETEs quiz_sessions for the student', () => {
    const src = readFileSync(FN_PATH, 'utf8');
    expect(src).toContain("'quiz_sessions'");
  });

  it('DELETEs chat_sessions for the student', () => {
    const src = readFileSync(FN_PATH, 'utf8');
    expect(src).toContain("'chat_sessions'");
  });

  it('DELETEs foxy_chat_messages for the student', () => {
    const src = readFileSync(FN_PATH, 'utf8');
    expect(src).toContain("'foxy_chat_messages'");
  });

  it('DELETEs image_uploads for the student', () => {
    const src = readFileSync(FN_PATH, 'utf8');
    expect(src).toContain("'image_uploads'");
  });

  it('uses a forEach-style table loop with .delete({ count: exact }) so counts are recorded', () => {
    const src = readFileSync(FN_PATH, 'utf8');
    expect(src).toMatch(/\.delete\(\{\s*count:\s*['"]exact['"]\s*\}\)/);
  });
});

describe('account-purge — students/teachers/guardians PII columns nulled', () => {
  it('students: nulls email, phone, parent_phone, parent_name etc. (per contract)', () => {
    const src = readFileSync(FN_PATH, 'utf8');
    // Spot-check the PII columns from the D7.1 contract are explicitly handled.
    expect(src).toMatch(/email:\s*null/);
    expect(src).toMatch(/phone:\s*null/);
    expect(src).toMatch(/parent_name:\s*null/);
    expect(src).toMatch(/parent_phone:\s*null/);
    expect(src).toMatch(/school_name:\s*null/);
  });

  it('students: keeps the row (UPDATEs, does NOT DELETE) so anon FKs still resolve', () => {
    const src = readFileSync(FN_PATH, 'utf8');
    // Pin: the students-row mutation in deleteStudentPii must be .update(),
    // never .delete(). (Hard-delete would orphan the anon payment FKs.)
    expect(src).toMatch(/deleteStudentPii[\s\S]{0,3000}from\(['"]students['"]\)\s*\.update\(/);
    expect(src).not.toMatch(/deleteStudentPii[\s\S]{0,3000}from\(['"]students['"]\)\s*\.delete\(/);
  });

  it('teachers: handles teachers.email NOT NULL (sets to invalid sentinel, not null)', () => {
    const src = readFileSync(FN_PATH, 'utf8');
    // teachers.email is NOT NULL per baseline schema (line 14394). Pinning the
    // sentinel prevents a later "let's null it everywhere" refactor from
    // crashing the purge with a CHECK violation.
    expect(src).toContain('__deleted__@invalid.local');
  });

  it('guardians: nulls email, phone, name (DPDP scope: parent contact info)', () => {
    const src = readFileSync(FN_PATH, 'utf8');
    expect(src).toMatch(/deleteGuardianPii[\s\S]{0,1500}email:\s*null/);
    expect(src).toMatch(/deleteGuardianPii[\s\S]{0,1500}phone:\s*null/);
  });
});

describe('account-purge — auth.users delete', () => {
  it('calls sb.auth.admin.deleteUser with the auth_user_id', () => {
    const src = readFileSync(FN_PATH, 'utf8');
    expect(src).toMatch(/auth\.admin\.deleteUser\(/);
  });

  it('reads auth_user_id from the role table BEFORE nulling it', () => {
    const src = readFileSync(FN_PATH, 'utf8');
    // The orchestrator must call deleteAuthUserForAccount BEFORE
    // deleteStudentPii/deleteTeacherPii/deleteGuardianPii (the PII step nulls
    // auth_user_id). Pin the order in runPurge.
    const runPurgeBlock = src.match(/async function runPurge[\s\S]+?^}/m);
    expect(runPurgeBlock).not.toBeNull();
    const block = runPurgeBlock![0];
    const authIdx = block.indexOf('deleteAuthUserForAccount');
    const piiIdx = Math.min(
      ...['deleteStudentPii', 'deleteTeacherPii', 'deleteGuardianPii']
        .map((s) => {
          const idx = block.indexOf(s);
          return idx === -1 ? Number.POSITIVE_INFINITY : idx;
        }),
    );
    expect(authIdx).toBeGreaterThan(0);
    expect(piiIdx).toBeLessThan(Number.POSITIVE_INFINITY);
    expect(authIdx).toBeLessThan(piiIdx);
  });

  it('treats user_not_found / 404 as benign (idempotent re-run safety)', () => {
    const src = readFileSync(FN_PATH, 'utf8');
    expect(src).toMatch(/not.\?found|user_not_found/);
  });
});

describe('account-purge — failure path writes status=failed (cron retries)', () => {
  it('has a markLogFailed helper that flips status=failed', () => {
    const src = readFileSync(FN_PATH, 'utf8');
    expect(src).toMatch(/markLogFailed/);
    expect(src).toMatch(/status:\s*['"]failed['"]/);
  });

  it('the outer try/catch around runPurge calls markLogFailed before returning 500', () => {
    const src = readFileSync(FN_PATH, 'utf8');
    // Find the catch block that wraps runPurge.
    const handlerCatch = src.match(/} catch \(err\)[\s\S]+?await markLogFailed[\s\S]+?status:\s*500/);
    expect(handlerCatch).not.toBeNull();
  });

  it('truncates error_text to a safe length so ops dashboards stay readable', () => {
    const src = readFileSync(FN_PATH, 'utf8');
    expect(src).toMatch(/errMessage\.slice\(0,\s*\d+\)/);
  });

  it('returns 500 (not 200) on partial failure so the cron retries tomorrow', () => {
    const src = readFileSync(FN_PATH, 'utf8');
    // The failure-path Response must use 5xx, never 200.
    expect(src).toMatch(/} catch \(err\)[\s\S]+?status:\s*5\d\d/);
  });
});

describe('account-purge — PII discipline in logs (P13 data privacy)', () => {
  it('only logs IDs + counts + role + elapsed_ms (no PII fields)', () => {
    const src = readFileSync(FN_PATH, 'utf8');
    // Allow-list the fields that may appear in console.{log,error} payloads.
    // Forbidden: any of email, name, phone, full_name, parent_name, parent_phone
    // appearing as a literal key in a logged object.
    const forbidden = [
      /console\.(log|error|warn)\([^)]*\bemail\s*:/,
      /console\.(log|error|warn)\([^)]*\bname\s*:/,
      /console\.(log|error|warn)\([^)]*\bphone\s*:/,
      /console\.(log|error|warn)\([^)]*\bparent_name\s*:/,
      /console\.(log|error|warn)\([^)]*\bparent_phone\s*:/,
      /console\.(log|error|warn)\([^)]*\bfull_name\s*:/,
    ];
    for (const re of forbidden) {
      expect(src).not.toMatch(re);
    }
  });
});

describe('account-purge — cron route compatibility', () => {
  it('the path matches what the cron route POSTs to', () => {
    // Pin the contract in both directions: the cron at
    // src/app/api/cron/account-purge/route.ts builds
    //   `${SUPABASE_URL}/functions/v1/account-purge`.
    // If the directory is renamed, the URL breaks silently — this test surfaces
    // that loudly.
    const cronRoute = resolve(process.cwd(), 'src/app/api/cron/account-purge/route.ts');
    expect(existsSync(cronRoute)).toBe(true);
    const cronSrc = readFileSync(cronRoute, 'utf8');
    expect(cronSrc).toContain('/functions/v1/account-purge');
  });

  it('accepts the body shape the cron sends ({ account_id, account_role, deletion_log_id })', () => {
    // The cron route's body literal — pin the field names so a contract drift
    // breaks both sides at once.
    const cronRoute = resolve(process.cwd(), 'src/app/api/cron/account-purge/route.ts');
    const cronSrc = readFileSync(cronRoute, 'utf8');
    expect(cronSrc).toMatch(/account_id:\s*row\.account_id/);
    expect(cronSrc).toMatch(/account_role:\s*row\.account_role/);
    expect(cronSrc).toMatch(/deletion_log_id:\s*row\.id/);

    const fnSrc = readFileSync(FN_PATH, 'utf8');
    // And the function must validate exactly those fields.
    expect(fnSrc).toMatch(/obj\.account_id/);
    expect(fnSrc).toMatch(/obj\.account_role/);
    expect(fnSrc).toMatch(/obj\.deletion_log_id/);
  });
});
