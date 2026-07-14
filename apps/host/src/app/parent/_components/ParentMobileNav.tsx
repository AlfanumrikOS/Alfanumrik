'use client';

import { useState, useEffect, useRef } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { withParentChildId } from './parent-child-scope';

interface ParentMobileNavProps {
  unreadCount: number;        // notification badge
  messagesUnread: number;     // messages badge
  isHi: boolean;
  mode: 'guardian' | 'link-code';
  childId: string | null;
  onLogout: () => void;
}

interface PrimaryTab {
  href: string;
  label: string;
  labelHi: string;
  icon: string;
  exact?: boolean;
  isBadge?: boolean;
}

interface MoreItem {
  href: string;
  label: string;
  labelHi: string;
  icon: string;
  isBadge?: boolean;
}

const PRIMARY_TABS: PrimaryTab[] = [
  { href: '/parent', label: 'Home', labelHi: 'होम', icon: '🏠', exact: true },
  { href: '/parent/children', label: 'Children', labelHi: 'बच्चे', icon: '👨‍👧' },
  { href: '/parent/reports', label: 'Reports', labelHi: 'रिपोर्ट', icon: '📊' },
  { href: '/parent/messages', label: 'Messages', labelHi: 'संदेश', icon: '✉️', isBadge: true },
];

const MORE_ITEMS: MoreItem[] = [
  { href: '/parent/calendar', label: 'Calendar', labelHi: 'कैलेंडर', icon: '📅' },
  { href: '/parent/notifications', label: 'Notifications', labelHi: 'सूचनाएं', icon: '🔔', isBadge: true },
  { href: '/parent/billing', label: 'Billing', labelHi: 'बिलिंग', icon: '💳' },
  { href: '/parent/support', label: 'Support', labelHi: 'सहायता', icon: '🤝' },
  { href: '/parent/profile', label: 'Profile', labelHi: 'प्रोफ़ाइल', icon: '👤' },
];

export default function ParentMobileNav({
  unreadCount,
  messagesUnread,
  isHi,
  mode,
  childId,
  onLogout,
}: ParentMobileNavProps) {
  const pathname = usePathname();
  const router = useRouter();
  const [showMore, setShowMore] = useState(false);
  const moreSheetRef = useRef<HTMLDivElement>(null);

  // rAF scroll-hide — 8px threshold, hides after 80px scroll-down,
  // restores on scroll-up or when y < 80.
  const [navHidden, setNavHidden] = useState(false);
  const lastScrollYRef = useRef(0);
  const rafIdRef = useRef<number | null>(null);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;
    if (reduced) return;
    const onScroll = () => {
      if (rafIdRef.current != null) return;
      rafIdRef.current = window.requestAnimationFrame(() => {
        rafIdRef.current = null;
        const y = window.scrollY;
        const last = lastScrollYRef.current;
        const delta = y - last;
        if (Math.abs(delta) < 8) return;
        if (y < 80) setNavHidden(false);
        else if (delta > 0) setNavHidden(true);
        else setNavHidden(false);
        lastScrollYRef.current = y;
      });
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      window.removeEventListener('scroll', onScroll);
      if (rafIdRef.current != null) window.cancelAnimationFrame(rafIdRef.current);
    };
  }, []);

  // ESC closes More sheet; auto-focus first button when More sheet opens.
  useEffect(() => {
    if (showMore && moreSheetRef.current) {
      const firstButton = moreSheetRef.current.querySelector('button');
      firstButton?.focus();
    }
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && showMore) setShowMore(false);
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [showMore]);

  const isActive = (href: string, exact?: boolean) => {
    if (exact) return pathname === href;
    return pathname === href || pathname.startsWith(href + '/');
  };

  // Link-code mode: hide Children and Messages from primary tabs.
  const visibleTabs = PRIMARY_TABS.filter(tab => {
    if (mode === 'link-code') {
      if (tab.href === '/parent/children') return false;
      if (tab.href === '/parent/messages') return false;
    }
    return true;
  });

  // Check if any More item is active (for the More button highlight).
  const isMoreActive = MORE_ITEMS.some(item => isActive(item.href));

  const getBadgeCount = (tab: PrimaryTab): number => {
    if (tab.href === '/parent/messages') return messagesUnread;
    return 0;
  };

  const getMoreBadgeCount = (item: MoreItem): number => {
    if (item.href === '/parent/notifications') return unreadCount;
    return 0;
  };

  return (
    <>
      {showMore && (
        <>
          <div
            className="fixed inset-0 z-[60] bg-black/30"
            onClick={() => setShowMore(false)}
            role="presentation"
            aria-hidden="true"
          />
          <div
            ref={moreSheetRef}
            role="dialog"
            aria-label={isHi ? 'अधिक नेविगेशन विकल्प' : 'More navigation options'}
            className="fixed bottom-0 left-0 right-0 z-[70] rounded-t-3xl"
            style={{
              background: 'var(--surface-1)',
              paddingBottom: 'env(safe-area-inset-bottom, 16px)',
              boxShadow: '0 -8px 40px rgba(0,0,0,0.12)',
            }}
          >
            {/* Handle bar */}
            <div className="flex justify-center pt-3 pb-2">
              <div
                className="w-10 h-1 rounded-full"
                style={{ background: 'var(--border-mid, #ccc)' }}
              />
            </div>
            <div className="px-5 pb-4 space-y-1">
              {MORE_ITEMS.map(item => {
                // Link-code mode: hide billing, profile, notifications in More too.
                if (mode === 'link-code') {
                  if (item.href === '/parent/billing') return null;
                  if (item.href === '/parent/profile') return null;
                  if (item.href === '/parent/notifications') return null;
                }
                const active = isActive(item.href);
                const badgeCount = getMoreBadgeCount(item);
                return (
                  <button
                    key={item.href}
                    type="button"
                    onClick={() => {
                      setShowMore(false);
                      router.push(withParentChildId(item.href, childId));
                    }}
                    className="w-full flex items-center gap-4 px-4 py-3.5 rounded-2xl text-left transition-all active:scale-[0.98]"
                    style={{
                      background: active ? 'rgba(249, 115, 22, 0.08)' : 'transparent',
                      color: active ? '#E8581C' : 'var(--text-2)',
                    }}
                  >
                    <span className="text-xl w-7 text-center" aria-hidden="true">{item.icon}</span>
                    <span className="text-sm font-semibold">{isHi ? item.labelHi : item.label}</span>
                    {badgeCount > 0 && (
                      <span
                        className="ml-auto min-w-[18px] h-[18px] rounded-full flex items-center justify-center text-[9px] font-bold text-white px-1"
                        style={{ background: '#E8581C' }}
                      >
                        {badgeCount > 99 ? '99+' : badgeCount}
                      </span>
                    )}
                    {active && badgeCount === 0 && (
                      <span
                        className="ml-auto w-1.5 h-1.5 rounded-full"
                        style={{ background: '#E8581C' }}
                      />
                    )}
                  </button>
                );
              })}
              {/* Logout at bottom of More sheet */}
              <div className="pt-3 mt-2" style={{ borderTop: '1px solid var(--border)' }}>
                <button
                  type="button"
                  onClick={() => { setShowMore(false); onLogout(); }}
                  className="w-full flex items-center gap-4 px-4 py-3.5 rounded-2xl text-left transition-all active:scale-[0.98]"
                  style={{ color: 'var(--text-3)' }}
                >
                  <span className="text-xl w-7 text-center" aria-hidden="true">🚪</span>
                  <span className="text-sm font-semibold">{isHi ? 'लॉगआउट' : 'Logout'}</span>
                </button>
              </div>
            </div>
          </div>
        </>
      )}

      <nav
        className="bottom-nav-mobile fixed bottom-0 left-0 right-0 z-50"
        aria-label={isHi ? 'मुख्य नेविगेशन' : 'Main navigation'}
        role="navigation"
        data-scroll-hidden={navHidden ? 'true' : 'false'}
        style={{ paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}
      >
        <div className="flex items-end justify-around px-2 pt-2 pb-1">
          {visibleTabs.map(tab => {
            const active = isActive(tab.href, tab.exact);
            const badgeCount = getBadgeCount(tab);
            return (
              <button
                key={tab.href}
                type="button"
                onClick={() => router.push(withParentChildId(tab.href, childId))}
                aria-label={isHi ? tab.labelHi : tab.label}
                aria-current={active ? 'page' : undefined}
                className="flex flex-col items-center gap-0.5 py-1.5 px-2 bg-transparent border-0 min-w-[44px] min-h-[44px] justify-center"
                style={{ color: active ? '#E8581C' : 'var(--ink-3, #64748b)' }}
              >
                <span
                  className="relative inline-block"
                  style={{
                    fontSize: 22,
                    lineHeight: 1,
                    transform: active ? 'translateY(-1px) scale(1.06)' : 'scale(1)',
                    transition: 'transform 200ms cubic-bezier(.22,1,.36,1)',
                  }}
                  aria-hidden="true"
                >
                  {tab.icon}
                  {badgeCount > 0 && (
                    <span
                      className="absolute -top-1.5 -right-2.5 min-w-[16px] h-[16px] rounded-full flex items-center justify-center text-[9px] font-bold text-white px-0.5"
                      style={{ background: '#DC2626', border: '1.5px solid var(--bg)' }}
                    >
                      {badgeCount > 9 ? '9+' : badgeCount}
                    </span>
                  )}
                </span>
                <span
                  className="tracking-wide"
                  style={{
                    fontSize: 'var(--text-2xs, 10px)',
                    fontWeight: active ? 700 : 600,
                    letterSpacing: '0.02em',
                  }}
                >
                  {isHi ? tab.labelHi : tab.label}
                </span>
              </button>
            );
          })}

          {/* More button */}
          <button
            type="button"
            onClick={() => setShowMore(!showMore)}
            aria-label={isHi ? 'अधिक विकल्प' : 'More options'}
            aria-expanded={showMore}
            className="flex flex-col items-center gap-0.5 py-1.5 px-2 bg-transparent border-0 min-w-[44px] min-h-[44px] justify-center"
            style={{ color: isMoreActive ? '#E8581C' : 'var(--ink-3, #64748b)' }}
          >
            <span aria-hidden="true" style={{ fontSize: 22, lineHeight: 1 }}>⋯</span>
            <span
              className="tracking-wide"
              style={{
                fontSize: 'var(--text-2xs, 10px)',
                fontWeight: isMoreActive ? 700 : 600,
                letterSpacing: '0.02em',
              }}
            >
              {isHi ? 'अधिक' : 'More'}
            </span>
          </button>
        </div>
      </nav>
    </>
  );
}
