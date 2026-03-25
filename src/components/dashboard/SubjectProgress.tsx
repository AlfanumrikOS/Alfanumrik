'use client';

import { Card, ProgressBar, SectionHeader } from '@/components/ui';
import type { StudentLearningProfile, Subject } from '@/lib/types';

interface SubjectProgressProps {
  profiles: StudentLearningProfile[];
  subjects: Subject[];
  selectedSubjects: string[];
  isHi: boolean;
}

export default function SubjectProgress({ profiles, subjects, selectedSubjects, isHi }: SubjectProgressProps) {
  const filteredProfiles = profiles.filter(p => selectedSubjects.includes(p.subject));

  if (filteredProfiles.length === 0) return null;

  return (
    <div>
      <SectionHeader icon="🏅">{isHi ? 'विषयवार XP' : 'XP by Subject'}</SectionHeader>
      <div className="space-y-2">
        {filteredProfiles.map((p) => {
          const sm = subjects.find((s) => s.code === p.subject);
          return (
            <Card key={p.id} className="!p-3 flex items-center gap-3">
              <span className="text-lg">{sm?.icon ?? '📚'}</span>
              <div className="flex-1 min-w-0">
                <div className="flex justify-between text-xs mb-1">
                  <span className="font-semibold truncate">{sm?.name ?? p.subject}</span>
                  <span className="text-[var(--text-3)]">{p.xp} XP · Lv{p.level}</span>
                </div>
                <ProgressBar value={((p.xp % 500) / 500) * 100} color={sm?.color} height={5} />
              </div>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
