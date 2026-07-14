'use client';

/**
 * QuickActionsSection — collapsed below-fold accordion content.
 *
 * Houses utility shortcuts that don't belong above-the-fold:
 *   - QuickActions tile grid (quiz / chapters / Foxy / revise / exams / scan)
 *   - Inline shortcut row for Scan, Profile, Billing
 *
 * Lazy-loaded via next/dynamic from page.tsx — only mounts when the user
 * expands the "Quick actions" accordion. Keeps the icon grid out of the
 * first-paint bundle.
 *
 * Owned by frontend. Composed of existing widgets — no new business logic.
 */

import { useRouter } from 'next/navigation';
import { trackDashboardCta } from '@alfanumrik/lib/posthog/dashboard-cta';

// Unified shortcut config — used to be split between QuickActions
// (six core actions) and the "more" row (three extras). The visible
// redesign merges them into a single dashboard-tile-grid that goes
// 2×3 on phone → 3×2 on tablet → 6×1 on desktop.
interface Tile {
  key: string;
  href: string;
  icon: string;
  label: string;
  labelHi: string;
  color: string;
}

const PRIMARY_TILES: Tile[] = [
  { key: 'quiz',    href: '/quiz',    icon: '⚡', label: 'Quiz',     labelHi: 'क्विज़',           color: '#E8581C' },
  { key: 'learn',   href: '/learn',   icon: '📖', label: 'Chapters', labelHi: 'अध्याय',           color: '#2563EB' },
  { key: 'foxy',    href: '/foxy',    icon: '🦊', label: 'Ask Foxy', labelHi: 'फॉक्सी से पूछो',   color: '#7C3AED' },
  { key: 'review',  href: '/review',  icon: '🔄', label: 'Revise',   labelHi: 'रिव्यू',           color: '#0D9488' },
  { key: 'exams',   href: '/exams',   icon: '📋', label: 'Exams',    labelHi: 'परीक्षाएँ',         color: '#DC2626' },
  { key: 'scan',    href: '/scan',    icon: '📷', label: 'Scan',     labelHi: 'स्कैन',             color: '#059669' },
];

const SECONDARY_TILES: Tile[] = [
  { key: 'profile', href: '/profile', icon: '👤', label: 'Profile', labelHi: 'प्रोफ़ाइल', color: '#2563EB' },
  { key: 'billing', href: '/billing', icon: '💳', label: 'Billing', labelHi: 'बिलिंग',     color: '#7C3AED' },
];

interface QuickActionsSectionProps {
  isHi: boolean;
  router: { push: (path: string) => void };
  /** Optional foxy deep-link with subject+grade pre-fill (passed through). */
  foxyHref?: string;
}

export default function QuickActionsSection({
  isHi,
  router: routerProp,
  foxyHref,
}: QuickActionsSectionProps) {
  // Fall back to the local router if the parent didn't pass one (legacy
  // test harnesses sometimes call this section in isolation).
  const fallbackRouter = useRouter();
  const router = routerProp ?? fallbackRouter;

  const renderTile = (t: Tile, source: 'primary' | 'secondary') => {
    const href = t.key === 'foxy' && foxyHref ? foxyHref : t.href;
    return (
      <button
        key={t.key}
        type="button"
        onClick={() => {
          trackDashboardCta({
            section: 'quick_actions',
            action: `shortcut_${t.key}`,
            destination: href,
          });
          router.push(href);
        }}
        className="dashboard-tile"
        style={{
          // Soft tinted background per tile + matching accent border —
          // keeps semantic color identity from the legacy palette while
          // sitting on the new editorial paper surface.
          background: `linear-gradient(135deg, ${t.color}10, var(--paper))`,
          borderColor: `${t.color}30`,
        }}
        aria-label={isHi ? t.labelHi : t.label}
        data-source={source}
      >
        <span
          className="dashboard-tile__icon"
          aria-hidden="true"
          style={{ color: t.color }}
        >
          {t.icon}
        </span>
        <span className="dashboard-tile__label" style={{ color: t.color }}>
          {isHi ? t.labelHi : t.label}
        </span>
      </button>
    );
  };

  return (
    <div className="space-y-5 pt-1">
      {/* Primary tile grid — 2×3 phone, 3×2 tablet, 6×1 desktop. The
          ONE thing the eye lands on when this accordion opens. */}
      <div
        className="dashboard-tile-grid"
        role="navigation"
        aria-label={isHi ? 'त्वरित क्रियाएँ' : 'Quick actions'}
      >
        {PRIMARY_TILES.map((t) => renderTile(t, 'primary'))}
      </div>

      {/* Secondary row — Profile / Billing. Smaller emphasis. */}
      <div>
        <p
          className="editorial-eyebrow mb-2"
          style={{ paddingLeft: 2 }}
        >
          {isHi ? 'खाता' : 'Account'}
        </p>
        <div className="dashboard-tile-grid">
          {SECONDARY_TILES.map((t) => renderTile(t, 'secondary'))}
        </div>
      </div>
    </div>
  );
}
