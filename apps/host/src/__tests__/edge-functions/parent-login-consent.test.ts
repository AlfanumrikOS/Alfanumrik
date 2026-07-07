/**
 * REG-199 — PP-1/3: Parent-Link Consent / Option B (P8/P13/P15).
 *
 * WHY THIS EXISTS
 * ---------------
 * The Cycle-7 audit found that the legacy Edge `parent_login` action granted an
 * `active` / `is_verified:true` guardian↔child link from a bare link-code match.
 * A link code alone (e.g. leaked to a tuition centre) therefore opened a child's
 * data with NO child consent — a P8 (parent↔child boundary) + P13 (privacy)
 * exposure. CEO-approved Option B FLIPS the posture: `parent_login` now creates a
 * `pending` link that the STUDENT must approve before any data is exposed.
 *
 * This is a posture FLIP, not a preservation — there is intentionally NO
 * characterization tripwire of the old "active-without-approval" behaviour. The
 * pins below assert the NEW consent invariant across four surfaces:
 *
 *   1. CONSENT POSTURE — both `handleParentLogin` insert branches write
 *      `status:'pending'` + `is_verified:false` via an ON CONFLICT upsert (never
 *      `active`/`true`, never a downgrade of an approved link); the pending
 *      response carries no session/guardian/grade; the student is notified
 *      PII-free via `send_notification` (`type:'parent_link_request'`).
 *   2. NO-DATA-WHILE-PENDING — `ACTIVE_GUARDIAN_LINK_STATUSES` excludes
 *      `'pending'`, so the relationship reads + `canAccessStudent`'s parent
 *      branch grant ZERO child data while pending.
 *   3. ANTI-ORPHAN GUARD (the critical one) — the live `StudentOSDashboard`
 *      imports AND renders `PendingLinkApproval`. This guards against the card
 *      silently un-wiring again (the §1 orphaning that would dead-end consent).
 *   4. APPROVE FLOW INTACT — the student-owned approve-link flip (REG-117) stays
 *      green (asserted in `src/__tests__/api/parent/approve-link/route.test.ts`).
 *
 * LANE: the Edge function imports Deno globals + npm:/jsr: specifiers and cannot
 * be imported under Vitest, so the consent posture is pinned as STATIC source
 * assertions over the file — the SAME convention as
 * `parent-login-rate-limit.test.ts` (PP-1) and `reports-pii-tier.test.ts`
 * (REG-198). Comments are stripped first so the doc-comments that describe the
 * OLD behaviour can never satisfy or break a pin on the real code.
 *
 * Invariants: P8 (parent↔child boundary), P13 (no PII while pending / in the
 * notification), P15 (consent funnel — the approval surface must stay wired).
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';
import { ACTIVE_GUARDIAN_LINK_STATUSES, type GuardianLinkStatus } from '@alfanumrik/lib/domains/types';

const REPO_ROOT = path.resolve(__dirname, '../../..');

function read(rel: string): string {
  return readFileSync(path.join(REPO_ROOT, rel), 'utf8');
}

/**
 * Strip block + line comments so the route's doc-comments (which quote the OLD
 * `status:'active'` posture to explain the remediation) cannot satisfy/break a
 * textual pin on the real code. The `[^:]` guard avoids eating `://` inside any
 * URL string literal.
 */
function stripComments(raw: string): string {
  return raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

const EDGE_REL = 'supabase/functions/parent-portal/index.ts';
const EDGE_SRC = stripComments(read(EDGE_REL));

// Body of handleParentLogin only (everything from its declaration to the next
// top-level `async function`), so the assertions can't be satisfied by an
// unrelated handler.
function sliceFn(src: string, name: string): string {
  const start = src.indexOf(`async function ${name}`);
  if (start < 0) throw new Error(`${name} not found`);
  const after = src.indexOf('async function ', start + 10);
  return src.slice(start, after < 0 ? undefined : after);
}

const LOGIN_BODY = sliceFn(EDGE_SRC, 'handleParentLogin');
const NOTIFY_BODY = sliceFn(EDGE_SRC, 'notifyStudentOfPendingLink');

// ─── 1. CONSENT POSTURE ──────────────────────────────────────────────────────

describe('REG-199 — consent posture: handleParentLogin creates a PENDING link (P8)', () => {
  it('both insert branches write status:\'pending\' (the two upsert sites)', () => {
    // Authed-guardian branch + new-guardian branch each insert exactly one row.
    const pendingWrites = LOGIN_BODY.match(/status:\s*'pending'/g) || [];
    expect(pendingWrites.length).toBe(2);
  });

  it('both insert branches write is_verified:false (consent is a separate event)', () => {
    const verifiedFalse = LOGIN_BODY.match(/is_verified:\s*false/g) || [];
    expect(verifiedFalse.length).toBe(2);
  });

  it('NEVER writes status:\'active\' or is_verified:true (no active-without-consent)', () => {
    // Object-literal WRITE form only. `=== 'active'` and `.in('status',
    // ['active','approved'])` are READ comparisons and use different syntax, so
    // they do not trip these pins.
    expect(LOGIN_BODY).not.toMatch(/status:\s*'active'/);
    expect(LOGIN_BODY).not.toMatch(/is_verified:\s*true/);
  });

  it('uses an ON CONFLICT (guardian_id,student_id) upsert with ignoreDuplicates (no 23505 / no downgrade)', () => {
    const upserts = LOGIN_BODY.match(/\.upsert\(/g) || [];
    expect(upserts.length).toBe(2);
    const onConflict = LOGIN_BODY.match(/onConflict:\s*'guardian_id,student_id'/g) || [];
    expect(onConflict.length).toBe(2);
    const ignoreDup = LOGIN_BODY.match(/ignoreDuplicates:\s*true/g) || [];
    expect(ignoreDup.length).toBe(2);
    // initiated_by provenance retained on both writes.
    const initiatedBy = LOGIN_BODY.match(/initiated_by:\s*'parent_login'/g) || [];
    expect(initiatedBy.length).toBe(2);
  });

  it('an already-approved re-submit is NOT downgraded — it returns status:\'approved\'', () => {
    // The authed branch short-circuits on an existing approved/active link and
    // returns the approved shape; the alreadyLinked path in the new-guardian
    // branch does the same. Either way no second insert/downgrade fires.
    expect(LOGIN_BODY).toMatch(/===\s*'approved'\s*\|\|\s*[\w.]+\.status\s*===\s*'active'/);
    const approvedResponses = LOGIN_BODY.match(/status:\s*'approved'/g) || [];
    expect(approvedResponses.length).toBeGreaterThanOrEqual(2);
  });
});

describe('REG-199 — pending response carries NO session/guardian/grade (P13)', () => {
  // Each pending response is a flat literal: `{ status: 'pending_approval',
  // student_name: student.name, link_id: ... }`.
  const pendingResponses = LOGIN_BODY.match(/\{\s*status:\s*'pending_approval'[^}]*\}/g) || [];

  it('emits exactly two pending_approval responses (one per branch)', () => {
    expect(pendingResponses.length).toBe(2);
  });

  it('each pending_approval response exposes only student_name + link_id — no guardian/grade/session', () => {
    for (const r of pendingResponses) {
      expect(r).toMatch(/student_name/);
      expect(r).toMatch(/link_id/);
      // No data-bearing session for an unapproved link.
      expect(r).not.toMatch(/guardian/);
      expect(r).not.toMatch(/grade/);
      expect(r).not.toMatch(/\bgrade\b|\bstreak\b|\bxp\b|last_active/i);
    }
  });
});

describe('REG-199 — student notified PII-free via send_notification (P13)', () => {
  it('handleParentLogin calls notifyStudentOfPendingLink on a genuine new pending insert', () => {
    const calls = LOGIN_BODY.match(/notifyStudentOfPendingLink\(/g) || [];
    expect(calls.length).toBe(2);
  });

  it('the notifier goes through the send_notification RPC with type parent_link_request', () => {
    expect(NOTIFY_BODY).toMatch(/\.rpc\(\s*'send_notification'/);
    expect(NOTIFY_BODY).toMatch(/p_type:\s*'parent_link_request'/);
    // Bilingual ride-along (P7 house shape — *_hi inside the data jsonb).
    expect(NOTIFY_BODY).toMatch(/title_hi/);
    expect(NOTIFY_BODY).toMatch(/body_hi/);
  });

  it('the notification carries NO guardian name/email/phone (P13)', () => {
    expect(NOTIFY_BODY).not.toMatch(/guardianName|parentName|parent_name/);
    expect(NOTIFY_BODY).not.toMatch(/\bemail\b/i);
    expect(NOTIFY_BODY).not.toMatch(/\bphone\b/i);
    // Only the opaque link_id rides in the payload.
    expect(NOTIFY_BODY).toMatch(/link_id:\s*linkId/);
  });
});

// ─── 2. NO-DATA-WHILE-PENDING ─────────────────────────────────────────────────

describe('REG-199 — a pending link grants ZERO child data (P8)', () => {
  it('ACTIVE_GUARDIAN_LINK_STATUSES excludes \'pending\'', () => {
    expect(ACTIVE_GUARDIAN_LINK_STATUSES).not.toContain('pending' as GuardianLinkStatus);
  });

  it('ACTIVE_GUARDIAN_LINK_STATUSES is exactly the consented set [approved, active]', () => {
    expect([...ACTIVE_GUARDIAN_LINK_STATUSES].sort()).toEqual(['active', 'approved']);
    // 'rejected' / 'revoked' are likewise excluded — only consented links count.
    expect(ACTIVE_GUARDIAN_LINK_STATUSES).not.toContain('rejected' as GuardianLinkStatus);
    expect(ACTIVE_GUARDIAN_LINK_STATUSES).not.toContain('revoked' as GuardianLinkStatus);
  });

  it('relationship.ts filters every guardian read to ACTIVE_GUARDIAN_LINK_STATUSES (layer 1)', () => {
    const rel = stripComments(read('src/lib/domains/relationship.ts'));
    expect(rel).toMatch(/ACTIVE_GUARDIAN_LINK_STATUSES/);
    // Used as the .in('status', …) filter on the link reads.
    const filters = rel.match(/\.in\(\s*'status',\s*ACTIVE_GUARDIAN_LINK_STATUSES/g) || [];
    expect(filters.length).toBeGreaterThanOrEqual(2);
  });

  it('canAccessStudent\'s parent branch only counts active/approved links (layer 2)', () => {
    const rbac = stripComments(read('src/lib/rbac.ts'));
    const fnStart = rbac.indexOf('export async function canAccessStudent');
    expect(fnStart).toBeGreaterThan(-1);
    const fnEnd = rbac.indexOf('export ', fnStart + 10);
    const fn = rbac.slice(fnStart, fnEnd < 0 ? undefined : fnEnd);
    // The guardian_student_links read inside the parent branch filters to the
    // consented statuses — a pending link can never satisfy it.
    expect(fn).toMatch(/guardian_student_links/);
    expect(fn).toMatch(/\.in\(\s*'status',\s*\[\s*'active',\s*'approved'\s*\]\s*\)/);
    expect(fn).not.toMatch(/'pending'/);
  });
});

// ─── 3. ANTI-ORPHAN GUARD ─────────────────────────────────────────────────────

describe('REG-199 — the approval surface stays WIRED into the live dashboard (P15)', () => {
  const DASH = read('src/app/dashboard/StudentOSDashboard.tsx'); // raw — JSX & imports are code, not comments

  it('StudentOSDashboard IMPORTS PendingLinkApproval', () => {
    expect(DASH).toMatch(
      /import\s+PendingLinkApproval(?:\s*,\s*\{[^}]*\})?\s+from\s+'@\/components\/dashboard\/PendingLinkApproval'/,
    );
  });

  it('StudentOSDashboard IMPORTS the getPendingParentLinks fetch helper', () => {
    expect(DASH).toMatch(/getPendingParentLinks/);
  });

  it('StudentOSDashboard RENDERS <PendingLinkApproval …/> in JSX (not orphaned)', () => {
    // The exact regression we guard against: the card existing but un-mounted.
    expect(DASH).toMatch(/<PendingLinkApproval\b/);
    // It is fed the fetched pending links + a re-fetch on approval.
    expect(DASH).toMatch(/<PendingLinkApproval[^>]*links=\{[^}]*\}/);
    expect(DASH).toMatch(/<PendingLinkApproval[^>]*onApproved=\{/);
  });
});
