'use client';

import { useEffect, useMemo, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { useAuth } from '@alfanumrik/lib/AuthContext';
import { ROLE_CONFIG } from '@alfanumrik/lib/constants';
import { supabase } from '@alfanumrik/lib/supabase';
import { useFeatureFlags } from '@alfanumrik/lib/swr';
import RoleBottomNav from './RoleBottomNav';
import {
  ROLE_NAV_CONFIGS,
  RoleNavIcon,
  visibleRoleNavItems,
  type RoleNavItem,
} from './role-nav';

export function MobileBottomNav() {
  const pathname = usePathname();
  const router = useRouter();
  const auth = useAuth();
  const isHi = auth?.isHi ?? false;
  const { roles, activeRole, setActiveRole } = auth;
  const { data: navFlags } = useFeatureFlags();
  const [hasUpcomingExam, setHasUpcomingExam] = useState(false);

  const student = auth.student;
  useEffect(() => {
    const studentId = student?.id;
    if (!studentId) return;
    let cancelled = false;
    supabase
      .from('student_exams')
      .select('id')
      .eq('student_id', studentId)
      .gte('exam_date', new Date().toISOString())
      .limit(1)
      .then(({ data }) => {
        if (!cancelled) setHasUpcomingExam((data?.length ?? 0) > 0);
      });
    return () => {
      cancelled = true;
    };
  }, [student?.id]);

  const subscriptionPlan = student?.subscription_plan ?? null;
  const showUpgradePill = activeRole === 'student' && (subscriptionPlan === null || subscriptionPlan === 'free');
  const hasMultipleRoles = roles.length > 1;

  const items = useMemo<RoleNavItem[]>(() => {
    if (activeRole !== 'student') {
      return [];
    }
    return visibleRoleNavItems(ROLE_NAV_CONFIGS.student.items, { flags: navFlags }).filter((item) => {
      if (item.href === '/exam-prep' && !hasUpcomingExam) return false;
      return true;
    });
  }, [activeRole, hasUpcomingExam, navFlags]);

  const handleNavigate = (href: string) => {
    if (href === '/foxy') window.location.href = '/foxy';
    else router.push(href);
  };

  const handleRoleSwitch = (role: typeof activeRole) => {
    setActiveRole(role);
    const config = ROLE_CONFIG[role];
    if (config?.homePath) {
      router.push(config.homePath);
    }
  };

  const moreContent = (
    <>
      {showUpgradePill && (
        <div className="role-bottom-nav__sheet-footer">
          <a
            href="/pricing"
            onClick={() => {
              if (typeof window !== 'undefined') {
                try {
                  window.dispatchEvent(new CustomEvent('alfanumrik:upgrade-cta-click', {
                    detail: { source: 'nav_more_sheet', variant: 'pill', timestamp: Date.now() },
                  }));
                } catch {
                  /* non-blocking */
                }
              }
            }}
            className="flex min-h-[48px] items-center gap-3 rounded-xl border px-3 py-2.5 no-underline"
            style={{
              borderColor: 'rgb(var(--accent-warm-rgb) / 0.24)',
              background: 'rgb(var(--accent-warm-rgb) / 0.08)',
            }}
          >
            <span className="inline-flex h-8 w-8 items-center justify-center rounded-lg" style={{ color: 'var(--primary)' }} aria-hidden="true">
              <RoleNavIcon iconKey="billing" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-bold" style={{ color: 'var(--text-1)' }}>
                {isHi ? 'प्रीमियम पर अपग्रेड करें' : 'Upgrade to Premium'}
              </span>
              <span className="block text-[11px]" style={{ color: 'var(--text-3)' }}>
                {isHi ? 'और चैट, अनलिमिटेड क्विज़' : 'More chats, unlimited quizzes'}
              </span>
            </span>
          </a>
        </div>
      )}

      {hasMultipleRoles && (
        <div className="role-bottom-nav__sheet-footer">
          <p className="px-3 pb-1 text-[11px] font-bold uppercase" style={{ color: 'var(--text-3)' }}>
            {isHi ? 'भूमिका बदलें' : 'Switch role'}
          </p>
          {roles.filter((role) => role !== 'none').map((role) => {
            const cfg = ROLE_CONFIG[role];
            const isCurrent = role === activeRole;
            return (
              <button
                key={role}
                type="button"
                onClick={() => handleRoleSwitch(role)}
                className="role-bottom-nav__more-row"
                data-active={isCurrent ? 'true' : 'false'}
              >
                <span className="role-bottom-nav__more-icon" aria-hidden="true">
                  <RoleNavIcon iconKey={role === 'guardian' ? 'home' : role === 'teacher' ? 'class' : role === 'institution_admin' ? 'health' : 'profile'} />
                </span>
                <span className="role-bottom-nav__more-label">{isHi ? cfg.labelHi : cfg.label}</span>
                {isCurrent && (
                  <span className="rounded-full px-2 py-0.5 text-[11px] font-bold" style={{ background: 'var(--surface-2)', color: 'var(--primary)' }}>
                    {isHi ? 'सक्रिय' : 'Active'}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      )}
    </>
  );

  if (activeRole !== 'student') return null;

  return (
    <RoleBottomNav
      config={ROLE_NAV_CONFIGS.student}
      items={items}
      isHi={isHi}
      pathname={pathname}
      onNavigate={handleNavigate}
      moreContent={moreContent}
      maxVisible={5}
      reserveMoreSlot={false}
    />
  );
}
