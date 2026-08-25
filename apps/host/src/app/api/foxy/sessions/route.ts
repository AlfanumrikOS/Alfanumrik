/**
 * GET /api/foxy/sessions — the student's Foxy chat history LIST.
 *
 * ── Why this route exists (2026-08-24, CEO defect #1) ─────────────────────
 * The Foxy conversation rail used to read `foxy_sessions` + `foxy_chat_messages`
 * client-side straight over PostgREST (`fetchAllConversations` in
 * apps/host/src/app/foxy/page.tsx) and DISCARDED the query error. Confirmed
 * live 2026-08-08: a student with 1,359 real `foxy_sessions` rows saw an empty
 * sidebar with no trace of why, because a failed fetch rendered identically to
 * a genuinely empty account. There was no list endpoint at all — the sibling
 * `GET /api/foxy` requires a `sessionId` and returns exactly one thread.
 *
 * This route is the read side of that fix. It fails LOUDLY (500 with
 * `{ success: false }`) so the client can render a distinct error state with a
 * Retry, instead of an empty list.
 *
 * ── Contract ──────────────────────────────────────────────────────────────
 * Query params:
 *   limit  — 1..50, default 30. Number of SESSIONS scanned (see the filter
 *            note below: fewer may be returned).
 *   cursor — ISO-8601 timestamp. Returns sessions strictly OLDER than it
 *            (`last_active_at < cursor`), for "load more".
 *
 * 200 → {
 *   success: true,
 *   data: {
 *     sessions: Array<{
 *       id: string;                 // foxy_sessions.id (uuid)
 *       title: string | null;       // derived from the student's OWN first
 *                                   // prompt; null when the thread has no
 *                                   // user turn yet — the CLIENT supplies the
 *                                   // bilingual subject-name fallback (P7)
 *       subject: string | null;
 *       chapter: string | null;
 *       updatedAt: string;          // ISO, = last_active_at
 *       messageCount: number;       // always >= 1 (see the filter note)
 *     }>,
 *     nextCursor: string | null;    // null = end of history
 *   }
 * }
 * 401/403 → the shared RBAC error body from `authorizeRequest`.
 * 500 → { success: false, error, code: 'SESSION_LIST_FAILED' }
 *
 * ── Filter note: zero-message sessions ────────────────────────────────────
 * Sessions with NO messages are excluded from the LIST (they are unopenable
 * chrome — production carries 306 of them). Sessions with only a USER turn are
 * INCLUDED: `foxy_chat_messages` took zero writes for 21 days (last row
 * 2026-08-02) until the write path was repaired in this same wave, so a
 * `messageCount >= 2` floor would keep hiding real history. The exclusion is
 * applied AFTER paging, so a page may return fewer rows than `limit` while
 * still advancing `nextCursor` correctly — an empty `sessions` array with a
 * non-null `nextCursor` means "keep going", not "end of history".
 *
 * ── P13 ───────────────────────────────────────────────────────────────────
 * No message body crosses the wire. `title` is the student's own prompt,
 * normalized + truncated to 50 chars by the shared `deriveConversationTitle`,
 * returned only to that same authenticated student. Assistant output, `sources`
 * and full message text are never selected into the response — the same
 * precedent the single-session `GET /api/foxy` sets by excluding `sources`.
 * Logs carry route + counts + error codes only: no ids, no titles, no content.
 *
 * ── P8/P9 ─────────────────────────────────────────────────────────────────
 * `authorizeRequest(request, 'foxy.chat', { requireStudentId: true })` matches
 * the sibling foxy routes. Reads go through `createSupabaseRouteClient(request)`
 * (anon key + the CALLER's credential ⇒ RLS applies: "Students see own foxy
 * sessions" / "Students see own foxy messages"), never the RLS-bypassing
 * service-role admin client. (That last clause is deliberately spelled in prose:
 * `scripts/gen-route-access-manifest.mjs` / `route-access-manifest.test.ts`
 * detect service-role use with a bare text scan over the whole file, so naming
 * the identifier here — even to deny using it — would force a false
 * `serviceRoleUse` justification into the security ledger. This route carries
 * none, by design.) The
 * explicit `.eq('student_id', studentId)` on every query is belt-and-suspenders
 * on top of RLS, so one student can never see another's threads even if a
 * policy regresses.
 *
 * ⚠️ The data client MUST be resolved FROM THE REQUEST, not from cookies.
 * This route originally used the cookie-only `createSupabaseServerClient()`,
 * which was silently the original defect with an extra network hop: the web
 * client authenticates with `Authorization: Bearer <jwt>` read from the
 * localStorage-backed browser Supabase session (`packages/lib/src/supabase-client.ts`
 * uses plain `createClient`, so there is NO `sb-*` auth cookie for password-login
 * students). Under the cookie-only client PostgREST saw no user ⇒ `auth.uid()`
 * NULL ⇒ every RLS SELECT denied ⇒ all three queries returned zero rows ⇒ this
 * route answered a cheerful `200 { success: true, sessions: [] }`: an empty
 * rail again, now with no error to show. Same failure mode already recorded at
 * `apps/host/src/app/api/synthesis/state/route.ts:64-67` (spurious 404) and
 * fixed the same way. `createSupabaseRouteClient` is Bearer-aware AND falls
 * back to the cookie client, and can never bypass RLS (anon key only).
 */

import { NextRequest, NextResponse } from 'next/server';
import { authorizeRequest } from '@alfanumrik/lib/rbac';
import { createSupabaseRouteClient } from '@alfanumrik/lib/supabase-route';
import { logger } from '@alfanumrik/lib/logger';
import { deriveConversationTitle } from '@alfanumrik/ui/foxy/ConversationManager.utils';

export const dynamic = 'force-dynamic';

const DEFAULT_LIMIT = 30;
const MAX_LIMIT = 50;

export interface FoxySessionListItem {
  id: string;
  title: string | null;
  subject: string | null;
  chapter: string | null;
  updatedAt: string;
  messageCount: number;
}

function failure(code: string, status: number): NextResponse {
  return NextResponse.json(
    {
      success: false,
      // Bilingual pair so the client can pick without a second round-trip;
      // the rail also carries its own P7 copy and ignores these by default.
      error: "Couldn't load your chats.",
      errorHi: 'आपकी चैट लोड नहीं हो पाईं।',
      code,
    },
    { status },
  );
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const auth = await authorizeRequest(request, 'foxy.chat', {
    requireStudentId: true,
  });
  if (!auth.authorized) return auth.errorResponse! as NextResponse;

  const studentId = auth.studentId;
  if (!studentId) {
    // Defensive: requireStudentId means RBAC should already have rejected.
    return failure('FORBIDDEN', 403);
  }

  const { searchParams } = new URL(request.url);

  const rawLimit = Number.parseInt(searchParams.get('limit') ?? '', 10);
  const limit = Number.isFinite(rawLimit)
    ? Math.min(Math.max(rawLimit, 1), MAX_LIMIT)
    : DEFAULT_LIMIT;

  // Reject an unparseable cursor rather than silently ignoring it — silently
  // ignoring would restart paging from the top and loop the "load more" button
  // forever on the same first page.
  const rawCursor = searchParams.get('cursor');
  let cursor: string | null = null;
  if (rawCursor) {
    const parsed = new Date(rawCursor);
    if (Number.isNaN(parsed.getTime())) return failure('BAD_CURSOR', 400);
    cursor = parsed.toISOString();
  }

  try {
    // Bearer-aware (web + mobile), cookie fallback, always RLS-scoped. Must be
    // derived from `request` — see the P8/P9 note above for why the cookie-only
    // client silently returned an empty history for every password-login student.
    const supabase = await createSupabaseRouteClient(request);

    // ── Scan loop (2026-08-25) ────────────────────────────────────────────
    // The zero-message filter runs AFTER paging, so a scanned page can come
    // back entirely filtered out. This route's contract already said "an empty
    // `sessions` array with a non-null `nextCursor` means keep going" — but no
    // client implemented that, and the web rail (`fetchAllConversations` in
    // apps/host/src/app/foxy/page.tsx) issues exactly ONE request and renders
    // whatever it gets. The burden is moved here, where it belongs: the route
    // keeps scanning until it can fill a page or genuinely runs out.
    //
    // Why it mattered: `foxy_chat_messages` took zero writes from 2026-08-02
    // to 2026-08-25 (the broadcast-trigger argument swap, fixed in #1628)
    // while `foxy_sessions` kept writing normally. That left 324 message-less
    // sessions, 274 of them created during the outage — and because they are
    // the MOST RECENT, they filled the entire first page. Measured on the
    // student with the largest history (1,439 sessions / 3,048 messages): all
    // 30 of their most recent sessions were empty shells, their newest real
    // session was 2026-08-02, and 221 shells sat in front of real history — so
    // a 30-row page needed EIGHT round trips to reach one visible
    // conversation. The rail rendered "No conversations yet".
    //
    // SCAN_PAGE is deliberately larger than MAX_LIMIT so a single round trip
    // clears a meaningful run of shells; MAX_SCANS bounds worst-case work at
    // SCAN_PAGE * MAX_SCANS sessions per request. If that budget is spent
    // before the page fills, `nextCursor` points at the last SCANNED row so
    // paging resumes exactly where it stopped and nothing is skipped.
    const SCAN_PAGE = 100;
    const MAX_SCANS = 8;

    const items: FoxySessionListItem[] = [];
    let scanCursor: string | null = cursor;
    let lastIncludedCursor: string | null = null;
    let exhausted = false;
    let scans = 0;

    while (items.length < limit && scans < MAX_SCANS && !exhausted) {
      scans += 1;

      let sessionQuery = supabase
        .from('foxy_sessions')
        .select('id, subject, chapter, last_active_at')
        .eq('student_id', studentId)
        .order('last_active_at', { ascending: false })
        .limit(SCAN_PAGE);
      if (scanCursor) sessionQuery = sessionQuery.lt('last_active_at', scanCursor);

      const { data: sessions, error: sessionsError } = await sessionQuery;

      if (sessionsError) {
        // THE defect this route exists to fix: a failed query must never render
        // as "no conversations". Surface it; the client shows a Retry.
        logger.error('foxy.sessions.list_failed', {
          route: '/api/foxy/sessions',
          query: 'foxy_sessions',
          errorCode: sessionsError.code ?? null,
        });
        return failure('SESSION_LIST_FAILED', 500);
      }

      const sessionRows = (sessions ?? []) as Array<{
        id: string;
        subject: string | null;
        chapter: string | null;
        last_active_at: string | null;
      }>;

      if (sessionRows.length === 0) {
        exhausted = true;
        break;
      }
      // A short read means there is nothing older left to scan.
      if (sessionRows.length < SCAN_PAGE) exhausted = true;

      const sessionIds = sessionRows.map((s) => s.id);

      // Two narrow queries instead of one wide one. Selecting every message's
      // `content` to compute a count would pull the entire assistant corpus for
      // the page across the network for no reason.
      //   A) counts   — ids only, no bodies.
      //   B) titles   — USER turns only, oldest first; the first row per
      //                 session is the student's opening prompt.
      const [countResult, firstUserResult] = await Promise.all([
        supabase
          .from('foxy_chat_messages')
          .select('session_id')
          .eq('student_id', studentId)
          .in('session_id', sessionIds),
        supabase
          .from('foxy_chat_messages')
          .select('session_id, content, created_at')
          .eq('student_id', studentId)
          .eq('role', 'user')
          .in('session_id', sessionIds)
          .order('created_at', { ascending: true }),
      ]);

      if (countResult.error || firstUserResult.error) {
        logger.error('foxy.sessions.messages_failed', {
          route: '/api/foxy/sessions',
          countErrorCode: countResult.error?.code ?? null,
          titleErrorCode: firstUserResult.error?.code ?? null,
        });
        return failure('SESSION_LIST_FAILED', 500);
      }

      const countBySession = new Map<string, number>();
      for (const row of (countResult.data ?? []) as Array<{ session_id: string }>) {
        countBySession.set(row.session_id, (countBySession.get(row.session_id) ?? 0) + 1);
      }

      const firstUserBySession = new Map<string, string>();
      for (const row of (firstUserResult.data ?? []) as Array<{
        session_id: string;
        content: string | null;
      }>) {
        // Rows arrive oldest-first, so the FIRST one seen per session wins.
        if (!firstUserBySession.has(row.session_id) && row.content) {
          firstUserBySession.set(row.session_id, row.content);
        }
      }

      for (const s of sessionRows) {
        // Zero-message sessions are unopenable chrome — see the filter note.
        const messageCount = countBySession.get(s.id) ?? 0;
        if (messageCount === 0) continue;

        items.push({
          id: s.id,
          title: deriveConversationTitle(firstUserBySession.get(s.id)),
          subject: s.subject,
          chapter: s.chapter,
          updatedAt: s.last_active_at ?? new Date().toISOString(),
          messageCount,
        });
        lastIncludedCursor = s.last_active_at ?? lastIncludedCursor;

        if (items.length >= limit) break;
      }

      // Advance from the last SCANNED row so the next scan cannot re-read rows
      // this one already rejected.
      const lastScanned = sessionRows[sessionRows.length - 1];
      if (lastScanned.last_active_at) {
        scanCursor = lastScanned.last_active_at;
      } else {
        // A null ordering key cannot produce a usable cursor; stop rather than
        // loop forever on the same page.
        exhausted = true;
      }
    }

    // Cursor semantics:
    //   - page filled       -> resume strictly older than the last INCLUDED
    //                          row, so nothing between it and the next page is
    //                          skipped.
    //   - history exhausted -> null, the documented end-of-history signal.
    //   - scan budget spent -> resume from the last SCANNED row.
    let nextCursor: string | null;
    if (items.length >= limit) {
      nextCursor = lastIncludedCursor;
    } else if (exhausted) {
      nextCursor = null;
    } else {
      nextCursor = scanCursor;
    }

    return NextResponse.json({
      success: true,
      data: { sessions: items, nextCursor },
    });
  } catch (err) {
    logger.error('foxy.sessions.unhandled', {
      route: '/api/foxy/sessions',
      error: err instanceof Error ? err.message : String(err),
    });
    return failure('SESSION_LIST_FAILED', 500);
  }
}
