import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { resolve, join } from 'node:path';

/**
 * ADMIN-CLIENT ANTI-REGRESSION ALLOWLIST guard (P8 / P9) — XC-3 Phase 0b.
 *
 * WHY THIS EXISTS
 * ===============
 * The XC-3 audit found that 273 of 362 API `route.ts` files (75.4%) import the
 * RLS-BYPASSING service-role client `@alfanumrik/lib/supabase-admin`. On those routes RLS
 * is NOT exercised on the request path — authorization rests entirely on
 * hand-written `authorizeRequest()` + app checks (`canAccessStudent`, …). A
 * single missed check is an unbounded data-exposure bug with no second line of
 * defense (P8 RLS boundary, P9 RBAC enforcement, P13 data privacy at risk).
 *
 * We cannot migrate all 273 routes at once. Instead Phase 0b FREEZES the blast
 * radius: this guard fails CI the moment a NEW `route.ts` imports `supabase-admin`
 * without being recorded in the `scripts/admin-client-allowlist.json` ledger. The
 * ledger can only RATCHET DOWN — Phase 2/3 prune entries as they swap routes onto
 * the RLS-scoped `supabase-server` client.
 *
 * THE RULE
 * ========
 * A new API route MUST default to the RLS-respecting `@alfanumrik/lib/supabase-server`
 * client. If service-role is genuinely required (webhooks, reconciliation,
 * super-admin-by-design, cron), the route's path MUST be added to the ledger in
 * the SAME PR — that JSON entry is the explicit, reviewable "service-role
 * justified" record an architect signs off on.
 *
 * HOW IT WORKS (static source scan — no runtime, no DB)
 * =====================================================
 *   1. enumerate every `route.ts` under `src/app/api`;
 *   2. flag any whose source has an import/require of a module specifier ending
 *      in `supabase-admin` (covers `@alfanumrik/lib/supabase-admin` AND relative
 *      `../../lib/supabase-admin` forms);
 *   3. load `scripts/admin-client-allowlist.json`;
 *   4. ASSERT detected \ allowlist === ∅  (no NEW admin-importing route);
 *   5. ASSERT allowlist \ detected === ∅  (no STALE entry — a migrated/removed
 *      route must be pruned so the count ratchets down, never drifts);
 *   6. pin the exact count.
 *
 * Plan: docs/superpowers/plans/2026-07-02-xc3-systemic-rls-defense-in-depth.md (§5b).
 * Owner: architect (ledger) + testing (guard). Catalog: REG-213.
 */

// ── repo / file resolution (cwd or one level up, matching the sibling pins) ──
function resolveRepo(rel: string): string | null {
  for (const c of [resolve(process.cwd(), rel), resolve(process.cwd(), '..', rel)]) {
    if (existsSync(c)) return c;
  }
  return null;
}

const API_ROOT = resolveRepo('src/app/api');
const ALLOWLIST_ABS = resolveRepo('scripts/admin-client-allowlist.json');

// Match an import/require whose module specifier ends in `supabase-admin`:
//   import { getSupabaseAdmin } from '@alfanumrik/lib/supabase-admin'
//   import { supabaseAdmin }   from '../../../../lib/supabase-admin'
//   const x = require('@alfanumrik/lib/supabase-admin')
const ADMIN_IMPORT_RE = /(?:from|require\(\s*)\s*['"][^'"]*\bsupabase-admin['"]/;

/** Recursively collect every route.ts under src/app/api, repo-relative + POSIX. */
function collectRoutes(dir: string, repoRoot: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const abs = join(dir, entry);
    const st = statSync(abs);
    if (st.isDirectory()) out.push(...collectRoutes(abs, repoRoot));
    else if (entry === 'route.ts') {
      out.push(abs.slice(repoRoot.length + 1).replace(/\\/g, '/'));
    }
  }
  return out;
}

const REPO_ROOT = API_ROOT ? resolve(API_ROOT, '..', '..', '..') : null;

function detectAdminImporters(): string[] {
  if (!API_ROOT || !REPO_ROOT) return [];
  const out: string[] = [];
  for (const rel of collectRoutes(API_ROOT, REPO_ROOT)) {
    const src = readFileSync(resolve(REPO_ROOT, rel), 'utf8');
    if (ADMIN_IMPORT_RE.test(src)) out.push(rel);
  }
  return out.sort();
}

interface Allowlist {
  _comment?: string;
  count: number;
  routes: string[];
}

function loadAllowlist(): Allowlist {
  return JSON.parse(readFileSync(ALLOWLIST_ABS!, 'utf8')) as Allowlist;
}

/** Normalize any path-separator drift before set math. */
const norm = (p: string) => p.replace(/\\/g, '/');

// The frozen baseline captured 2026-06-30 by scanning the live tree.
// XC-3 Phase 2 batch 1 (2026-06-30, REG-217): ratcheted 273 → 272 when
// src/app/api/student/daily-lab/route.ts migrated admin → supabase-server.
// XC-3 Phase 2 batch 2 (2026-06-30, REG-218): ratcheted 272 → 271 when
// src/app/api/dashboard/reviews-due/route.ts migrated admin → supabase-server.
// XC-3 Phase 2 batch 3 — Bearer batch (2026-06-30, REG-220): ratcheted 271 → 270
// when src/app/api/student/daily-plan/route.ts migrated admin →
// createSupabaseRouteClient (Bearer-aware RLS client; mobile Bearer caller).
// XC-3 Phase 3 first slice (2026-06-30, REG-221): ratcheted 270 → 269 when
// src/app/api/school-admin/contracts/route.ts migrated admin →
// createSupabaseServerClient (RLS-scoped cookie client; teacher/school-admin
// read, tenant upper+lower bound proven via school_admin_can_read_own_contracts).
// RCA-01/XC-3 RCA execution (2026-07-10): ratcheted 269 → 267 when
// src/app/api/teacher/join-class/route.ts moved to the scoped authenticated
// teacher_join_class_by_code RPC and src/app/api/parent/report/route.ts moved
// parent_weekly_reports cache access to an RLS-scoped request client.
// RCA-01/XC-3 parent event-bus publisher migration (2026-07-10): ratcheted
// 267 → 265 when src/app/api/parent/children/[student_id]/export/route.ts and
// src/app/api/parent/children/[student_id]/request-erasure/route.ts moved
// state_events publishing to the scoped parent_publish_child_state_event RPC.
// RCA-01/XC-3 school-admin students Auth Admin narrowing (2026-07-10):
// ratcheted 265 → 264 when src/app/api/school-admin/students/route.ts stopped
// importing the broad supabase-admin route client and moved Auth Admin user
// creation behind a narrow server-only helper.
// RCA-01/XC-3 parent erasure status migration (2026-07-10): ratcheted 264 → 263
// when src/app/api/parent/children/[student_id]/erasure-status/route.ts moved
// guardian/link/status reads to the scoped parent_child_erasure_status RPC.
// RCA-01/XC-3 parent profile migration (2026-07-10): ratcheted 263 → 262
// when src/app/api/parent/profile/route.ts moved guardian own-profile updates
// to the scoped parent_update_own_profile RPC.
// RCA-01/XC-3 parent notifications migration (2026-07-10): ratcheted 262 → 259
// when src/app/api/parent/notifications/route.ts,
// src/app/api/parent/notifications/[id]/read/route.ts, and
// src/app/api/parent/notifications/mark-all-read/route.ts moved guardian-owned
// notification list/read writes to scoped authenticated RPCs.
// RCA-01/XC-3 parent calendar migration (2026-07-10): ratcheted 259 → 258
// when src/app/api/parent/calendar/route.ts moved child calendar aggregation
// reads to an RLS-scoped request client after the existing canAccessStudent gate.
// RCA-01/XC-3 parent billing migration (2026-07-10): ratcheted 258 -> 257
// when src/app/api/parent/billing/route.ts moved subscription, plan, and payment
// aggregation reads to an RLS-scoped request client after guardian-child scoping.
// RCA-01/XC-3 parent approve-link migration (2026-07-10): ratcheted 257 -> 256
// when src/app/api/parent/approve-link/route.ts moved student-owned guardian
// link review to the auth.uid()-anchored student_review_guardian_link RPC.
// RCA-01/XC-3 parent accept-invite migration (2026-07-10): ratcheted 256 -> 255
// when src/app/api/parent/accept-invite/route.ts moved guardian invite
// redemption and placeholder cleanup to the auth.uid()-anchored
// parent_accept_invite_code RPC.
// RCA-01/XC-3 parent link-code OTP migration (2026-07-10): ratcheted 255 -> 253
// when src/app/api/parent/link-code/request-otp/route.ts and
// src/app/api/parent/link-code/redeem/route.ts moved challenge insertion,
// verification, and linking to auth.uid()-anchored OTP RPCs.
// RCA-01/XC-3 parent consent migration (2026-07-10): ratcheted 253 -> 252
// when src/app/api/parent/consent/route.ts moved guardian resolution, consent
// mutation/listing, state events, and audit writes to auth.uid()-anchored RPCs.
// RCA-01/XC-3 parent messages migration (2026-07-10): ratcheted 252 -> 249
// when the three parent messaging routes moved guardian/thread/message reads,
// state events, read marking, and notifications to auth.uid()-anchored RPCs.
// Alfanumrik One Experience V3 (2026-07-12): 249 -> 250 because the unified,
// authenticated rollout/capability endpoint must resolve role membership across
// role-specific tables and support Bearer-session verification. This explicit
// ledger entry remains subject to route-level role, scope, RBAC, and tenant
// checks until those cross-role reads move behind narrower authenticated RPCs.
// Foxy Learning Report (2026-07-14): 250 -> 251 for the new read-only,
// super_admin.access-gated per-student report route
// src/app/api/super-admin/foxy-report/[studentId]/route.ts. It is
// super-admin-by-design (service-role read of already-populated learning-loop
// tables, no writes), mirroring the sibling marking-integrity/[studentId] and
// foxy-quality routes. Subject to route-level RBAC + UUID validation; no new
// permission was introduced.
// Alfanumrik One Experience V3 removal (2026-07-15): 251 -> 250. The unified
// experience-v3 rollout/capability route (src/app/api/experience-v3/route.ts)
// was deleted along with the One Experience V3 feature; its ledger entry is
// pruned in the SAME PR so the guard ratchets DOWN, not drifts.
// Flag-posture drift canary (2026-07-20): 250 -> 251 for the new cron route
// src/app/api/cron/flag-posture-canary/route.ts. Service-role is
// cron-by-design here: the nightly posture canary reads feature_flags via the
// admin client to compare live flag state against the CEO-approved posture
// (protected-flags.ts) — no user session exists on a scheduled invocation.
// Fail-closed CRON_SECRET gate (constant-time compare) runs BEFORE any DB
// I/O; output is counts/flag-names-only (no PII, no operator identity).
// Phase 2.2 mock-exam remediation (2026-07-21): 255 -> 256 for the new
// route src/app/api/exams/papers/[id]/start/route.ts. Service-role is
// justified by the same pattern as its siblings [id]/route.ts,
// [id]/submit/route.ts, and papers/route.ts: it calls the
// `start_mock_test_attempt` SECURITY DEFINER RPC and writes a new
// mock_test_attempts row on behalf of the student for the cbse_board
// dynamic-assembly flow. Subject to the same exam.view authorizeRequest()
// gate as the sibling routes.
// Phase 8 monitoring routes (2026-07-22): 256 -> 263 for 7 new routes, all
// service-role-justified as cron (no user session) or super-admin-by-design
// (cross-student aggregate reads):
//   src/app/api/cron/adaptive-loops-monitor/route.ts,
//   src/app/api/cron/synthesis-delivery-monitor/route.ts,
//   src/app/api/cron/synthesis-quality-sample/route.ts,
//   src/app/api/super-admin/adaptive-loops/route.ts,
//   src/app/api/super-admin/ai/irt-readiness/route.ts,
//   src/app/api/super-admin/synthesis-health/route.ts,
//   src/app/api/super-admin/synthesis-quality/route.ts.
// GenAI Phase 5a (2026-07-24): 263 -> 264 for the outcome-prediction
// cross-student read src/app/api/predict/outcome/route.ts. Service-role is the
// sanctioned cross-student read path here, taken only AFTER the canAccessStudent
// gate (architect ruling); registered in scripts/admin-client-allowlist.json.
// P0-1 quota display/enforcement gap (2026-07-29): 264 -> 265 for the new
// read-only route src/app/api/usage/daily/route.ts. Service-role is REQUIRED,
// not convenience: migration 20260729130400 §5 REVOKEs EXECUTE ON
// public.get_plan_limit(uuid, text) FROM PUBLIC, anon, authenticated, so an
// RLS-scoped session cannot call the enforcement authority the badge must read.
// Bounded to one STABLE read-only RPC + one own-row student_daily_usage SELECT,
// both keyed on the SESSION-derived auth.studentId (never a request-supplied
// id), behind authorizeRequest() on student-role permissions. Architect-reviewed;
// full justification + ratchet-down path in scripts/admin-client-allowlist.json.
// WhatsApp bot Phase 2 (2026-07-30): 265 -> 268 for the three WhatsApp routes.
// Service-role is REQUIRED, not convenience: every whatsapp_* table is RLS
// service-role-only by design (migration 20260801100000 — the tables are keyed
// by phone-derived identity, not auth.uid(), so no session policy can exist).
//   src/app/api/whatsapp/webhook/route.ts   — Twilio webhook (no user session);
//     X-Twilio-Signature HMAC verified fail-closed before any processing.
//   src/app/api/cron/whatsapp-drain/route.ts — cron worker (no user session);
//     fail-closed CRON_SECRET gate before any I/O.
//   src/app/api/whatsapp/link/start/route.ts — cookie-session route; admin
//     client used only AFTER supabase.auth.getUser() and scoped to that
//     auth_user_id (whatsapp_link_challenges insert + student-side
//     parental_consent existence check, which has no student RLS policy).
// Mock Exam Runner v2 autosave (2026-08-02, architect-reviewed): 268 -> 269
// for the new save-only route src/app/api/exams/papers/[id]/autosave/route.ts.
// Service-role is REQUIRED, not convenience: mock_test_attempts RLS
// (20260520000008) keys its student policies on student_id = auth.uid()
// directly, but this route family (including already-ledgered siblings
// [id]/start/route.ts and [id]/submit/route.ts) resolves and filters on
// authorizeRequest()'s studentId, which is students.id — a DIFFERENT uuid
// than auth.uid(). An RLS-scoped client would be silently zero-rowed by the
// auth.uid()-keyed policy on every call. Bounded to a single UPDATE scoped
// to id + student_id + exam_paper_id + status='in_progress', touching only
// the pre-existing client_metadata column; never score_percent/raw_score/
// xp_earned/status/submitted_at. Full justification + ratchet-down path in
// scripts/admin-client-allowlist.json.
// P1 verifyCronAuth batch (2026-08-03, architect-approved): 269 -> 268.
// src/app/api/cron/daily/route.ts was DELETED — a deprecated alias for
// /api/cron/daily-cron, scheduled by nothing, carrying only deprecation
// telemetry. Its ledger entry is pruned in the same change (ratchet DOWN).
// P2-7b teacher-messaging RLS migration (2026-08-03, architect-approved): 268 -> 265.
// The three teacher-messaging routes — src/app/api/teacher/messages/route.ts,
// src/app/api/teacher/messages/threads/route.ts, and
// src/app/api/teacher/messages/threads/[id]/messages/route.ts — moved OFF the
// service-role client onto auth.uid()-anchored SECURITY DEFINER RPCs invoked
// through the RLS-scoped createSupabaseServerClient (teacher RPC set: migration
// 20260803130000, symmetric with the parent set). Their ledger entries are
// pruned in the SAME change so the guard ratchets DOWN, not drifts.
// Foxy North-Star Phase 1 Safety & Trust (2026-08-05): 265 -> 268.
// Three NEW routes legitimately use the admin client (REG-348..REG-350):
// src/app/api/learner/memory/route.ts (memory.view_own/memory.erase_own-gated
// self-access; reads via getStudentMemory + writes scoped
// data_erasure_requests), src/app/api/school-admin/safeguarding/route.ts and
// src/app/api/super-admin/safeguarding/route.ts (the safeguarding review
// lane — safeguarding_escalations is DELIBERATELY service-role-only at the
// RLS layer, so these routes are the ONLY sanctioned read path; school-admin
// hard-scopes every query to the caller's school_id). Ledger entries added
// in the same change.
// Foxy North-Star Phase 5 lane U10 (2026-08-05): 268 -> 269. The new
// caller's-own leaderboard band route src/app/api/v1/leaderboard/me/route.ts
// legitimately uses the admin client: service-role read of the
// get_leaderboard_percentile RPC scoped to the SESSION-derived studentId
// (auth.uid()-resolved; a client-supplied ?student_id is ignored) after
// authorizeRequest('leaderboard.view'). Ledger entry added in the same change;
// ratchet-down path recorded in scripts/admin-client-allowlist.json.
// P1 health consolidation (2026-08-06, commit eaa7e1ab): 269 -> 268.
// src/app/api/health/route.ts is now a PURE liveness endpoint (no downstream
// probes, no service-role reads); its ledger entry is pruned in the same change
// so the guard ratchets DOWN, not drifts.
// learners repository module (2026-08-10): 268 -> 267.
// src/app/api/v2/student/profile/route.ts now reads the caller's OWN students
// row through the RLS-scoped request client (createSupabaseRouteClient) behind
// the new learners repository port; the read is served by the
// students_select_merged policy (auth_user_id = auth.uid()), so service-role is
// no longer required. Ledger entry pruned in the same change so the guard
// ratchets DOWN, not drifts.
// leaderboard SEV1 Pattern-B repair (2026-08-11): 267 -> 269.
// Two NEW routes legitimately require service-role:
//   src/app/api/v1/leaderboard/titles/route.ts — student_titles has RLS enabled
//     with exactly ONE policy (service_role only, baseline :20003) and no
//     student SELECT policy, so an RLS-scoped read returns 0 rows for everyone;
//     the route scopes the SELECT to the SESSION-derived auth.studentId.
//   src/app/api/v1/leaderboard/streaks/route.ts — a peer streak board is
//     structurally impossible under own-row-only RLS on challenge_streaks; the
//     route reads via service-role and projects an explicit P13 whitelist.
// The sibling src/app/api/v1/leaderboard/my-class/route.ts added in the same
// change is deliberately NOT ledgered: it uses the RLS-scoped
// createSupabaseRouteClient (class_students own-enrollment policy + the
// already-SECURITY-DEFINER get_class_leaderboard RPC granted to authenticated).
// support first-response SLA (2026-08-11): 269 -> 270.
// ONE new route legitimately requires service-role:
//   src/app/api/internal/admin/support/metrics/route.ts — the FRT metric behind
//     the newly-published 2-business-day support SLA. NEITHER table it reads has
//     an operator SELECT policy: support_tickets' only two SELECT policies are
//     requester-anchored ('Users can read own tickets' :20262,
//     support_tickets_self_select :22378) and support_ticket_replies
//     (20260814000012) has only _owner_select/_owner_insert/_service_role_all —
//     that migration states outright that the operator surface is service-role
//     with authorization enforced in the route. Under an RLS-scoped client an
//     operator would see only tickets they personally filed, so the metric would
//     report breach_count 0 / meeting_promise true over a near-empty set — it
//     would certify the SLA is met BECAUSE it cannot see the breaches. Failing
//     toward "all clear" is the one failure mode this route exists to prevent,
//     so RLS here is a silent-zero, not defense-in-depth. The sibling operator
//     console src/app/api/internal/admin/support/route.ts is already ledgered,
//     reads the same two tables and carries the same
//     authorizeRequest('support.view_tickets') gate.
//     Read-only and PII-free by construction: the ticket projection is pinned to
//     'id, category, status, created_at, resolved_at' and the reply projection to
//     'ticket_id, created_at, author_role' — email, user_name, subject, message,
//     device_info and admin_notes are never selected. Ratchet-down path: a
//     SECURITY DEFINER get_support_first_response_metrics() gated on the existing
//     baseline helper check_permission(auth.uid(), 'support.view_tickets')
//     (:1973), granted to authenticated; then move to the RLS-scoped client.
// Learning-sources signed-URL route (2026-08-15, architect-reviewed): 270 -> 271
// for the new route src/app/api/learning-sources/route.ts. Service-role is
// REQUIRED, not convenience: the private `learning-sources` storage bucket
// (migration 20260816000001) is service-role-only by design — it carries NO
// per-user storage RLS policies, so an RLS-scoped client cannot mint the
// signed URLs this route exists to serve. The route is authenticated
// (authorizeRequest) BEFORE any minting; signed URLs carry a 300s TTL; the
// object path shape is validated; no PII is logged. Ledger entry added in the
// same change in scripts/admin-client-allowlist.json.
// Phase 4 quiz session resume (2026-08-11, architect-reviewed, recorded
// 2026-08-23 during b00b9c872 reconciliation): 271 -> 272 for NEW route
// src/app/api/quiz/session/[sessionId]/progress/route.ts. Service-role is
// REQUIRED, not convenience: quiz_session_shuffles has RLS ENABLED with
// exactly THREE policies and ALL THREE are FOR SELECT (student/parent/
// teacher) — there is NO INSERT/UPDATE/DELETE policy at all, and migration
// 20260814000020 made that denial explicit at the privilege layer too
// (post-condition 4d asserts `authenticated` retains no write privilege). An
// RLS-scoped client issuing this route's UPDATE would be silently zero-rowed
// — indistinguishable from the route's own legitimate first-write-wins
// 'saved:false' no-op, i.e. a silent durability failure, not a security win.
// Bounded surface: ONE table, ONE write verb (UPDATE) touching only
// student_selected_displayed_index / student_time_spent_seconds /
// student_answered_at / session_mode — NEVER shuffle_map, options_snapshot,
// correct_answer_index_snapshot, integrity_hash or options_version_at_serve.
// Auth gate: requireOwnedSession() runs authorizeRequest('quiz.attempt')
// FIRST, then an owner-vs-session studentId probe (404 unknown, 403
// mismatch). RATCHET-DOWN PATH: an auth.uid()-anchored SECURITY DEFINER
// persist_quiz_answer_progress RPC, after which the route moves to the
// RLS-scoped client and this entry is pruned. Pinned by REG-213 (P8/P9).
// Teacher worksheet answer key (2026-08-11, architect-reviewed, recorded
// 2026-08-23 during b00b9c872 reconciliation): 272 -> 273 for NEW route
// src/app/api/teacher/worksheets/answer-key/route.ts, created expressly to
// UNBLOCK the question_bank answer-key column ACL. Service-role is
// REQUIRED, not convenient: question_bank.correct_answer_index is today
// SELECTable by every signed-in user (students, parents and teachers all
// authenticate as the SAME `authenticated` Postgres role), so neither RLS
// nor a column ACL can distinguish "teacher printing an answer key" from
// "student reading the key mid-quiz". Bounded surface: ONE table, ONE verb
// (SELECT), READ-ONLY, over exactly six columns. Gated by
// authorizeRequest('worksheet.create') — an EXISTING permission already
// granted to the teacher role by 20260612123200 — plus a second,
// content-side tenancy gate (resolveTeacherContentScope) that restricts the
// read to (subject, grade) pairs the caller actually teaches. RATCHET-DOWN
// PATH: an auth.uid()-anchored SECURITY DEFINER get_worksheet_answer_key
// RPC, after which the route moves to the RLS-scoped client and this entry
// is pruned. Pinned by REG-213 (P8/P9).
// Foxy dimension feedback (recorded 2026-08-23, architect-reviewed during
// b00b9c872 reconciliation — NOT yet independently reviewed by
// ai-engineer/backend, flagged for follow-up): 273 -> 274 for NEW route
// src/app/api/foxy/feedback/dimension/route.ts (Phase A.2 dimension-level
// Foxy feedback). POST-only, gated by authorizeRequest('progress.view_own',
// { requireStudentId: true }) BEFORE any DB access; performs an explicit
// ownership check on foxy_chat_messages BEFORE invoking the
// record_message_dimension_feedback RPC — the route's own header comment
// states the RPC's auth.uid() guard does not fire under a service-role JWT,
// so this ownership check is the actual trust boundary. Recorded
// provisionally; see scripts/admin-client-allowlist.json for the full note.
// student/profile regression-and-fix (recorded 2026-08-23, backend, during
// b00b9c872 reconciliation): net no-op at 274. Commit b00b9c872 silently
// reverted src/app/api/v2/student/profile/route.ts from the 2026-08-10
// RLS-scoped implementation (createSupabaseRouteClient + the learners
// repository composition root) back to a getSupabaseAdmin()-based one, as an
// unrelated side effect of a stale-base merge — briefly recorded in the JSON
// ledger as a flagged, non-approved 274 -> 275 entry so the guard would not
// fail opaquely. That regression is now fixed: the route has been restored
// (byte-identical to origin/main) to the RLS-scoped implementation, so no
// service-role client remains in it, and the ledger entry has been pruned in
// the same change (275 -> 274). See scripts/admin-client-allowlist.json.
// Phase A.3 AI quality dashboard (2026-08-23, architect-reviewed): 274 -> 275
// for NEW route src/app/api/super-admin/ai-quality/route.ts. Service-role is
// justified by the same super-admin-by-design pattern as the already-ledgered
// siblings foxy-quality/route.ts and foxy-report/[studentId]/route.ts: a
// read-only, cross-student aggregate over 5 tables (foxy_quality_scores,
// ops_events filtered to category='ai', foxy_message_feedback,
// foxy_message_dimension_feedback, foxy_chat_messages) over the trailing 30
// days, feeding the AiQualityData contract consumed by
// super-admin/ai-quality/page.tsx. No RLS-scoped client can serve this: the
// read spans ALL students, not the caller's own row. Gated by
// authorizeRequest(request, 'super_admin.access') — the SAME existing
// permission the sibling routes use; no new RBAC. Read-only, no writes/RPCs;
// response is counts/averages/enum-like keys only, never message text,
// `reason` free text, or student identifiers (P13). See
// scripts/admin-client-allowlist.json for the full note.
const EXPECTED_COUNT = 275;

// ════════════════════════════════════════════════════════════════════════════
// 0. Non-vacuity — if resolution failed, every assertion below would be hollow.
// ════════════════════════════════════════════════════════════════════════════
describe('admin-client allowlist guard: non-vacuity', () => {
  it('resolves the API route root and the allowlist ledger', () => {
    expect(API_ROOT).not.toBeNull();
    expect(ALLOWLIST_ABS).not.toBeNull();
    expect(REPO_ROOT).not.toBeNull();
  });

  it('detects a large, non-empty admin-importer set from the live tree', () => {
    expect(detectAdminImporters().length).toBeGreaterThan(200);
  });

  it('the ledger JSON has the expected shape (count + routes[])', () => {
    const a = loadAllowlist();
    expect(typeof a.count).toBe('number');
    expect(Array.isArray(a.routes)).toBe(true);
    expect(a._comment).toMatch(/ratchet/i);
    // self-consistency: declared count equals the listed routes length.
    expect(a.routes.length).toBe(a.count);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// 1. THE FREEZE — detected ⊆ allowlist (no NEW admin route) and allowlist ⊆
//    detected (no STALE entry). Together they pin the set EXACTLY.
// ════════════════════════════════════════════════════════════════════════════
describe('admin-client allowlist guard: frozen blast radius', () => {
  it('no NEW route imports supabase-admin without a ledger entry (detected \\ allowlist === ∅)', () => {
    const allow = new Set(loadAllowlist().routes.map(norm));
    const detected = detectAdminImporters().map(norm);
    const offenders = detected.filter((r) => !allow.has(r)).sort();

    expect(
      offenders,
      offenders.length === 0
        ? ''
        : `XC-3 Phase 0b — ${offenders.length} API route(s) import the RLS-BYPASSING ` +
            `service-role client (@alfanumrik/lib/supabase-admin) but are NOT in the allowlist ` +
            `ledger:\n` +
            offenders.map((r) => `  • ${r}`).join('\n') +
            `\n\nThe 273-route admin-client footprint is FROZEN (P8 RLS boundary / P9 RBAC). ` +
            `It may only RATCHET DOWN. Fix ONE of:\n` +
            `  (a) use the RLS-scoped client \`@alfanumrik/lib/supabase-server\` instead — RLS then ` +
            `provides a real second line of defense behind authorizeRequest(); OR\n` +
            `  (b) if service-role is genuinely required (webhook / reconciliation / ` +
            `super-admin-by-design / cron), add the route's repo-relative path to ` +
            `scripts/admin-client-allowlist.json (and bump its "count") in THIS PR, with ` +
            `architect review — that entry is the reviewable "service-role justified" record.\n` +
            `See docs/superpowers/plans/2026-07-02-xc3-systemic-rls-defense-in-depth.md (§5b).`,
    ).toEqual([]);
  });

  it('no STALE ledger entry — a migrated/removed route must be pruned (allowlist \\ detected === ∅)', () => {
    const detected = new Set(detectAdminImporters().map(norm));
    const stale = loadAllowlist()
      .routes.map(norm)
      .filter((r) => !detected.has(r))
      .sort();

    expect(
      stale,
      stale.length === 0
        ? ''
        : `XC-3 Phase 0b — ${stale.length} allowlist entry(ies) no longer import ` +
            `supabase-admin (route migrated to supabase-server, renamed, or deleted). ` +
            `Prune them from scripts/admin-client-allowlist.json and decrement "count" so ` +
            `the ledger stays an EXACT mirror of the live debt and ratchets DOWN:\n` +
            stale.map((r) => `  • ${r}`).join('\n'),
    ).toEqual([]);
  });

  // Title is deliberately number-free: it previously read "exactly 263" while
  // EXPECTED_COUNT had already ratcheted to 264, i.e. the title lied about the
  // pin. EXPECTED_COUNT is the single source of truth.
  it('pins the admin-client route count at exactly EXPECTED_COUNT (drift in either direction trips a guard above)', () => {
    const a = loadAllowlist();
    expect(a.count).toBe(EXPECTED_COUNT);
    expect(a.routes.length).toBe(EXPECTED_COUNT);
    expect(detectAdminImporters().length).toBe(EXPECTED_COUNT);
  });
});
