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

  // ─── Foxy AI Tutor endpoint switch (Audit F7 mitigation) ────────────────────
  //
  // Two surfaces serve Foxy responses:
  //   1. Legacy: `${supabaseUrl}/functions/v1/foxy-tutor` (Edge Function,
  //      DEPRECATED, FTS-only retrieval, weaker P12 safety rails).
  //   2. New:    `${apiBase}/foxy` (Next.js route → grounded-answer service,
  //      Voyage RAG + RRF + rerank-2 + Sonnet, full P12 rails, IRT-aware).
  //
  // Mobile must keep both reachable per-build because clients in the wild
  // can't be hot-flipped. Default stays 'edge' so this PR is behavior-neutral.
  // Ops will flip the default to 'api' in a future build after staging
  // validates the new path.
  //
  // Values: 'edge' | 'api'.
  // Set via `--dart-define=FOXY_ENDPOINT=api` at build time.
  static const String foxyEndpoint = String.fromEnvironment(
    'FOXY_ENDPOINT',
    defaultValue: 'edge',
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
}
