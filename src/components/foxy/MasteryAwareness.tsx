'use client';

/**
 * MasteryAwareness — the mastery-aware nudge inside the Foxy ContextPanel
 * (ff_student_os_v1). Shows the active subject and, when the engine flags a
 * weak/decayed topic, a one-tap "practice this?" suggestion.
 *
 * IMPORTANT (P12 / REG-55): this component issues NO new AI call. The
 * suggestion is delivered to the parent Foxy page via the `onSuggest`
 * callback, which routes it through the EXISTING mode/prompt mechanism
 * (switchMode / sendMessage with the standard autoPrompt/autoPromptHi). The
 * structured-render envelope, the 7 modes, daily limits, and scope-lock are
 * untouched.
 *
 * Data comes from the existing `useMasteryOverview` (get_mastery_overview RPC);
 * weak-topic selection is the pure `weakestStartedTopic` helper — no mastery
 * is computed here. Bilingual via isHi. Mastery encoded with a numeric label +
 * ring colour, never colour alone (WCAG 1.4.1).
 */

import { useMasteryOverview } from '@/lib/swr';
import { MasteryRing, Skeleton } from '@/components/ui';
import {
  weakestStartedTopic,
  masteryPercent,
  type MasteryOverviewRow,
} from '@/lib/dashboard/mastery-buckets';

export interface MasterySuggestion {
  /** Topic title for the prompt scope. */
  topicTitle: string;
  /** 'practice' maps to the existing practice/revise mode. */
  kind: 'practice' | 'revise';
}

interface MasteryAwarenessProps {
  isHi: boolean;
  studentId: string | undefined;
  activeSubjectName: string;
  activeSubjectIcon: string;
  /** Subject code (e.g. 'science', 'math') used to scope the nudge to the
   *  current subject. When provided, weakestStartedTopic filters to this
   *  subject before falling back to cross-subject. */
  activeSubject?: string;
  /** Called when the student taps the nudge. Parent routes via existing modes. */
  onSuggest: (s: MasterySuggestion) => void;
}

export default function MasteryAwareness({
  isHi,
  studentId,
  activeSubjectName,
  activeSubjectIcon,
  activeSubject,
  onSuggest,
}: MasteryAwarenessProps) {
  const { data, isLoading, error } = useMasteryOverview(studentId);
  const rows: MasteryOverviewRow[] = Array.isArray(data) ? (data as MasteryOverviewRow[]) : [];
  // RCA-FIX MEDIUM-UX-9: filter to the active subject before selecting the
  // weakest topic so a student studying Chemistry gets a Chemistry nudge,
  // not a cross-subject Math nudge. Fall back to the full set if the active
  // subject has no started topics yet (preserves the useful cross-subject case).
  const subjectRows = activeSubject
    ? rows.filter((r) => r.subject === activeSubject)
    : rows;
  const weak = weakestStartedTopic(subjectRows.length > 0 ? subjectRows : rows);

  if (isLoading && !data) {
    return (
      <div className="p-3">
        <Skeleton width="60%" height={12} className="mb-2" />
        <Skeleton height={64} rounded="rounded-2xl" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-3">
        <p className="text-xs leading-relaxed px-1" style={{ color: 'var(--text-3)' }} role="status">
          {isHi
            ? 'अभी लोड नहीं हो पाया — रीफ़्रेश करके फिर देखो।'
            : "Couldn't load right now — pull to refresh."}
        </p>
      </div>
    );
  }

  return (
    <div className="p-3">
      {/* Active subject line. */}
      <div className="flex items-center gap-2 mb-3">
        <span className="text-base" aria-hidden="true">{activeSubjectIcon}</span>
        <span className="text-xs font-bold uppercase tracking-wide" style={{ color: 'var(--text-3)' }}>
          {isHi ? 'अभी पढ़ रहे हैं' : 'Studying now'}
        </span>
        <span className="text-xs font-semibold ml-auto truncate" style={{ color: 'var(--text-1)' }}>
          {activeSubjectName}
        </span>
      </div>

      {weak ? (
        <button
          type="button"
          onClick={() =>
            onSuggest({
              topicTitle: weak.title || '',
              kind: weak.due_for_review ? 'revise' : 'practice',
            })
          }
          className="w-full text-left rounded-2xl p-3 flex items-center gap-3 transition-all active:scale-[0.99] focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2"
          style={{
            background: 'var(--surface-2)',
            border: '1px solid var(--border)',
            minHeight: 48,
          }}
          aria-label={
            isHi
              ? `${weak.title} में ${masteryPercent(weak)}% — अभ्यास करें`
              : `${weak.title} at ${masteryPercent(weak)}% — practice this`
          }
        >
          <MasteryRing value={masteryPercent(weak)} size={40} strokeWidth={4} />
          <span className="flex-1 min-w-0">
            <span className="block text-xs font-bold" style={{ color: 'var(--orange, #E8581C)' }}>
              {weak.due_for_review
                ? isHi ? 'दोहराने का समय' : 'Time to revise'
                : isHi ? 'कमज़ोर विषय' : 'Weak spot'}
            </span>
            <span className="block text-sm font-semibold truncate" style={{ color: 'var(--text-1)' }}>
              {isHi && weak.title_hi ? weak.title_hi : weak.title}
            </span>
            <span className="block text-xs mt-0.5" style={{ color: 'var(--text-3)' }}>
              {isHi ? 'इसका अभ्यास करें?' : 'Practise this?'}
              {' '}
              <span aria-hidden="true">→</span>
            </span>
          </span>
        </button>
      ) : (
        <p className="text-xs leading-relaxed px-1" style={{ color: 'var(--text-3)' }}>
          {isHi
            ? 'बढ़िया! अभी कोई कमज़ोर विषय नहीं। आगे बढ़ते रहो।'
            : 'Looking strong — no weak spots right now. Keep going!'}
        </p>
      )}
    </div>
  );
}
