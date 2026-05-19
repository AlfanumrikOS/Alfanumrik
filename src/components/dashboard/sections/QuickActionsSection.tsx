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

import QuickActions from '@/components/dashboard/QuickActions';
import { SectionHeader } from '@/components/ui';
import { trackDashboardCta } from '@/lib/posthog/dashboard-cta';

interface ShortcutTile {
  key: 'scan' | 'profile' | 'billing';
  href: string;
  icon: string;
  label: string;
  labelHi: string;
  color: string;
}

const SHORTCUTS: ShortcutTile[] = [
  { key: 'scan', href: '/scan', icon: '📷', label: 'Scan Question', labelHi: 'सवाल स्कैन', color: '#059669' },
  { key: 'profile', href: '/profile', icon: '👤', label: 'My Profile', labelHi: 'मेरी प्रोफ़ाइल', color: '#2563EB' },
  { key: 'billing', href: '/billing', icon: '💳', label: 'Plan & Billing', labelHi: 'प्लान और बिलिंग', color: '#7C3AED' },
];

interface QuickActionsSectionProps {
  isHi: boolean;
  router: { push: (path: string) => void };
  /** Optional foxy deep-link with subject+grade pre-fill (passed through). */
  foxyHref?: string;
}

export default function QuickActionsSection({
  isHi,
  router,
  foxyHref,
}: QuickActionsSectionProps) {
  return (
    <div className="space-y-4 pt-3">
      {/* Quick action tile grid (existing widget) */}
      <QuickActions isHi={isHi} foxyHref={foxyHref} />

      {/* Utility shortcut row */}
      <div>
        <SectionHeader icon="⚙️">{isHi ? 'अधिक' : 'More'}</SectionHeader>
        <div className="grid grid-cols-3 gap-2">
          {SHORTCUTS.map((s) => (
            <button
              key={s.key}
              onClick={() => {
                // PII-free: section/action/destination are closed enums.
                trackDashboardCta({
                  section: 'quick_actions',
                  action: `shortcut_${s.key}`,
                  destination: s.href,
                });
                router.push(s.href);
              }}
              /* min-h-[64px] + px-3 py-3.5: meets Apple HIG 44px touch target
                 with comfortable margin. Audit 2026-05-11 §0 F4. */
              className="flex flex-col items-center gap-2 px-3 py-3.5 rounded-xl transition-all active:scale-[0.97] min-h-[64px]"
              style={{
                /* Tile background uses inline-style color-with-alpha (s.color is
                   a per-tile semantic hex). Phase 0 bumped alpha to 1a (10%) for
                   light-mode visibility, but 10% over dark surface is nearly
                   imperceptible. Phase 1.5 (2026-05-11) raises to 33 (20%) /
                   77 (47%) so the tile reads in both themes. The fully-saturated
                   text color (rendered below) keeps semantic identity.
                   Trade-off: brighter tint in light mode is acceptable — perf-
                   score tiles already use comparable saturation. */
                background: `${s.color}33`,
                border: `1px solid ${s.color}77`,
              }}
            >
              <span className="text-2xl" aria-hidden="true">{s.icon}</span>
              <span
                className="text-[13px] font-semibold text-center leading-tight"
                style={{ color: s.color }}
              >
                {isHi ? s.labelHi : s.label}
              </span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
