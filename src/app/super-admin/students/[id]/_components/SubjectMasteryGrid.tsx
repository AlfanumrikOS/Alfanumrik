'use client';

import { colors } from '../../../_components/admin-styles';

interface SubjectMasteryGridProps {
  mastery: Record<string, { topics: number; avgMastery: number }>;
}

export default function SubjectMasteryGrid({ mastery }: SubjectMasteryGridProps) {
  const entries = Object.entries(mastery).sort(
    ([, a], [, b]) => b.avgMastery - a.avgMastery
  );

  if (entries.length === 0) {
    return (
      <div style={{ padding: 16, color: colors.text3, fontSize: 13 }}>
        No mastery data available yet.
      </div>
    );
  }

  return (
    <div style={{ display: 'grid', gap: 10 }}>
      {entries.map(([subject, data]) => (
        <div
          key={subject}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 12,
          }}
        >
          <span
            style={{
              fontSize: 13,
              fontWeight: 600,
              color: colors.text1,
              width: 100,
              flexShrink: 0,
              textTransform: 'capitalize',
            }}
          >
            {subject}
          </span>
          <div
            style={{
              flex: 1,
              height: 8,
              background: colors.surface,
              borderRadius: 4,
              overflow: 'hidden',
              border: `1px solid ${colors.borderLight}`,
            }}
          >
            <div
              style={{
                height: '100%',
                width: `${Math.min(100, data.avgMastery)}%`,
                background: '#7C3AED',
                borderRadius: 4,
                transition: 'width 0.3s',
              }}
            />
          </div>
          <span
            style={{
              fontSize: 12,
              fontWeight: 600,
              color: colors.text1,
              width: 42,
              textAlign: 'right',
              flexShrink: 0,
            }}
          >
            {data.avgMastery}%
          </span>
          <span
            style={{
              fontSize: 11,
              color: colors.text3,
              width: 60,
              textAlign: 'right',
              flexShrink: 0,
            }}
          >
            {data.topics} topics
          </span>
        </div>
      ))}
    </div>
  );
}