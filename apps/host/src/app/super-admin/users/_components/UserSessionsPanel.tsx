'use client';

/**
 * Active-sessions list for the Users DetailDrawer.
 *
 * GET /api/super-admin/sessions?user_id=<auth_user_id> — list (read-only,
 * 'support' floor).
 *
 * The actual force-logout (POST + confirm dialog) is deliberately NOT owned
 * here — it's lifted to the page (see `requestForceLogout` /
 * `confirmForceLogout` in page.tsx). Reason: the canonical `Dialog`
 * primitive (`packages/ui/src/ui/primitives/Dialog.tsx`) paints at
 * `var(--z-modal)` = 60, while `DetailDrawer` (`packages/ui/src/admin-ui/
 * DetailDrawer.tsx`) hardcodes `z-[1000]` — a pre-existing z-index ladder
 * mismatch between two shared primitives (out of this task's edit scope:
 * `packages/ui` is off-limits here). A confirm dialog opened while this
 * panel's host drawer is still open would render invisibly BEHIND the
 * drawer. The page closes the drawer before opening the force-logout
 * confirm so the dialog is never occluded. This panel only owns the
 * read-only session list (which unmounts harmlessly with the drawer); the
 * page's confirm dialog is a sibling with its own independent state, so it
 * survives the drawer closing.
 */

import { useCallback, useEffect, useState } from 'react';
import { readAdminJson } from '../../_components/AdminShell';

interface SessionRecord {
  id: string;
  device_label: string | null;
  ip_address: string | null;
  created_at: string;
  last_seen_at: string | null;
  is_active: boolean;
  revoked_at: string | null;
}

export interface UserSessionsPanelProps {
  authUserId: string;
  apiFetch: (path: string, init?: RequestInit) => Promise<Response>;
  isHi: boolean;
  /** Fired when the operator clicks Force Logout — the page owns the confirm dialog + POST. */
  onRequestForceLogout: () => void;
}

export default function UserSessionsPanel({ authUserId, apiFetch, isHi, onRequestForceLogout }: UserSessionsPanelProps) {
  const [sessions, setSessions] = useState<SessionRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchSessions = useCallback(async () => {
    if (!authUserId) return;
    setLoading(true);
    setError(null);
    try {
      const res = await apiFetch(`/api/super-admin/sessions?user_id=${encodeURIComponent(authUserId)}`);
      const d = await readAdminJson<{ sessions?: SessionRecord[]; error?: string }>(res).catch(() => ({}) as { sessions?: SessionRecord[]; error?: string });
      if (!res.ok) {
        setError(d.error || (isHi ? 'सत्र लोड नहीं हो सके' : 'Could not load sessions'));
        return;
      }
      setSessions(d.sessions || []);
    } catch {
      setError(isHi ? 'नेटवर्क त्रुटि' : 'Network error');
    } finally {
      setLoading(false);
    }
  }, [apiFetch, authUserId, isHi]);

  useEffect(() => { fetchSessions(); }, [fetchSessions]);

  const activeCount = sessions.filter((s) => s.is_active).length;

  return (
    <div className="mb-5">
      <div className="mb-2 flex items-center justify-between">
        <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          {isHi ? 'सक्रिय सत्र' : 'Active Sessions'}
        </div>
        <button
          type="button"
          onClick={onRequestForceLogout}
          disabled={loading || activeCount === 0}
          className="rounded-md border border-danger bg-transparent px-2.5 py-1 text-[11px] font-medium text-danger hover:bg-surface-2 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {isHi ? 'फ़ोर्स लॉगआउट' : 'Force Logout'}
        </button>
      </div>

      {loading && (
        <div aria-busy="true" role="status" className="text-xs text-muted-foreground">
          {isHi ? 'सत्र लोड हो रहे हैं…' : 'Loading sessions…'}
        </div>
      )}
      {!loading && error && (
        <div role="alert" className="flex items-center justify-between gap-2 text-xs text-danger">
          <span>{error}</span>
          <button type="button" onClick={fetchSessions} className="font-semibold underline">
            {isHi ? 'फिर से कोशिश करें' : 'Retry'}
          </button>
        </div>
      )}
      {!loading && !error && sessions.length === 0 && (
        <div className="text-xs text-muted-foreground">
          {isHi ? 'कोई सत्र नहीं मिला' : 'No sessions found'}
        </div>
      )}
      {!loading && !error && sessions.length > 0 && (
        <ul className="space-y-1.5">
          {sessions.slice(0, 6).map((s) => (
            <li
              key={s.id}
              className="flex items-center justify-between rounded-md border border-surface-3 px-2.5 py-1.5 text-xs"
            >
              <span className="truncate text-foreground">
                {s.device_label || (isHi ? 'अज्ञात डिवाइस' : 'Unknown device')}
              </span>
              <span className={s.is_active ? 'font-medium text-success' : 'text-muted-foreground'}>
                {s.is_active ? (isHi ? 'सक्रिय' : 'Active') : (isHi ? 'रद्द' : 'Revoked')}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
