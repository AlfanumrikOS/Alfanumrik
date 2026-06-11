'use client';

/**
 * SubjectSkillTree — wraps the existing SkillTree + RoadmapNode primitives for
 * the Alfa OS Subjects hub (ff_subjects_os_v1, Tier 1 / presentation-only).
 *
 * Each chapter's readiness level + score (from the EXISTING useSubjectReadiness
 * RPC) is mapped to a RoadmapNode status via the pure `nodeStatusForLevel()`
 * helper — no mastery is computed here. Tapping a node deep-links to that
 * chapter's existing reader route (`/learn/[subject]/[chapter]`). Mastery state
 * is encoded by glyph + ring + numeric % (RoadmapNode), never colour alone.
 *
 * States: loading (skeleton), error (distinct), empty (no chapters).
 */

import { useRouter } from 'next/navigation';
import { SkillTree, type SkillTreeNode } from '@/components/ui/SkillTree';
import { Skeleton } from '@/components/ui';
import type { ChapterReadinessSummaryRow } from '@/lib/useSubjectReadiness';
import { nodeStatusForLevel, statusLabel } from './readiness-map';

interface SubjectSkillTreeProps {
  subjectCode: string;
  /** Chapter-number → title, supplied by the page from its chapters fetch. */
  chapterTitles: Record<number, string>;
  chapters: ChapterReadinessSummaryRow[];
  isLoading: boolean;
  error: unknown;
  isHi: boolean;
}

export default function SubjectSkillTree({
  subjectCode,
  chapterTitles,
  chapters,
  isLoading,
  error,
  isHi,
}: SubjectSkillTreeProps) {
  const router = useRouter();

  return (
    <section aria-label={isHi ? 'अध्याय रोडमैप' : 'Chapter roadmap'}>
      <h2
        className="text-sm font-bold uppercase tracking-wider mb-3"
        style={{ color: 'var(--text-3)' }}
      >
        {isHi ? 'अध्याय रोडमैप' : 'Chapter roadmap'}
      </h2>

      {isLoading && chapters.length === 0 ? (
        <div className="space-y-2" aria-busy="true">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} height={64} rounded="rounded-2xl" />
          ))}
        </div>
      ) : error && chapters.length === 0 ? (
        <div
          className="rounded-2xl p-4 text-center text-sm"
          style={{ background: 'var(--surface-2)', border: '1px solid var(--border)', color: 'var(--orange)' }}
          role="status"
        >
          {isHi
            ? 'रोडमैप अभी लोड नहीं हो पाया — रीफ़्रेश करके फिर देखो।'
            : "Couldn't load the roadmap — pull to refresh."}
        </div>
      ) : (
        <SkillTree
          nodes={chapters.map((row): SkillTreeNode => {
            const status = nodeStatusForLevel(row.level, row.score);
            const label =
              chapterTitles[row.chapter_number] ||
              (isHi ? `अध्याय ${row.chapter_number}` : `Chapter ${row.chapter_number}`);
            return {
              id: `ch-${row.chapter_number}`,
              label,
              percent: row.score,
              status,
              statusLabel: statusLabel(status, isHi),
              onClick: () =>
                router.push(`/learn/${encodeURIComponent(subjectCode)}/${row.chapter_number}`),
            };
          })}
          emptyLabel={
            isHi
              ? 'पहला अध्याय शुरू करो — तुम्हारा रोडमैप यहाँ बनेगा।'
              : 'Start your first chapter — your roadmap builds here.'
          }
        />
      )}
    </section>
  );
}
