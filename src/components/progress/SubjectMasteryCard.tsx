'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Card, MasteryRing, ProgressBar, Button } from '@/components/ui';
import { BLOOM_LEVELS, BLOOM_CONFIG } from '@/lib/cognitive-engine';
import type { BloomLevel } from '@/lib/types';
import type { StudentLearningProfile, Subject, LearningVelocity } from '@/lib/types';

/* ── Types ── */
interface SubjectMasteryCardProps {
  profile: StudentLearningProfile;
  subjectMeta: Subject | undefined;
  bloomData: Array<{ bloom_level: BloomLevel; mastery: number }>;
  velocity: LearningVelocity | undefined;
  isHi: boolean;
}

/* ── Inline Bloom Heatmap (kept for advanced view) ── */
function BloomHeatmap({ data, isHi }: { data: Array<{ bloom_level: BloomLevel; mastery: number }>; isHi: boolean }) {
  const masteryByLevel: Record<BloomLevel, number[]> = {
    remember: [], understand: [], apply: [], analyze: [], evaluate: [], create: [],
  };
  for (const row of data) {
    if (masteryByLevel[row.bloom_level]) {
      masteryByLevel[row.bloom_level].push(row.mastery ?? 0);
    }
  }

  return (
    <div className="space-y-2">
      <div className="flex gap-1 items-center w-full">
        {BLOOM_LEVELS.map((level) => {
          const values = masteryByLevel[level];
          const avg = values.length > 0 ? values.reduce((a, b) => a + b, 0) / values.length : 0;
          const cfg = BLOOM_CONFIG[level];
          const opacity = Math.max(0.1, avg);
          return (
            <div
              key={level}
              className="flex-1 rounded-sm relative group"
              style={{ height: 24, background: cfg.color, opacity, minWidth: 0 }}
              title={`${isHi ? cfg.labelHi : cfg.label}: ${Math.round(avg * 100)}%`}
            >
              <div className="absolute inset-0 flex items-center justify-center text-[9px] font-bold text-white opacity-0 group-hover:opacity-100 transition-opacity">
                {Math.round(avg * 100)}%
              </div>
            </div>
          );
        })}
      </div>
      {/* Legend */}
      <div className="flex flex-wrap gap-x-3 gap-y-1">
        {BLOOM_LEVELS.map((level) => {
          const cfg = BLOOM_CONFIG[level];
          return (
            <div key={level} className="flex items-center gap-1">
              <div className="w-2.5 h-2.5 rounded-sm" style={{ background: cfg.color }} />
              <span className="text-[10px] text-[var(--text-3)]">{isHi ? cfg.labelHi : cfg.label}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ── Velocity Sparkline (kept for advanced view) ── */
function VelocitySparkline({ datapoints }: { datapoints: Array<{ date: string; mastery: number }> }) {
  if (!datapoints || datapoints.length < 2) return <span className="text-[10px] text-[var(--text-3)]">---</span>;

  const sorted = [...datapoints].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
  const maxM = Math.max(...sorted.map((d) => d.mastery), 0.01);
  const width = 80;
  const height = 24;
  const step = width / (sorted.length - 1);
  const points = sorted.map((d, i) => `${i * step},${height - (d.mastery / maxM) * height}`).join(' ');

  return (
    <svg width={width} height={height} className="inline-block">
      <polyline
        points={points}
        fill="none"
        stroke="var(--teal)"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/* ── Mastery level classifier ── */
function classifyMastery(pct: number): 'mastered' | 'developing' | 'beginner' {
  if (pct >= 75) return 'mastered';
  if (pct >= 40) return 'developing';
  return 'beginner';
}

function getMasteryLabel(level: 'mastered' | 'developing' | 'beginner', isHi: boolean): string {
  const labels = {
    mastered: isHi ? 'मास्टर किया' : 'Mastered',
    developing: isHi ? 'अभी सीख रहे' : 'Developing',
    beginner: isHi ? 'मेहनत चाहिए' : 'Beginner',
  };
  return labels[level];
}

function getMasteryColor(level: 'mastered' | 'developing' | 'beginner'): string {
  const colors = {
    mastered: 'var(--mastery-high)',
    developing: 'var(--mastery-mid)',
    beginner: 'var(--mastery-low)',
  };
  return colors[level];
}

/* ── Component ── */
export default function SubjectMasteryCard({
  profile,
  subjectMeta,
  bloomData,
  velocity,
  isHi,
}: SubjectMasteryCardProps) {
  const router = useRouter();
  const [showAdvanced, setShowAdvanced] = useState(false);

  const correctPct = profile.total_questions_asked > 0
    ? Math.round((profile.total_questions_answered_correctly / profile.total_questions_asked) * 100)
    : 0;

  const masteryLevel = classifyMastery(correctPct);
  const subjectCode = profile.subject;
  const icon = subjectMeta?.icon ?? '📚';
  const name = subjectMeta?.name ?? profile.subject;
  const color = subjectMeta?.color ?? 'var(--orange)';

  // Derive topic-level insights from bloom data
  // Group bloom data: high mastery topics are "strong", low are "needs work"
  const bloomByLevel = BLOOM_LEVELS.reduce((acc, level) => {
    const items = bloomData.filter(b => b.bloom_level === level);
    const avg = items.length > 0 ? items.reduce((s, i) => s + i.mastery, 0) / items.length : 0;
    acc[level] = avg;
    return acc;
  }, {} as Record<string, number>);

  const strongLevels = BLOOM_LEVELS.filter(l => bloomByLevel[l] >= 0.7);
  const weakLevels = BLOOM_LEVELS.filter(l => bloomByLevel[l] > 0 && bloomByLevel[l] < 0.4);

  // Velocity data for sparkline
  const velocityHistory = velocity?.velocity_history as Record<string, number> | null;
  const sparklineData = velocityHistory
    ? Object.entries(velocityHistory).map(([date, mastery]) => ({ date, mastery: Number(mastery) }))
    : [];

  return (
    <Card className="!p-4">
      {/* Header row */}
      <div className="flex items-center gap-3">
        <MasteryRing value={correctPct} size={52} strokeWidth={4} color={color}>
          <span className="text-lg">{icon}</span>
        </MasteryRing>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-bold truncate">{name}</h3>
            <span
              className="text-xs font-semibold"
              style={{ color }}
            >
              {correctPct}%
            </span>
          </div>
          <ProgressBar value={correctPct} color={color} height={5} />
        </div>
      </div>

      {/* Mastery summary */}
      <div className="mt-3 space-y-1.5">
        {strongLevels.length > 0 && (
          <div className="flex items-start gap-2 text-xs">
            <span className="shrink-0 font-semibold" style={{ color: 'var(--mastery-high)' }}>
              {isHi ? 'मज़बूत:' : 'Strong:'}
            </span>
            <span className="text-[var(--text-2)]">
              {strongLevels.map(l => isHi ? BLOOM_CONFIG[l].labelHi : BLOOM_CONFIG[l].label).join(', ')}
            </span>
          </div>
        )}
        {weakLevels.length > 0 && (
          <div className="flex items-start gap-2 text-xs">
            <span className="shrink-0 font-semibold" style={{ color: 'var(--mastery-low)' }}>
              {isHi ? 'मेहनत चाहिए:' : 'Needs work:'}
            </span>
            <span className="text-[var(--text-2)]">
              {weakLevels.map(l => isHi ? BLOOM_CONFIG[l].labelHi : BLOOM_CONFIG[l].label).join(', ')}
            </span>
          </div>
        )}
        {strongLevels.length === 0 && weakLevels.length === 0 && (
          <p className="text-xs text-[var(--text-3)]">
            Lv{profile.level} · {profile.xp} XP · {profile.total_sessions} {isHi ? 'सत्र' : 'sessions'}
          </p>
        )}
      </div>

      {/* CTA */}
      <div className="mt-3 flex gap-2">
        <Button
          variant="soft"
          size="sm"
          color={color}
          onClick={() => router.push(`/quiz?subject=${encodeURIComponent(subjectCode)}`)}
          className="flex-1"
        >
          {isHi ? 'कमज़ोर क्षेत्रों का अभ्यास करो' : 'Practice Weak Areas'}
        </Button>
        <button
          onClick={() => setShowAdvanced(!showAdvanced)}
          className="text-[10px] font-semibold px-2 py-1 rounded-lg transition-colors"
          style={{
            background: showAdvanced ? 'var(--surface-3, var(--surface-2))' : 'var(--surface-2)',
            color: 'var(--text-3)',
          }}
        >
          {showAdvanced
            ? (isHi ? 'सरल' : 'Simple')
            : (isHi ? 'विस्तार' : 'Advanced')
          }
        </button>
      </div>

      {/* Advanced: Bloom Heatmap + Velocity Sparkline */}
      {showAdvanced && (
        <div className="mt-3 pt-3 space-y-3" style={{ borderTop: '1px solid var(--border)' }}>
          {bloomData.length > 0 && (
            <div>
              <p className="text-[10px] font-semibold text-[var(--text-3)] uppercase tracking-wider mb-1.5">
                {isHi ? "Bloom's विश्लेषण" : "Bloom's Analysis"}
              </p>
              <BloomHeatmap data={bloomData} isHi={isHi} />
            </div>
          )}
          {sparklineData.length >= 2 && (
            <div className="flex items-center gap-3">
              <p className="text-[10px] font-semibold text-[var(--text-3)] uppercase tracking-wider">
                {isHi ? 'सीखने की गति' : 'Velocity'}
              </p>
              <VelocitySparkline datapoints={sparklineData} />
              {velocity?.weekly_mastery_rate != null && (
                <span className="text-[10px] font-bold" style={{ color: 'var(--teal)' }}>
                  {Math.round((velocity.weekly_mastery_rate ?? 0) * 100)}%/wk
                </span>
              )}
            </div>
          )}
          <p className="text-[10px] text-[var(--text-3)]">
            {profile.total_sessions} {isHi ? 'सत्र' : 'sessions'} · {profile.total_time_minutes}m {isHi ? 'पढ़ाई' : 'study time'} · Lv{profile.level}
          </p>
        </div>
      )}
    </Card>
  );
}
