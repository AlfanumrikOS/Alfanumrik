/**
 * Maintenance banner flag. When enabled, a dismissible amber banner is shown
 * across all portals (student, parent, teacher, admin).
 *
 * Enable via super-admin console or direct DB:
 *   UPDATE feature_flags
 *   SET is_enabled = true,
 *       metadata = '{"message_en":"Scheduled maintenance 10-11 PM IST","message_hi":"रखरखाव 10-11 PM IST"}'
 *   WHERE flag_name = 'maintenance_banner';
 *
 * The MaintenanceBanner component reads `is_enabled` + `metadata.message_en/message_hi`
 * directly from the client Supabase instance (public read via RLS).
 */
export const MAINTENANCE_FLAGS = {
  MAINTENANCE_BANNER: 'maintenance_banner',
} as const;

/**
 * Marketing/landing-page flags.
 *
 * `ff_welcome_v2` — the mobile-first editorial redesign of `/welcome` is now
 * the permanent unconditional render. WelcomeV2 is always returned from
 * src/app/welcome/page.tsx; WelcomeV1 and the flag-routing logic have been
 * removed (2026-06-10). This flag constant is kept for reference / DB hygiene
 * but is no longer evaluated at runtime.
 *
 * Seeded by migration 20260426150000_add_ff_welcome_v2.sql.
 */
export const WELCOME_FLAGS = {
  /** Mobile-first editorial redesign of /welcome. Permanently ON — no longer
   *  evaluated at runtime (WelcomeV2 is the unconditional default). */
  WELCOME_V2: 'ff_welcome_v2',
} as const;

/**
 * Realtime subscriptions (Phase C.6).
 *
 *  ff_realtime_subscriptions_v1
 *    Gates Supabase Realtime postgres_changes subscriptions on:
 *      - teacher heatmap (student_learning_profiles UPDATE, throttled 2s)
 *      - teacher poll results (classroom_poll_responses INSERT, unthrottled)
 *      - parent child-progress (student_learning_profiles UPDATE, debounced 5s)
 *    When OFF, dashboards fall back to the existing focus/visibility fetch
 *    pattern. Default: false. Per-tenant opt-in via target_institutions.
 *
 *    PRECONDITION: the `supabase_realtime` Postgres publication must contain
 *    `student_learning_profiles` and `classroom_poll_responses` before this
 *    flag is flipped on. Verify with:
 *      SELECT tablename FROM pg_publication_tables WHERE pubname = 'supabase_realtime';
 *    See migration 20260527000002 header for the operator runbook.
 *
 * Seeded by 20260527000002_add_ff_realtime_subscriptions_v1.sql.
 */
export const REALTIME_FLAGS = {
  SUBSCRIPTIONS_V1: 'ff_realtime_subscriptions_v1',
} as const;

/**
 * Cosmic redesign flags (Phase 0 foundation, 2026-06-05).
 *
 *  ff_cosmic_redesign_v1
 *    Master switch for the "cosmic" dark-theme visual identity. Gates the
 *    new client-side CSS/theme layer. When ON, the cosmic theme tokens and
 *    surfaces render; when OFF, the existing visual identity renders
 *    unchanged. Default: false (off) so production is completely unaffected
 *    until explicitly enabled.
 *
 *    The redesign is gated client-side (CSS/theme), so read this flag from a
 *    client component via the existing client read path — see the
 *    "Client read API" note below.
 *
 *    Not yet seeded by any migration. While the flag is absent from the
 *    `feature_flags` table, both read paths resolve it to OFF
 *    (`isFeatureEnabled()` returns false for unknown flags;
 *    `getFeatureFlags()` omits absent rows so the lookup is undefined/falsy).
 *    A seeding migration with `is_enabled = false` would only be needed to
 *    make the flag visible/toggleable in the super-admin Flags console; it is
 *    NOT required for the default-OFF behavior.
 */
export const COSMIC_REDESIGN_FLAGS = {
  /** Cosmic dark redesign — new visual identity (Phase 0 foundation). Default off. */
  V1: 'ff_cosmic_redesign_v1',
} as const;
