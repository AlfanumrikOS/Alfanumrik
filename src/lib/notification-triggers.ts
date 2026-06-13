/**
 * Notification Triggers — Parent Engagement System
 *
 * Fires in-app notifications to linked guardians when student events occur.
 * All functions are fire-and-forget: they catch their own errors and never
 * throw, so callers do not need try/catch.
 *
 * P7 (Bilingual): Every notification stores English body in `body` and
 * Hindi body in `body_hi`. The recipient_type is 'guardian' per the schema
 * used by daily-cron.
 *
 * P13 (Privacy): Student names and guardian phone numbers are never logged.
 * Only opaque IDs and aggregate/scalar values appear in log output.
 */

import { supabaseAdmin } from '@/lib/supabase-admin';
import { logger } from '@/lib/logger';

// ─── Internal helpers ─────────────────────────────────────────────────────────

interface GuardianRecord {
  id: string;
  auth_user_id: string | null;
  notification_preferences: Record<string, unknown> | null;
  preferred_language: string | null;
}

interface LinkedGuardian {
  guardian_id: string;
  // Supabase returns a joined 1:1 relation as an array; we treat index 0 as the record.
  guardians: GuardianRecord | GuardianRecord[] | null;
}

/**
 * Fetch all approved guardian links for a student, including guardian
 * notification preferences and language preference.
 */
async function getApprovedGuardians(studentId: string): Promise<LinkedGuardian[]> {
  const { data, error } = await supabaseAdmin
    .from('guardian_student_links')
    .select(
      `guardian_id,
       guardians (
         id,
         auth_user_id,
         notification_preferences,
         preferred_language
       )`
    )
    .eq('student_id', studentId)
    .eq('status', 'approved');

  if (error) {
    logger.error('notification_triggers: failed to fetch guardian links', {
      error: new Error(error.message),
      studentId,
    });
    return [];
  }

  return (data ?? []) as unknown as LinkedGuardian[];
}

/**
 * Normalise the guardians join result.
 * Supabase returns 1:1 foreign-key joins as a single object in the JS SDK but
 * the inferred TypeScript type may appear as an array. This helper handles both.
 */
function resolveGuardian(raw: GuardianRecord | GuardianRecord[] | null): GuardianRecord | null {
  if (!raw) return null;
  if (Array.isArray(raw)) return raw[0] ?? null;
  return raw;
}

/**
 * Check whether a guardian has a specific notification type enabled.
 * Defaults to true (all notifications enabled) if preferences are null/missing.
 */
function isNotificationEnabled(
  prefs: Record<string, unknown> | null,
  notificationType: string,
): boolean {
  if (!prefs) return true;
  // Support both flat boolean flags and nested enabled objects
  const key = notificationType;
  if (typeof prefs[key] === 'boolean') return prefs[key] as boolean;
  if (prefs[key] && typeof prefs[key] === 'object') {
    const nested = prefs[key] as Record<string, unknown>;
    if (typeof nested.enabled === 'boolean') return nested.enabled;
  }
  return true;
}

interface NotificationRow {
  recipient_type: string;
  recipient_id: string;
  type: string;
  title: string;
  body: string;
  body_hi: string;
  data: Record<string, unknown>;
  is_read: boolean;
  created_at: string;
}

// ─── Public trigger functions ─────────────────────────────────────────────────

/**
 * Triggered when a student completes a quiz.
 * Sends a score notification to every approved linked guardian.
 */
export async function onQuizCompleted(
  studentId: string,
  quizData: {
    subject: string;
    score: number;
    xpEarned: number;
    totalQuestions: number;
    correctAnswers: number;
  },
): Promise<void> {
  try {
    const guardians = await getApprovedGuardians(studentId);
    if (guardians.length === 0) return;

    const { subject, score, xpEarned, totalQuestions, correctAnswers } = quizData;
    const now = new Date().toISOString();
    const rows: NotificationRow[] = [];

    for (const link of guardians) {
      const guardian = resolveGuardian(link.guardians);
      if (!guardian?.id) continue;
      if (!isNotificationEnabled(guardian.notification_preferences, 'quiz_result')) continue;

      rows.push({
        recipient_type: 'guardian',
        recipient_id: guardian.id,
        type: 'quiz_result',
        title: `Quiz completed: ${subject}`,
        body: `Your child scored ${score}% on ${subject} (${correctAnswers}/${totalQuestions} correct) and earned +${xpEarned} XP.`,
        body_hi: `आपके बच्चे ने ${subject} में ${score}% अंक प्राप्त किए (${correctAnswers}/${totalQuestions} सही) और +${xpEarned} XP अर्जित किए।`,
        data: {
          student_id: studentId,
          subject,
          score,
          xp_earned: xpEarned,
          total_questions: totalQuestions,
          correct_answers: correctAnswers,
          trigger: 'quiz_completed',
        },
        is_read: false,
        created_at: now,
      });
    }

    if (rows.length === 0) return;

    const { error } = await supabaseAdmin.from('notifications').insert(rows);
    if (error) {
      logger.error('notification_triggers: onQuizCompleted insert failed', {
        error: new Error(error.message),
        studentId,
        subject,
        guardianCount: rows.length,
      });
      return;
    }

    logger.info('notification_triggers: onQuizCompleted sent', {
      studentId,
      subject,
      score,
      guardianCount: rows.length,
    });
  } catch (err) {
    logger.error('notification_triggers: onQuizCompleted unexpected error', {
      error: err instanceof Error ? err : new Error(String(err)),
      studentId,
    });
  }
}

/**
 * Triggered when a student's accuracy in a subject drops below 50%.
 * Only fires if accuracy < 50 (enforced here, not left to the caller).
 */
export async function onLowAccuracy(
  studentId: string,
  subject: string,
  accuracy: number,
): Promise<void> {
  if (accuracy >= 50) return;

  try {
    const guardians = await getApprovedGuardians(studentId);
    if (guardians.length === 0) return;

    const now = new Date().toISOString();
    const rows: NotificationRow[] = [];

    for (const link of guardians) {
      const guardian = resolveGuardian(link.guardians);
      if (!guardian?.id) continue;
      if (!isNotificationEnabled(guardian.notification_preferences, 'daily_progress')) continue;

      rows.push({
        recipient_type: 'guardian',
        recipient_id: guardian.id,
        type: 'daily_progress',
        title: `Low accuracy in ${subject}`,
        body: `Your child scored ${accuracy}% accuracy in ${subject} recently. Extra practice in this topic would help.`,
        body_hi: `आपके बच्चे की ${subject} में हाल ही में ${accuracy}% सटीकता रही। इस विषय में अतिरिक्त अभ्यास सहायक होगा।`,
        data: {
          student_id: studentId,
          subject,
          accuracy,
          trigger: 'low_accuracy',
        },
        is_read: false,
        created_at: now,
      });
    }

    if (rows.length === 0) return;

    const { error } = await supabaseAdmin.from('notifications').insert(rows);
    if (error) {
      logger.error('notification_triggers: onLowAccuracy insert failed', {
        error: new Error(error.message),
        studentId,
        subject,
        accuracy,
        guardianCount: rows.length,
      });
      return;
    }

    logger.info('notification_triggers: onLowAccuracy sent', {
      studentId,
      subject,
      accuracy,
      guardianCount: rows.length,
    });
  } catch (err) {
    logger.error('notification_triggers: onLowAccuracy unexpected error', {
      error: err instanceof Error ? err : new Error(String(err)),
      studentId,
    });
  }
}

/**
 * Triggered when a student's study streak is broken (missed a day).
 * Sends a streak_risk notification to all approved linked guardians.
 */
export async function onStreakBroken(studentId: string): Promise<void> {
  try {
    const guardians = await getApprovedGuardians(studentId);
    if (guardians.length === 0) return;

    const now = new Date().toISOString();
    const rows: NotificationRow[] = [];

    for (const link of guardians) {
      const guardian = resolveGuardian(link.guardians);
      if (!guardian?.id) continue;
      if (!isNotificationEnabled(guardian.notification_preferences, 'streak_risk')) continue;

      rows.push({
        recipient_type: 'guardian',
        recipient_id: guardian.id,
        type: 'streak_risk',
        title: 'Study streak broken',
        body: 'Your child missed their daily study session and their streak has been reset. Encourage them to start a new streak today!',
        body_hi: 'आपके बच्चे ने अपना दैनिक अध्ययन सत्र छोड़ दिया और उनकी स्ट्रीक रीसेट हो गई है। उन्हें आज नई स्ट्रीक शुरू करने के लिए प्रोत्साहित करें!',
        data: {
          student_id: studentId,
          trigger: 'streak_broken',
        },
        is_read: false,
        created_at: now,
      });
    }

    if (rows.length === 0) return;

    const { error } = await supabaseAdmin.from('notifications').insert(rows);
    if (error) {
      logger.error('notification_triggers: onStreakBroken insert failed', {
        error: new Error(error.message),
        studentId,
        guardianCount: rows.length,
      });
      return;
    }

    logger.info('notification_triggers: onStreakBroken sent', {
      studentId,
      guardianCount: rows.length,
    });
  } catch (err) {
    logger.error('notification_triggers: onStreakBroken unexpected error', {
      error: err instanceof Error ? err : new Error(String(err)),
      studentId,
    });
  }
}

/**
 * Triggered by the weekly digest job.
 * Sends a weekly_summary notification summarising the student's week.
 */
export async function onWeeklyDigest(
  studentId: string,
  weekData: {
    quizzesCompleted: number;
    avgScore: number;
    xpEarned: number;
    streakDays: number;
  },
): Promise<void> {
  try {
    const guardians = await getApprovedGuardians(studentId);
    if (guardians.length === 0) return;

    const { quizzesCompleted, avgScore, xpEarned, streakDays } = weekData;
    const now = new Date().toISOString();
    const rows: NotificationRow[] = [];

    for (const link of guardians) {
      const guardian = resolveGuardian(link.guardians);
      if (!guardian?.id) continue;
      if (!isNotificationEnabled(guardian.notification_preferences, 'parent_daily_report')) continue;

      rows.push({
        recipient_type: 'guardian',
        recipient_id: guardian.id,
        type: 'parent_daily_report',
        title: 'Weekly learning summary',
        body: `This week: ${quizzesCompleted} quiz${quizzesCompleted !== 1 ? 'zes' : ''} completed, average score ${avgScore}%, +${xpEarned} XP earned, ${streakDays}-day streak.`,
        body_hi: `इस सप्ताह: ${quizzesCompleted} क्विज़ पूरी${quizzesCompleted !== 1 ? 'ं' : ''}, औसत अंक ${avgScore}%, +${xpEarned} XP अर्जित, ${streakDays} दिन की स्ट्रीक।`,
        data: {
          student_id: studentId,
          quizzes_completed: quizzesCompleted,
          avg_score: avgScore,
          xp_earned: xpEarned,
          streak_days: streakDays,
          trigger: 'weekly_digest',
        },
        is_read: false,
        created_at: now,
      });
    }

    if (rows.length === 0) return;

    const { error } = await supabaseAdmin.from('notifications').insert(rows);
    if (error) {
      logger.error('notification_triggers: onWeeklyDigest insert failed', {
        error: new Error(error.message),
        studentId,
        guardianCount: rows.length,
      });
      return;
    }

    logger.info('notification_triggers: onWeeklyDigest sent', {
      studentId,
      quizzesCompleted,
      avgScore,
      guardianCount: rows.length,
    });
  } catch (err) {
    logger.error('notification_triggers: onWeeklyDigest unexpected error', {
      error: err instanceof Error ? err : new Error(String(err)),
      studentId,
    });
  }
}

// ─── Phase A Loop A — adaptive remediation triggers ──────────────────────────
//
// Three triggers for the adaptive closed loop (mastery-cliff → auto-inject →
// verify → escalate). All three follow the WORKING notifications-table shape
// (the one daily-cron's generateParentDigests and the goal-daily-plan-reminder
// builder use, verified against the prod baseline):
//   - top-level `message` (NOT NULL in prod) + `body` carry the English copy;
//   - Hindi copy lives in `data.title_hi` / `data.body_hi` / `data.message_hi`
//     (P7 — the notifications table has NO top-level body_hi column; the older
//     triggers above that set a top-level body_hi predate that verification);
//   - deterministic `idempotency_key` + upsert on
//     (recipient_id, type, idempotency_key) with ignoreDuplicates so cron
//     retries never duplicate rows (migration 20260505100100);
//   - fire-and-forget: never throws (P13: opaque ids + metrics only in logs).
//
// Copy is supportive, never punitive ("Foxy is helping you"), per the spec's
// student-facing framing rule.
// Spec: docs/superpowers/specs/2026-06-12-phase-a-loop-a-adaptive-remediation-design.md

interface RemediationNotificationRow {
  recipient_type: 'student' | 'guardian';
  recipient_id: string;
  type: string;
  title: string;
  message: string;
  body: string;
  data: Record<string, unknown>;
  is_read: boolean;
  created_at: string;
  idempotency_key: string;
}

async function upsertRemediationNotifications(
  rows: RemediationNotificationRow[],
  triggerName: string,
  logContext: Record<string, unknown>,
): Promise<void> {
  if (rows.length === 0) return;
  const { error } = await supabaseAdmin
    .from('notifications')
    .upsert(rows, {
      onConflict: 'recipient_id,type,idempotency_key',
      ignoreDuplicates: true,
    });
  if (error) {
    logger.error(`notification_triggers: ${triggerName} upsert failed`, {
      error: new Error(error.message),
      ...logContext,
      rowCount: rows.length,
    });
    return;
  }
  logger.info(`notification_triggers: ${triggerName} sent`, {
    ...logContext,
    rowCount: rows.length,
  });
}

export interface RemediationNotificationContext {
  subjectCode: string;
  chapterNumber: number;
  interventionId: string;
}

/**
 * Triggered when the adaptive loop auto-injects a remediation intervention
 * (INJECT phase). Recipient: the student. Idempotent per intervention cycle.
 */
export async function onRemediationAssigned(
  studentId: string,
  ctx: RemediationNotificationContext,
): Promise<void> {
  try {
    const { subjectCode, chapterNumber, interventionId } = ctx;
    const now = new Date().toISOString();
    const bodyEn = `Foxy noticed Chapter ${chapterNumber} (${subjectCode}) got tricky and added a few practice cards to your daily queue. A little each day brings it back!`;
    const bodyHi = `Foxy ने देखा कि अध्याय ${chapterNumber} (${subjectCode}) थोड़ा कठिन हो गया है, इसलिए आपकी दैनिक सूची में कुछ अभ्यास कार्ड जोड़े हैं। रोज़ थोड़ा अभ्यास — और यह फिर से आसान!`;
    await upsertRemediationNotifications(
      [{
        recipient_type: 'student',
        recipient_id: studentId,
        type: 'remediation_assigned',
        title: `Foxy is helping you with Chapter ${chapterNumber}`,
        message: bodyEn,
        body: bodyEn,
        data: {
          student_id: studentId,
          subject_code: subjectCode,
          chapter_number: chapterNumber,
          intervention_id: interventionId,
          title_hi: `Foxy अध्याय ${chapterNumber} में आपकी मदद कर रहा है`,
          message_hi: bodyHi,
          body_hi: bodyHi,
          trigger: 'remediation_assigned',
        },
        is_read: false,
        created_at: now,
        idempotency_key: `remediation_assigned_${interventionId}`,
      }],
      'onRemediationAssigned',
      { studentId, subjectCode, chapterNumber, interventionId },
    );
  } catch (err) {
    logger.error('notification_triggers: onRemediationAssigned unexpected error', {
      error: err instanceof Error ? err : new Error(String(err)),
      studentId,
    });
  }
}

/**
 * Triggered when the verify phase confirms the remediated chapter recovered.
 * Recipient: the student (celebratory). Idempotent per intervention cycle.
 */
export async function onRemediationRecovered(
  studentId: string,
  ctx: RemediationNotificationContext,
): Promise<void> {
  try {
    const { subjectCode, chapterNumber, interventionId } = ctx;
    const now = new Date().toISOString();
    const bodyEn = `Your extra practice on Chapter ${chapterNumber} (${subjectCode}) worked — your mastery is back on track. Great comeback!`;
    const bodyHi = `अध्याय ${chapterNumber} (${subjectCode}) पर आपका अतिरिक्त अभ्यास काम कर गया — आपकी पकड़ फिर से मज़बूत है। शानदार वापसी!`;
    await upsertRemediationNotifications(
      [{
        recipient_type: 'student',
        recipient_id: studentId,
        type: 'remediation_recovered',
        title: `Chapter ${chapterNumber} is back on track!`,
        message: bodyEn,
        body: bodyEn,
        data: {
          student_id: studentId,
          subject_code: subjectCode,
          chapter_number: chapterNumber,
          intervention_id: interventionId,
          title_hi: `अध्याय ${chapterNumber} फिर से पटरी पर!`,
          message_hi: bodyHi,
          body_hi: bodyHi,
          trigger: 'remediation_recovered',
        },
        is_read: false,
        created_at: now,
        idempotency_key: `remediation_recovered_${interventionId}`,
      }],
      'onRemediationRecovered',
      { studentId, subjectCode, chapterNumber, interventionId },
    );
  } catch (err) {
    logger.error('notification_triggers: onRemediationRecovered unexpected error', {
      error: err instanceof Error ? err : new Error(String(err)),
      studentId,
    });
  }
}

/**
 * Triggered when the verification window expires without recovery and the
 * loop escalates to a human (spec Decision 7).
 *
 * Recipients:
 *  - ALWAYS the student (supportive framing — a human is stepping in).
 *  - When escalatedTo === 'parent' (B2C, no roster teacher): every linked
 *    guardian with status approved/active, respecting each guardian's
 *    notification preferences (key: 'remediation_escalated', default ON).
 *  - When escalatedTo === 'teacher' (B2B): the teacher is reached through the
 *    Phase 3A teacher_remediation_assignments row, not a notification here.
 */
export async function onRemediationEscalated(
  studentId: string,
  ctx: RemediationNotificationContext & { escalatedTo: 'teacher' | 'parent' | null },
): Promise<void> {
  try {
    const { subjectCode, chapterNumber, interventionId, escalatedTo } = ctx;
    const now = new Date().toISOString();
    const rows: RemediationNotificationRow[] = [];

    // Student-facing row — always (spec: even the no-recipient edge case keeps
    // the student informed). Framing varies by who is stepping in.
    const studentBodyEn =
      escalatedTo === 'teacher'
        ? `Chapter ${chapterNumber} (${subjectCode}) is still feeling tough, so your teacher will help you with it. You've got this!`
        : escalatedTo === 'parent'
          ? `Chapter ${chapterNumber} (${subjectCode}) is still feeling tough, so we let your family know — a little support goes a long way. Keep going!`
          : `Chapter ${chapterNumber} (${subjectCode}) is still feeling tough. Keep at your practice cards — Foxy is with you!`;
    const studentBodyHi =
      escalatedTo === 'teacher'
        ? `अध्याय ${chapterNumber} (${subjectCode}) अभी भी कठिन लग रहा है, इसलिए आपके शिक्षक इसमें आपकी मदद करेंगे। आप कर सकते हैं!`
        : escalatedTo === 'parent'
          ? `अध्याय ${chapterNumber} (${subjectCode}) अभी भी कठिन लग रहा है, इसलिए हमने आपके परिवार को बताया है — थोड़ा साथ बहुत काम आता है। लगे रहो!`
          : `अध्याय ${chapterNumber} (${subjectCode}) अभी भी कठिन लग रहा है। अभ्यास कार्ड जारी रखें — Foxy आपके साथ है!`;

    rows.push({
      recipient_type: 'student',
      recipient_id: studentId,
      type: 'remediation_escalated',
      title: `Extra help for Chapter ${chapterNumber}`,
      message: studentBodyEn,
      body: studentBodyEn,
      data: {
        student_id: studentId,
        subject_code: subjectCode,
        chapter_number: chapterNumber,
        intervention_id: interventionId,
        escalated_to: escalatedTo,
        title_hi: `अध्याय ${chapterNumber} के लिए अतिरिक्त मदद`,
        message_hi: studentBodyHi,
        body_hi: studentBodyHi,
        trigger: 'remediation_escalated',
      },
      is_read: false,
      created_at: now,
      idempotency_key: `remediation_escalated_${interventionId}_student`,
    });

    // Guardian rows — only on the parent escalation path. Dual-status link
    // filter ('approved','active') matches the adaptive_interventions RLS and
    // the spec's Decision 7; preference-respecting per guardian.
    if (escalatedTo === 'parent') {
      const { data: links, error: linkErr } = await supabaseAdmin
        .from('guardian_student_links')
        .select(
          `guardian_id,
           guardians (
             id,
             auth_user_id,
             notification_preferences,
             preferred_language
           )`
        )
        .eq('student_id', studentId)
        .in('status', ['approved', 'active']);

      if (linkErr) {
        logger.error('notification_triggers: onRemediationEscalated guardian fetch failed', {
          error: new Error(linkErr.message),
          studentId,
        });
      }

      const guardianBodyEn = `Chapter ${chapterNumber} (${subjectCode}) has stayed difficult for your child despite extra practice over the last week. A short revision session together would really help.`;
      const guardianBodyHi = `पिछले सप्ताह अतिरिक्त अभ्यास के बावजूद अध्याय ${chapterNumber} (${subjectCode}) आपके बच्चे के लिए कठिन बना हुआ है। साथ बैठकर एक छोटा रिवीज़न सत्र बहुत मदद करेगा।`;

      for (const link of ((links ?? []) as unknown as LinkedGuardian[])) {
        const guardian = resolveGuardian(link.guardians);
        if (!guardian?.id) continue;
        if (!isNotificationEnabled(guardian.notification_preferences, 'remediation_escalated')) continue;
        rows.push({
          recipient_type: 'guardian',
          recipient_id: guardian.id,
          type: 'remediation_escalated',
          title: `Your child needs support with Chapter ${chapterNumber}`,
          message: guardianBodyEn,
          body: guardianBodyEn,
          data: {
            student_id: studentId,
            subject_code: subjectCode,
            chapter_number: chapterNumber,
            intervention_id: interventionId,
            escalated_to: escalatedTo,
            title_hi: `आपके बच्चे को अध्याय ${chapterNumber} में सहयोग चाहिए`,
            message_hi: guardianBodyHi,
            body_hi: guardianBodyHi,
            trigger: 'remediation_escalated',
          },
          is_read: false,
          created_at: now,
          idempotency_key: `remediation_escalated_${interventionId}_${guardian.id}`,
        });
      }
    }

    await upsertRemediationNotifications(
      rows,
      'onRemediationEscalated',
      { studentId, subjectCode, chapterNumber, interventionId, escalatedTo },
    );
  } catch (err) {
    logger.error('notification_triggers: onRemediationEscalated unexpected error', {
      error: err instanceof Error ? err : new Error(String(err)),
      studentId,
    });
  }
}

// ─── Phase A Loops B & C — adaptive re-engagement / concentration triggers ───
//
// Six triggers for the two remaining adaptive closed loops on the Loop A
// substrate (spec docs/superpowers/specs/2026-06-13-phase-a-loops-b-c-design.md):
//
//   Loop B (inactivity → re-engagement nudge → return-check → parent escalate):
//     onReEngagementNudge      — INTERVENE: student (encouraging) + ENCOURAGING
//                                parent alert when a guardian is linked.
//     onReEngagementReturned   — VERIFY 'returned': student (celebratory).
//     onInactivityEscalated    — VERIFY 'expired': student + CONCERNED parent
//                                alert. PARENT ONLY, never a teacher (Decision B4).
//
//   Loop C (concentration 'high' → IMMEDIATE escalation → band-drop check → re-notify):
//     onConcentrationEscalated — INTERVENE (escalation-at-inject): student +
//                                parent on B2C (teacher rides the assignment row).
//     onConcentrationResolved  — VERIFY 'resolved': student (celebratory).
//     onConcentrationReescalated — VERIFY 'expired': parent follow-up (idempotent
//                                key distinct from the inject alert so it never
//                                reads as a duplicate).
//
// All six reuse the WORKING RemediationNotificationRow house shape +
// upsertRemediationNotifications (deterministic idempotency_key, P7 bilingual
// `data.*_hi`, guardian-preference-respecting, P13 metadata-only, fire-and-forget).
// Loop B's two parent alerts use DISTINCT idempotency keys
// (engagement_nudge_<id>_<guardian> vs engagement_escalated_<id>_<guardian>) so
// the day-0 supportive nudge and the at-expiry concerned escalation never collide.
// Copy is pre-authored (P12 — no LLM output) and supportive in framing.

export interface ReEngagementNotificationContext {
  interventionId: string;
  /** Whole UTC days since the student's last qualifying activity, for copy. */
  daysSinceActive?: number | null;
}

/**
 * Fetch dual-status (approved | active) linked guardians for a student. Loop B/C
 * escalation paths use the SAME dual-status convention as the adaptive_interventions
 * RLS + the Loop A onRemediationEscalated path (not the approved-only helper).
 */
async function getLinkedGuardiansDualStatus(studentId: string): Promise<LinkedGuardian[]> {
  const { data, error } = await supabaseAdmin
    .from('guardian_student_links')
    .select(
      `guardian_id,
       guardians (
         id,
         auth_user_id,
         notification_preferences,
         preferred_language
       )`
    )
    .eq('student_id', studentId)
    .in('status', ['approved', 'active']);
  if (error) {
    logger.error('notification_triggers: dual-status guardian fetch failed', {
      error: new Error(error.message),
      studentId,
    });
    return [];
  }
  return (data ?? []) as unknown as LinkedGuardian[];
}

/**
 * Loop B INTERVENE — the re-engagement nudge. Recipient: the student ALWAYS
 * (encouraging), plus an ENCOURAGING parent alert for every linked guardian
 * (dual-status, preference-respecting). This is the day-0 supportive touch —
 * distinct in tone AND idempotency key from the at-expiry escalation (B4).
 */
export async function onReEngagementNudge(
  studentId: string,
  ctx: ReEngagementNotificationContext,
): Promise<void> {
  try {
    const { interventionId } = ctx;
    const now = new Date().toISOString();
    const rows: RemediationNotificationRow[] = [];

    const studentBodyEn = `Foxy misses you! It's been a little while — jump back in for a quick session and pick your streak right back up. You've got this!`;
    const studentBodyHi = `Foxy को आपकी याद आ रही है! थोड़ा समय हो गया — एक छोटे सत्र के लिए वापस आएँ और अपनी स्ट्रीक फिर से शुरू करें। आप कर सकते हैं!`;
    rows.push({
      recipient_type: 'student',
      recipient_id: studentId,
      type: 'reengagement_nudge',
      title: `Foxy is waiting for you!`,
      message: studentBodyEn,
      body: studentBodyEn,
      data: {
        student_id: studentId,
        intervention_id: interventionId,
        title_hi: `Foxy आपका इंतज़ार कर रहा है!`,
        message_hi: studentBodyHi,
        body_hi: studentBodyHi,
        trigger: 'reengagement_nudge',
      },
      is_read: false,
      created_at: now,
      idempotency_key: `engagement_nudge_${interventionId}_student`,
    });

    // Encouraging parent alert — every linked guardian, preference-respecting.
    const guardianBodyEn = `Your child hasn't studied for a couple of days. A gentle nudge from you to open the app today would really help them keep up their momentum.`;
    const guardianBodyHi = `आपके बच्चे ने कुछ दिनों से अध्ययन नहीं किया है। आज ऐप खोलने के लिए आपकी ओर से एक हल्का प्रोत्साहन उन्हें गति बनाए रखने में बहुत मदद करेगा।`;
    for (const link of await getLinkedGuardiansDualStatus(studentId)) {
      const guardian = resolveGuardian(link.guardians);
      if (!guardian?.id) continue;
      if (!isNotificationEnabled(guardian.notification_preferences, 'reengagement_nudge')) continue;
      rows.push({
        recipient_type: 'guardian',
        recipient_id: guardian.id,
        type: 'reengagement_nudge',
        title: `A nudge to get them studying`,
        message: guardianBodyEn,
        body: guardianBodyEn,
        data: {
          student_id: studentId,
          intervention_id: interventionId,
          title_hi: `उन्हें अध्ययन के लिए एक प्रोत्साहन`,
          message_hi: guardianBodyHi,
          body_hi: guardianBodyHi,
          trigger: 'reengagement_nudge',
        },
        is_read: false,
        created_at: now,
        idempotency_key: `engagement_nudge_${interventionId}_${guardian.id}`,
      });
    }

    await upsertRemediationNotifications(rows, 'onReEngagementNudge', {
      studentId,
      interventionId,
    });
  } catch (err) {
    logger.error('notification_triggers: onReEngagementNudge unexpected error', {
      error: err instanceof Error ? err : new Error(String(err)),
      studentId,
    });
  }
}

/**
 * Loop B VERIFY 'returned' — the nudged student came back. Recipient: the
 * student (celebratory). Optional / low-stakes; idempotent per cycle.
 */
export async function onReEngagementReturned(
  studentId: string,
  ctx: ReEngagementNotificationContext,
): Promise<void> {
  try {
    const { interventionId } = ctx;
    const now = new Date().toISOString();
    const bodyEn = `Welcome back! Great to see you studying again — keep the momentum going and build that streak back up!`;
    const bodyHi = `वापसी पर स्वागत है! आपको फिर से पढ़ते देखना बहुत अच्छा लगा — गति बनाए रखें और अपनी स्ट्रीक फिर से बढ़ाएँ!`;
    await upsertRemediationNotifications(
      [{
        recipient_type: 'student',
        recipient_id: studentId,
        type: 'reengagement_returned',
        title: `Welcome back!`,
        message: bodyEn,
        body: bodyEn,
        data: {
          student_id: studentId,
          intervention_id: interventionId,
          title_hi: `वापसी पर स्वागत है!`,
          message_hi: bodyHi,
          body_hi: bodyHi,
          trigger: 'reengagement_returned',
        },
        is_read: false,
        created_at: now,
        idempotency_key: `engagement_returned_${interventionId}_student`,
      }],
      'onReEngagementReturned',
      { studentId, interventionId },
    );
  } catch (err) {
    logger.error('notification_triggers: onReEngagementReturned unexpected error', {
      error: err instanceof Error ? err : new Error(String(err)),
      studentId,
    });
  }
}

/**
 * Loop B VERIFY 'expired' — the student never returned in the window. Recipient:
 * the student (supportive) + a CONCERNED parent alert (PARENT ONLY, never a
 * teacher — Decision B4). Distinct idempotency key from the day-0 nudge alert.
 * No parent linked ⇒ student-only (the worker records escalated_to = NULL +
 * ops-visible event).
 */
export async function onInactivityEscalated(
  studentId: string,
  ctx: ReEngagementNotificationContext & { escalatedTo: 'parent' | null },
): Promise<void> {
  try {
    const { interventionId, escalatedTo } = ctx;
    const now = new Date().toISOString();
    const rows: RemediationNotificationRow[] = [];

    const studentBodyEn =
      escalatedTo === 'parent'
        ? `We've missed you for a few days. We let your family know so they can cheer you on — come back today and pick up where you left off!`
        : `We've missed you for a few days. Whenever you're ready, Foxy is here to pick up right where you left off!`;
    const studentBodyHi =
      escalatedTo === 'parent'
        ? `कुछ दिनों से आपकी कमी महसूस हुई। हमने आपके परिवार को बताया ताकि वे आपका उत्साह बढ़ा सकें — आज वापस आएँ और जहाँ छोड़ा था वहीं से शुरू करें!`
        : `कुछ दिनों से आपकी कमी महसूस हुई। जब भी आप तैयार हों, Foxy आपके साथ वहीं से शुरू करने के लिए तैयार है!`;
    rows.push({
      recipient_type: 'student',
      recipient_id: studentId,
      type: 'reengagement_escalated',
      title: `We've missed you`,
      message: studentBodyEn,
      body: studentBodyEn,
      data: {
        student_id: studentId,
        intervention_id: interventionId,
        escalated_to: escalatedTo,
        title_hi: `आपकी कमी महसूस हुई`,
        message_hi: studentBodyHi,
        body_hi: studentBodyHi,
        trigger: 'reengagement_escalated',
      },
      is_read: false,
      created_at: now,
      idempotency_key: `engagement_escalated_${interventionId}_student`,
    });

    if (escalatedTo === 'parent') {
      const guardianBodyEn = `Your child hasn't studied for several days despite a reminder. A little encouragement from you to get back into a daily habit would make a real difference right now.`;
      const guardianBodyHi = `एक अनुस्मारक के बावजूद आपके बच्चे ने कई दिनों से अध्ययन नहीं किया है। दैनिक आदत में वापस आने के लिए आपकी ओर से थोड़ा प्रोत्साहन अभी बहुत फ़र्क लाएगा।`;
      for (const link of await getLinkedGuardiansDualStatus(studentId)) {
        const guardian = resolveGuardian(link.guardians);
        if (!guardian?.id) continue;
        if (!isNotificationEnabled(guardian.notification_preferences, 'reengagement_escalated')) continue;
        rows.push({
          recipient_type: 'guardian',
          recipient_id: guardian.id,
          type: 'reengagement_escalated',
          title: `Your child has stopped studying`,
          message: guardianBodyEn,
          body: guardianBodyEn,
          data: {
            student_id: studentId,
            intervention_id: interventionId,
            escalated_to: escalatedTo,
            title_hi: `आपके बच्चे ने अध्ययन करना बंद कर दिया है`,
            message_hi: guardianBodyHi,
            body_hi: guardianBodyHi,
            trigger: 'reengagement_escalated',
          },
          is_read: false,
          created_at: now,
          idempotency_key: `engagement_escalated_${interventionId}_${guardian.id}`,
        });
      }
    }

    await upsertRemediationNotifications(rows, 'onInactivityEscalated', {
      studentId,
      interventionId,
      escalatedTo,
    });
  } catch (err) {
    logger.error('notification_triggers: onInactivityEscalated unexpected error', {
      error: err instanceof Error ? err : new Error(String(err)),
      studentId,
    });
  }
}

export interface ConcentrationNotificationContext {
  subjectCode: string;
  interventionId: string;
  /** At-risk-chapter count for the subject at the time of the action. */
  atRiskChapterCount?: number | null;
}

/**
 * Loop C INTERVENE — the escalation IS the intervention (immediate, at inject).
 * Recipient: the student ALWAYS (supportive) + a parent alert on the B2C path
 * (escalatedTo === 'parent'). On B2B the teacher is reached through the
 * teacher_remediation_assignments row (Phase 3A surface), not a notification here.
 */
export async function onConcentrationEscalated(
  studentId: string,
  ctx: ConcentrationNotificationContext & { escalatedTo: 'teacher' | 'parent' | null },
): Promise<void> {
  try {
    const { subjectCode, interventionId, escalatedTo } = ctx;
    const now = new Date().toISOString();
    const rows: RemediationNotificationRow[] = [];

    const studentBodyEn =
      escalatedTo === 'teacher'
        ? `${subjectCode} has a few tricky chapters right now, so your teacher is going to help you build it back up. Step by step — you've got this!`
        : escalatedTo === 'parent'
          ? `${subjectCode} has a few tricky chapters right now, so we let your family know so they can support you. A little focused practice will turn it around!`
          : `${subjectCode} has a few tricky chapters right now. Keep practising a little each day — Foxy is with you!`;
    const studentBodyHi =
      escalatedTo === 'teacher'
        ? `${subjectCode} में अभी कुछ कठिन अध्याय हैं, इसलिए आपके शिक्षक इसे फिर से मज़बूत बनाने में आपकी मदद करेंगे। कदम दर कदम — आप कर सकते हैं!`
        : escalatedTo === 'parent'
          ? `${subjectCode} में अभी कुछ कठिन अध्याय हैं, इसलिए हमने आपके परिवार को बताया ताकि वे आपका साथ दे सकें। थोड़ा केंद्रित अभ्यास इसे बदल देगा!`
          : `${subjectCode} में अभी कुछ कठिन अध्याय हैं। रोज़ थोड़ा अभ्यास करते रहें — Foxy आपके साथ है!`;
    rows.push({
      recipient_type: 'student',
      recipient_id: studentId,
      type: 'concentration_escalated',
      title: `Extra help for ${subjectCode}`,
      message: studentBodyEn,
      body: studentBodyEn,
      data: {
        student_id: studentId,
        subject_code: subjectCode,
        intervention_id: interventionId,
        escalated_to: escalatedTo,
        title_hi: `${subjectCode} के लिए अतिरिक्त मदद`,
        message_hi: studentBodyHi,
        body_hi: studentBodyHi,
        trigger: 'concentration_escalated',
      },
      is_read: false,
      created_at: now,
      idempotency_key: `concentration_escalated_${interventionId}_student`,
    });

    if (escalatedTo === 'parent') {
      const guardianBodyEn = `Several chapters in ${subjectCode} have become difficult for your child. A short, focused revision session together on this subject would really help them turn it around.`;
      const guardianBodyHi = `${subjectCode} के कई अध्याय आपके बच्चे के लिए कठिन हो गए हैं। इस विषय पर साथ बैठकर एक छोटा, केंद्रित रिवीज़न सत्र उन्हें इसे बदलने में बहुत मदद करेगा।`;
      for (const link of await getLinkedGuardiansDualStatus(studentId)) {
        const guardian = resolveGuardian(link.guardians);
        if (!guardian?.id) continue;
        if (!isNotificationEnabled(guardian.notification_preferences, 'concentration_escalated')) continue;
        rows.push({
          recipient_type: 'guardian',
          recipient_id: guardian.id,
          type: 'concentration_escalated',
          title: `Your child needs support with ${subjectCode}`,
          message: guardianBodyEn,
          body: guardianBodyEn,
          data: {
            student_id: studentId,
            subject_code: subjectCode,
            intervention_id: interventionId,
            escalated_to: escalatedTo,
            title_hi: `आपके बच्चे को ${subjectCode} में सहयोग चाहिए`,
            message_hi: guardianBodyHi,
            body_hi: guardianBodyHi,
            trigger: 'concentration_escalated',
          },
          is_read: false,
          created_at: now,
          idempotency_key: `concentration_escalated_${interventionId}_${guardian.id}`,
        });
      }
    }

    await upsertRemediationNotifications(rows, 'onConcentrationEscalated', {
      studentId,
      subjectCode,
      interventionId,
      escalatedTo,
    });
  } catch (err) {
    logger.error('notification_triggers: onConcentrationEscalated unexpected error', {
      error: err instanceof Error ? err : new Error(String(err)),
      studentId,
    });
  }
}

/**
 * Loop C VERIFY 'resolved' — the subject dropped out of the 'high' band.
 * Recipient: the student (celebratory). Idempotent per cycle.
 */
export async function onConcentrationResolved(
  studentId: string,
  ctx: ConcentrationNotificationContext,
): Promise<void> {
  try {
    const { subjectCode, interventionId } = ctx;
    const now = new Date().toISOString();
    const bodyEn = `Your focused work on ${subjectCode} is paying off — the subject is back on track. Fantastic turnaround!`;
    const bodyHi = `${subjectCode} पर आपकी केंद्रित मेहनत रंग ला रही है — विषय फिर से पटरी पर है। शानदार वापसी!`;
    await upsertRemediationNotifications(
      [{
        recipient_type: 'student',
        recipient_id: studentId,
        type: 'concentration_resolved',
        title: `${subjectCode} is back on track!`,
        message: bodyEn,
        body: bodyEn,
        data: {
          student_id: studentId,
          subject_code: subjectCode,
          intervention_id: interventionId,
          title_hi: `${subjectCode} फिर से पटरी पर!`,
          message_hi: bodyHi,
          body_hi: bodyHi,
          trigger: 'concentration_resolved',
        },
        is_read: false,
        created_at: now,
        idempotency_key: `concentration_resolved_${interventionId}_student`,
      }],
      'onConcentrationResolved',
      { studentId, subjectCode, interventionId },
    );
  } catch (err) {
    logger.error('notification_triggers: onConcentrationResolved unexpected error', {
      error: err instanceof Error ? err : new Error(String(err)),
      studentId,
    });
  }
}

/**
 * Loop C VERIFY 'expired' — the subject stayed 'high' through the window. Per
 * Decision C4 this is a RE-NOTIFY (follow-up), not a second intervention row.
 * Recipient: a parent follow-up on the B2C path; on B2B the teacher assignment
 * is re-flagged by the worker (no notification here). Distinct idempotency key
 * (`concentration_reescalated_<id>_<recipient>`) from the inject alert so it
 * reads as a follow-up, never a duplicate.
 */
export async function onConcentrationReescalated(
  studentId: string,
  ctx: ConcentrationNotificationContext & { escalatedTo: 'teacher' | 'parent' | null },
): Promise<void> {
  try {
    const { subjectCode, interventionId, escalatedTo } = ctx;
    const now = new Date().toISOString();
    if (escalatedTo !== 'parent') {
      // B2B re-flag rides the assignment row; no-recipient → ops event only.
      // Nothing to send here, but keep the idempotent log line for parity.
      logger.info('notification_triggers: onConcentrationReescalated no-parent path (no notification)', {
        studentId,
        subjectCode,
        interventionId,
        escalatedTo,
      });
      return;
    }
    const rows: RemediationNotificationRow[] = [];
    const guardianBodyEn = `${subjectCode} has stayed difficult for your child over the past couple of weeks. It would really help to sit with them for a focused revision session, or reach out to their teacher about extra support.`;
    const guardianBodyHi = `पिछले कुछ हफ़्तों से ${subjectCode} आपके बच्चे के लिए कठिन बना हुआ है। उनके साथ एक केंद्रित रिवीज़न सत्र के लिए बैठना, या अतिरिक्त सहयोग के लिए उनके शिक्षक से संपर्क करना बहुत मदद करेगा।`;
    for (const link of await getLinkedGuardiansDualStatus(studentId)) {
      const guardian = resolveGuardian(link.guardians);
      if (!guardian?.id) continue;
      if (!isNotificationEnabled(guardian.notification_preferences, 'concentration_escalated')) continue;
      rows.push({
        recipient_type: 'guardian',
        recipient_id: guardian.id,
        type: 'concentration_escalated',
        title: `${subjectCode} still needs attention`,
        message: guardianBodyEn,
        body: guardianBodyEn,
        data: {
          student_id: studentId,
          subject_code: subjectCode,
          intervention_id: interventionId,
          escalated_to: escalatedTo,
          title_hi: `${subjectCode} पर अभी भी ध्यान देने की ज़रूरत है`,
          message_hi: guardianBodyHi,
          body_hi: guardianBodyHi,
          trigger: 'concentration_reescalated',
        },
        is_read: false,
        created_at: now,
        idempotency_key: `concentration_reescalated_${interventionId}_${guardian.id}`,
      });
    }
    await upsertRemediationNotifications(rows, 'onConcentrationReescalated', {
      studentId,
      subjectCode,
      interventionId,
      escalatedTo,
    });
  } catch (err) {
    logger.error('notification_triggers: onConcentrationReescalated unexpected error', {
      error: err instanceof Error ? err : new Error(String(err)),
      studentId,
    });
  }
}

/**
 * Triggered when a student achieves mastery (>= 80%) on a concept.
 * Only fires if masteryLevel >= 80 (enforced here, not left to the caller).
 */
export async function onMasteryMilestone(
  studentId: string,
  concept: string,
  masteryLevel: number,
): Promise<void> {
  if (masteryLevel < 80) return;

  try {
    const guardians = await getApprovedGuardians(studentId);
    if (guardians.length === 0) return;

    const now = new Date().toISOString();
    const rows: NotificationRow[] = [];

    for (const link of guardians) {
      const guardian = resolveGuardian(link.guardians);
      if (!guardian?.id) continue;
      if (!isNotificationEnabled(guardian.notification_preferences, 'achievement')) continue;

      rows.push({
        recipient_type: 'guardian',
        recipient_id: guardian.id,
        type: 'achievement',
        title: `Mastery milestone: ${concept}`,
        body: `Your child has reached ${masteryLevel}% mastery in "${concept}". Great progress!`,
        body_hi: `आपके बच्चे ने "${concept}" में ${masteryLevel}% महारत हासिल कर ली है। शानदार प्रगति!`,
        data: {
          student_id: studentId,
          concept,
          mastery_level: masteryLevel,
          trigger: 'mastery_milestone',
        },
        is_read: false,
        created_at: now,
      });
    }

    if (rows.length === 0) return;

    const { error } = await supabaseAdmin.from('notifications').insert(rows);
    if (error) {
      logger.error('notification_triggers: onMasteryMilestone insert failed', {
        error: new Error(error.message),
        studentId,
        concept,
        masteryLevel,
        guardianCount: rows.length,
      });
      return;
    }

    logger.info('notification_triggers: onMasteryMilestone sent', {
      studentId,
      concept,
      masteryLevel,
      guardianCount: rows.length,
    });
  } catch (err) {
    logger.error('notification_triggers: onMasteryMilestone unexpected error', {
      error: err instanceof Error ? err : new Error(String(err)),
      studentId,
    });
  }
}
