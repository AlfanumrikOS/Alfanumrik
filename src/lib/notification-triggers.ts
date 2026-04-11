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
