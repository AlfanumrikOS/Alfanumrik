'use client';

import { useState, useEffect } from 'react';
import useSWR from 'swr';
import { supabase } from '@/lib/supabase';
import { BLOOM_LEVELS, BLOOM_CONFIG } from '@/lib/cognitive-engine';
import type { BloomLevel } from '@/lib/cognitive-engine';
import { Card, Badge, Button, MasteryRing } from '@/components/ui';

/* ── Types ── */
interface TopicMastery { topic: string; mastery: number }
interface ImprovementItem { topic: string; action: string; potential_gain: number }
interface ExamProphecyData {
  predicted_score: number;
  confidence_band: [number, number];
  strength_topics: TopicMastery[];
  weakness_topics: TopicMastery[];
  improvement_plan: ImprovementItem[];
  total_topics: number;
  topics_mastered: number;
  topics_in_progress: number;
  topics_not_started: number;
  bloom_distribution: Record<string, number>;
  exam_readiness: 'ready' | 'partially_ready' | 'needs_work' | 'not_ready';
}

export interface ExamProphecyProps {
  studentId: string;
  subject: string;
  grade: string;
  isHi: boolean;
}

const READINESS_CONFIG: Record<string, { label: string; labelHi: string; color: string }> = {
  ready:           { label: 'Exam Ready',      labelHi: 'परीक्षा के लिए तैयार', color: '#16A34A' },
  partially_ready: { label: 'Partially Ready', labelHi: 'आंशिक रूप से तैयार',    color: '#F59E0B' },
  needs_work:      { label: 'Needs Work',      labelHi: 'मेहनत ज़रूरी है',        color: '#EA580C' },
  not_ready:       { label: 'Not Ready',       labelHi: 'तैयार नहीं',            color: '#DC2626' },
};

const ACTION_LABELS: Record<string, { en: string; hi: string }> = {
  teach: { en: 'Learn', hi: 'सीखो' }, remediate: { en: 'Revise', hi: 'दोहराओ' },
  practice: { en: 'Practice', hi: 'अभ्यास करो' }, challenge: { en: 'Challenge', hi: 'चुनौती लो' },
  revise: { en: 'Review', hi: 'समीक्षा करो' },
};

/* ── Fetcher ── */

async function fetchProphecy(_key: string, studentId: string, subject: string, grade: string): Promise<ExamProphecyData | null> {
  const { data, error } = await supabase.rpc('predict_exam_score', {
    p_student_id: studentId,
    p_subject: subject,
    p_grade: grade,
  });
  if (error) throw error;
  return data as ExamProphecyData | null;
}

/* ── SVG Radar Chart (no external library) ── */

function BloomRadar({ distribution, isHi }: { distribution: Record<string, number>; isHi: boolean }) {
  const levels = BLOOM_LEVELS;
  const cx = 90;
  const cy = 90;
  const maxR = 70;
  const angleStep = (2 * Math.PI) / levels.length;

  // Grid rings at 25%, 50%, 75%, 100%
  const rings = [0.25, 0.5, 0.75, 1.0];

  // Compute data points
  const points = levels.map((level, i) => {
    const val = Math.min(1, Math.max(0, distribution[level] ?? 0));
    const angle = -Math.PI / 2 + i * angleStep;
    return {
      x: cx + Math.cos(angle) * maxR * val,
      y: cy + Math.sin(angle) * maxR * val,
      labelX: cx + Math.cos(angle) * (maxR + 16),
      labelY: cy + Math.sin(angle) * (maxR + 16),
      level,
      val,
      angle,
    };
  });

  const polygonPoints = points.map(p => `${p.x},${p.y}`).join(' ');

  return (
    <div className="flex flex-col items-center">
      <svg width={180} height={180} viewBox="0 0 180 180" className="w-full max-w-[180px]">
        {/* Grid rings */}
        {rings.map(r => (
          <polygon
            key={r}
            points={levels.map((_, i) => {
              const angle = -Math.PI / 2 + i * angleStep;
              return `${cx + Math.cos(angle) * maxR * r},${cy + Math.sin(angle) * maxR * r}`;
            }).join(' ')}
            fill="none"
            stroke="var(--border)"
            strokeWidth={0.5}
            opacity={0.6}
          />
        ))}
        {/* Axis lines */}
        {levels.map((_, i) => {
          const angle = -Math.PI / 2 + i * angleStep;
          return (
            <line
              key={i}
              x1={cx} y1={cy}
              x2={cx + Math.cos(angle) * maxR}
              y2={cy + Math.sin(angle) * maxR}
              stroke="var(--border)"
              strokeWidth={0.5}
              opacity={0.4}
            />
          );
        })}
        {/* Data polygon */}
        <polygon
          points={polygonPoints}
          fill="var(--orange)"
          fillOpacity={0.2}
          stroke="var(--orange)"
          strokeWidth={1.5}
        />
        {/* Data dots */}
        {points.map(p => (
          <circle key={p.level} cx={p.x} cy={p.y} r={3} fill={BLOOM_CONFIG[p.level as BloomLevel].color} />
        ))}
        {/* Labels */}
        {points.map(p => {
          const cfg = BLOOM_CONFIG[p.level as BloomLevel];
          return (
            <text
              key={p.level}
              x={p.labelX}
              y={p.labelY}
              textAnchor="middle"
              dominantBaseline="central"
              fontSize={8}
              fill="var(--text-3)"
              fontWeight={600}
            >
              {isHi ? cfg.labelHi.slice(0, 6) : cfg.label.slice(0, 6)}
            </text>
          );
        })}
      </svg>
    </div>
  );
}

/* ── Main Component ── */

export default function ExamProphecy({ studentId, subject, grade, isHi }: ExamProphecyProps) {
  const { data: prophecy, error, isLoading } = useSWR(
    studentId && subject && grade ? ['exam-prophecy', studentId, subject, grade] : null,
    ([_key, sid, sub, gr]) => fetchProphecy(_key, sid, sub, gr),
    { revalidateOnFocus: false, dedupingInterval: 60000 }
  );

  if (isLoading) {
    return (
      <Card className="!p-5 animate-pulse">
        <div className="h-6 w-40 rounded-lg mb-4" style={{ background: 'var(--surface-2)' }} />
        <div className="flex items-center gap-5">
          <div className="w-20 h-20 rounded-full" style={{ background: 'var(--surface-2)' }} />
          <div className="flex-1 space-y-2">
            <div className="h-4 w-32 rounded" style={{ background: 'var(--surface-2)' }} />
            <div className="h-3 w-24 rounded" style={{ background: 'var(--surface-2)' }} />
          </div>
        </div>
      </Card>
    );
  }

  if (error || !prophecy) {
    return null; // Silently hide if RPC not available or no data
  }

  if (prophecy.total_topics === 0) {
    return null; // No curriculum topics — nothing to predict
  }

  const readiness = READINESS_CONFIG[prophecy.exam_readiness] ?? READINESS_CONFIG.not_ready;
  const [bandLow, bandHigh] = prophecy.confidence_band;
  const scoreColor = prophecy.predicted_score >= 80 ? 'var(--mastery-high)'
    : prophecy.predicted_score >= 60 ? 'var(--mastery-mid)'
    : prophecy.predicted_score >= 40 ? 'var(--orange)'
    : 'var(--mastery-low)';

  return (
    <Card className="!p-5 space-y-4 animate-slide-up" accent={readiness.color}>
      {/* Header */}
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-bold uppercase tracking-wider text-[var(--text-3)]">
          {isHi ? 'परीक्षा भविष्यवाणी' : 'Exam Prophecy'}
        </h3>
        <Badge color={readiness.color} size="sm">
          {isHi ? readiness.labelHi : readiness.label}
        </Badge>
      </div>

      {/* Score + Confidence */}
      <div className="flex items-center gap-5">
        <MasteryRing value={prophecy.predicted_score} size={88} strokeWidth={7} color={scoreColor}>
          <div className="text-center">
            <div className="text-xl font-bold" style={{ color: scoreColor, fontFamily: 'var(--font-display)' }}>
              {prophecy.predicted_score}
            </div>
            <div className="text-[9px] text-[var(--text-3)]">%</div>
          </div>
        </MasteryRing>

        <div className="flex-1 space-y-2">
          <div className="text-xs text-[var(--text-3)]">
            {isHi ? 'अनुमानित अंक' : 'Predicted Score'}
          </div>
          <div className="text-xs font-semibold" style={{ color: scoreColor }}>
            {isHi ? 'विश्वास सीमा' : 'Confidence'}: {bandLow}% — {bandHigh}%
          </div>
          <div className="flex gap-3 text-[10px] text-[var(--text-3)]">
            <span>{prophecy.topics_mastered} {isHi ? 'पक्के' : 'mastered'}</span>
            <span>{prophecy.topics_in_progress} {isHi ? 'चल रहे' : 'in progress'}</span>
            <span>{prophecy.topics_not_started} {isHi ? 'नए' : 'new'}</span>
          </div>
        </div>
      </div>

      {/* Strengths & Weaknesses */}
      <div className="grid grid-cols-2 gap-3">
        {/* Strengths */}
        {prophecy.strength_topics.length > 0 && (
          <div>
            <div className="text-[10px] font-bold text-[var(--text-3)] uppercase mb-1.5">
              {isHi ? 'ताकत' : 'Strengths'}
            </div>
            <div className="space-y-1">
              {prophecy.strength_topics.slice(0, 3).map((t) => (
                <div key={t.topic} className="flex items-center gap-1.5">
                  <div className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: 'var(--mastery-high)' }} />
                  <span className="text-[11px] truncate">{t.topic}</span>
                  <span className="text-[10px] font-semibold ml-auto flex-shrink-0" style={{ color: 'var(--mastery-high)' }}>
                    {Math.round(t.mastery * 100)}%
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Weaknesses */}
        {prophecy.weakness_topics.length > 0 && (
          <div>
            <div className="text-[10px] font-bold text-[var(--text-3)] uppercase mb-1.5">
              {isHi ? 'कमज़ोरियाँ' : 'Weaknesses'}
            </div>
            <div className="space-y-1">
              {prophecy.weakness_topics.slice(0, 3).map((t) => (
                <div key={t.topic} className="flex items-center gap-1.5">
                  <div className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: 'var(--mastery-low)' }} />
                  <span className="text-[11px] truncate">{t.topic}</span>
                  <span className="text-[10px] font-semibold ml-auto flex-shrink-0" style={{ color: 'var(--mastery-low)' }}>
                    {Math.round(t.mastery * 100)}%
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Improvement Plan */}
      {prophecy.improvement_plan.length > 0 && (
        <div>
          <div className="text-[10px] font-bold text-[var(--text-3)] uppercase mb-1.5">
            {isHi ? 'सुधार योजना' : 'Improvement Plan'}
          </div>
          <div className="space-y-1.5">
            {prophecy.improvement_plan.slice(0, 4).map((item) => {
              const actionLabel = ACTION_LABELS[item.action] ?? ACTION_LABELS.practice;
              return (
                <div
                  key={item.topic}
                  className="flex items-center gap-2 rounded-lg px-2.5 py-1.5"
                  style={{ background: 'var(--surface-2)' }}
                >
                  <span className="text-[11px] truncate flex-1">{item.topic}</span>
                  <Badge color="var(--orange)" size="sm">
                    {isHi ? actionLabel.hi : actionLabel.en}
                  </Badge>
                  {item.potential_gain > 0 && (
                    <span className="text-[10px] font-bold flex-shrink-0" style={{ color: 'var(--mastery-high)' }}>
                      +{item.potential_gain}%
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Bloom's Radar */}
      {Object.values(prophecy.bloom_distribution).some(v => v > 0) && (
        <div>
          <div className="text-[10px] font-bold text-[var(--text-3)] uppercase mb-1">
            {isHi ? "Bloom's विश्लेषण" : "Bloom's Analysis"}
          </div>
          <BloomRadar distribution={prophecy.bloom_distribution} isHi={isHi} />
        </div>
      )}

      {/* CTA */}
      <div className="flex gap-2 pt-1">
        <Button
          variant="soft"
          size="sm"
          color="var(--orange)"
          className="flex-1"
          onClick={() => {
            const weakest = prophecy.weakness_topics[0]?.topic ?? prophecy.improvement_plan[0]?.topic;
            if (weakest) {
              window.location.href = `/foxy?topic=${encodeURIComponent(weakest)}`;
            } else {
              window.location.href = '/quiz';
            }
          }}
        >
          {isHi ? 'कमज़ोरी सुधारो' : 'Fix Weaknesses'}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="flex-1"
          onClick={() => { window.location.href = '/quiz'; }}
        >
          {isHi ? 'अभ्यास करो' : 'Practice'}
        </Button>
      </div>
    </Card>
  );
}
