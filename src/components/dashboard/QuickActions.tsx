'use client';

import { useRouter } from 'next/navigation';
import { SectionHeader, ActionTile } from '@/components/ui';

// `key` is used as the React list key (stable across foxyHref changes); `href`
// is computed at render time so the dashboard can override the Foxy entry URL
// with subject+grade pre-fill (Phase 1.2).
const QUICK_ACTIONS: Array<{
  key: string;
  href: string;
  icon: string;
  label: string;
  labelHi: string;
  color: string;
}> = [
  { key: 'quiz',   href: '/quiz',   icon: '⚡', label: 'Quiz',     labelHi: 'क्विज़',           color: '#F97316' },
  { key: 'learn',  href: '/learn',  icon: '📖', label: 'Chapters', labelHi: 'अध्याय',           color: '#2563EB' },
  { key: 'foxy',   href: '/foxy',   icon: '🦊', label: 'Ask Foxy', labelHi: 'फॉक्सी से पूछो',   color: '#7C3AED' },
  { key: 'review', href: '/review', icon: '🔄', label: 'Revise',   labelHi: 'रिव्यू',           color: '#0D9488' },
  { key: 'exams',  href: '/exams',  icon: '📋', label: 'Exams',    labelHi: 'परीक्षाएँ',         color: '#DC2626' },
  { key: 'scan',   href: '/scan',   icon: '📷', label: 'Scan',     labelHi: 'स्कैन',             color: '#059669' },
];

interface QuickActionsProps {
  isHi: boolean;
  /**
   * Optional override for the Foxy tile's href. The dashboard passes a URL with
   * `?subject=...&grade=...&source=dashboard` so the student doesn't have to
   * pick a subject before sending their first message. Falls back to plain
   * `/foxy` when the dashboard has no preferred/allowed subject to suggest.
   */
  foxyHref?: string;
}

export default function QuickActions({ isHi, foxyHref }: QuickActionsProps) {
  const router = useRouter();

  return (
    <nav aria-label={isHi ? 'शॉर्टकट' : 'Shortcuts'}>
      <SectionHeader icon="🔗">{isHi ? 'शॉर्टकट' : 'Shortcuts'}</SectionHeader>
      <div className="grid grid-cols-3 gap-2">
        {QUICK_ACTIONS.map((a) => {
          const href = a.key === 'foxy' && foxyHref ? foxyHref : a.href;
          return (
            <ActionTile
              key={a.key}
              icon={a.icon}
              label={isHi ? a.labelHi : a.label}
              color={a.color}
              onClick={() => router.push(href)}
            />
          );
        })}
      </div>
    </nav>
  );
}
