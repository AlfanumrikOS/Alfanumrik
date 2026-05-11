/**
 * src/lib/state/student-state.ts — the canonical student state model.
 *
 * THE NON-NEGOTIABLE: every Alfanumrik feature reads from and contributes
 * to this single shape. Quiz, Foxy, mastery, parent reports, teacher
 * dashboards, school admin views, super-admin analytics — none of them
 * carries its own private model of "what a student is." They all read
 * `StudentState`, they all emit events that the Orchestrator folds back
 * into `StudentState`.
 *
 * StudentState is a PROJECTION, not a row. It's computed from existing
 * Supabase tables (students, mastery_state, quiz_sessions, foxy_sessions,
 * school_admins, subscriptions, …) by `buildStudentState()`. The
 * Orchestrator caches it for a short TTL; subscribers to the event bus
 * invalidate the cache on relevant events.
 *
 * Five non-negotiables this model enforces:
 *
 *   1. **Single identity.** authUserId is THE identifier across every
 *      surface (web, Flutter, parent app, teacher portal, admin reports).
 *      Anything currently keying by studentId or email-with-tenant gets
 *      adapted upstream — downstream code only sees authUserId.
 *
 *   2. **Tenant context is part of identity.** A student in a white-label
 *      school is a different unit than the same email signed up B2C.
 *      tenantId disambiguates. RLS + RBAC follow.
 *
 *   3. **Mastery is the source of truth for "what they know."** No
 *      feature reaches into raw quiz history or BKT priors. Mastery rolls
 *      up to subject- and chapter-grain; downstream consumers query
 *      mastery, not the underlying signals.
 *
 *   4. **Engagement is a first-class field, not derived ad-hoc.** Streak
 *      counters, last session, time-on-task — all live here. Teacher and
 *      parent dashboards read these directly instead of recomputing per
 *      page.
 *
 *   5. **Live session state is part of the student.** If the student is
 *      mid-quiz or in a Foxy conversation right now, every other surface
 *      can see that and respond (parent view shows "Studying now",
 *      teacher dashboard shows live participation).
 *
 * Schema versioning: this file's exported types are the contract. When
 * the shape evolves, bump StudentState.schemaVersion. Consumers can
 * branch on the version; the Orchestrator's cache invalidates on bump.
 */

import { z } from 'zod';

// Shape-only UUID validator (Zod v4's `.uuid()` enforces RFC 4122
// variant bits, which fixture UUIDs like `1111-…-1111` fail. We don't
// need cryptographic UUID guarantees in the state model — just shape).
const uuidLike = () => z.string().regex(/^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/);
const isoDatetime = () => z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/);

// ── Discriminated unions for live state ─────────────────────────────

export const LiveSessionStateSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('idle') }),
  z.object({
    kind: z.literal('in_quiz'),
    quizSessionId: uuidLike(),
    subjectCode: z.string(),
    chapterNumber: z.number().int().positive(),
    startedAt: isoDatetime(),
    questionCount: z.number().int().nonnegative(),
    questionsAnswered: z.number().int().nonnegative(),
  }),
  z.object({
    kind: z.literal('in_foxy'),
    foxySessionId: uuidLike(),
    subjectCode: z.string().nullable(),
    startedAt: isoDatetime(),
    turnCount: z.number().int().nonnegative(),
  }),
  z.object({
    kind: z.literal('in_lesson'),
    lessonId: uuidLike(),
    subjectCode: z.string(),
    chapterNumber: z.number().int().positive(),
    startedAt: isoDatetime(),
  }),
]);

export type LiveSessionState = z.infer<typeof LiveSessionStateSchema>;

// ── Per-subject / per-chapter mastery rollup ─────────────────────────

export const ChapterMasterySchema = z.object({
  chapterNumber: z.number().int().positive(),
  // BKT mastery in [0,1]; null = no signal yet for this chapter.
  mastery: z.number().min(0).max(1).nullable(),
  // ISO-8601 of the last interaction that updated this chapter's mastery.
  lastUpdatedAt: isoDatetime().nullable(),
  // Number of questions attempted across all sessions for this chapter.
  attempts: z.number().int().nonnegative(),
});

export const SubjectMasterySchema = z.object({
  subjectCode: z.string(),
  // Weighted mean across chapters where chapter has signal. Null if no
  // chapter in this subject has been touched yet.
  meanMastery: z.number().min(0).max(1).nullable(),
  // Per-chapter detail. Always sorted by chapterNumber ASC.
  chapters: z.array(ChapterMasterySchema),
});

export type SubjectMastery = z.infer<typeof SubjectMasterySchema>;

// ── Engagement / streak block ────────────────────────────────────────

export const EngagementSchema = z.object({
  // Streak in consecutive days with at least one learning event.
  currentStreakDays: z.number().int().nonnegative(),
  longestStreakDays: z.number().int().nonnegative(),
  lastActiveAt: isoDatetime().nullable(),
  // Cumulative time-on-task in seconds across all sessions.
  totalTimeOnTaskSec: z.number().int().nonnegative(),
  // XP balance. Source of truth lives in xp_ledger; this is the rollup.
  xpBalance: z.number().int().nonnegative(),
});

// ── Tenant / access ──────────────────────────────────────────────────

export const TenantContextSchema = z.object({
  // Null for B2C learners; the school's id for white-label tenants.
  tenantId: uuidLike().nullable(),
  tenantType: z.enum(['b2c', 'school', 'b2b_org']),
  // Module slugs enabled for this learner's tenant (or platform defaults
  // for B2C). E.g. ['foxy_tutor', 'quiz_engine', 'live_classes', …].
  // The sidebar / nav reads this directly.
  enabledModules: z.array(z.string()),
  // Free-form AI personality override set by the tenant for Foxy.
  aiPersonality: z.string().nullable(),
});

// ── Access / subscription / consent ──────────────────────────────────

export const AccessSchema = z.object({
  planSlug: z.enum(['free', 'starter', 'family', 'school', 'school_pro']),
  isTrialing: z.boolean(),
  trialEndsAt: isoDatetime().nullable(),
  // Aggregate from per-feature usage; consumers shouldn't dig into raw
  // usage rows. Caps are plan-dependent.
  usageThisMonth: z.object({
    foxyMinutes: z.number().int().nonnegative(),
    quizSessions: z.number().int().nonnegative(),
  }),
});

export const ConsentSchema = z.object({
  // DPDP Act requirement: minors need a verified parent link.
  isMinor: z.boolean(),
  parentLinkVerified: z.boolean(),
  // Cookie + analytics consent (most users in EU/IN: explicit).
  analyticsConsent: z.boolean(),
});

// ── The full state ───────────────────────────────────────────────────

export const StudentStateSchema = z.object({
  schemaVersion: z.literal(1),
  // Built-at marker — consumers can decide whether to trust a stale read.
  builtAt: isoDatetime(),

  // Identity (cardinal — every other field is owned by this id)
  authUserId: uuidLike(),
  studentId: uuidLike(),
  displayName: z.string().min(1).max(80),
  grade: z.string(), // e.g. '6'..'12'
  board: z.enum(['CBSE', 'ICSE', 'STATE', 'OTHER']),
  language: z.enum(['en', 'hi']),

  // Tenant + access
  tenant: TenantContextSchema,
  access: AccessSchema,
  consent: ConsentSchema,

  // Knowledge (what they know)
  mastery: z.array(SubjectMasterySchema),

  // Engagement (how they're showing up)
  engagement: EngagementSchema,

  // Live (what they're doing right now)
  live: LiveSessionStateSchema,

  // Optional pointers — null when not applicable
  classroomId: uuidLike().nullable(),  // teacher's class assignment
  parentIds: z.array(uuidLike()),       // verified parent auth_user_ids
});

export type StudentState = z.infer<typeof StudentStateSchema>;

// ── Builder (DB → state) ─────────────────────────────────────────────
//
// The implementation deliberately lives in a separate file so this
// module exports types + schema as a pure dependency. See
// src/lib/state/student-state-builder.ts for the read-side queries.
// Exported here only as the type the Orchestrator calls.

export type StudentStateBuilder = (authUserId: string) => Promise<StudentState>;

// ── Helpers ──────────────────────────────────────────────────────────

/**
 * Pick a single subject's mastery by code, or null if no signal yet.
 * Pure helper — useful for rules and the AI context builder.
 */
export function pickSubjectMastery(
  s: StudentState,
  subjectCode: string,
): SubjectMastery | null {
  return s.mastery.find(m => m.subjectCode === subjectCode) ?? null;
}

/**
 * "Weakest chapter" candidate across all subjects, used by Foxy and the
 * next-quiz rule. Returns null if the student has no mastery signal at
 * all (a fresh signup before their first quiz).
 */
export function weakestChapter(s: StudentState): {
  subjectCode: string;
  chapterNumber: number;
  mastery: number;
} | null {
  let pick: { subjectCode: string; chapterNumber: number; mastery: number } | null = null;
  for (const subject of s.mastery) {
    for (const chapter of subject.chapters) {
      if (chapter.mastery === null) continue;
      if (pick === null || chapter.mastery < pick.mastery) {
        pick = {
          subjectCode: subject.subjectCode,
          chapterNumber: chapter.chapterNumber,
          mastery: chapter.mastery,
        };
      }
    }
  }
  return pick;
}

/** True if the student is mid-activity (any non-idle live state). */
export function isLive(s: StudentState): boolean {
  return s.live.kind !== 'idle';
}
