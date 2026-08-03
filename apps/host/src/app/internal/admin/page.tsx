'use client';

/**
 * ALFANUMRIK SUPER ADMIN — thin tab dispatcher.
 *
 * SESSION-ONLY auth (P2-1): the console is gated on the super_admin session
 * cookie established by <LoginScreen>. There is no shared secret and nothing
 * to persist client-side — a boolean `authed` flag flips once login succeeds.
 * Renders the chrome (toast / header / sidebar nav) and dispatches to one of
 * 10 per-tab components in ./_components/<TabName>Tab.tsx.
 *
 * Cross-cutting state owned here so it survives tab switches:
 *   - selectedUser → <UserDrawer> mounts at top level
 *   - usersRefreshKey → bumped after a UserDrawer action; UsersTab refetches
 *   - showToast → bottom-right toast, callable by Users / Flags / Support tabs
 */

import { useState, useCallback, useRef } from 'react';
import LoginScreen from './_components/LoginScreen';
import UserDrawer from './_components/UserDrawer';
import LogsTab from './_components/LogsTab';
import ReportsTab from './_components/ReportsTab';
import FlagsTab from './_components/FlagsTab';
import SupportTab from './_components/SupportTab';
import AIMonitorTab from './_components/AIMonitorTab';
import RevenueTab from './_components/RevenueTab';
import SchoolsTab from './_components/SchoolsTab';
import ContentTab from './_components/ContentTab';
import UsersTab from './_components/UsersTab';
import CommandTab from './_components/CommandTab';
import type {
  Tab,
  Student,
} from './_lib/internal-admin-types';

// Chrome styles only (header, sidebar, content wrapper, sign-out).
// Per-tab styles live with each tab. Task 6 kept chrome on the legacy
// dark-theme tokens — operator-only console.
const C = {
  bg: '#080c10',
  bg2: '#0d1117',
  bg3: '#161b22',
  border: '#21262d',
  text1: '#e6edf3',
  text2: '#8b949e',
  text3: '#484f58',
  orange: '#E8581C',
  red: '#ef4444',
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const S: Record<string, any> = {
  page: { minHeight: '100vh', background: C.bg, color: C.text1, fontFamily: "'Plus Jakarta Sans', 'Inter', system-ui, sans-serif", fontSize: 13 },
  header: { padding: '12px 20px', borderBottom: `1px solid ${C.border}`, background: C.bg2, display: 'flex', justifyContent: 'space-between', alignItems: 'center' },
  sidebar: { width: 200, minHeight: 'calc(100vh - 49px)', borderRight: `1px solid ${C.border}`, background: C.bg2, padding: '8px 0', flexShrink: 0 },
  content: { flex: 1, padding: 20, overflowX: 'auto' as const, minHeight: 'calc(100vh - 49px)' },
  navItem: (active: boolean): React.CSSProperties => ({
    display: 'flex', alignItems: 'center', gap: 8,
    padding: '9px 16px', fontSize: 12, fontWeight: active ? 700 : 400,
    color: active ? C.orange : C.text2,
    background: active ? `${C.orange}12` : 'transparent',
    borderLeft: active ? `2px solid ${C.orange}` : '2px solid transparent',
    cursor: 'pointer', border: 'none', width: '100%', textAlign: 'left' as const,
    transition: 'all 0.15s',
  }),
  signOutBtn: {
    padding: '5px 10px', borderRadius: 7, fontSize: 10, fontWeight: 600, cursor: 'pointer',
    background: `${C.red}15`, color: C.red, border: `1px solid ${C.red}30`,
    transition: 'all 0.15s',
  } as React.CSSProperties,
};

function LegacyInternalAdminPage() {
  const [authed, setAuthed] = useState(false);
  const [tab, setTab] = useState<Tab>('command');
  const [toast, setToast] = useState('');
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  /** UserDrawer is mounted at page level above the tabs so its onClose / onRefresh
   *  do not unmount with a tab switch. The drawer's selected user lives here;
   *  UsersTab notifies via onSelectUser. */
  const [selectedUser, setSelectedUser] = useState<Student | null>(null);
  /** Bumped after UserDrawer completes an action — UsersTab refetches. */
  const [usersRefreshKey, setUsersRefreshKey] = useState(0);

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(''), 3000);
  }, []);

  // ── Sign out ── revoke the server session (expires the sb-* cookie), then
  // return to the login screen. The session is httpOnly, so teardown is
  // server-side only; there is no client-side secret/state to clear.
  const handleSignOut = useCallback(() => {
    void fetch('/api/super-admin/logout', {
      method: 'POST',
      credentials: 'same-origin',
    }).catch(() => undefined);
    setAuthed(false);
  }, []);

  if (!authed) return <LoginScreen onLogin={() => setAuthed(true)} />;

  const TABS: { key: Tab; icon: string; label: string }[] = [
    { key: 'command', icon: '⚡', label: 'Command Center' },
    { key: 'users', icon: '👥', label: 'Users' },
    { key: 'content', icon: '📚', label: 'Content CMS' },
    { key: 'schools', icon: '🏫', label: 'Schools' },
    { key: 'revenue', icon: '💰', label: 'Revenue' },
    { key: 'ai', icon: '🤖', label: 'AI Monitor' },
    { key: 'flags', icon: '🚩', label: 'Feature Flags' },
    { key: 'support', icon: '🎫', label: 'Support' },
    { key: 'logs', icon: '🔍', label: 'Audit Logs' },
    { key: 'reports', icon: '📋', label: 'Reports' },
  ];

  return (
    <div style={S.page}>
      {/* Toast */}
      {toast && (
        <div style={{ position: 'fixed', bottom: 20, right: 20, background: C.bg3, border: `1px solid ${C.border}`, borderRadius: 8, padding: '10px 16px', fontSize: 12, color: C.text1, zIndex: 200, boxShadow: '0 8px 24px rgba(0,0,0,0.4)' }}>
          {toast}
        </div>
      )}

      {/* Header */}
      <header style={S.header}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 20 }}>🦊</span>
          <div>
            <div style={{ fontSize: 14, fontWeight: 800, color: C.orange, letterSpacing: 0.5 }}>ALFANUMRIK</div>
            <div style={{ fontSize: 9, color: C.text3, letterSpacing: 2, textTransform: 'uppercase' }}>Super Admin Console</div>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
          <span style={{ fontSize: 10, color: C.text3 }}>{new Date().toLocaleString()}</span>
          <button onClick={handleSignOut} style={S.signOutBtn}>Sign Out</button>
        </div>
      </header>

      <div style={{ display: 'flex' }}>
        {/* Sidebar */}
        <nav style={S.sidebar}>
          {TABS.map(t => (
            <button key={t.key} onClick={() => setTab(t.key)} style={S.navItem(tab === t.key)}>
              <span>{t.icon}</span>{t.label}
            </button>
          ))}
        </nav>

        {/* Main content */}
        <main style={S.content}>

          {tab === 'command' && <CommandTab onNavigate={setTab} />}
          {tab === 'users' && (
            <UsersTab onSelectUser={setSelectedUser} onToast={showToast} refreshKey={usersRefreshKey} />
          )}
          {tab === 'content' && <ContentTab />}
          {tab === 'schools' && <SchoolsTab />}
          {tab === 'revenue' && <RevenueTab />}
          {tab === 'ai' && <AIMonitorTab />}
          {tab === 'flags' && <FlagsTab onToast={showToast} />}
          {tab === 'support' && <SupportTab onToast={showToast} />}
          {tab === 'logs' && <LogsTab />}
          {tab === 'reports' && <ReportsTab />}
        </main>
      </div>

      {/* User Detail Drawer */}
      {selectedUser && (
        <UserDrawer
          student={selectedUser}
          onClose={() => setSelectedUser(null)}
          onRefresh={() => setUsersRefreshKey(k => k + 1)}
        />
      )}
    </div>
  );
}

export default function InternalAdminPage() {
  return <LegacyInternalAdminPage />;
}
