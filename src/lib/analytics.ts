/**
 * Alfanumrik Analytics — Learning-First Event Tracking
 *
 * Dario's principle: Measure what matters for the mission, not vanity metrics.
 * For EdTech, that means: learning velocity, retention, and mastery progression.
 *
 * Dual-dispatch:
 *  - Vercel Analytics — page-level events + simple custom events. Always on
 *    in production (via @vercel/analytics injection).
 *  - PostHog — cohort/funnel/retention analysis. Opt-in via
 *    NEXT_PUBLIC_POSTHOG_ENABLED=true + NEXT_PUBLIC_POSTHOG_KEY. See
 *    `src/lib/posthog-client.ts` for init details and privacy posture.
 *
 * Every `track()` call fires to BOTH backends if both are configured.
 * Callers don't need to know which backends are active; they just call
 * `track('quiz_completed', { ... })` and the dispatcher does the right thing.
 *
 * Privacy (P13):
 *  - Never pass raw user IDs in event properties — use `hashUserIdForAnalytics()`
 *    or the existing `student_id_hash` convention.
 *  - PostHog `identify()` always uses a hashed ID, never the raw Supabase UUID.
 *  - Both dispatch paths swallow errors: analytics never breaks the app.
 */

import { posthogCapture, posthogIdentify, posthogReset, hashUserIdForAnalytics, isPosthogEnabled } from './posthog-client';

type AnalyticsEvent = {
  // Learning events
  quiz_completed: { subject: string; score: number; questions: number; grade: string; time_seconds: number };
  quiz_started: { subject: string; grade: string };
  foxy_message_sent: { subject: string; mode: string; language: string };
  // F16: extended to carry grade alongside the subject/mode pair already collected.
  foxy_session_started: { subject: string; grade?: string; mode?: string };
  // F16: per-turn completion telemetry — feeds RAG/grounding success funnels.
  // Phase 0 Fix 0.5 (2026-04-27): semantics tightened.
  //   was_grounded   — true ONLY when the answer was produced from the
  //                    retrieved NCERT chunks. Soft-mode "From general CBSE
  //                    knowledge:" fallback answers report false here even
  //                    though the API-shape branch was grounded:true.
  //                    Use this for the citation-backed answer rate metric.
  //   citations_count — actual NCERT citation count from the grounded-answer
  //                    service response (0 on abstain or legacy paths
  //                    without chunks). NOT suggestedAlternatives.length
  //                    (which was the previous, incorrect signal).
  foxy_turn_completed: {
    subject: string;
    grade?: string;
    was_grounded: boolean;
    citations_count: number;
    latency_ms: number;
    // Phase 1.1: true when the response was served via SSE streaming. Used to
    // separate streaming-vs-blocking latency distributions in PostHog. Optional
    // for backward compat — older clients on the blocking path omit it.
    streamed?: boolean;
  };
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

  // Funnel events (F16 — top-of-funnel acquisition + activation)
  signup_complete: { role: 'student' | 'teacher' | 'parent' | 'guardian'; method: 'email' };
  onboarding_complete: { role: 'student' | 'teacher' | 'parent' | 'guardian'; grade?: string; board?: string; subjects?: string[] };
  payment_success: { plan: string; amount_inr?: number; currency: 'INR'; order_id?: string; subscription_id?: string; billing_cycle: 'monthly' | 'yearly' };

  // Parent/Teacher events
  parent_linked: { method?: string; student_id_hash?: string; link_method?: 'code' | 'phone' };
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
 * Track a learning event. Fans out to all configured analytics backends:
 *  - Vercel Analytics (always on in production)
 *  - PostHog (when `NEXT_PUBLIC_POSTHOG_ENABLED === 'true'`)
 *
 * Callers don't need to know which backends are active.
 */
export function track<K extends keyof AnalyticsEvent>(
  event: K,
  properties: AnalyticsEvent[K]
) {
  // Development logging
  if (process.env.NODE_ENV === 'development') {
    console.info(`[Analytics] ${event}`, properties);
  }

  // ── Vercel Analytics (custom events) ──
  if (typeof window !== 'undefined' && 'va' in window) {
    try {
      // Vercel Analytics track function
      (window as Window & { va?: (cmd: string, props: Record<string, unknown>) => void }).va?.('event', {
        name: event,
        ...properties,
      });
    } catch { /* analytics should never break the app */ }
  }

  // ── PostHog (cohort/funnel/retention) ──
  // No-op when the runtime flag is off or the key is missing — see posthog-client.ts.
  posthogCapture(event, properties as Record<string, unknown>);
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

/**
 * Identify the current user to analytics backends.
 *
 * P13: We hash the auth UUID before sending to PostHog. The 16-hex-char
 * (8-byte) prefix gives ~10^19 distinct cohorts — enough to keep users
 * distinct, while preventing recovery of the original UUID.
 *
 * Call this from AuthContext after `supabase.auth.getUser()` resolves.
 * Safe to call on every auth state change — `posthogIdentify()` is idempotent.
 *
 * @param authUserId Raw Supabase auth UUID. Hashed before any external call.
 * @param traits Optional trait map (role, grade, plan tier). DO NOT pass PII.
 */
export async function identifyUser(
  authUserId: string,
  traits?: { role?: 'student' | 'teacher' | 'parent' | 'guardian'; grade?: string; plan?: string }
): Promise<void> {
  if (!authUserId) return;
  if (!isPosthogEnabled()) return;
  const hash = await hashUserIdForAnalytics(authUserId);
  if (!hash) return;
  posthogIdentify(hash, traits as Record<string, unknown> | undefined);
}

/**
 * Reset analytics identity (call on logout). Prevents cross-user attribution
 * when a different user signs in on the same browser.
 */
export function resetAnalyticsIdentity(): void {
  posthogReset();
}
