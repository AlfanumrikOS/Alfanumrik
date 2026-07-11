'use client';

import { useState, useEffect, useCallback, useMemo, createContext, useContext } from 'react';
import { type SupabaseClient } from '@supabase/supabase-js';
import DashboardSidebar, { type SidebarNavItem, type SidebarItem } from '@alfanumrik/ui/admin-ui/DashboardSidebar';
import { useAuth } from '@alfanumrik/lib/AuthContext';
import { supabase } from '@alfanumrik/lib/supabase-client';
import { getFeatureFlags } from '@alfanumrik/lib/supabase';
import { EDUCATION_INTELLIGENCE_FLAGS } from '@alfanumrik/lib/feature-flags';
import { useCosmicTheme } from '@alfanumrik/lib/cosmic-theme';
import { Starfield } from '@alfanumrik/ui/cosmic';

interface AdminSession {
  accessToken: string;
  adminName: string;
  supabase: SupabaseClient;
  headers: () => Record<string, string>;
  apiFetch: (path: string, init?: RequestInit) => Promise<Response>;
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
  { href: '/super-admin/subscribers', label: 'Subscribers', labelHi: 'सब्सक्राइबर', icon: '⊳' },
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

  useEffect(() => {
    let cancelled = false;

    const getSession = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        window.location.href = '/super-admin/login';
        return;
      }

      // Set token immediately — children can render now.
      // Real security is middleware + authorizeAdmin on every API route.
      if (!cancelled) setAccessToken(session.access_token);

      // Background verify (non-blocking).
      fetch('/api/super-admin/stats', {
        headers: { Authorization: `Bearer ${session.access_token}` },
      }).then(res => {
        if (!res.ok && !cancelled) window.location.href = '/super-admin/login';
      }).catch(() => {
        if (!cancelled) window.location.href = '/super-admin/login';
      });
    };

    getSession();

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event: string, session: { access_token: string } | null) => {
      if (session) setAccessToken(session.access_token);
      else window.location.href = '/super-admin/login';
    });

    return () => {
      cancelled = true;
      subscription.unsubscribe();
    };
  }, []);

  // Fetch admin name once token is available
  useEffect(() => {
    if (!accessToken) return;
    fetch('/api/super-admin/roles?action=roles', {
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    }).catch((err: unknown) => {
      console.warn('[admin-shell] roles prefetch failed:', err instanceof Error ? err.message : String(err));
    });
    // Try to get name from session user metadata
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (user?.user_metadata?.name) setAdminName(user.user_metadata.name);
      else if (user?.email) setAdminName(user.email.split('@')[0]);
    });
  }, [accessToken]);

  const headers = useCallback(() => ({
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${accessToken}`,
  }), [accessToken]);

  const apiFetch = useCallback(async (path: string, init?: RequestInit) => {
    return fetch(path, { ...init, headers: { ...headers(), ...init?.headers } });
  }, [headers]);

  if (!accessToken) {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-surface-1">
        <div className="text-sm text-muted-foreground">
          {isHi ? 'सत्र लोड हो रहा है...' : 'Loading session...'}
        </div>
      </div>
    );
  }

  return (
    <AdminCtx.Provider value={{ accessToken, adminName, supabase, headers, apiFetch }}>
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
          <div className="max-w-screen-2xl p-6">{children}</div>
        </main>
      </div>
    </AdminCtx.Provider>
  );
}
