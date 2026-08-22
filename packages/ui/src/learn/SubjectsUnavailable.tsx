'use client';

/**
 * SubjectsUnavailable — the three non-happy states of a subject picker.
 *
 * ── Why this exists ──────────────────────────────────────────────────────
 * `GET /api/student/subjects` fails CLOSED: when `get_available_subjects`
 * errors or returns nothing, the route rebuilds the list from
 * `grade_subject_map ⋈ subjects(is_active)` and marks EVERY row locked,
 * because it cannot evaluate the plan join. Two surfaces rendered that
 * response with a bare `.map()`:
 *
 *   • QuizSetup's subject grid → zero tiles, no explanation at all.
 *   • /learn's subject grid    → every subject as a LockedCard reading
 *     "Upgrade to unlock", plus an "Unlock N more subjects" strip. A student
 *     already paying for Pro or Unlimited was told to buy the thing they had
 *     already bought.
 *
 * The product rule this encodes: a lock the app cannot PROVE is a plan lock
 * must never be sold as one. So the copy for `failure` explicitly denies the
 * upgrade reading ("This doesn't mean you've lost access") the same way
 * /learn's chapter-failure copy denies the empty-syllabus reading ("This
 * doesn't mean your course is empty").
 *
 * ── Composition, not a new primitive ─────────────────────────────────────
 * This is a thin arrangement of the canonical `EmptyState`
 * (ui/primitives/EmptyState — role/icon/title/description/action) plus
 * `Touchable` for the >=44px tap target. It introduces no new visual
 * language; it exists so the two surfaces cannot drift apart in copy, and so
 * the strings are pinned in exactly one place for the unit + E2E suites.
 *
 * P7: every string is bilingual via the `isHi` prop.
 * DD-16: the CTA is `--accent-warm-strong` under `--on-accent` ink (never
 * light ink on a bare `--orange`/`--accent-warm` surface).
 */

import { EmptyState } from '../ui/primitives/EmptyState';
import { Touchable } from '../responsive/Touchable';

export type SubjectsUnavailableVariant =
  /** The list could not be established (fetch failed, or served from the
   *  fail-closed fallback). We do NOT know what this student can access. */
  | 'failure'
  /** The list loaded and is genuinely empty — no subjects mapped at all. */
  | 'empty'
  /** The list loaded and every subject in it is a real, provable plan lock. */
  | 'locked';

export interface SubjectsUnavailableProps {
  isHi: boolean;
  variant: SubjectsUnavailableVariant;
  /** Required for `failure` — re-runs the subjects fetch. */
  onRetry?: () => void;
  /** Tighter padding for inline use (e.g. inside the quiz setup form). */
  compact?: boolean;
  className?: string;
}

/* Copy lives here and ONLY here. Both the QuizSetup grid and the /learn grid
 * read from this component, and the test suites assert these exact strings —
 * a silent copy edit is a failing test, not an unnoticed regression. */
export const SUBJECTS_UNAVAILABLE_COPY = {
  failure: {
    title: "Couldn't load your subjects",
    titleHi: 'तुम्हारे विषय लोड नहीं हो सके',
    // The load-bearing sentence: it rules out the upgrade reading.
    description: "This doesn't mean you've lost access to anything — please try again.",
    descriptionHi: 'इसका मतलब यह नहीं कि तुम्हारी पहुँच चली गई — दोबारा कोशिश करो।',
    action: 'Try again',
    actionHi: 'फिर से कोशिश करो',
  },
  empty: {
    title: 'No subjects set up yet',
    titleHi: 'अभी कोई विषय सेट नहीं है',
    description: "We haven't mapped any subjects to your class yet. Support can fix this for you.",
    descriptionHi: 'तुम्हारी कक्षा के लिए अभी कोई विषय नहीं जोड़ा गया है। सहायता टीम इसे ठीक कर देगी।',
    action: 'Get help',
    actionHi: 'मदद लो',
  },
  locked: {
    title: 'No subjects unlocked on your plan',
    titleHi: 'तुम्हारे प्लान में कोई विषय अनलॉक नहीं है',
    description: 'Upgrade to open these subjects up.',
    descriptionHi: 'इन विषयों को खोलने के लिए अपग्रेड करो।',
    action: 'See plans',
    actionHi: 'प्लान देखो',
  },
} as const;

const ICON: Record<SubjectsUnavailableVariant, string> = {
  failure: '⚠️',
  empty: '📚',
  locked: '🔒',
};

/** Warm CTA surface. `--accent-warm-strong` is the AA-safe stop for
 *  `--on-accent` ink; a bare `--orange`/`--accent-warm` is not (DD-16). */
const CTA_STYLE = {
  background: 'var(--accent-warm-strong)',
  color: 'var(--on-accent)',
} as const;

export function SubjectsUnavailable({
  isHi,
  variant,
  onRetry,
  compact = false,
  className,
}: SubjectsUnavailableProps) {
  const copy = SUBJECTS_UNAVAILABLE_COPY[variant];
  const label = isHi ? copy.actionHi : copy.action;

  /* The accessible name is the visible label; the emoji is decorative and
   * aria-hidden so a screen reader announces "Try again", not "warning sign
   * Try again". Touchable guarantees the 44x44 hit area in real layout. */
  const action =
    variant === 'failure' ? (
      onRetry ? (
        <Touchable
          onClick={onRetry}
          className="gap-1.5 rounded-xl px-4 text-sm font-bold"
          style={CTA_STYLE}
        >
          <span aria-hidden="true">🔄</span>
          {label}
        </Touchable>
      ) : null
    ) : (
      <Touchable
        as="a"
        href={variant === 'locked' ? '/pricing' : '/help'}
        className="gap-1.5 rounded-xl px-4 text-sm font-bold"
        style={CTA_STYLE}
      >
        {label}
      </Touchable>
    );

  return (
    <EmptyState
      role={variant === 'failure' ? 'alert' : 'status'}
      icon={ICON[variant]}
      title={isHi ? copy.titleHi : copy.title}
      description={isHi ? copy.descriptionHi : copy.description}
      action={action}
      compact={compact}
      className={className}
    />
  );
}

export default SubjectsUnavailable;
