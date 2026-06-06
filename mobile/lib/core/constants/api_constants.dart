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

  // ─── /v2 contract switch (Wave 2.3 mobile-parity) ───────────────────────────
  //
  // When ON, the app renders the new server-driven `/v2` surfaces via the
  // GENERATED dart-dio client (lib/api/v2). Wave 2.3 scope is the adaptive
  // "Today" home + a 4-tab nav (Today / Learn / Foxy / Me). Everything else
  // (quiz, learning, dashboard repositories) stays on the legacy path until
  // the next increment.
  //
  // DEFAULT OFF: a build without `--dart-define=USE_V2=true` behaves EXACTLY
  // as today — current 5-tab nav, legacy repositories, Dashboard as the authed
  // landing. No current user sees any change.
  //
  // Turn on per-build:
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
  // Rollback path: ship a new APK with `--dart-define=FOXY_ENDPOINT=edge`.
  // The 'edge' branch is preserved indefinitely for old builds in the wild.
  // The Edge Function is NOT yet decommissioned; ai-engineer owns deletion
  // in a separate PR after the new path has been on >95% of active
  // installs for 2 weeks.
  //
  // Values: 'edge' | 'api'.
  // Set via `--dart-define=FOXY_ENDPOINT=edge` at build time to roll back.
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
  static const Duration cacheMaxAge = Duration(minutes: 5);

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
