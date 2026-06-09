'use client';

import { useState, useEffect, useCallback, createContext, useContext } from 'react';
import { type SupabaseClient } from '@supabase/supabase-js';
import DashboardSidebar, { type SidebarNavItem } from '@/components/admin-ui/DashboardSidebar';
import { useAuth } from '@/lib/AuthContext';
import { supabase } from '@/lib/supabase-client';
import { useCosmicTheme } from '@/lib/cosmic-theme';
import { Starfield } from '@/components/cosmic';

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

const NAV_ITEMS: SidebarNavItem[] = [
  { href: '/super-admin', label: 'Overview', labelHi: 'अवलोकन', icon: '▦' },
  { href: '/super-admin/analytics', label: 'Analytics', labelHi: 'विश्लेषण', icon: '◍' },
  { href: '/super-admin/users', label: 'Users & Roles', labelHi: 'उपयोगकर्ता और भूमिकाएँ', icon: '⊕' },
  { href: '/super-admin/rbac', label: 'RBAC', labelHi: 'RBAC', icon: '⛊' },
  { href: '/super-admin/oauth-apps', label: 'OAuth Apps', labelHi: 'OAuth ऐप्स', icon: '⊚' },
  { href: '/super-admin/subscriptions', label: 'Subscriptions', labelHi: 'सदस्यता', icon: '◈' },
  { href: '/super-admin/learning', label: 'Learning Intel', labelHi: 'लर्निंग इंटेल', icon: '◉' },
  { href: '/super-admin/diagnostics', label: 'Diagnostics', labelHi: 'डायग्नोस्टिक्स', icon: '⊘' },
  { href: '/super-admin/marking-integrity', label: 'Marking Integrity', labelHi: 'अंकन सत्यनिष्ठा', icon: '⛉' },
  { href: '/super-admin/oracle-health', label: 'Oracle Health', labelHi: 'ओरेकल स्वास्थ्य', icon: '◐' },
  { href: '/super-admin/mol-shadow', label: 'MOL Shadow', labelHi: 'MOL शैडो', icon: '◑' },
  { href: '/super-admin/health', label: 'Health', labelHi: 'स्वास्थ्य', icon: '♥' },
  { href: '/super-admin/observability', label: 'Observability', labelHi: 'अवलोकनीयता', icon: '◎' },
  { href: '/super-admin/subscribers', label: 'Subscribers', labelHi: 'सब्सक्राइबर', icon: '⊳' },
  { href: '/super-admin/workbench', label: 'Data Workbench', labelHi: 'डेटा वर्कबेंच', icon: '⊞' },
  { href: '/super-admin/flags', label: 'Feature Flags', labelHi: 'फ़ीचर फ़्लैग्स', icon: '⊡' },
  { href: '/super-admin/institutions', label: 'Institutions', labelHi: 'संस्थान', icon: '⊟' },
  { href: '/super-admin/invoices', label: 'Invoices', labelHi: 'चालान', icon: '⊓' },
  { href: '/super-admin/analytics-b2b', label: 'B2B Analytics', labelHi: 'B2B विश्लेषण', icon: '⊿' },
  { href: '/super-admin/sla', label: 'SLA Monitor', labelHi: 'SLA मॉनिटर', icon: '⊗' },
  { href: '/super-admin/alerts', label: 'Alerts', labelHi: 'अलर्ट', icon: '⊚' },
  { href: '/super-admin/cms', label: 'CMS', labelHi: 'CMS', icon: '⊠' },
  { href: '/super-admin/reports', label: 'Reports', labelHi: 'रिपोर्ट', icon: '⊏' },
  { href: '/super-admin/logs', label: 'Audit Logs', labelHi: 'ऑडिट लॉग', icon: '⊙' },
  { href: '/super-admin/support', label: 'Support Center', labelHi: 'सहायता केंद्र', icon: '⊛' },
  { href: '/super-admin/bulk-actions', label: 'Bulk Actions', labelHi: 'बल्क क्रियाएँ', icon: '⊞' },
  { href: '/super-admin/demo', label: 'Demo Accounts', labelHi: 'डेमो खाते', icon: '⊜' },
  { href: '/super-admin/alfabot', label: 'AlfaBot', labelHi: 'AlfaBot', icon: '◓' },
];

export default function AdminShell({ children }: { children: React.ReactNode }) {
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [adminName, setAdminName] = useState('');
  const [currentPath, setCurrentPath] = useState('');
  // Supabase client is the canonical singleton from '@/lib/supabase-client'.
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

  useEffect(() => {
    setCurrentPath(window.location.pathname);
  }, []);

  useEffect(() => {
    const getSession = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (session) {
        setAccessToken(session.access_token);
        // Fetch admin name
        try {
          const res = await fetch('/api/super-admin/stats', {
            headers: { Authorization: `Bearer ${session.access_token}` },
          });
          if (!res.ok) {
            window.location.href = '/super-admin/login';
            return;
          }
        } catch {
          window.location.href = '/super-admin/login';
          return;
        }
      } else {
        window.location.href = '/super-admin/login';
      }
    };
    getSession();

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event: string, session: { access_token: string } | null) => {
      if (session) setAccessToken(session.access_token);
      else window.location.href = '/super-admin/login';
    });

    return () => subscription.unsubscribe();
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
      <div className="flex min-h-screen items-center justify-center bg-surface-1">
        <div className="text-sm text-muted-foreground">
          {isHi ? 'सत्र लोड हो रहा है...' : 'Loading session...'}
        </div>
      </div>
    );
  }

  return (
    <AdminCtx.Provider value={{ accessToken, adminName, supabase, headers, apiFetch }}>
      <div
        className={`flex min-h-screen bg-surface-1${cosmicEnabled ? ' super-admin-portal' : ''}`}
        style={cosmicEnabled ? { position: 'relative' } : undefined}
      >
        {/* Cosmic dark canvas — decorative starfield behind the admin chrome.
            Hidden in light/HC + reduced-motion via globals.css. */}
        {cosmicEnabled && <Starfield className="!fixed inset-0 -z-0" />}
        <DashboardSidebar
          brandTitle="ALFANUMRIK"
          brandSubtitle={isHi ? 'सुपर एडमिन' : 'Super Admin'}
          items={NAV_ITEMS}
          currentPath={currentPath}
          isHi={isHi}
          footer={
            <div>
              {adminName && (
                <div className="mb-2 truncate text-[11px] text-muted-foreground">{adminName}</div>
              )}
              <button
                onClick={async () => { await supabase.auth.signOut(); window.location.href = '/super-admin/login'; }}
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
