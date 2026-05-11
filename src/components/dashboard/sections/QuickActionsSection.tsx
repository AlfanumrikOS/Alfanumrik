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
              onClick={() => router.push(s.href)}
              /* min-h-[64px] + px-3 py-3.5: meets Apple HIG 44px touch target
                 with comfortable margin. Audit 2026-05-11 §0 F4. */
              className="flex flex-col items-center gap-2 px-3 py-3.5 rounded-xl transition-all active:scale-[0.97] min-h-[64px]"
              style={{
                /* Tile background was ${s.color}10 (6% alpha) — invisible on
                   cream bg. Bumped to 1a (10%) for tile presence; border
                   raised from 25 to 55 (33%) so the edge is clearly defined.
                   Audit 2026-05-11 §0 F4. */
                background: `${s.color}1a`,
                border: `1px solid ${s.color}55`,
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
