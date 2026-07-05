'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  Card,
  Badge,
  Button,
  MasteryRing,
  ProgressBar,
  type Tone,
} from '@/components/ui/primitives';
import { BLOOM_LEVELS, BLOOM_CONFIG } from '@/lib/cognitive-engine';
import { calculateScorePercent } from '@/lib/scoring';
import {
  bandForValue,
  bandLabelForValue,
  MASTERY_BAND_LABELS,
  type MasteryBand,
} from '@/lib/dashboard/mastery-band-labels';
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

/* Mastery band → primitive Tone + non-colour backup glyph (deuteranopia-safe:
   the number + Bloom label + this glyph carry the meaning; colour only
   accelerates). */
const BAND_TONE: Record<MasteryBand, Tone> = { high: 'success', mid: 'warning', low: 'danger' };
const BAND_GLYPH: Record<MasteryBand, string> = { high: '●', mid: '◐', low: '▲' };
const BAND_VAR: Record<MasteryBand, string> = {
  high: 'var(--mastery-high)',
  mid: 'var(--mastery-mid)',
  low: 'var(--mastery-low)',
};

/* ── Bloom Mastery grid (Phase 0 fix) ──
   Mastery is shown as an ALWAYS-VISIBLE number + Bloom label + non-colour band
   glyph + a determinate bar — never opacity-encoded and never hover-only. Fully
   touch-accessible and glanceable (WCAG 1.4.1). The underlying per-level data is
   unchanged. */
function BloomMasteryGrid({ data, isHi }: { data: Array<{ bloom_level: BloomLevel; mastery: number }>; isHi: boolean }) {
  const masteryByLevel: Record<BloomLevel, number[]> = {
    remember: [], understand: [], apply: [], analyze: [], evaluate: [], create: [],
  };
  for (const row of data) {
    if (masteryByLevel[row.bloom_level]) masteryByLevel[row.bloom_level].push(row.mastery ?? 0);
  }

  return (
    <div className="grid grid-cols-3 gap-2">
      {BLOOM_LEVELS.map((level) => {
        const values = masteryByLevel[level];
        const avg = values.length > 0 ? values.reduce((a, b) => a + b, 0) / values.length : 0;
        const pct = Math.round(avg * 100);
        const band = bandForValue(pct);
        const cfg = BLOOM_CONFIG[level];
        const label = isHi ? cfg.labelHi : cfg.label;
        return (
          <div key={level} className="min-w-0 rounded-lg border border-surface-3 bg-surface-1 p-2">
            <div className="truncate text-fluid-2xs font-semibold text-muted-foreground">{label}</div>
            <div className="mt-0.5 flex items-baseline gap-1">
              <span className="text-fluid-base font-bold tabular-nums text-foreground">{pct}%</span>
              <span aria-hidden="true" className="text-fluid-2xs" style={{ color: BAND_VAR[band] }}>
                {BAND_GLYPH[band]}
              </span>
            </div>
            <ProgressBar
              value={pct}
              tone={BAND_TONE[band]}
              size="sm"
              ariaLabel={`${label}: ${pct}%`}
              className="mt-1.5"
            />
          </div>
        );
      })}
    </div>
  );
}

/* ── Velocity sparkline (kept for advanced view; token stroke) ── */
function VelocitySparkline({ datapoints }: { datapoints: Array<{ date: string; mastery: number }> }) {
  if (!datapoints || datapoints.length < 2) return <span className="text-fluid-2xs text-muted-foreground">—</span>;

  const sorted = [...datapoints].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
  const maxM = Math.max(...sorted.map((d) => d.mastery), 0.01);
  const width = 80;
  const height = 24;
  const step = width / (sorted.length - 1);
  const points = sorted.map((d, i) => `${i * step},${height - (d.mastery / maxM) * height}`).join(' ');

  return (
    <svg width={width} height={height} className="inline-block" aria-hidden="true">
      <polyline
        points={points}
        fill="none"
        stroke="var(--info)"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
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

  // P1: accuracy % is read straight from server counts via calculateScorePercent
  // — no client recompute of any score/mastery number.
  const correctPct = calculateScorePercent(profile.total_questions_answered_correctly, profile.total_questions_asked);

  // Growth-mindset band label — routed through the shared mastery-band-labels
  // source of truth (no harsh "Beginner" / "मेहनत चाहिए").
  const band = bandForValue(correctPct);
  const bandText = bandLabelForValue(correctPct, isHi);

  const subjectCode = profile.subject;
  const icon = subjectMeta?.icon ?? '📚';
  const name = subjectMeta?.name ?? profile.subject;

  // Derive Bloom-level insights from bloom data (presentation grouping only).
  const bloomByLevel = BLOOM_LEVELS.reduce((acc, level) => {
    const items = bloomData.filter((b) => b.bloom_level === level);
    const avg = items.length > 0 ? items.reduce((s, i) => s + i.mastery, 0) / items.length : 0;
    acc[level] = avg;
    return acc;
  }, {} as Record<string, number>);

  const strongLevels = BLOOM_LEVELS.filter((l) => bloomByLevel[l] >= 0.7);
  const focusLevels = BLOOM_LEVELS.filter((l) => bloomByLevel[l] > 0 && bloomByLevel[l] < 0.4);

  const velocityHistory = velocity?.velocity_history as Record<string, number> | null;
  const sparklineData = velocityHistory
    ? Object.entries(velocityHistory).map(([date, mastery]) => ({ date, mastery: Number(mastery) }))
    : [];

  return (
    <Card className="p-4">
      {/* Header row: accuracy MasteryRing (band-labelled) + subject + band badge */}
      <div className="flex items-center gap-3">
        <MasteryRing
          value={correctPct}
          size={56}
          strokeWidth={5}
          showLabel={false}
          bandLabel={(k) => (isHi ? MASTERY_BAND_LABELS[k].hi : MASTERY_BAND_LABELS[k].en)}
        />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span aria-hidden="true" className="text-fluid-lg">{icon}</span>
            <h3 className="min-w-0 truncate text-fluid-sm font-bold text-foreground">{name}</h3>
            <span className="text-fluid-sm font-bold tabular-nums text-foreground">{correctPct}%</span>
            <Badge tone={BAND_TONE[band]} icon={<span>{BAND_GLYPH[band]}</span>}>{bandText}</Badge>
          </div>
          <ProgressBar
            value={correctPct}
            tone={BAND_TONE[band]}
            size="sm"
            ariaLabel={`${name}: ${correctPct}%`}
            className="mt-1.5"
          />
        </div>
      </div>

      {/* Bloom summary (growth-mindset framing; no harsh terms) */}
      <div className="mt-3 space-y-1.5">
        {strongLevels.length > 0 && (
          <div className="flex items-start gap-2 text-fluid-sm">
            <span className="shrink-0 font-semibold" style={{ color: BAND_VAR.high }}>
              {isHi ? MASTERY_BAND_LABELS.high.hi : MASTERY_BAND_LABELS.high.en}:
            </span>
            <span className="text-foreground">
              {strongLevels.map((l) => (isHi ? BLOOM_CONFIG[l].labelHi : BLOOM_CONFIG[l].label)).join(', ')}
            </span>
          </div>
        )}
        {focusLevels.length > 0 && (
          <div className="flex items-start gap-2 text-fluid-sm">
            <span className="shrink-0 font-semibold" style={{ color: BAND_VAR.mid }}>
              {isHi ? 'अगला फोकस' : 'Focus next'}:
            </span>
            <span className="text-foreground">
              {focusLevels.map((l) => (isHi ? BLOOM_CONFIG[l].labelHi : BLOOM_CONFIG[l].label)).join(', ')}
            </span>
          </div>
        )}
        {strongLevels.length === 0 && focusLevels.length === 0 && (
          <p className="text-fluid-xs text-muted-foreground">
            Lv{profile.level} · {profile.xp} XP · {profile.total_sessions} {isHi ? 'सत्र' : 'sessions'}
          </p>
        )}
      </div>

      {/* Actions */}
      <div className="mt-3 flex gap-2">
        <Button
          variant="secondary"
          size="sm"
          onClick={() => router.push(`/quiz?subject=${encodeURIComponent(subjectCode)}`)}
          className="flex-1"
        >
          {isHi ? 'कमज़ोर क्षेत्रों का अभ्यास करो' : 'Practice Weak Areas'}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          aria-expanded={showAdvanced}
          onClick={() => setShowAdvanced((v) => !v)}
        >
          {showAdvanced ? (isHi ? 'सरल' : 'Simple') : (isHi ? 'विस्तार' : 'Advanced')}
        </Button>
      </div>

      {/* Advanced: Bloom grid + velocity */}
      {showAdvanced && (
        <div className="mt-3 space-y-3 border-t border-surface-3 pt-3">
          {bloomData.length > 0 && (
            <div>
              <p className="mb-1.5 text-fluid-2xs font-semibold uppercase tracking-wider text-muted-foreground">
                {isHi ? "Bloom's विश्लेषण" : "Bloom's Analysis"}
              </p>
              <BloomMasteryGrid data={bloomData} isHi={isHi} />
            </div>
          )}
          {sparklineData.length >= 2 && (
            <div className="flex items-center gap-3">
              <p className="text-fluid-2xs font-semibold uppercase tracking-wider text-muted-foreground">
                {isHi ? 'सीखने की गति' : 'Velocity'}
              </p>
              <VelocitySparkline datapoints={sparklineData} />
              {velocity?.weekly_mastery_rate != null && (
                <span className="text-fluid-2xs font-bold" style={{ color: 'var(--info)' }}>
                  {Math.round((velocity.weekly_mastery_rate ?? 0) * 100)}%/wk
                </span>
              )}
            </div>
          )}
          <p className="text-fluid-2xs text-muted-foreground">
            {profile.total_sessions} {isHi ? 'सत्र' : 'sessions'} · {profile.total_time_minutes}m {isHi ? 'पढ़ाई' : 'study time'} · Lv{profile.level}
          </p>
        </div>
      )}
    </Card>
  );
}
