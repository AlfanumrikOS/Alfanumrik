/**
 * src/lib/state/journey/journey.ts — the unified learning journey.
 *
 * Step 5 of the unified state architecture. A LearnerJourney is the
 * continuous, ordered, replayable timeline of every meaningful thing
 * that happened to a learner across every surface and feature. One
 * timeline, six surfaces consume from it:
 *
 *   - Parent dashboard: "Here's what your child did today"
 *   - Teacher class view: "Live activity in my class"
 *   - Foxy AI: "What is this student currently working on, what have
 *     they struggled with, what just happened?"
 *   - Mesh outcome attribution: "Did our cycle-X change move the metric
 *     for cohorts that adopted it?"
 *   - Super-admin analytics: "Engagement-to-conversion funnel"
 *   - The learner's own progress view
 *
 * Today these surfaces re-implement their own queries against quiz
 * sessions, foxy logs, payment events, mastery deltas, etc. — each
 * with its own filtering, time-window logic, joins. That's the
 * fragmentation we're killing.
 *
 * Architecture:
 *
 *   - The journey is a PROJECTION over state_events, scoped to a
 *     learner and (optionally) a time window. It is not a new table —
 *     it's a function `projectJourney(events) → JourneyEvent[]` plus
 *     short-term caching at the consumer.
 *
 *   - Each JourneyEvent is denormalised on purpose: it carries the
 *     fields a UI needs to render without joining back to subject_codes
 *     or chapter titles. The projector handles the lookups once.
 *
 *   - Surfaces that need "live" updates subscribe to state_events for
 *     this learner's id and re-project incrementally — the projector
 *     is incremental-safe.
 *
 * This file defines the type and the projector. The
 * `buildAiContext()` helper (Step 6) reads journey snapshots for Foxy.
 */

import type { DomainEvent } from '../events/registry';

// ── JourneyEvent — what UIs render ───────────────────────────────────

/**
 * One row in the timeline. Derived from one or more DomainEvents.
 * Shape designed for direct render — surface code shouldn't compute
 * "what happened", just "how to display this".
 */
export interface JourneyEvent {
  /** Stable id for React lists / dedupe. Matches source event_id. */
  id: string;

  /** ISO-8601. Timeline orders DESC by this. */
  occurredAt: string;

  /** Slugged category for filters: 'practice' | 'lesson' | 'ai' | 'milestone' | 'parent' | 'admin'. */
  category: JourneyCategory;

  /** Headline a parent/teacher/student would read. <= 80 chars. */
  title: string;

  /** Optional one-line detail. Keep terse — UIs may truncate. */
  detail: string | null;

  /** Bag of decorations. Use sparingly; UIs may ignore unknown keys. */
  emoji?: string;
  badge?: 'success' | 'warning' | 'milestone' | 'info';

  /** Original source event kind — for filtering and analytics. */
  sourceKind: DomainEvent['kind'];
}

export type JourneyCategory =
  | 'practice'   // quiz, problem set
  | 'lesson'    // lesson watched, chapter unlocked
  | 'ai'        // foxy session, ai solve
  | 'milestone' // mastery threshold crossed, streak hit
  | 'parent'    // parent linked, parent viewed report
  | 'admin';    // school admin action affecting this learner

// ── Projector ────────────────────────────────────────────────────────

/**
 * Project an ordered list of DomainEvents (already filtered to a single
 * learner) into JourneyEvents. Pure, deterministic, testable.
 *
 * Conventions:
 *   - Each input event becomes EXACTLY ONE JourneyEvent unless we
 *     deliberately drop it (e.g., we hide internal `mesh.cycle_completed`
 *     from learner-facing journeys — it lives in the audit log only).
 *   - Multiple events can collapse into one JourneyEvent in the FUTURE
 *     (e.g., burst of mastery_changed during a single quiz → one "5
 *     chapters improved" entry). The current projector is 1:1 to keep
 *     the rendering surface trivial; merging is Phase 2.
 */
export function projectJourney(events: DomainEvent[]): JourneyEvent[] {
  const out: JourneyEvent[] = [];
  for (const e of events) {
    const j = projectOne(e);
    if (j) out.push(j);
  }
  // Stable sort by occurredAt DESC, breaking ties by id (lexicographic
  // on UUID — deterministic, no real ordering meaning, just stable).
  out.sort((a, b) => {
    if (a.occurredAt === b.occurredAt) return a.id.localeCompare(b.id);
    return b.occurredAt.localeCompare(a.occurredAt);
  });
  return out;
}

function projectOne(e: DomainEvent): JourneyEvent | null {
  switch (e.kind) {
    case 'learner.signed_up':
      return {
        id: e.eventId,
        occurredAt: e.occurredAt,
        category: 'milestone',
        title: 'Started learning on Alfanumrik',
        detail: `Grade ${e.payload.grade}, ${e.payload.board}, ${e.payload.language === 'hi' ? 'Hindi' : 'English'}`,
        emoji: '🎉',
        badge: 'milestone',
        sourceKind: e.kind,
      };
    case 'learner.session_started':
      // Hide from learner-facing journey — too noisy. Keep available
      // via raw events for analytics.
      return null;
    case 'learner.quiz_completed': {
      const accuracy = e.payload.questionCount === 0
        ? 0
        : Math.round((e.payload.correctCount / e.payload.questionCount) * 100);
      return {
        id: e.eventId,
        occurredAt: e.occurredAt,
        category: 'practice',
        title: `Quiz — ${e.payload.subjectCode} ch. ${e.payload.chapterNumber}`,
        detail: `${e.payload.correctCount}/${e.payload.questionCount} correct (${accuracy}%) · +${e.payload.xpEarned} XP`,
        emoji: accuracy >= 80 ? '🎯' : accuracy >= 50 ? '📝' : '💪',
        badge: accuracy >= 80 ? 'success' : accuracy < 40 ? 'warning' : 'info',
        sourceKind: e.kind,
      };
    }
    case 'learner.lesson_completed':
      return {
        id: e.eventId,
        occurredAt: e.occurredAt,
        category: 'lesson',
        title: `Lesson — ${e.payload.subjectCode} ch. ${e.payload.chapterNumber}`,
        detail: `${Math.round(e.payload.durationSec / 60)} min`,
        emoji: '📚',
        badge: 'info',
        sourceKind: e.kind,
      };
    case 'learner.mastery_changed': {
      const direction = e.payload.toMastery > (e.payload.fromMastery ?? 0) ? 'improved' : 'slipped';
      // Only surface mastery threshold crossings (0.5 → strong, 0.8 →
      // mastered). Continuous wobble is noise.
      const crossed =
        (e.payload.fromMastery ?? 0) < 0.5 && e.payload.toMastery >= 0.5
          ? 'strong'
          : (e.payload.fromMastery ?? 0) < 0.8 && e.payload.toMastery >= 0.8
            ? 'mastered'
            : null;
      if (!crossed) return null;
      return {
        id: e.eventId,
        occurredAt: e.occurredAt,
        category: 'milestone',
        title: crossed === 'mastered'
          ? `Mastered ${e.payload.subjectCode} ch. ${e.payload.chapterNumber}`
          : `Strong on ${e.payload.subjectCode} ch. ${e.payload.chapterNumber}`,
        detail: `${direction} to ${Math.round(e.payload.toMastery * 100)}%`,
        emoji: crossed === 'mastered' ? '🏆' : '⭐',
        badge: 'milestone',
        sourceKind: e.kind,
      };
    }
    case 'ai.foxy_session_started':
      // Hide start; surface only completed sessions to keep the timeline tidy.
      return null;
    case 'ai.foxy_session_completed':
      return {
        id: e.eventId,
        occurredAt: e.occurredAt,
        category: 'ai',
        title: `Talked to Foxy${e.payload.helpful === true ? ' — helpful' : e.payload.helpful === false ? " — wasn't helpful" : ''}`,
        detail: `${e.payload.turnCount} turn${e.payload.turnCount === 1 ? '' : 's'} · ${Math.round(e.payload.durationSec / 60)} min`,
        emoji: '🦊',
        badge: e.payload.helpful === false ? 'warning' : 'info',
        sourceKind: e.kind,
      };
    case 'parent.linked_to_learner':
      return {
        id: e.eventId,
        occurredAt: e.occurredAt,
        category: 'parent',
        title: 'A parent linked to your account',
        detail: e.payload.verificationMethod === 'otp' ? 'verified by OTP' : null,
        emoji: '👨‍👩‍👧',
        badge: 'info',
        sourceKind: e.kind,
      };
    case 'parent.report_viewed':
      // Hidden from learner-facing; surfaced on parent-facing journey.
      return null;
    case 'teacher.assignment_created':
      return {
        id: e.eventId,
        occurredAt: e.occurredAt,
        category: 'admin',
        title: `New assignment — ${e.payload.subjectCode}`,
        detail: e.payload.dueAt ? `due ${e.payload.dueAt.slice(0, 10)}` : null,
        emoji: '📋',
        badge: 'info',
        sourceKind: e.kind,
      };
    case 'school.module_toggled':
      return null; // admin-only signal
    case 'billing.invoice_paid':
      return {
        id: e.eventId,
        occurredAt: e.occurredAt,
        category: 'admin',
        title: 'Subscription renewed',
        detail: `₹${e.payload.amountInr / 100} · ${e.payload.planSlug}`,
        emoji: '✅',
        badge: 'success',
        sourceKind: e.kind,
      };
    case 'mesh.cycle_completed':
      return null; // internal — never on learner journeys
    default: {
      // Exhaustiveness check — the compiler errors here if a new event
      // kind is added to the registry without a projector entry.
      const _exhaustive: never = e;
      void _exhaustive;
      return null;
    }
  }
}

// ── Helpers for surfaces ─────────────────────────────────────────────

/** Group projected events by calendar day (YYYY-MM-DD, IST). Useful
 *  for the parent dashboard's "today / yesterday / this week" view. */
export function groupByIstDay(
  events: JourneyEvent[],
): Array<{ ymd: string; events: JourneyEvent[] }> {
  const groups = new Map<string, JourneyEvent[]>();
  for (const e of events) {
    const ymd = toIstYmd(e.occurredAt);
    if (!groups.has(ymd)) groups.set(ymd, []);
    groups.get(ymd)!.push(e);
  }
  return Array.from(groups.entries())
    .sort((a, b) => b[0].localeCompare(a[0]))
    .map(([ymd, events]) => ({ ymd, events }));
}

function toIstYmd(iso: string): string {
  // Convert UTC iso to IST (UTC+5:30) and emit YYYY-MM-DD.
  const t = Date.parse(iso) + 5.5 * 60 * 60 * 1000;
  const d = new Date(t);
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(d.getUTCDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}
