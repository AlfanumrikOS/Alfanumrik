'use client';

import { useState, useEffect, useCallback, useMemo, useRef, createContext, useContext } from 'react';
import { type SupabaseClient } from '@supabase/supabase-js';
import DashboardSidebar, { type SidebarNavItem, type SidebarItem } from '@alfanumrik/ui/admin-ui/DashboardSidebar';
import { AdminDashboardSkeleton } from '@alfanumrik/ui/Skeleton';
import { useAuth } from '@alfanumrik/lib/AuthContext';
import { supabase } from '@alfanumrik/lib/supabase-client';
import { getFeatureFlags } from '@alfanumrik/lib/supabase';
import { EDUCATION_INTELLIGENCE_FLAGS } from '@alfanumrik/lib/feature-flags';
import { useCosmicTheme } from '@alfanumrik/lib/cosmic-theme';
import { Starfield } from '@alfanumrik/ui/cosmic';

// ── Structured API error contract (Phase 2 client hardening, 2026-07-20) ────
// RCA: Vercel's DDoS challenge intermittently serves 429 text/html "Security
// Checkpoint" pages to fetch() calls; raw res.json() then throws
// `Unexpected token '<'` at the operator. Every super-admin fetch should
// resolve to one of these shapes instead of an opaque SyntaxError.
export type ApiError =
  | { kind: 'security_checkpoint'; status: number; message: string }
  | { kind: 'non_json'; status: number; message: string }
  | { kind: 'network'; status: 0; message: string }
  | { kind: 'session_expired'; status: 401; message: string }
  | { kind: 'http'; status: number; message: string };

export type ApiResult<T> =
  | { ok: true; data: T; status: number }
  | { ok: false; error: ApiError };

const CHECKPOINT_MESSAGE =
  'Vercel security checkpoint is intercepting API calls — data may be stale. Retry in a moment.';

/**
 * Pure response → ApiResult classifier. Never throws.
 * - 429 + text/html ⇒ `security_checkpoint` (the Vercel DDoS challenge page)
 * - any other non-JSON body when JSON was expected ⇒ `non_json`
 * - 401 with JSON body ⇒ `session_expired` (callers reach here only after
 *   apiFetch's refresh+retry, so a 401 is genuinely expired)
 * - other non-2xx JSON ⇒ `http` with the server's `error` string when present
 */
export async function classifyJsonResponse<T>(res: Response): Promise<ApiResult<T>> {
  const ct = (res.headers.get('content-type') ?? '').toLowerCase();
  if (!ct.includes('application/json')) {
    if (res.status === 429 && ct.includes('text/html')) {
      return { ok: false, error: { kind: 'security_checkpoint', status: 429, message: CHECKPOINT_MESSAGE } };
    }
    return {
      ok: false,
      error: { kind: 'non_json', status: res.status, message: `Server returned a non-JSON response (HTTP ${res.status})` },
    };
  }
  let body: unknown;
  try {
    body = await res.json();
  } catch {
    return {
      ok: false,
      error: { kind: 'non_json', status: res.status, message: `Malformed JSON response (HTTP ${res.status})` },
    };
  }
  if (!res.ok) {
    if (res.status === 401) {
      return { ok: false, error: { kind: 'session_expired', status: 401, message: 'Session expired — sign in again' } };
    }
    const serverError =
      body && typeof body === 'object' && typeof (body as { error?: unknown }).error === 'string'
        ? (body as { error: string }).error
        : `HTTP ${res.status}`;
    return { ok: false, error: { kind: 'http', status: res.status, message: serverError } };
  }
  return { ok: true, data: body as T, status: res.status };
}

/**
 * Minimal drop-in guard for legacy `await res.json()` call sites.
 * Preserves their semantics: JSON bodies (even on non-2xx) are returned so the
 * caller's own `d.error` handling keeps working; only a non-JSON body throws —
 * with a readable message instead of the raw `Unexpected token '<'`.
 */
export async function readAdminJson<T = any>(res: Response): Promise<T> {
  const ct = (res.headers.get('content-type') ?? '').toLowerCase();
  if (!ct.includes('application/json')) {
    if (res.status === 429) {
      throw new Error('Vercel security checkpoint is intercepting API calls — retry in a moment (HTTP 429)');
    }
    throw new Error(`Server returned a non-JSON response (HTTP ${res.status})`);
  }
  try {
    return (await res.json()) as T;
  } catch {
    throw new Error(`Malformed JSON response (HTTP ${res.status})`);
  }
}

interface AdminSession {
  accessToken: string;
  adminName: string;
  supabase: SupabaseClient;
  headers: () => Record<string, string>;
  apiFetch: (path: string, init?: RequestInit) => Promise<Response>;
  apiFetchJson: <T = unknown>(path: string, init?: RequestInit) => Promise<ApiResult<T>>;
}

const AdminCtx = createContext<AdminSession | null>(null);
export function useAdmin() {
  const ctx = useContext(AdminCtx);
  if (!ctx) throw new Error('useAdmin must be used within AdminShell');
  return ctx;
}

const NAV_ITEMS: SidebarItem[] = [
  // ── Platform ────────────────────────────────────────────────────────────
  { type: 'section', label: 'Platform', labelHi: 'प्लेटफॉर्म' },
  { href: '/super-admin', label: 'Overview', labelHi: 'अवलोकन', icon: '▦' },
  { href: '/super-admin/analytics', label: 'Analytics', labelHi: 'विश्लेषण', icon: '◍' },
  { href: '/super-admin/learning', label: 'Learning Intel', labelHi: 'लर्निंग इंटेल', icon: '◉' },
  { href: '/super-admin/mol-shadow', label: 'MOL Shadow', labelHi: 'MOL शैडो', icon: '◑' },
  // ── Users ───────────────────────────────────────────────────────────────
  { type: 'section', label: 'Users', labelHi: 'उपयोगकर्ता' },
  { href: '/super-admin/users', label: 'Users & Roles', labelHi: 'उपयोगकर्ता और भूमिकाएँ', icon: '⊕' },
  { href: '/super-admin/rbac', label: 'RBAC', labelHi: 'RBAC', icon: '⛊' },
  { href: '/super-admin/oauth-apps', label: 'OAuth Apps', labelHi: 'OAuth ऐप्स', icon: '⊚' },
  { href: '/super-admin/entitlements', label: 'Entitlements', labelHi: 'एंटाइटलमेंट', icon: '⊞' },
  // ── Institutions ─────────────────────────────────────────────────────────
  { type: 'section', label: 'Institutions', labelHi: 'संस्थाएं' },
  { href: '/super-admin/institutions', label: 'Institutions', labelHi: 'संस्थान', icon: '⊟' },
  { href: '/super-admin/diagnostics', label: 'Diagnostics', labelHi: 'डायग्नोस्टिक्स', icon: '⊘' },
  { href: '/super-admin/marking-integrity', label: 'Marking Integrity', labelHi: 'अंकन सत्यनिष्ठा', icon: '⛉' },
  { href: '/super-admin/oracle-health', label: 'Oracle Health', labelHi: 'ओरेकल स्वास्थ्य', icon: '◐' },
  { href: '/super-admin/analytics-b2b', label: 'B2B Analytics', labelHi: 'B2B विश्लेषण', icon: '⊿' },
  // ── Health ───────────────────────────────────────────────────────────────
  { type: 'section', label: 'Health', labelHi: 'स्वास्थ्य' },
  { href: '/super-admin/health', label: 'Health', labelHi: 'स्वास्थ्य', icon: '♥' },
  { href: '/super-admin/observability', label: 'Observability', labelHi: 'अवलोकनीयता', icon: '◎' },
  { href: '/super-admin/sla', label: 'SLA Monitor', labelHi: 'SLA मॉनिटर', icon: '⊗' },
  { href: '/super-admin/alerts', label: 'Alerts', labelHi: 'अलर्ट', icon: '⊚' },
  // Event Runtime = the state-event dead-letter / replay console
  // (/super-admin/subscribers). Lives here with observability/SLA/alerts as a
  // runtime-ops tool — NOT in Users (it is not customer-subscriber management).
  { href: '/super-admin/subscribers', label: 'Event Runtime', labelHi: 'इवेंट रनटाइम', icon: '⊳' },
  // ── Operations ──────────────────────────────────────────────────────────
  { type: 'section', label: 'Operations', labelHi: 'संचालन' },
  { href: '/super-admin/subscriptions', label: 'Subscriptions', labelHi: 'सदस्यता', icon: '◈' },
  { href: '/super-admin/invoices', label: 'Invoices', labelHi: 'चालान', icon: '⊓' },
  { href: '/super-admin/cms', label: 'CMS', labelHi: 'CMS', icon: '⊠' },
  { href: '/super-admin/flags', label: 'Feature Flags', labelHi: 'फ़ीचर फ़्लैग्स', icon: '⊡' },
  { href: '/super-admin/workbench', label: 'Data Workbench', labelHi: 'डेटा वर्कबेंच', icon: '⊞' },
  { href: '/super-admin/bulk-actions', label: 'Bulk Actions', labelHi: 'बल्क क्रियाएँ', icon: '⊞' },
  { href: '/super-admin/demo', label: 'Demo Accounts', labelHi: 'डेमो खाते', icon: '⊜' },
  { href: '/super-admin/alfabot', label: 'AlfaBot', labelHi: 'AlfaBot', icon: '◓' },
  { href: '/super-admin/reports', label: 'Reports', labelHi: 'रिपोर्ट', icon: '⊏' },
  { href: '/super-admin/logs', label: 'Audit Logs', labelHi: 'ऑडिट लॉग', icon: '⊙' },
  { href: '/super-admin/support', label: 'Support Center', labelHi: 'सहायता केंद्र', icon: '⊛' },
];

// Education Intelligence Cloud nav group — appended only when the
// `ff_education_intelligence` flag resolves ON. Additive: never alters the
// base NAV_ITEMS above. Pages stay behind super-admin auth regardless.
const EDUCATION_INTELLIGENCE_NAV: SidebarItem[] = [
  { type: 'section', label: 'Education Intelligence', labelHi: 'एजुकेशन इंटेलिजेंस' },
  { href: '/super-admin/intelligence', label: 'EI · Overview', labelHi: 'EI · अवलोकन', icon: '◆' },
  { href: '/super-admin/intelligence/schools', label: 'EI · Schools', labelHi: 'EI · स्कूल', icon: '◇' },
  { href: '/super-admin/intelligence/revenue', label: 'EI · Revenue', labelHi: 'EI · राजस्व', icon: '◈' },
  { href: '/super-admin/intelligence/geography', label: 'EI · Geography', labelHi: 'EI · भूगोल', icon: '◊' },
];

export default function AdminShell({ children }: { children: React.ReactNode }) {
  const [accessToken, setAccessToken] = useState<string | null>(null);
  // Ref twin so apiFetch's retry closure always reads the freshest token
  // (state updates would be stale inside an in-flight refresh+retry).
  const accessTokenRef = useRef<string | null>(null);
  // authReady replaces the old "token or bust" gate: the httpOnly sb-* cookie
  // is now the single session source (architect Phase 2 — authorizeAdmin
  // accepts the cookie; middleware keeps it fresh), so the shell can be
  // authenticated without any client-side session object.
  const [authReady, setAuthReady] = useState(false);
  const [sessionExpired, setSessionExpired] = useState(false);
  const [checkpointActive, setCheckpointActive] = useState(false);
  const [adminName, setAdminName] = useState('');
  const [currentPath, setCurrentPath] = useState('');
  // Supabase client is the canonical singleton from '@alfanumrik/lib/supabase-client'.
  // Previously this component created its own client via createClient(), which
  // produced a second GoTrueClient instance fighting AuthContext over the same
  // localStorage key and intermittently failed /api/auth/session with 401.
  // useAuth() returns the default context (isHi: false) when no AuthProvider is
  // mounted — super-admin routes have their own /super-admin/login flow and may
  // not be wrapped in AuthProvider. Bilingual rendering activates only when
  // AuthContext is present.
  const { isHi } = useAuth();
  // Cosmic Phase 3: flag-gated dark reskin (school/gold-steel palette via
  // data-role="school"). OFF ⇒ cosmicEnabled false ⇒ byte-identical to before.
  const { cosmicEnabled } = useCosmicTheme();

  // Education Intelligence Cloud nav group — gated by ff_education_intelligence.
  // Defaults OFF so the group is hidden for every current user until the flag
  // is seeded + enabled. Additive only.
  const [eiEnabled, setEiEnabled] = useState(false);

  const storeToken = useCallback((token: string | null) => {
    accessTokenRef.current = token;
    setAccessToken(token);
  }, []);

  const markSessionExpired = useCallback(() => setSessionExpired(true), []);

  useEffect(() => {
    setCurrentPath(window.location.pathname);
  }, []);

  useEffect(() => {
    let cancelled = false;
    getFeatureFlags()
      .then((flags) => {
        if (!cancelled) setEiEnabled(Boolean(flags[EDUCATION_INTELLIGENCE_FLAGS.V1]));
      })
      .catch(() => { /* flag fetch failed — keep group hidden (default OFF) */ });
    return () => { cancelled = true; };
  }, []);

  const navItems = useMemo<SidebarItem[]>(
    () => (eiEnabled ? [...NAV_ITEMS, ...EDUCATION_INTELLIGENCE_NAV] : NAV_ITEMS),
    [eiEnabled],
  );

  // ── Session bootstrap ─────────────────────────────────────────────────────
  // RCA fix (logout-on-refresh): the old shell hard-redirected to login on the
  // FIRST null getSession() / failed background verify / transient null auth
  // event. Now:
  //  1. null client session ⇒ probe one authorizeAdmin-gated endpoint with
  //     cookies first; redirect only when BOTH the client session is absent
  //     AND the cookie probe returns 401/403.
  //  2. onAuthStateChange redirects only on an explicit SIGNED_OUT event.
  useEffect(() => {
    let cancelled = false;

    const bootstrap = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (cancelled) return;

      if (session) {
        // Render immediately. Real security is middleware + authorizeAdmin on
        // every API route; per-request 401 handling covers a stale token.
        storeToken(session.access_token);
        setAuthReady(true);
        return;
      }

      // No client session — the httpOnly sb-* cookie may still carry a valid
      // session. Probe before deciding the operator is logged out.
      try {
        const res = await fetch('/api/super-admin/stats', { credentials: 'same-origin' });
        if (cancelled) return;
        if (res.status === 401 || res.status === 403) {
          window.location.href = '/super-admin/login';
          return;
        }
        // Cookie session works (or the failure is transient — a Vercel
        // checkpoint 429, a 5xx, a network blip). Never lock the operator out
        // on ambiguity; per-request guards surface real errors.
        setAuthReady(true);
      } catch {
        if (!cancelled) setAuthReady(true);
      }
    };

    bootstrap();

    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (event: string, session: { access_token: string } | null) => {
        if (session) {
          storeToken(session.access_token);
          setAuthReady(true);
        } else if (event === 'SIGNED_OUT') {
          window.location.href = '/super-admin/login';
        }
        // Transient null sessions (refresh races, INITIAL_SESSION before
        // hydration, etc.) never redirect.
      },
    );

    return () => {
      cancelled = true;
      subscription.unsubscribe();
    };
  }, [storeToken]);

  // Session-expiry UX: banner (preserves in-progress operator work) with a
  // manual sign-in button; auto-redirect after 10s.
  useEffect(() => {
    if (!sessionExpired) return;
    const timer = setTimeout(() => {
      window.location.href = '/super-admin/login';
    }, 10_000);
    return () => clearTimeout(timer);
  }, [sessionExpired]);

  // Fetch admin name once auth is ready
  useEffect(() => {
    if (!authReady) return;
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (user?.user_metadata?.name) setAdminName(user.user_metadata.name);
      else if (user?.email) setAdminName(user.email.split('@')[0]);
    });
  }, [authReady]);

  const headers = useCallback(() => {
    const h: Record<string, string> = { 'Content-Type': 'application/json' };
    const token = accessTokenRef.current;
    if (token) h['Authorization'] = `Bearer ${token}`;
    return h;
    // Depend on accessToken so consumers holding `headers` in hook deps
    // re-render with a fresh Authorization header after a refresh.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accessToken]);

  // Cookie-based auth with belt-and-braces Bearer: same-origin credentials so
  // the httpOnly sb-* cookie always rides along; the Bearer header is attached
  // when a client session exists but is no longer REQUIRED (the server prefers
  // whichever works). On 401: refresh the client session once, retry once;
  // only a second 401 counts as session-expired.
  const apiFetch = useCallback(async (path: string, init?: RequestInit) => {
    const doFetch = () =>
      fetch(path, {
        ...init,
        credentials: init?.credentials ?? 'same-origin',
        headers: { ...headers(), ...(init?.headers as Record<string, string> | undefined) },
      });

    let res: Response;
    try {
      res = await doFetch();
    } catch (err) {
      throw err; // network errors surface to the caller / apiFetchJson
    }
    if (res.status !== 401) return res;

    try {
      const { data } = await supabase.auth.refreshSession();
      if (data.session?.access_token) storeToken(data.session.access_token);
    } catch {
      // refresh failed — the retry still rides the cookie
    }
    const retry = await doFetch();
    if (retry.status === 401) markSessionExpired();
    return retry;
  }, [headers, storeToken, markSessionExpired]);

  const apiFetchJson = useCallback(
    async function apiFetchJsonImpl<T = unknown>(path: string, init?: RequestInit): Promise<ApiResult<T>> {
      let res: Response;
      try {
        res = await apiFetch(path, init);
      } catch (err) {
        return {
          ok: false,
          error: { kind: 'network', status: 0, message: err instanceof Error ? err.message : 'Network error' },
        };
      }
      const result = await classifyJsonResponse<T>(res);
      if (!result.ok) {
        if (result.error.kind === 'security_checkpoint') setCheckpointActive(true);
        if (result.error.kind === 'session_expired') markSessionExpired();
      }
      return result;
    },
    [apiFetch, markSessionExpired],
  );

  if (!authReady) {
    // Shape-matched first paint instead of a bare centred spinner/text — the
    // sidebar isn't mounted yet (no session), so render the dashboard skeleton
    // in the content column the shell will fill once the session resolves.
    return (
      <div className="min-h-dvh bg-surface-1">
        <div className="max-w-screen-2xl p-6">
          <AdminDashboardSkeleton label={isHi ? 'ऑपरेटर वर्कस्पेस लोड हो रहा है…' : 'Loading operator workspace…'} />
        </div>
      </div>
    );
  }

  return (
    <AdminCtx.Provider value={{ accessToken: accessToken ?? '', adminName, supabase, headers, apiFetch, apiFetchJson }}>
      <div
        className={`flex min-h-dvh bg-surface-1${cosmicEnabled ? ' super-admin-portal' : ''}`}
        style={cosmicEnabled ? { position: 'relative' } : undefined}
      >
      {/* Cosmic dark canvas — decorative starfield behind the admin chrome.
          Hidden in light/HC + reduced-motion via globals.css. */}
      {cosmicEnabled && <Starfield className="!fixed inset-0 -z-0" />}
      <DashboardSidebar
        brandTitle="ALFANUMRIK"
        brandSubtitle={isHi ? 'सुपर एडमिन' : 'Super Admin'}
        items={navItems}
        currentPath={currentPath}
        isHi={isHi}
        footer={
          <div>
            {adminName && (
              <div className="mb-2 truncate text-[11px] text-muted-foreground">{adminName}</div>
            )}
            <button
              onClick={async () => {
                await fetch('/api/super-admin/logout', { method: 'POST', credentials: 'same-origin' }).catch(() => undefined);
                await supabase.auth.signOut({ scope: 'local' });
                window.location.replace('/super-admin/login');
              }}
              className="w-full rounded-md border border-surface-3 bg-surface-1 py-1.5 text-[11px] font-medium text-muted-foreground hover:bg-surface-2"
            >
              {isHi ? 'लॉगआउट' : 'Logout'}
            </button>
          </div>
        }
      />
      <main className={`flex-1${cosmicEnabled ? ' relative z-10' : ''}`}>
        <div className="max-w-screen-2xl p-6">
          {sessionExpired && (
            <div
              role="alert"
              className="mb-4 flex items-center justify-between gap-3 rounded-md border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900"
            >
              <span>
                {isHi
                  ? 'सत्र समाप्त हो गया — फिर से साइन इन करें। 10 सेकंड में लॉगिन पर भेजा जाएगा।'
                  : 'Session expired — sign in again. Redirecting to login in 10s.'}
              </span>
              <button
                type="button"
                onClick={() => { window.location.href = '/super-admin/login'; }}
                className="shrink-0 rounded-md border border-amber-400 bg-white px-3 py-1 text-xs font-semibold text-amber-900 hover:bg-amber-100"
              >
                {isHi ? 'साइन इन करें' : 'Sign in'}
              </button>
            </div>
          )}
          {checkpointActive && (
            <div
              role="status"
              className="mb-4 flex items-center justify-between gap-3 rounded-md border border-blue-300 bg-blue-50 px-4 py-3 text-sm text-blue-900"
            >
              <span>
                {isHi
                  ? 'Vercel सुरक्षा चेकपॉइंट API कॉल्स को रोक रहा है — डेटा पुराना हो सकता है। थोड़ी देर में पुनः प्रयास करें।'
                  : CHECKPOINT_MESSAGE}
              </span>
              <button
                type="button"
                onClick={() => setCheckpointActive(false)}
                aria-label={isHi ? 'बंद करें' : 'Dismiss'}
                className="shrink-0 rounded-md border border-blue-400 bg-white px-2 py-1 text-xs font-semibold text-blue-900 hover:bg-blue-100"
              >
                ✕
              </button>
            </div>
          )}
          {children}
        </div>
      </main>
      </div>
    </AdminCtx.Provider>
  );
}
