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
 *
 * COLLAPSED-BY-DEFAULT (2026-08-05 declutter). This section used to render up
 * to 8 chapter nodes for EVERY subject at once — 24-40 tap targets, the single
 * largest source of clutter on the mobile dashboard. Each subject is now ONE
 * card (icon + name + a mastered/total count) that expands on tap to reveal its
 * SkillTree. The chapter nodes are not even constructed while collapsed, so the
 * collapsed state costs one button per subject.
 *
 * Everything below the fold is unchanged: identical
 * `/foxy?subject=..&chapter=..&source=dashboard` destinations (the subject
 * param is OMITTED when the display name can't be resolved to a canonical
 * code — Foxy only accepts real codes), identical
 * locked-node behaviour (locked nodes still get no onClick), identical
 * 8-chapter cap, identical status labels. Presentation only.
 */

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useMasteryOverview } from '@alfanumrik/lib/swr';
import { SkillTree, type SkillTreeNode } from '@alfanumrik/ui/ui/SkillTree';
import { Skeleton } from '@alfanumrik/ui/ui';
import {
  groupBySubject,
  roadmapStatusForRow,
  masteryPercent,
  subjectCodeForName,
  type MasteryOverviewRow,
  type RoadmapStatus,
} from '@alfanumrik/lib/dashboard/mastery-buckets';

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

  // Which subject cards are expanded. Empty map = every subject collapsed,
  // which is the default the CEO asked for. Local UI state only.
  const [expandedSubjects, setExpandedSubjects] = useState<Record<string, boolean>>({});
  const toggleSubject = (subject: string) =>
    setExpandedSubjects((prev) => ({ ...prev, [subject]: !prev[subject] }));

  const rows: MasteryOverviewRow[] = Array.isArray(data) ? (data as MasteryOverviewRow[]) : [];

  // Filter to Mathematics and Science only — the two core CBSE subjects the
  // dashboard roadmap should surface. Everything else (English, Hindi, SST,
  // etc.) is accessible via /learn but does not get a roadmap card here.
  const TARGET_SUBJECTS = new Set(['Mathematics', 'Science']);
  const filteredRows: MasteryOverviewRow[] = rows.filter((r) =>
    r.subject && TARGET_SUBJECTS.has(r.subject),
  );

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

  const groups = groupBySubject(filteredRows);

  return (
    <section aria-label={isHi ? 'विषय रोडमैप' : 'Subject roadmaps'}>
      {/* Section eyebrow — the ONE shared treatment across every dashboard card. */}
      <h2
        className="text-fluid-2xs font-bold uppercase tracking-widest mb-3"
        style={{ color: 'var(--text-3)' }}
      >
        {isHi ? 'विषय रोडमैप' : 'Subject roadmaps'}
      </h2>

      {error && !isLoading ? (
        <div
          className="rounded-2xl p-4 text-center text-fluid-sm"
          style={{ background: 'var(--surface-2)', border: '1px solid var(--border)', color: 'var(--text-3)' }}
          role="status"
        >
          {isHi
            ? 'अभी लोड नहीं हो पाया — रीफ़्रेश करके फिर देखो।'
            : "Couldn't load right now — pull to refresh."}
        </div>
      ) : groups.length === 0 ? (
        <div
          className="rounded-2xl p-4 text-center text-fluid-sm"
          style={{ background: 'var(--surface-2)', border: '1px dashed var(--border)', color: 'var(--text-3)' }}
        >
          {isHi
            ? 'अपना पहला अध्याय शुरू करो — तुम्हारा रोडमैप यहाँ बनेगा।'
            : 'Start your first chapter — your roadmap builds here.'}
        </div>
      ) : (
        <div className="space-y-2">
          {groups.map((g, gi) => {
            const panelId = `roadmap-panel-${gi}`;
            const isOpen = expandedSubjects[g.subject] === true;

            // Cap each tree to the most relevant 8 chapters to keep first paint
            // light (P10) and avoid overwhelming the student.
            const visibleRows = g.rows.slice(0, 8);

            // Glanceable progress on the collapsed card. This is a COUNT of
            // rows the engine already classified as `mastered` via the shared
            // `roadmapStatusForRow` helper — no mastery is computed or
            // re-derived here (assessment owns that formula).
            const masteredCount = visibleRows.filter(
              (row) => roadmapStatusForRow(row) === 'mastered',
            ).length;
            const summary = isHi
              ? `${visibleRows.length} में से ${masteredCount} अध्यायों में महारत`
              : `${masteredCount} of ${visibleRows.length} chapters mastered`;

            // Nodes are built ONLY when the card is open — a collapsed subject
            // costs one button, not eight roadmap nodes.
            const nodes: SkillTreeNode[] = isOpen
              ? visibleRows.map((row) => {
                  const status = roadmapStatusForRow(row);
                  const label =
                    isHi && row.title_hi ? row.title_hi : row.title || `Chapter ${row.chapter_number ?? ''}`;
                  // Resolve the display name → canonical subject CODE. When the
                  // name can't be mapped (unknown subject), the `subject` param
                  // is OMITTED — Foxy validates ?subject= against real codes
                  // and silently falls back to the first allowed subject on a
                  // bogus value, so sending a raw name lands on the WRONG
                  // subject.
                  const code = subjectCodeForName(g.subject, subjectCodeByName);
                  const onClick =
                    status === 'locked'
                      ? undefined
                      : () => {
                          // Deep-link Foxy scoped to this subject + chapter via the
                          // existing URL-context mechanism — no new AI call here.
                          const params = new URLSearchParams({ source: 'dashboard' });
                          if (code) params.set('subject', code);
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
                })
              : [];

            return (
              <div key={g.subject}>
                {/* ONE card per subject. The visible text (subject name +
                    mastered/total summary) is the accessible name in both
                    languages; `aria-expanded` + `aria-controls` describe the
                    disclosure to assistive tech. */}
                <button
                  type="button"
                  onClick={() => toggleSubject(g.subject)}
                  aria-expanded={isOpen}
                  aria-controls={panelId}
                  data-testid="roadmap-subject-toggle"
                  className="w-full flex items-center gap-3 rounded-2xl px-4 py-3 min-h-tap-large text-left transition-all active:scale-[0.99] focus:outline-none focus-visible:ring-2"
                  style={{
                    background: 'var(--surface-1)',
                    border: '1px solid var(--border)',
                    boxShadow: 'var(--shadow-sm)',
                  }}
                >
                  <span className="text-xl shrink-0" aria-hidden="true">{g.icon}</span>
                  <span className="flex-1 min-w-0">
                    <span
                      className="block text-fluid-sm font-bold truncate"
                      style={{ color: 'var(--text-1)', fontFamily: 'var(--font-display)' }}
                    >
                      {g.subject}
                    </span>
                    <span className="block text-fluid-xs truncate" style={{ color: 'var(--text-3)' }}>
                      {summary}
                    </span>
                  </span>
                  <span
                    className="text-fluid-xs shrink-0"
                    aria-hidden="true"
                    style={{
                      color: 'var(--text-3)',
                      display: 'inline-block',
                      transform: isOpen ? 'rotate(180deg)' : 'none',
                      transition: 'transform 160ms ease',
                    }}
                  >
                    ▾
                  </span>
                </button>
                <div id={panelId} hidden={!isOpen} className={isOpen ? 'mt-2' : undefined}>
                  {isOpen && (
                    <SkillTree
                      nodes={nodes}
                      emptyLabel={isHi ? 'कोई अध्याय नहीं' : 'No chapters yet'}
                    />
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
