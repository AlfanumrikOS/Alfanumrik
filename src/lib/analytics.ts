/**
 * Alfanumrik Analytics — Learning-First Event Tracking
 *
 * Dario's principle: Measure what matters for the mission, not vanity metrics.
 * For EdTech, that means: learning velocity, retention, and mastery progression.
 *
 * These events feed into Vercel Analytics. In production, extend to
 * PostHog/Mixpanel for cohort analysis and learning funnel optimization.
 */

type AnalyticsEvent = {
  // Learning events
  quiz_completed: { subject: string; score: number; questions: number; grade: string; time_seconds: number };
  quiz_started: { subject: string; grade: string };
  foxy_message_sent: { subject: string; mode: string; language: string };
  foxy_session_started: { subject: string; mode: string };
  review_card_rated: { quality: number; topic: string };
  study_plan_generated: { subject?: string; daily_minutes: number };
  simulation_opened: { simulation_id: string; title: string };
  mastery_gained: { topic: string; from_level: number; to_level: number };

  // Engagement events
  streak_milestone: { days: number };
  xp_milestone: { total_xp: number };
  achievement_unlocked: { achievement_id: string; title: string };
  leaderboard_viewed: { period: string };
  competition_joined: { competition_id: string };

  // Parent/Teacher events
  parent_linked: { method: string };
  teacher_class_created: { grade: string };
  hpc_viewed: Record<string, never>;

  // Retention events
  daily_return: { streak_days: number };
  session_duration: { seconds: number; pages_visited: number };

  // Trust events
  data_exported: Record<string, never>;
  account_deleted: Record<string, never>;
  privacy_viewed: Record<string, never>;
  language_switched: { from: string; to: string };
};

/**
 * Track a learning event. In production, this sends to Vercel Analytics
 * and can be extended to any analytics provider.
 */
export function track<K extends keyof AnalyticsEvent>(
  event: K,
  properties: AnalyticsEvent[K]
) {
  // Development logging
  if (process.env.NODE_ENV === 'development') {
    console.info(`[Analytics] ${event}`, properties);
  }

  // Vercel Analytics custom events
  if (typeof window !== 'undefined' && 'va' in window) {
    try {
      // Vercel Analytics track function
      (window as Window & { va?: (cmd: string, props: Record<string, unknown>) => void }).va?.('event', {
        name: event,
        ...properties,
      });
    } catch { /* analytics should never break the app */ }
  }
}

/**
 * Track page-level learning context (added to all subsequent events).
 * Call this when a student navigates to a learning page.
 */
export function setLearningContext(context: {
  student_id?: string;
  grade?: string;
  board?: string;
  language?: string;
}) {
  if (typeof window !== 'undefined') {
    (window as Window & { __alfCtx?: typeof context }).__alfCtx = context;
  }
}
