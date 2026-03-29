'use client';

import { useRouter } from 'next/navigation';
import { SectionHeader, ActionTile } from '@/components/ui';

const QUICK_ACTIONS = [
  { href: '/quiz', icon: '⚡', label: 'Quiz', labelHi: 'क्विज़', color: '#7C3AED' },
  { href: '/review', icon: '🔄', label: 'Revise', labelHi: 'रिव्यू', color: '#0891B2' },
  { href: '/scan', icon: '📷', label: 'Scan', labelHi: 'स्कैन', color: '#0D9488' },
  { href: '/exams', icon: '📋', label: 'Exams', labelHi: 'परीक्षाएँ', color: '#DC2626' },
];

interface QuickActionsProps {
  isHi: boolean;
}

export default function QuickActions({ isHi }: QuickActionsProps) {
  const router = useRouter();

  return (
    <div>
      <SectionHeader icon="⚡">{isHi ? 'त्वरित क्रियाएँ' : 'Quick Actions'}</SectionHeader>
      <div className="grid grid-cols-4 gap-2">
        {QUICK_ACTIONS.map((a) => (
          <ActionTile
            key={a.href}
            icon={a.icon}
            label={isHi ? a.labelHi : a.label}
            color={a.color}
            onClick={() => router.push(a.href)}
          />
        ))}
      </div>
    </div>
  );
}
