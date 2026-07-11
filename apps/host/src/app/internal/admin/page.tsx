'use client';

/**
 * ALFANUMRIK SUPER ADMIN — thin tab dispatcher.
 *
 * Auth via sessionStorage (`alfa_admin_secret`). On first visit shows
 * <LoginScreen>. Renders the chrome (toast / header / sidebar nav) and
 * dispatches to one of 10 per-tab components in ./_components/<TabName>Tab.tsx.
 *
 * Cross-cutting state owned here so it survives tab switches:
 *   - selectedUser → <UserDrawer> mounts at top level
 *   - usersRefreshKey → bumped after a UserDrawer action; UsersTab refetches
 *   - showToast → bottom-right toast, callable by Users / Flags / Support tabs
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { useExperienceV3 } from '@alfanumrik/lib/use-experience-v3';
import {
  getAdminSecretFromSession,
  clearAdminSession,
} from '@alfanumrik/lib/admin-session';
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
  const [secret, setSecret] = useState('');
  const [tab, setTab] = useState<Tab>('command');
  const [toast, setToast] = useState('');
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  /** UserDrawer is mounted at page level above the tabs so its onClose / onRefresh
   *  do not unmount with a tab switch. The drawer's selected user lives here;
   *  UsersTab notifies via onSelectUser. */
  const [selectedUser, setSelectedUser] = useState<Student | null>(null);
  /** Bumped after UserDrawer completes an action — UsersTab refetches. */
  const [usersRefreshKey, setUsersRefreshKey] = useState(0);

  // ── Auth ──
  useEffect(() => {
    const saved = getAdminSecretFromSession();
    if (saved) setSecret(saved);
  }, []);

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(''), 3000);
  }, []);

  if (!secret) return <LoginScreen onLogin={setSecret} />;

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
          <button onClick={() => { clearAdminSession(); setSecret(''); }} style={S.signOutBtn}>Sign Out</button>
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

          {tab === 'command' && <CommandTab secret={secret} onNavigate={setTab} />}
          {tab === 'users' && (
            <UsersTab secret={secret} onSelectUser={setSelectedUser} onToast={showToast} refreshKey={usersRefreshKey} />
          )}
          {tab === 'content' && <ContentTab secret={secret} />}
          {tab === 'schools' && <SchoolsTab secret={secret} />}
          {tab === 'revenue' && <RevenueTab secret={secret} />}
          {tab === 'ai' && <AIMonitorTab secret={secret} />}
          {tab === 'flags' && <FlagsTab secret={secret} onToast={showToast} />}
          {tab === 'support' && <SupportTab secret={secret} onToast={showToast} />}
          {tab === 'logs' && <LogsTab secret={secret} />}
          {tab === 'reports' && <ReportsTab secret={secret} />}
        </main>
      </div>

      {/* User Detail Drawer */}
      {selectedUser && (
        <UserDrawer
          student={selectedUser}
          secret={secret}
          onClose={() => setSelectedUser(null)}
          onRefresh={() => setUsersRefreshKey(k => k + 1)}
        />
      )}
    </div>
  );
}

export default function InternalAdminPage() {
  const router = useRouter();
  const { enabled, loading } = useExperienceV3('super-admin');
  useEffect(() => {
    if (enabled) router.replace('/super-admin/command');
  }, [enabled, router]);
  if (loading || enabled) return null;
  return <LegacyInternalAdminPage />;
}
