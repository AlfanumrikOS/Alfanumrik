'use client';

import { useEffect } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import useSWR from 'swr';
import { useAuth } from '@alfanumrik/lib/AuthContext';
import DashboardSidebar, { type SidebarNavItem } from '@alfanumrik/ui/admin-ui/DashboardSidebar';
import { RoleNavIcon } from '@alfanumrik/ui/navigation/role-nav';
import { useParentAuth } from './useParentAuth';
import { supabase } from '@alfanumrik/lib/supabase';
import ParentMobileNav from './ParentMobileNav';

const NAV_ITEMS: SidebarNavItem[] = [
  { href: '/parent', label: 'Home', labelHi: 'होम', icon: <RoleNavIcon iconKey="home" /> },
  { href: '/parent/children', label: 'Children', labelHi: 'बच्चे', icon: <RoleNavIcon iconKey="students" /> },
  { href: '/parent/calendar', label: 'Calendar', labelHi: 'कैलेंडर', icon: <RoleNavIcon iconKey="calendar" /> },
  { href: '/parent/messages', label: 'Messages', labelHi: 'संदेश', icon: <RoleNavIcon iconKey="messages" /> },
  { href: '/parent/notifications', label: 'Notifications', labelHi: 'सूचनाएँ', icon: <RoleNavIcon iconKey="notifications" /> },
  { href: '/parent/reports', label: 'Reports', labelHi: 'रिपोर्ट', icon: <RoleNavIcon iconKey="reports" /> },
  { href: '/parent/attendance', label: 'Attendance', labelHi: 'उपस्थिति', icon: <RoleNavIcon iconKey="attendance" /> },
  { href: '/parent/billing', label: 'Billing', labelHi: 'बिलिंग', icon: <RoleNavIcon iconKey="billing" /> },
  { href: '/parent/support', label: 'Support', labelHi: 'सहायता', icon: <RoleNavIcon iconKey="support" /> },
  { href: '/parent/profile', label: 'Profile', labelHi: 'प्रोफ़ाइल', icon: <RoleNavIcon iconKey="profile" /> },
];

// Polling interval for the sidebar unread badge. Conservative — the
// /parent/notifications page itself polls at 30s; the sidebar only needs
// occasional refresh to keep the count "fresh enough" without hammering.
const BADGE_POLL_MS = 60_000;

interface UnreadResponse {
  success: boolean;
  unreadCount: number;
}

interface MessagesUnreadResponse {
  success: boolean;
  unreadTotal: number;
}

async function authedFetch(url: string): Promise<Response> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  try {
    const { data: { session } } = await supabase.auth.getSession();
    if (session?.access_token) headers['Authorization'] = `Bearer ${session.access_token}`;
  } catch {
    /* anonymous — fall through, server returns 401 */
  }
  return fetch(url, { headers });
}

async function badgeFetcher(url: string): Promise<UnreadResponse> {
  // Use the parent-notifications GET but force limit=1 to keep payloads
  // tiny. The route still computes the unreadCount.
  const res = await authedFetch(url);
  if (!res.ok) throw new Error(`parent-notifications.badge_fetch_failed:${res.status}`);
  return res.json() as Promise<UnreadResponse>;
}

async function messagesBadgeFetcher(url: string): Promise<MessagesUnreadResponse> {
  const res = await authedFetch(url);
  if (!res.ok) throw new Error(`parent-messages.badge_fetch_failed:${res.status}`);
  return res.json() as Promise<MessagesUnreadResponse>;
}

function useParentUnreadBadge(enabled: boolean): number {
  const { data } = useSWR<UnreadResponse>(
    enabled ? '/api/parent/notifications?limit=1' : null,
    badgeFetcher,
    {
      refreshInterval: BADGE_POLL_MS,
      revalidateOnFocus: true,
      shouldRetryOnError: false,
    },
  );
  return data?.unreadCount ?? 0;
}

function useParentMessagesBadge(enabled: boolean): number {
  const { data } = useSWR<MessagesUnreadResponse>(
    enabled ? '/api/parent/messages/threads?limit=1' : null,
    messagesBadgeFetcher,
    {
      refreshInterval: BADGE_POLL_MS,
      revalidateOnFocus: true,
      shouldRetryOnError: false,
    },
  );
  return data?.unreadTotal ?? 0;
}

/**
 * DPDP gate (Phase D.1).
 *
 * For guardian-mode parents, hit /api/parent/consent and check whether
 * any linked child lacks an active consent at the current version. If
 * so, redirect to /parent/consent with the original path as returnTo.
 *
 * Link-code parents skip the gate — they don't have a Supabase auth
 * session, so the consent route would 401 them anyway. The plan is to
 * surface a sign-in nudge before the link-code flow can persist consent
 * authoritatively. Tracked for D.2.
 */
async function consentGateFetcher(url: string): Promise<{ allChildrenConsented: boolean }> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  try {
    const { data: { session } } = await supabase.auth.getSession();
    if (session?.access_token) headers['Authorization'] = `Bearer ${session.access_token}`;
  } catch {
    /* anonymous — fall through */
  }
  const [consentRes, billingRes] = await Promise.all([
    fetch(url, { headers }),
    fetch('/api/parent/billing', { headers }),
  ]);
  if (!consentRes.ok || !billingRes.ok) {
    // Network/auth glitch — fail open so a transient hiccup doesn't trap
    // the parent on the consent screen. The gate re-runs on next render.
    return { allChildrenConsented: true };
  }
  const consent = await consentRes.json();
  const billing = await billingRes.json();
  type ActiveRow = { studentId: string; consentVersion: string };
  const rows = (consent?.items ?? []) as ActiveRow[];
  const currentVersion = consent?.currentVersion as string | undefined;
  const consentedSet = new Set(
    rows
      .filter((r) => !currentVersion || r.consentVersion === currentVersion)
      .map((r) => r.studentId),
  );
  type BillingChild = { student_id: string };
  const linked = ((billing?.data?.children ?? []) as BillingChild[]).map((c) => c.student_id);
  const missing = linked.filter((id) => !consentedSet.has(id));
  return { allChildrenConsented: missing.length === 0 };
}

export default function ParentShell({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const { isHi } = useAuth();
  const { mode, parentName, loading } = useParentAuth();
  // Call all hooks unconditionally at the top — rules-of-hooks.
  // Only guardian mode parents have a Supabase JWT; link-code parents
  // can't authenticate against /api/parent/notifications. Guard the
  // SWR fetch so we don't generate spurious 401s.
  const unreadCount = useParentUnreadBadge(mode === 'guardian');
  // Messaging surface also requires guardian mode (Supabase JWT). Link-code
  // parents see no Messages tab — see the visibility filter below.
  const messagesUnread = useParentMessagesBadge(mode === 'guardian');

  // DPDP consent gate. Only fires for guardian-mode sessions on non-
  // consent paths — we skip while on /parent/consent itself so the
  // parent can complete the form, and we skip on /parent (the login
  // screen). The SWR cache makes this cheap on every navigation.
  const consentGateEnabled =
    mode === 'guardian' &&
    pathname !== '/parent' &&
    pathname !== '/parent/consent' &&
    !pathname?.startsWith('/parent/consent');
  const { data: gateData } = useSWR<{ allChildrenConsented: boolean }>(
    consentGateEnabled ? '/api/parent/consent' : null,
    consentGateFetcher,
    { revalidateOnFocus: false, shouldRetryOnError: false },
  );
  useEffect(() => {
    if (!consentGateEnabled) return;
    if (gateData && !gateData.allChildrenConsented) {
      const returnTo = encodeURIComponent(pathname || '/parent');
      router.replace(`/parent/consent?returnTo=${returnTo}`);
    }
  }, [consentGateEnabled, gateData, pathname, router]);

  // While auth is resolving, render children naked. Pages that require auth
  // (everything except `/parent` itself, which IS the login screen) will
  // gate themselves. Wrapping a still-resolving auth in a shell would flash
  // the sidebar before potential redirect.
  if (loading) return <>{children}</>;

  // Unauthenticated → render naked. The /parent route renders its login screen
  // directly; other parent routes will redirect to /parent (handled by their pages).
  if (mode === null) return <>{children}</>;

  // Filter nav by mode: link-code parents have a single pinned child and don't
  // need the "Children" picker (it shows their one child). Hide it for clarity.
  // Profile is also restricted in link-code mode (no Supabase user to manage).
  // Notifications is also gated: the API requires Supabase auth.
  const visibleItems = NAV_ITEMS.filter(item => {
    if (mode === 'link-code') {
      if (item.href === '/parent/children') return false;
      if (item.href === '/parent/profile') return false;
      // Billing requires a real Supabase auth session (guardian mode) to
      // bind charges to a parent identity. Link-code sessions are
      // anonymous HMAC payloads and cannot be the subject of a Razorpay
      // subscription — hide the tab in that mode.
      if (item.href === '/parent/billing') return false;
      // Notifications is API-gated by Supabase auth too — link-code
      // parents can't authenticate against /api/parent/notifications.
      if (item.href === '/parent/notifications') return false;
      // Messaging also needs Supabase auth — guardian mode only.
      if (item.href === '/parent/messages') return false;
    }
    return true;
  }).map(item => {
    if (item.href === '/parent/notifications') return { ...item, badge: unreadCount };
    if (item.href === '/parent/messages') return { ...item, badge: messagesUnread };
    return item;
  });

  const handleLogout = async () => {
    if (mode === 'guardian') {
      await supabase.auth.signOut();
      router.replace('/login');
    } else {
      // Clear link-code session and bounce back to /parent for re-entry.
      // clearParentSession is sync (per parent-session.ts), so no await needed.
      const { clearParentSession } = await import('./parent-session');
      clearParentSession();
      router.replace('/parent');
    }
  };

  return (
    <div className="flex min-h-dvh bg-surface-2">
      <DashboardSidebar
        brandTitle="Alfanumrik"
        brandSubtitle={isHi ? 'अभिभावक' : 'Parent'}
        primaryColor="var(--primary)" /* brand accent — token-driven, no raw hex */
        items={visibleItems}
        currentPath={pathname || ''}
        isHi={isHi}
        disableMobileHamburger={true}
        footer={
          <div>
            {parentName && (
              <div className="mb-2 truncate text-2xs text-muted-foreground">{parentName}</div>
            )}
            <button
              onClick={handleLogout}
              className="w-full rounded-md border border-surface-3 bg-surface-1 py-1.5 text-2xs font-medium text-muted-foreground hover:bg-surface-2"
            >
              {isHi ? 'लॉगआउट' : 'Logout'}
            </button>
          </div>
        }
      />
      <main className="flex-1 overflow-auto pb-nav md:pb-0">{children}</main>
      <ParentMobileNav
        unreadCount={unreadCount}
        messagesUnread={messagesUnread}
        isHi={isHi}
        mode={mode === 'link-code' ? 'link-code' : 'guardian'}
        onLogout={handleLogout}
      />
    </div>
  );
}
