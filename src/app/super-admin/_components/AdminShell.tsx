'use client';

import { useState, useEffect, useCallback, createContext, useContext } from 'react';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { colors } from './admin-styles';

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

const NAV_ITEMS: { href: string; label: string; icon: string }[] = [
  { href: '/super-admin', label: 'Overview', icon: '▦' },
  { href: '/super-admin/analytics', label: 'Analytics', icon: '◍' },
  { href: '/super-admin/users', label: 'Users & Roles', icon: '⊕' },
  { href: '/super-admin/rbac', label: 'RBAC', icon: '⛊' },
  { href: '/super-admin/oauth-apps', label: 'OAuth Apps', icon: '⊚' },
  { href: '/super-admin/subscriptions', label: 'Subscriptions', icon: '◈' },
  { href: '/super-admin/learning', label: 'Learning Intel', icon: '◉' },
  { href: '/super-admin/diagnostics', label: 'Diagnostics', icon: '⊘' },
  { href: '/super-admin/workbench', label: 'Data Workbench', icon: '⊞' },
  { href: '/super-admin/flags', label: 'Feature Flags', icon: '⊡' },
  { href: '/super-admin/institutions', label: 'Institutions', icon: '⊟' },
  { href: '/super-admin/invoices', label: 'Invoices', icon: '⊓' },
  { href: '/super-admin/analytics-b2b', label: 'B2B Analytics', icon: '⊿' },
  { href: '/super-admin/sla', label: 'SLA Monitor', icon: '⊗' },
  { href: '/super-admin/alerts', label: 'Alerts', icon: '⊚' },
  { href: '/super-admin/cms', label: 'CMS', icon: '⊠' },
  { href: '/super-admin/reports', label: 'Reports', icon: '⊏' },
  { href: '/super-admin/logs', label: 'Audit Logs', icon: '⊙' },
  { href: '/super-admin/support', label: 'Support Center', icon: '⊛' },
  { href: '/super-admin/demo', label: 'Demo Accounts', icon: '⊜' },
];

export default function AdminShell({ children }: { children: React.ReactNode }) {
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [adminName, setAdminName] = useState('');
  const [collapsed, setCollapsed] = useState(false);
  const [currentPath, setCurrentPath] = useState('');
  const [supabase] = useState(() =>
    createClient(process.env.NEXT_PUBLIC_SUPABASE_URL || '', process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '')
  );

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
  }, [supabase]);

  // Fetch admin name once token is available
  useEffect(() => {
    if (!accessToken) return;
    fetch('/api/super-admin/roles?action=roles', {
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    }).catch(() => {});
    // Try to get name from session user metadata
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (user?.user_metadata?.name) setAdminName(user.user_metadata.name);
      else if (user?.email) setAdminName(user.email.split('@')[0]);
    });
  }, [accessToken, supabase]);

  const headers = useCallback(() => ({
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${accessToken}`,
  }), [accessToken]);

  const apiFetch = useCallback(async (path: string, init?: RequestInit) => {
    return fetch(path, { ...init, headers: { ...headers(), ...init?.headers } });
  }, [headers]);

  if (!accessToken) {
    return (
      <div style={{
        minHeight: '100vh', background: colors.bg, display: 'flex',
        alignItems: 'center', justifyContent: 'center', colorScheme: 'light',
      }}>
        <div style={{ color: colors.text3, fontSize: 14 }}>Loading session...</div>
      </div>
    );
  }

  const sidebarWidth = collapsed ? 56 : 200;

  return (
    <AdminCtx.Provider value={{ accessToken, adminName, supabase, headers, apiFetch }}>
      <div style={{ display: 'flex', minHeight: '100vh', background: colors.bg, colorScheme: 'light' }}>
        {/* Sidebar */}
        <aside style={{
          width: sidebarWidth, flexShrink: 0,
          borderRight: `1px solid ${colors.border}`,
          background: colors.bg,
          display: 'flex', flexDirection: 'column',
          transition: 'width 0.2s',
          position: 'fixed', top: 0, bottom: 0, left: 0, zIndex: 100,
          overflowY: 'auto',
        }}>
          {/* Logo */}
          <div style={{
            padding: collapsed ? '16px 8px' : '16px 16px',
            borderBottom: `1px solid ${colors.border}`,
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          }}>
            {!collapsed && (
              <div>
                <div style={{ fontSize: 14, fontWeight: 800, color: colors.text1, letterSpacing: 0.5 }}>ALFANUMRIK</div>
                <div style={{ fontSize: 10, color: colors.text3, letterSpacing: 2, textTransform: 'uppercase', marginTop: 1 }}>Super Admin</div>
              </div>
            )}
            <button
              onClick={() => setCollapsed(!collapsed)}
              style={{
                background: 'none', border: `1px solid ${colors.border}`, borderRadius: 4,
                padding: '3px 6px', cursor: 'pointer', color: colors.text3, fontSize: 12,
              }}
              title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            >
              {collapsed ? '▸' : '◂'}
            </button>
          </div>

          {/* Nav */}
          <nav style={{ flex: 1, padding: '8px 0' }}>
            {NAV_ITEMS.map(item => {
              const isActive = currentPath === item.href || (item.href !== '/super-admin' && currentPath.startsWith(item.href));
              return (
                <a
                  key={item.href}
                  href={item.href}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 10,
                    padding: collapsed ? '9px 0' : '9px 16px',
                    justifyContent: collapsed ? 'center' : 'flex-start',
                    fontSize: 13, fontWeight: isActive ? 600 : 400,
                    color: isActive ? colors.text1 : colors.text2,
                    background: isActive ? colors.surface : 'transparent',
                    borderRight: isActive ? `2px solid ${colors.text1}` : '2px solid transparent',
                    textDecoration: 'none',
                    transition: 'background 0.1s',
                  }}
                  title={collapsed ? item.label : undefined}
                  onMouseEnter={e => { if (!isActive) e.currentTarget.style.background = colors.surfaceHover; }}
                  onMouseLeave={e => { if (!isActive) e.currentTarget.style.background = 'transparent'; }}
                >
                  <span style={{ fontSize: 14, width: 20, textAlign: 'center', flexShrink: 0 }}>{item.icon}</span>
                  {!collapsed && <span>{item.label}</span>}
                </a>
              );
            })}
          </nav>

          {/* Footer */}
          <div style={{ padding: collapsed ? '12px 4px' : '12px 16px', borderTop: `1px solid ${colors.border}` }}>
            {!collapsed && adminName && (
              <div style={{ fontSize: 11, color: colors.text3, marginBottom: 8, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {adminName}
              </div>
            )}
            <button
              onClick={async () => { await supabase.auth.signOut(); window.location.href = '/super-admin/login'; }}
              style={{
                width: '100%', padding: '6px 0', borderRadius: 5,
                border: `1px solid ${colors.border}`, background: colors.bg,
                color: colors.text2, fontSize: 11, cursor: 'pointer', fontWeight: 500,
              }}
            >
              {collapsed ? '→' : 'Logout'}
            </button>
          </div>
        </aside>

        {/* Main content */}
        <main style={{ flex: 1, marginLeft: sidebarWidth, transition: 'margin-left 0.2s' }}>
          <div style={{ padding: '24px 28px', maxWidth: 1480 }}>
            {children}
          </div>
        </main>
      </div>
    </AdminCtx.Provider>
  );
}
