/// Central API configuration.
/// Supabase keys are compile-time constants via --dart-define.
class ApiConstants {
  ApiConstants._();

  // SUPABASE_URL must be provided at build time via --dart-define.
  // Leaving no production URL as the default prevents accidental writes to
  // production from an unconfigured local build.
  static const String supabaseUrl = String.fromEnvironment(
    'SUPABASE_URL',
    defaultValue: '',
  );

  static const String supabaseAnonKey = String.fromEnvironment(
    'SUPABASE_ANON_KEY',
    defaultValue: '', // Must be provided at build time
  );

  static const String razorpayKeyId = String.fromEnvironment(
    'RAZORPAY_KEY_ID',
    defaultValue: '',
  );

  // API endpoints (Next.js backend)
  static const String apiBase = String.fromEnvironment(
    'API_BASE_URL',
    defaultValue: 'https://alfanumrik.com/api',
  );

  static const String paymentsCreateOrder = '$apiBase/payments/create-order';
  static const String paymentsVerify = '$apiBase/payments/verify';

  // ─── Curriculum-version anchor (Learn cache invalidation) ────────────────────
  //
  // FROZEN server contract:
  //   GET /api/v2/curriculum-version →
  //     { "as_of": "<ISO8601>",
  //       "scopes": { "<subject_code>-<grade>": <unix_epoch_int>, ... } }
  //
  // A higher int means newer content for that subject+grade scope; `0` means the
  // scope has never had content. The Learn cache stores this per-scope version
  // alongside each cached content entry and refetches ONLY when the server
  // reports a newer version (see [learning_repository]/[CacheManager]). This is
  // the anchor that replaces the blind 5-minute content TTL.
  static const String curriculumVersion = '$apiBase/v2/curriculum-version';

  // ─── /v2 contract switch (Wave 2.3 mobile-parity) ───────────────────────────
  //
  // This is an emergency BUILD-TIME kill switch only. When ON, the app still
  // asks the authenticated `/api/experience-v3` endpoint for the role's
  // server-resolved sticky cohort before rendering One Experience. A missing,
  // disabled or 0% flag therefore remains legacy.
  //
  // DEFAULT OFF: a build without `--dart-define=USE_V2=true` behaves EXACTLY
  // as today — current 5-tab nav, legacy repositories, Dashboard as the authed
  // landing. No current user sees any change.
  //
  // Permit server-controlled cohorts per build:
  //   flutter run --dart-define=USE_V2=true
  //   flutter build apk --dart-define=USE_V2=true
  static const bool useV2 = bool.fromEnvironment('USE_V2', defaultValue: false);

  /// Base path the generated `AlfanumrikApiV2` client is configured with.
  ///
  /// The generated `TodayApi.getToday()` requests the relative path
  /// `/v2/today`, and `AlfanumrikApiV2.basePath` is `/api`. We therefore feed
  /// the client a `basePathOverride` of `<host>/api` (i.e. [apiBase], which
  /// already ends in `/api`) so the resolved URL is `<host>/api/v2/today`.
  static const String v2BasePath = apiBase;

  // ─── Foxy AI Tutor endpoint switch (Audit F7 mitigation, Phase 2) ───────────
  //
  // Two surfaces serve Foxy responses:
  //   1. Legacy: `${supabaseUrl}/functions/v1/foxy-tutor` (Edge Function,
  //      DEPRECATED, FTS-only retrieval, weaker P12 safety rails).
  //   2. New:    `${apiBase}/foxy` (Next.js route → grounded-answer service,
  //      Voyage RAG + RRF + rerank-2 + Sonnet, full P12 rails, IRT-aware).
  //
  // Phase 2 (this constant): default flipped from 'edge' → 'api'. Web has
  // been on the new path since PR #447's surrounding work; mobile now
  // matches. Quota source-of-truth verified: both surfaces call
  // `check_and_record_usage` with the same `foxy_chat` feature key, so
  // students who upgrade their app mid-day do not get a fresh counter.
  //
  // Rollback path (HISTORICAL — NO LONGER VALID): shipping a new APK with
  // `--dart-define=FOXY_ENDPOINT=edge` used to be a valid rollback. As of
  // 2026-07-01 the `foxy-tutor` Edge Function has been RETIRED and removed
  // from `supabase/functions/` — this is no longer a usable rollback
  // target; a build pointed at 'edge' would fail to reach any backend.
  // The 'edge' branch stays compiled in only so already-installed APKs
  // still configured to it (older default, or a prior manual rollback)
  // fail predictably at the network call rather than crash. Do NOT build
  // or ship a new APK with FOXY_ENDPOINT=edge. Removing this dead code
  // path entirely is a separate, larger change — out of scope here.
  // See docs/audit/2026-07-02-discovery/05-mobile.md (§4e).
  //
  // Values: 'edge' | 'api'.
  // 'edge' is dead (see above) — do not set FOXY_ENDPOINT=edge on new builds.
  static const String foxyEndpoint = String.fromEnvironment(
    'FOXY_ENDPOINT',
    defaultValue: 'api',
  );

  /// Resolved Foxy URL. Used by chat_repository when [foxyEndpoint] == 'api'.
  /// When 'edge', the Supabase functions client is used instead of this URL.
  static const String foxyApiUrl = '$apiBase/foxy';

  // Timeouts
  static const Duration connectTimeout = Duration(seconds: 10);
  static const Duration receiveTimeout = Duration(seconds: 15);

  // Short TTL for VOLATILE per-student state (dashboard / quiz usage / auth
  // profile). These change frequently and must stay fresh — do NOT weaken this.
  // Near-static curriculum/concept content NO LONGER uses this TTL; it is
  // version-anchored instead (see [learnCacheStaleTtl] below).
  static const Duration cacheMaxAge = Duration(minutes: 5);

  // ─── Version-anchored Learn content cache (replaces the blind content TTL) ───
  //
  // The Learn reference content (chapters / topics / concept prose) is
  // near-static curriculum data. Instead of expiring it every 5 minutes (which
  // blocked cold-starts and burned the data budget re-downloading identical
  // syllabus), it is now invalidated by the per-scope version from
  // [curriculumVersion]. Content is served instantly when the stored version
  // matches the server, and only refetched when the server reports newer
  // content for that subject+grade scope.
  //
  // [versionAnchoredLearnCache] is the emergency revert switch. Default ON (the
  // new safe path). Ship a build with `--dart-define=VERSION_ANCHORED_LEARN_CACHE=false`
  // to fall back to the previous blind 5-minute TTL for Learn content — no
  // version poll, no atomic scope purge.
  static const bool versionAnchoredLearnCache =
      bool.fromEnvironment('VERSION_ANCHORED_LEARN_CACHE', defaultValue: true);

  // Offline grace window for version-anchored Learn content. When the device is
  // offline (or the version poll fails), cached content is still served — with a
  // non-blocking "content as of {date}" chip — ONLY while it is younger than
  // this window. Past it, the app REFUSES to serve stale content and shows the
  // Offline state (never a silent stale serve). Config-flagged so ops can tune
  // it per build: `--dart-define=LEARN_CACHE_STALE_TTL_DAYS=<n>`.
  static const int learnCacheStaleTtlDays =
      int.fromEnvironment('LEARN_CACHE_STALE_TTL_DAYS', defaultValue: 7);

  static const Duration learnCacheStaleTtl =
      Duration(days: learnCacheStaleTtlDays);

  // Pagination
  static const int defaultPageSize = 20;
  static const int dashboardLimit = 50;

  // ─── Crash + error observability ──────────────────────────────────────
  // Inject the Sentry DSN at build time:
  //   flutter build apk --dart-define=SENTRY_DSN=https://...@...ingest.sentry.io/...
  // Empty string → SDK initialised in disabled mode (main.dart) so the app
  // still launches in local/dev builds without a DSN configured.
  static const String sentryDsn = String.fromEnvironment(
    'SENTRY_DSN',
    defaultValue: '',
  );

  // Build-time environment label sent with every Sentry event so we can
  // segment dashboards by build channel. Defaults to "production" so a
  // forgotten --dart-define still sorts releases sanely.
  static const String sentryEnvironment = String.fromEnvironment(
    'SENTRY_ENVIRONMENT',
    defaultValue: 'production',
  );

  // Performance trace sample rate (0.0..1.0). 0.1 = 10% of transactions
  // get a span tree. Safe default that keeps Sentry quota low until ops
  // tunes per-environment.
  static const double sentryTracesSampleRate = 0.1;
}
