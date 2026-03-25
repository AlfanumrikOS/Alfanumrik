'use client';

import { useRouter } from 'next/navigation';
import { SectionHeader, ActionTile } from '@/components/ui';

const QUICK_ACTIONS = [
  { href: '/foxy', icon: '🦊', label: 'Ask Foxy', labelHi: 'फॉक्सी से पूछो', color: '#E8581C' },
  { href: '/quiz?mode=cognitive', icon: '🧠', label: 'Smart Quiz', labelHi: 'स्मार्ट क्विज़', color: '#7C3AED' },
  { href: '/exams', icon: '📋', label: 'My Exams', labelHi: 'मेरी परीक्षाएँ', color: '#DC2626' },
  { href: '/quiz', icon: '⚡', label: 'Quick Quiz', labelHi: 'क्विज़', color: '#F5A623' },
  { href: '/review', icon: '🔄', label: 'Review', labelHi: 'रिव्यू', color: '#0891B2' },
  { href: '/scan', icon: '📷', label: 'Scan', labelHi: 'स्कैन', color: '#0D9488' },
  { href: '/study-plan', icon: '📅', label: 'Study Plan', labelHi: 'अध्ययन योजना', color: '#7C3AED' },
  { href: '/reports', icon: '📊', label: 'Reports', labelHi: 'रिपोर्ट', color: '#16A34A' },
  { href: '/leaderboard', icon: '🏆', label: 'Leaderboard', labelHi: 'लीडरबोर्ड', color: '#DB2777' },
];

interface QuickActionsProps {
  isHi: boolean;
}

export default function QuickActions({ isHi }: QuickActionsProps) {
  const router = useRouter();

  return (
    <div>
      <SectionHeader icon="⚡">{isHi ? 'त्वरित क्रियाएँ' : 'Quick Actions'}</SectionHeader>
      <div className="grid-actions">
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
