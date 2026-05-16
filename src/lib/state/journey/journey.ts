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
    case 'learner.review_graded': {
      const qualityLabel =
        e.payload.quality === 0 ? 'forgot'
        : e.payload.quality === 3 ? 'hard'
        : e.payload.quality === 4 ? 'good'
        : 'easy';
      return {
        id: e.eventId,
        occurredAt: e.occurredAt,
        category: 'practice',
        title: `Reviewed ${e.payload.subjectCode} ch. ${e.payload.chapterNumber}`,
        detail: `${qualityLabel} · interval ${e.payload.previousIntervalDays}d`,
        emoji: e.payload.quality >= 4 ? '🔁' : '💪',
        badge: e.payload.quality >= 4 ? 'success' : 'info',
        sourceKind: e.kind,
      };
    }
    case 'learner.scan_extracted':
      return {
        id: e.eventId,
        occurredAt: e.occurredAt,
        category: 'practice',
        title: e.payload.subjectCode
          ? `Scanned ${e.payload.imageType.replace('_', ' ')} — ${e.payload.subjectCode}`
          : `Scanned ${e.payload.imageType.replace('_', ' ')}`,
        detail: e.payload.questionCount > 0
          ? `${e.payload.questionCount} question${e.payload.questionCount === 1 ? '' : 's'} extracted`
          : null,
        emoji: '📷',
        badge: 'info',
        sourceKind: e.kind,
      };
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
    case 'parent.consent_granted':
      // Phase D.1 — DPDP consent grant. Surfaces on the parent-facing
      // journey as an administrative "you signed the consent form" card.
      // Not part of the learner's own timeline (the learner did nothing);
      // the audit/notification subscribers consume it from the bus.
      return {
        id: e.eventId,
        occurredAt: e.occurredAt,
        category: 'parent',
        title: 'Parent consent recorded',
        detail: `Consent version ${e.payload.consentVersion}`,
        emoji: '✅',
        badge: 'info',
        sourceKind: e.kind,
      };
    case 'parent.consent_revoked':
      // Phase D.1 — DPDP consent revocation. Same rationale as the
      // grant card: surface so the parent can see the action in their
      // own timeline, but treat it as parent-actor, not learner-actor.
      return {
        id: e.eventId,
        occurredAt: e.occurredAt,
        category: 'parent',
        title: 'Parent consent revoked',
        detail: `Consent version ${e.payload.consentVersion}`,
        emoji: '🛑',
        badge: 'warning',
        sourceKind: e.kind,
      };
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
    case 'teacher.classroom_created':
    case 'teacher.classroom_updated':
    case 'teacher.classroom_archived':
    case 'teacher.student_note_set':
    case 'teacher.profile_updated':
    case 'teacher.submission_reviewed':
    case 'teacher.grade_entry_set':
    case 'teacher.parent_message_sent':
      // Teacher-side admin events — not surfaced on learner-facing journey
      // (they describe teacher actions on classroom/student, not learner state
      // changes). Audit/notification subscribers consume these instead.
      // Phase C.1: teacher.submission_reviewed could surface to learner
      // when a parent-facing journey adds review notifications — kept null
      // here to keep the learner timeline focused on their own work.
      // Phase C.2: teacher.grade_entry_set is a teacher-driven roll-up cell
      // edit — the learner journey shouldn't reflect a teacher's grade book
      // until we wire a parent-facing report-card surface that consumes it.
      // Phase C.3: teacher.parent_message_sent is sender-side admin — the
      // learner journey only shows what the LEARNER did. The parent's
      // counterpart (parent.teacher_message_sent) is rendered on the
      // parent-facing journey below; this case stays null.
      return null;
    case 'parent.teacher_message_sent':
      // Phase C.3. Parent-side messaging surfaces as a 'parent' category card
      // on parent-facing journeys; the learner timeline ignores it (the
      // category filter excludes 'parent' in the learner UI).
      return {
        id: e.eventId,
        occurredAt: e.occurredAt,
        category: 'parent',
        title: 'A parent messaged your teacher',
        detail: e.payload.isNewThread ? 'new conversation' : null,
        emoji: '💬',
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
    case 'learner.concept_check_answered':
      // ADR-004 Phase 2 — high-volume signal (one per /api/tutor/answer call).
      // Surfaced separately on the tutor page from concept_mastery rather than
      // as a journey card; keeping it out here avoids spamming the timeline.
      return null;
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
