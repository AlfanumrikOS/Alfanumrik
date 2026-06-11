'use client';

/**
 * SubjectRoadmaps — per-subject skill trees for the Alfa OS dashboard
 * (ff_student_os_v1).
 *
 * Reads the existing `useMasteryOverview` (get_mastery_overview RPC), groups
 * its rows by subject, and renders one <SkillTree> per subject. Each node's
 * state (mastered / learning / needs-revision / locked) and percentage come
 * straight from the engine output via the pure `mastery-buckets` helpers — no
 * mastery is computed here. Tapping a node routes the student to Foxy scoped to
 * that subject/topic (an existing route + URL-context mechanism, no new AI
 * call). Bilingual via isHi.
 */

import { useRouter } from 'next/navigation';
import { useMasteryOverview } from '@/lib/swr';
import { SkillTree, type SkillTreeNode } from '@/components/ui/SkillTree';
import { Skeleton } from '@/components/ui';
import {
  groupBySubject,
  roadmapStatusForRow,
  masteryPercent,
  type MasteryOverviewRow,
  type RoadmapStatus,
} from '@/lib/dashboard/mastery-buckets';

interface SubjectRoadmapsProps {
  isHi: boolean;
  studentId: string | undefined;
  /** Subject code → code map so node taps can deep-link Foxy. */
  subjectCodeByName?: Record<string, string>;
}

const STATUS_LABEL: Record<RoadmapStatus, { en: string; hi: string }> = {
  mastered: { en: 'Mastered', hi: 'महारत' },
  learning: { en: 'Learning', hi: 'सीख रहे' },
  'needs-revision': { en: 'Needs revision', hi: 'दोहराओ' },
  locked: { en: 'Not started', hi: 'अभी बाकी' },
};

export default function SubjectRoadmaps({ isHi, studentId, subjectCodeByName }: SubjectRoadmapsProps) {
  const router = useRouter();
  const { data, isLoading, error } = useMasteryOverview(studentId);

  const rows: MasteryOverviewRow[] = Array.isArray(data) ? (data as MasteryOverviewRow[]) : [];

  if (isLoading && !data) {
    return (
      <section aria-busy="true" aria-label={isHi ? 'रोडमैप लोड हो रहा है' : 'Loading roadmaps'}>
        <Skeleton width="50%" height={14} className="mb-3" />
        <div className="space-y-2">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} height={64} rounded="rounded-2xl" />
          ))}
        </div>
      </section>
    );
  }

  const groups = groupBySubject(rows);

  return (
    <section aria-label={isHi ? 'विषय रोडमैप' : 'Subject roadmaps'}>
      <h2
        className="text-sm font-bold uppercase tracking-wider mb-3"
        style={{ color: 'var(--text-3)' }}
      >
        {isHi ? 'विषय रोडमैप' : 'Subject roadmaps'}
      </h2>

      {error && !isLoading ? (
        <div
          className="rounded-2xl p-4 text-center text-sm"
          style={{ background: 'var(--surface-2)', border: '1px solid var(--border)', color: 'var(--text-3)' }}
          role="status"
        >
          {isHi
            ? 'अभी लोड नहीं हो पाया — रीफ़्रेश करके फिर देखो।'
            : "Couldn't load right now — pull to refresh."}
        </div>
      ) : groups.length === 0 ? (
        <div
          className="rounded-2xl p-4 text-center text-sm"
          style={{ background: 'var(--surface-2)', border: '1px dashed var(--border)', color: 'var(--text-3)' }}
        >
          {isHi
            ? 'अपना पहला अध्याय शुरू करो — तुम्हारा रोडमैप यहाँ बनेगा।'
            : 'Start your first chapter — your roadmap builds here.'}
        </div>
      ) : (
        <div className="space-y-5">
          {groups.map((g) => {
            // Cap each tree to the most relevant 8 chapters to keep first paint
            // light (P10) and avoid overwhelming the student.
            const visibleRows = g.rows.slice(0, 8);
            const nodes: SkillTreeNode[] = visibleRows.map((row) => {
              const status = roadmapStatusForRow(row);
              const label =
                isHi && row.title_hi ? row.title_hi : row.title || `Chapter ${row.chapter_number ?? ''}`;
              const code = subjectCodeByName?.[g.subject] ?? g.subject.toLowerCase();
              const onClick =
                status === 'locked'
                  ? undefined
                  : () => {
                      // Deep-link Foxy scoped to this subject + chapter via the
                      // existing URL-context mechanism — no new AI call here.
                      const params = new URLSearchParams({ subject: code, source: 'dashboard' });
                      if (row.chapter_number != null) params.set('chapter', String(row.chapter_number));
                      router.push(`/foxy?${params.toString()}`);
                    };
              return {
                id: row.topic_id,
                label,
                percent: masteryPercent(row),
                status,
                statusLabel: isHi ? STATUS_LABEL[status].hi : STATUS_LABEL[status].en,
                onClick,
              };
            });

            return (
              <div key={g.subject}>
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-lg" aria-hidden="true">{g.icon}</span>
                  <span
                    className="text-sm font-bold"
                    style={{ color: 'var(--text-1)', fontFamily: 'var(--font-display)' }}
                  >
                    {g.subject}
                  </span>
                </div>
                <SkillTree
                  nodes={nodes}
                  emptyLabel={isHi ? 'कोई अध्याय नहीं' : 'No chapters yet'}
                />
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
