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

  // Timeouts
  static const Duration connectTimeout = Duration(seconds: 10);
  static const Duration receiveTimeout = Duration(seconds: 15);
  static const Duration cacheMaxAge = Duration(minutes: 5);

  // Pagination
  static const int defaultPageSize = 20;
  static const int dashboardLimit = 50;
}
