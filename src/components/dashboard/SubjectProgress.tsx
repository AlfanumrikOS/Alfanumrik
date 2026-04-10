'use client';

import { Card, ProgressBar, SectionHeader } from '@/components/ui';
import type { StudentLearningProfile, Subject } from '@/lib/types';

interface SubjectProgressProps {
  profiles: StudentLearningProfile[];
  subjects: Subject[];
  selectedSubjects: string[];
  isHi: boolean;
  // BKT mastery: subject_code → average mastery_probability (0–100).
  // When present, shown as a second bar so students see actual mastery, not just XP.
  bktMastery?: Record<string, number>;
}

export default function SubjectProgress({ profiles, subjects, selectedSubjects, isHi, bktMastery }: SubjectProgressProps) {
  const filteredProfiles = profiles.filter(p => selectedSubjects.includes(p.subject));

  if (filteredProfiles.length === 0) return null;

  return (
    <div>
      <SectionHeader icon="🏅">{isHi ? 'विषयवार प्रगति' : 'Subject Progress'}</SectionHeader>
      <div className="space-y-2">
        {filteredProfiles.map((p) => {
          const sm = subjects.find((s) => s.code === p.subject);
          const mastery = bktMastery?.[p.subject] ?? null;
          const xpProgress = ((p.xp % 500) / 500) * 100;
          return (
            <Card key={p.id} className="!p-3">
              <div className="flex items-center gap-3 mb-2">
                <span className="text-lg">{sm?.icon ?? '📚'}</span>
                <div className="flex-1 min-w-0">
                  <div className="flex justify-between text-xs">
                    <span className="font-semibold truncate">{sm?.name ?? p.subject}</span>
                    <span className="text-[var(--text-3)]">{p.xp} XP · Lv{p.level}</span>
                  </div>
                </div>
              </div>
              {/* XP progress toward next level */}
              <div className="mb-1.5">
                <div className="flex justify-between text-[10px] text-[var(--text-3)] mb-0.5">
                  <span>{isHi ? 'XP स्तर' : 'XP Level'}</span>
                  <span>{Math.round(xpProgress)}%</span>
                </div>
                <ProgressBar value={xpProgress} color={sm?.color} height={4} />
              </div>
              {/* BKT mastery: real adaptive mastery signal */}
              {mastery !== null ? (
                <div>
                  <div className="flex justify-between text-[10px] mb-0.5">
                    <span className="font-semibold" style={{ color: mastery >= 70 ? 'var(--green)' : mastery >= 40 ? 'var(--orange)' : 'var(--danger)' }}>
                      {isHi ? 'ज्ञान महारत' : 'Knowledge Mastery'} {mastery}%
                    </span>
                    <span className="text-[var(--text-3)]">
                      {mastery >= 70
                        ? (isHi ? '✅ मज़बूत' : '✅ Strong')
                        : mastery >= 40
                        ? (isHi ? '📈 बढ़ रहे हो' : '📈 Growing')
                        : (isHi ? '⚡ अभ्यास करो' : '⚡ Needs practice')}
                    </span>
                  </div>
                  <ProgressBar
                    value={mastery}
                    color={mastery >= 70 ? 'var(--green)' : mastery >= 40 ? 'var(--orange)' : 'var(--danger)'}
                    height={5}
                  />
                </div>
              ) : (
                <p className="text-[10px] text-[var(--text-3)]">
                  {isHi ? 'क्विज़ खेलो — महारत दिखेगी' : 'Take a quiz to see your mastery'}
                </p>
              )}
            </Card>
          );
        })}
      </div>
    </div>
  );
}
