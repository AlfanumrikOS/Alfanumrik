'use client';

import { Card } from '@/components/ui';

interface KnowledgeGap {
  id: string;
  topic_title?: string;
  description: string;
  description_hi?: string;
}

interface PlanInsightsProps {
  aiReasoning: string | null | undefined;
  knowledgeGaps: KnowledgeGap[];
  isHi: boolean;
  /** Subject-level performance data: { subject, scorePercent } */
  subjectPerformance?: Array<{ subject: string; scorePercent: number }>;
  /** Days until board exam, if set */
  daysUntilExam?: number | null;
}

export default function PlanInsights({
  aiReasoning,
  knowledgeGaps,
  isHi,
  subjectPerformance,
  daysUntilExam,
}: PlanInsightsProps) {
  // Nothing meaningful to show
  if (!aiReasoning && knowledgeGaps.length === 0 && !subjectPerformance?.length) {
    return null;
  }

  const strongSubjects = subjectPerformance?.filter(s => s.scorePercent >= 80) || [];
  const weakSubjects = subjectPerformance?.filter(s => s.scorePercent < 60) || [];

  return (
    <Card className="!p-4">
      <div className="flex items-start gap-2">
        <span className="text-lg flex-shrink-0">&#128161;</span>
        <div className="flex-1 min-w-0">
          <p className="text-xs font-bold text-[var(--text-2)] mb-2">
            {isHi ? 'यह प्लान क्यों?' : 'Why this plan?'}
          </p>

          {/* Insight bullets */}
          <div className="space-y-1.5 mb-3">
            <p className="text-xs text-[var(--text-3)]">
              {isHi ? 'आपके आधार पर:' : 'Based on your:'}
            </p>
            <ul className="space-y-1 pl-3">
              {knowledgeGaps.length > 0 && (
                <li className="text-xs text-[var(--text-3)] flex items-start gap-1.5">
                  <span className="text-[var(--text-3)] mt-0.5">&#8226;</span>
                  <span>
                    {isHi
                      ? `${knowledgeGaps.length} ज्ञान की कमी${knowledgeGaps[0].topic_title ? ` (${knowledgeGaps[0].topic_title})` : ''}`
                      : `${knowledgeGaps.length} knowledge gap${knowledgeGaps.length > 1 ? 's' : ''}${knowledgeGaps[0].topic_title ? ` in ${knowledgeGaps[0].topic_title}` : ''}`}
                  </span>
                </li>
              )}
              {strongSubjects.length > 0 && (
                <li className="text-xs text-[var(--text-3)] flex items-start gap-1.5">
                  <span className="text-[var(--text-3)] mt-0.5">&#8226;</span>
                  <span>
                    {isHi
                      ? `${strongSubjects[0].subject} में अच्छा प्रदर्शन (${strongSubjects[0].scorePercent}%)`
                      : `Strong ${strongSubjects[0].subject} performance (${strongSubjects[0].scorePercent}%)`}
                  </span>
                </li>
              )}
              {weakSubjects.length > 0 && (
                <li className="text-xs text-[var(--text-3)] flex items-start gap-1.5">
                  <span className="text-[var(--text-3)] mt-0.5">&#8226;</span>
                  <span>
                    {isHi
                      ? `${weakSubjects[0].subject} में सुधार ज़रूरी (${weakSubjects[0].scorePercent}%)`
                      : `${weakSubjects[0].subject} needs improvement (${weakSubjects[0].scorePercent}%)`}
                  </span>
                </li>
              )}
              {daysUntilExam != null && daysUntilExam > 0 && (
                <li className="text-xs text-[var(--text-3)] flex items-start gap-1.5">
                  <span className="text-[var(--text-3)] mt-0.5">&#8226;</span>
                  <span>
                    {isHi
                      ? `बोर्ड परीक्षा ${daysUntilExam} दिन में`
                      : `Board exam in ${daysUntilExam} days`}
                  </span>
                </li>
              )}
            </ul>
          </div>

          {/* AI Reasoning */}
          {aiReasoning && (
            <div className="rounded-xl p-3" style={{ background: 'var(--surface-2)' }}>
              <div className="flex items-center gap-1.5 mb-1">
                <span className="text-xs">&#129514;</span>
                <span className="text-[10px] font-bold text-[var(--text-2)]">
                  {isHi ? 'विज्ञान आधारित' : 'Science-backed'}
                </span>
              </div>
              <p className="text-xs text-[var(--text-3)] leading-relaxed">{aiReasoning}</p>
            </div>
          )}
        </div>
      </div>
    </Card>
  );
}
