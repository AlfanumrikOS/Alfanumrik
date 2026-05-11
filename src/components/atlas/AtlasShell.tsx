/**
 * AtlasShell — the unified chrome wrapper for Editorial Atlas surfaces.
 *
 * Three layout variants matching the prototype:
 *   1. `student`  — narrow editorial column, mobile-first, no left rail.
 *                   Uses the existing BottomNav from `@/components/ui`.
 *   2. `rail`     — slim left sidebar (200px) + main stage. Used by
 *                   parent + school. Becomes a top bar on mobile.
 *   3. `classroom`— full-bleed for the teacher heatmap (control-tower view).
 *
 * The shell renders the cream canvas + paper-noise overlay automatically;
 * never set background on a child surface. The brand header is sticky and
 * shared across all three variants so the chrome reads as ONE product
 * regardless of role.
 *
 * NOT covered by this primitive (intentionally):
 *   - Bilingual toggles, profile pickers, plan badges — those live in the
 *     existing `<DashboardSidebar>` / `<BottomNav>` and stay there.
 *   - Per-role nav links — passed in via `nav` prop.
 */

'use client';

import type { ReactNode } from 'react';
import { clsx } from 'clsx';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useAuth } from '@/lib/AuthContext';
import { AtlasIcon, type AtlasIconName } from './AtlasIcon';

export interface AtlasShellNavItem {
  href: string;
  label: string;
  labelHi?: string;
  icon?: AtlasIconName;
  /** Optional small dot for unread/active state. */
  badge?: number | boolean;
  /** Group heading rendered above this item in the rail. */
  group?: string;
}

export interface AtlasShellProps {
  variant: 'student' | 'rail' | 'classroom';
  /** Greeting line shown in the chrome (e.g. "Aanya · Class 7"). */
  greeting?: string;
  /** Secondary metadata line under the greeting. */
  meta?: string;
  /** Items rendered in the left rail (rail variant only). */
  nav?: AtlasShellNavItem[];
  /** Right-side actions shown in the chrome (lang toggle, sign out etc). */
  actions?: ReactNode;
  /** Page content. */
  children: ReactNode;
  /** Optional max-width override; default depends on variant. */
  maxWidth?: number | string;
  /** Optional extra class for the main `<main>` wrapper. */
  contentClassName?: string;
}

/**
 * Responsive max-widths per variant. The "student" variant is mobile-first
 * but we let it stretch to 1240 on wide desktops so the layout doesn't pool
 * in a 720px column on a 1920px monitor. The 7/5 grid inside AtlasDashboard
 * fills that space with mission + atlas on the left, rhythm + wins on the
 * right.
 *
 * Rail (parent / school): 1280px is the editorial breakpoint where the
 * three drilldown cards stop feeling crowded. Wider than that and the
 * verdict line starts looking lost in negative space, so we cap there.
 *
 * Classroom (teacher): 1440px to give the heatmap room without forcing
 * horizontal scroll on 1366px laptops.
 */
const VARIANT_MAX_WIDTH: Record<AtlasShellProps['variant'], number> = {
  student:   1240,
  rail:      1280,
  classroom: 1440,
};

export function AtlasShell({
  variant,
  greeting,
  meta,
  nav,
  actions,
  children,
  maxWidth,
  contentClassName,
}: AtlasShellProps) {
  const { isHi } = useAuth();
  const pathname = usePathname();
  const router = useRouter();

  const resolvedMaxWidth = maxWidth ?? VARIANT_MAX_WIDTH[variant];

  return (
    <div className="atlas-canvas">
      {/* ─── Sticky brand chrome ─── */}
      <header
        className="atlas-stage"
        style={{
          position: 'sticky',
          top: 0,
          zIndex: 50,
          background: 'rgba(251, 248, 244, 0.86)',
          backdropFilter: 'saturate(140%) blur(14px)',
          WebkitBackdropFilter: 'saturate(140%) blur(14px)',
          borderBottom: '1px solid var(--line)',
        }}
      >
        <div
          style={{
            maxWidth: resolvedMaxWidth,
            margin: '0 auto',
            padding: '14px 24px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 20,
          }}
        >
          {/* Wordmark + role tag */}
          <Link
            href="/"
            aria-label="Alfanumrik home"
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              fontFamily: 'var(--font-serif)',
              fontWeight: 600,
              fontSize: 22,
              letterSpacing: '-0.01em',
              color: 'var(--ink)',
              textDecoration: 'none',
            }}
          >
            <span
              aria-hidden="true"
              style={{
                width: 9,
                height: 9,
                borderRadius: '50%',
                background: 'var(--accent)',
                boxShadow: '0 0 0 4px var(--accent-soft)',
              }}
            />
            Alfanumrik
            {(greeting || meta) && (
              <small
                style={{
                  fontFamily: 'var(--font-display)',
                  fontWeight: 500,
                  fontSize: 11,
                  textTransform: 'uppercase',
                  letterSpacing: '0.16em',
                  color: 'var(--ink-3)',
                  marginLeft: 6,
                  paddingLeft: 12,
                  borderLeft: '1px solid var(--line-mid)',
                }}
              >
                {greeting}
              </small>
            )}
          </Link>

          {/* Action slot */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            {actions}
          </div>
        </div>
        {meta && (
          <div
            style={{
              maxWidth: resolvedMaxWidth,
              margin: '0 auto',
              padding: '0 24px 12px',
              fontFamily: 'var(--font-display)',
              fontSize: 12,
              color: 'var(--ink-3)',
            }}
          >
            {meta}
          </div>
        )}
      </header>

      {/* ─── Stage ───
          The `atlas-rise` entrance animation was removed on 2026-05-11.
          It re-fired on every page mount (opacity 0→1 + translateY 10→0
          over 420ms), which combined with the data-cascade re-renders
          inside the dashboard made the screen look like it was
          "flickering" on every navigation. The brand chrome above is
          sticky and stable; the stage now paints in place. No animation
          between mount and data arrival. */}
      <div
        className="atlas-stage"
        style={{
          maxWidth: resolvedMaxWidth,
          margin: '0 auto',
          padding: variant === 'student' ? '20px 16px 96px' : '32px 24px 64px',
        }}
      >
        {variant === 'rail' && nav && nav.length > 0 ? (
          <div
            className={clsx('atlas-rail-frame', contentClassName)}
            style={{
              display: 'grid',
              gridTemplateColumns: 'minmax(200px, 220px) 1fr',
              gap: 32,
              alignItems: 'start',
            }}
          >
            <aside aria-label="Section navigation" style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              {renderRail(nav, pathname || '', router, isHi)}
            </aside>
            <main className={contentClassName} style={{ minWidth: 0 }}>
              {children}
            </main>
          </div>
        ) : (
          <main className={contentClassName}>{children}</main>
        )}
      </div>

      {/* Responsive: stack the rail on mobile. Plain <style> rather than
          styled-jsx so the rule lives in the cascade and doesn't depend
          on the styled-jsx types (which aren't part of this project's
          build chain). */}
      <style
        dangerouslySetInnerHTML={{
          __html: `@media (max-width: 880px){.atlas-rail-frame{grid-template-columns:1fr !important;}}`,
        }}
      />
    </div>
  );
}

function renderRail(
  nav: AtlasShellNavItem[],
  pathname: string,
  router: ReturnType<typeof useRouter>,
  isHi: boolean,
) {
  let lastGroup: string | undefined;
  return nav.map((item, idx) => {
    const showGroup = item.group && item.group !== lastGroup;
    if (item.group) lastGroup = item.group;
    const isActive = pathname === item.href || pathname.startsWith(item.href + '/');
    return (
      <span key={item.href + idx}>
        {showGroup && (
          <div
            style={{
              fontFamily: 'var(--font-display)',
              fontSize: 10,
              letterSpacing: '0.2em',
              textTransform: 'uppercase',
              color: 'var(--ink-4)',
              padding: '18px 12px 6px',
            }}
          >
            {item.group}
          </div>
        )}
        <button
          onClick={() => router.push(item.href)}
          aria-current={isActive ? 'page' : undefined}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            padding: '9px 12px',
            borderRadius: 10,
            fontFamily: 'var(--font-display)',
            fontWeight: 500,
            fontSize: 13,
            color: isActive ? 'var(--ink)' : 'var(--ink-2)',
            background: isActive ? 'var(--paper)' : 'transparent',
            boxShadow: isActive ? 'var(--shadow-atlas-1)' : 'none',
            border: 0,
            cursor: 'pointer',
            textAlign: 'left',
            width: '100%',
          }}
        >
          {item.icon && (
            <AtlasIcon name={item.icon} size={16} style={{ color: 'var(--ink-3)' }} />
          )}
          <span style={{ flex: 1 }}>{isHi && item.labelHi ? item.labelHi : item.label}</span>
          {item.badge && (
            <span
              aria-hidden="true"
              style={{
                width: 6,
                height: 6,
                borderRadius: '50%',
                background: 'var(--accent)',
              }}
            />
          )}
        </button>
      </span>
    );
  });
}

export default AtlasShell;
