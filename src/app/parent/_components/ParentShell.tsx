'use client';

import { useRouter, usePathname } from 'next/navigation';
import { useAuth } from '@/lib/AuthContext';
import DashboardSidebar, { type SidebarNavItem } from '@/components/admin-ui/DashboardSidebar';
import { useParentAuth } from './useParentAuth';
import { supabase } from '@/lib/supabase';

const NAV_ITEMS: SidebarNavItem[] = [
  { href: '/parent', label: 'Dashboard', labelHi: 'डैशबोर्ड', icon: '▦' },
  { href: '/parent/children', label: 'Children', labelHi: 'बच्चे', icon: '⊕' },
  { href: '/parent/calendar', label: 'Calendar', labelHi: 'कैलेंडर', icon: '◐' },
  { href: '/parent/reports', label: 'Reports', labelHi: 'रिपोर्ट', icon: '⊘' },
  { href: '/parent/support', label: 'Support', labelHi: 'सहायता', icon: '⊛' },
  { href: '/parent/profile', label: 'Profile', labelHi: 'प्रोफ़ाइल', icon: '◎' },
];

export default function ParentShell({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const { isHi } = useAuth();
  const { mode, parentName, loading } = useParentAuth();

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
  const visibleItems = NAV_ITEMS.filter(item => {
    if (mode === 'link-code') {
      if (item.href === '/parent/children') return false;
      if (item.href === '/parent/profile') return false;
    }
    return true;
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
    <div className="flex min-h-screen bg-orange-50/30">
      <DashboardSidebar
        brandTitle="Alfanumrik"
        brandSubtitle={isHi ? 'अभिभावक' : 'Parent'}
        primaryColor="#F97316" /* brand orange — parent portal accent */
        items={visibleItems}
        currentPath={pathname || ''}
        isHi={isHi}
        footer={
          <div>
            {parentName && (
              <div className="mb-2 truncate text-[11px] text-muted-foreground">{parentName}</div>
            )}
            <button
              onClick={handleLogout}
              className="w-full rounded-md border border-surface-3 bg-surface-1 py-1.5 text-[11px] font-medium text-muted-foreground hover:bg-surface-2"
            >
              {isHi ? 'लॉगआउट' : 'Logout'}
            </button>
          </div>
        }
      />
      <main className="flex-1 overflow-auto">{children}</main>
    </div>
  );
}
