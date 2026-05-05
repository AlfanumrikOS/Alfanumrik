'use client';

/**
 * ProgressSection — collapsed below-fold accordion content.
 *
 * Houses progress-shaped widgets that previously crowded the dashboard:
 *   - Performance score hero (overall + per-subject ScoreCard grid)
 *   - Bloom level chip
 *   - Subject progress (XP + BKT mastery per subject)
 *   - Knowledge gaps alert
 *   - Error breakdown (careless / conceptual / misread)
 *
 * This component is lazy-loaded via next/dynamic from page.tsx — it only mounts
 * when the user expands the section, so its SWR/BKT data is already on the
 * dashboard's snapshot fetch and we don't fire extra DB calls on dashboard load.
 *
 * Owned by frontend. JSX moved verbatim from page.tsx — no behavior changes.
 */

import { Card, SectionHeader, StatCard } from '@/components/ui';
import ScoreCard from '@/components/score/ScoreCard';
import SubjectProgress from '@/components/dashboard/SubjectProgress';
import type { StudentLearningProfile } from '@/lib/types';
import type { Subject as AllowedSubject } from '@/lib/subjects.types';

interface KnowledgeGap {
  id: string;
  topic_title?: string;
  severity: string;
  description: string;
  description_hi?: string;
}

interface ErrorBreakdown {
  careless: number;
  conceptual: number;
  misinterpretation: number;
}

interface PerfScore {
  subject: string;
  overall_score: number;
  level_name: string;
}

interface ProgressSectionProps {
  isHi: boolean;
  router: { push: (path: string) => void };
  // Data
  profiles: StudentLearningProfile[];
  allowedSubjects: AllowedSubject[];
  selectedSubjects: string[];
  bktMastery: Record<string, number>;
  perfScores: PerfScore[];
  overallPerfScore: number;
  overallPerfLevel: string;
  velocityTrend: 'fast' | 'steady' | 'slow' | null;
  cbseReadiness: number | null;
  retentionScore: number | null;
  mastered: number;
  dueCount: number;
  quizzesTaken: number;
  knowledgeGaps: KnowledgeGap[];
  errorBreakdown: ErrorBreakdown | null;
}

export default function ProgressSection({
  isHi,
  router,
  profiles,
  allowedSubjects,
  selectedSubjects,
  bktMastery,
  perfScores,
  overallPerfScore,
  overallPerfLevel,
  velocityTrend,
  cbseReadiness,
  retentionScore,
  mastered,
  dueCount,
  quizzesTaken,
  knowledgeGaps,
  errorBreakdown,
}: ProgressSectionProps) {
  return (
    <div className="space-y-4 pt-3">
      {/* Performance score hero */}
      {(perfScores.length > 0 || cbseReadiness !== null) && (
        <Card>
          <div className="flex items-center justify-between mb-3">
            <span className="text-sm font-bold uppercase tracking-wider" style={{ color: 'var(--text-3)' }}>
              {isHi ? 'समग्र प्रदर्शन' : 'Overall Performance'}
            </span>
            {velocityTrend && (
              <span
                className="text-xs font-semibold"
                style={{ color: velocityTrend === 'fast' ? '#16A34A' : velocityTrend === 'steady' ? '#F59E0B' : '#EF4444' }}
              >
                {velocityTrend === 'fast' ? '↑' : velocityTrend === 'steady' ? '→' : '↓'}
                {' '}
                {isHi
                  ? (velocityTrend === 'fast' ? 'तेज़ गति' : velocityTrend === 'steady' ? 'स्थिर गति' : 'धीमी गति')
                  : (velocityTrend === 'fast' ? 'Fast pace' : velocityTrend === 'steady' ? 'Steady pace' : 'Slow pace')}
              </span>
            )}
          </div>

          {overallPerfScore > 0 && (
            <div className="mb-4 text-center">
              <p className="text-4xl font-extrabold" style={{ color: 'var(--orange)', fontFamily: 'var(--font-display)' }}>
                {overallPerfScore}
              </p>
              <p className="text-xs mt-1" style={{ color: 'var(--text-3)' }}>
                {overallPerfLevel}
              </p>
            </div>
          )}

          <div className="grid-stats">
            {cbseReadiness !== null && (
              <StatCard
                icon="🎯"
                value={`${cbseReadiness}%`}
                label={isHi ? 'परीक्षा तैयार' : 'Exam Ready'}
                color={cbseReadiness >= 70 ? '#16A34A' : cbseReadiness >= 40 ? '#F59E0B' : '#EF4444'}
              />
            )}
            <StatCard value={mastered} label={isHi ? 'महारत' : 'Mastered'} color="var(--gold)" />
            <StatCard
              value={dueCount}
              label={isHi ? 'रिव्यू' : 'Due Reviews'}
              color={dueCount > 0 ? 'var(--orange)' : 'var(--text-3)'}
            />
            <StatCard
              value={quizzesTaken}
              label={isHi ? 'क्विज़' : 'Quizzes'}
              color="var(--purple)"
            />
            {retentionScore !== null && (
              <StatCard
                icon="🧠"
                value={`${retentionScore}%`}
                label={isHi ? 'याददाश्त' : 'Retention'}
                color="#0891B2"
              />
            )}
          </div>
        </Card>
      )}

      {/* Per-subject Performance Score grid */}
      {perfScores.length > 0 && (
        <div>
          <SectionHeader icon="📊">{isHi ? 'विषय स्कोर' : 'Subject Scores'}</SectionHeader>
          <div className="grid grid-cols-2 gap-3">
            {perfScores
              .filter((ps) => selectedSubjects.includes(ps.subject))
              .map((ps) => {
                const subjectMeta = allowedSubjects.find((s) => s.code === ps.subject);
                return (
                  <ScoreCard
                    key={ps.subject}
                    subject={subjectMeta?.name ?? ps.subject}
                    subjectHi={subjectMeta?.nameHi ?? ps.subject}
                    score={ps.overall_score}
                    isHi={isHi}
                  />
                );
              })}
          </div>
        </div>
      )}

      {/* Subject progress (XP + BKT mastery) */}
      {allowedSubjects.length > 0 && selectedSubjects.length > 0 && (
        <SubjectProgress
          profiles={profiles}
          subjects={allowedSubjects}
          selectedSubjects={selectedSubjects}
          isHi={isHi}
          bktMastery={bktMastery}
        />
      )}

      {/* Knowledge Gaps Alert */}
      {knowledgeGaps.length > 0 && (
        <div className="rounded-2xl p-4" style={{ background: 'var(--danger-light)', border: '1px solid rgba(244,63,94,0.15)' }}>
          <div className="flex items-start gap-3">
            <span className="text-2xl" aria-hidden="true">🔍</span>
            <div className="flex-1">
              <div className="font-semibold text-sm" style={{ color: 'var(--danger)' }}>
                {knowledgeGaps.length} {isHi ? 'ज्ञान अंतराल पाए गए' : 'knowledge gaps found'}
              </div>
              <div className="text-xs text-[var(--text-3)] mt-1 space-y-0.5">
                {knowledgeGaps.slice(0, 2).map((g) => (
                  <div key={g.id}>• {isHi && g.description_hi ? g.description_hi : g.description}</div>
                ))}
              </div>
              <button
                onClick={() => router.push('/foxy')}
                className="mt-2 text-xs font-bold px-3 py-1.5 rounded-lg"
                style={{ background: 'rgba(232,88,28,0.1)', color: 'var(--orange)' }}
              >
                🦊 {isHi ? 'Foxy से ठीक करो' : 'Fix with Foxy'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Error Breakdown */}
      {errorBreakdown && (
        <Card>
          <div className="flex items-center gap-2 mb-3">
            <span className="text-base" aria-hidden="true">🔍</span>
            <span className="text-sm font-bold" style={{ fontFamily: 'var(--font-display)' }}>
              {isHi ? 'गलती विश्लेषण' : 'Error Analysis'}
            </span>
          </div>
          <div className="space-y-2">
            {[
              { label: isHi ? 'लापरवाही' : 'Careless', pct: errorBreakdown.careless, color: '#F59E0B', icon: '⚡' },
              { label: isHi ? 'अवधारणा' : 'Conceptual', pct: errorBreakdown.conceptual, color: '#EF4444', icon: '🧠' },
              { label: isHi ? 'गलत समझ' : 'Misread', pct: errorBreakdown.misinterpretation, color: '#8B5CF6', icon: '🔍' },
            ].map((item) => (
              <div key={item.label} className="flex items-center gap-2">
                <span className="text-xs w-4" aria-hidden="true">{item.icon}</span>
                <span className="text-xs font-semibold w-20" style={{ color: item.color }}>{item.label}</span>
                <div className="flex-1 h-2 rounded-full overflow-hidden" style={{ background: `${item.color}15` }}>
                  <div className="h-full rounded-full transition-all" style={{ width: `${item.pct}%`, background: item.color }} />
                </div>
                <span className="text-[10px] text-[var(--text-3)] w-10 text-right">{item.pct}%</span>
              </div>
            ))}
          </div>
        </Card>
      )}
    </div>
  );
}
