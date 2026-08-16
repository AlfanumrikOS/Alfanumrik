/**
 * Ticket API client for /super-admin/support/tickets.
 *
 * Talks to the SAME, existing, actor-attributed API the legacy console uses —
 * `/api/internal/admin/support` (apps/host/src/app/internal/admin/_components/SupportTab.tsx)
 * — verbatim. No new route. Per the Phase 2 parity spec
 * (docs/superpowers/specs/2026-08-16-phase2-support-console-parity.md §1.2),
 * the request contract (credentials, headers) mirrors
 * `internal/admin/_hooks/useAdminFetch.ts` exactly:
 *   - `credentials: 'same-origin'` so the httpOnly sb-* session cookie rides
 *     along (this API is gated by `apps/host/src/proxy.ts` Layer 2.1, which
 *     requires a literal `super_admin` session independent of RBAC).
 *   - Only `Content-Type: application/json` — no `x-admin-secret`, no Bearer.
 *
 * ── WHY THIS DOESN'T REUSE `useAdminFetch()` OR AdminShell's `apiFetch` ────
 * `useAdminFetch()` throws a generic `Error` on any non-2xx, and AdminShell's
 * `apiFetch`/`apiFetchJson` (super-admin/_components/AdminShell.tsx) treats
 * ANY 401 as `session_expired` and pops the shared "session expired, sign in
 * again" banner. That is the WRONG message for a logged-in `support`/
 * `analyst`/`admin`-tier operator whose session is perfectly valid but simply
 * isn't `super_admin` — re-authenticating as themselves would 401 forever.
 * Per the spec's §2.2, this page must render a DISTINCT "requires Super Admin
 * access" state instead. `ticketFetch` below classifies 401/403 as its own
 * `access_denied` kind precisely so the page can branch on it without ever
 * touching AdminShell's session-expiry machinery.
 */

export interface SupportTicket {
  id: string;
  student_id: string;
  subject: string;
  message: string;
  status: string;
  admin_notes: string | null;
  created_at: string;
  // DataTable<T> requires T extends Record<string, unknown> (matches the
  // established convention — see UserRecord in super-admin/subscriptions/page.tsx
  // and Student in internal/admin/_lib/internal-admin-types.ts).
  [key: string]: unknown;
}

export interface TicketReply {
  id: string;
  author_role: string;
  author_user_id?: string | null;
  body: string;
  is_internal: boolean;
  created_at: string;
}

export interface ThreadResponse {
  ticket: SupportTicket;
  replies: TicketReply[];
}

export interface TicketListResponse {
  data: SupportTicket[];
  total: number;
}

export interface ReplyPostResponse {
  success: boolean;
  reply: TicketReply;
  ticket_status: string;
}

/** Mirrors the support_ticket_replies body CHECK (non-blank, <= 5000). */
export const REPLY_MAX_LENGTH = 5000;

export type TicketApiError =
  | { kind: 'access_denied'; status: 401 | 403 }
  | { kind: 'network'; message: string }
  | { kind: 'non_json'; status: number }
  | { kind: 'http'; status: number; message: string };

export type TicketApiResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: TicketApiError };

/**
 * Fetch wrapper for `/api/internal/admin/support`. Never throws — every
 * failure mode (network, non-JSON, 4xx/5xx, and specifically 401/403) is
 * returned as a discriminated result so callers can branch on
 * `error.kind === 'access_denied'` without a string-matching a thrown
 * Error's message.
 */
export async function ticketFetch<T>(path: string, init?: RequestInit): Promise<TicketApiResult<T>> {
  let res: Response;
  try {
    res = await fetch(path, {
      ...init,
      credentials: init?.credentials ?? 'same-origin',
      headers: {
        'Content-Type': 'application/json',
        ...(init?.headers || {}),
      },
    });
  } catch (err) {
    return { ok: false, error: { kind: 'network', message: err instanceof Error ? err.message : 'Network error' } };
  }

  // proxy.ts Layer 2.1 returns a hard 401 for any non-super_admin session
  // BEFORE the route handler runs; the route itself may also 403 via its own
  // authorizeRequest() check. Either is the same "wrong tier" condition.
  if (res.status === 401 || res.status === 403) {
    return { ok: false, error: { kind: 'access_denied', status: res.status } };
  }

  const ct = (res.headers.get('content-type') ?? '').toLowerCase();
  if (!ct.includes('application/json')) {
    return { ok: false, error: { kind: 'non_json', status: res.status } };
  }

  let body: unknown;
  try {
    body = await res.json();
  } catch {
    return { ok: false, error: { kind: 'non_json', status: res.status } };
  }

  if (!res.ok) {
    const message =
      body && typeof body === 'object' && typeof (body as { error?: unknown }).error === 'string'
        ? (body as { error: string }).error
        : `HTTP ${res.status}`;
    return { ok: false, error: { kind: 'http', status: res.status, message } };
  }

  return { ok: true, data: body as T };
}
