/// Typed exception hierarchy for clean error handling.
/// Every exception has a user-friendly message + optional technical detail.
sealed class AppException implements Exception {
  final String message;
  final String? detail;

  const AppException(this.message, [this.detail]);

  @override
  String toString() => 'AppException($message${detail != null ? ', $detail' : ''})';
}

class NetworkException extends AppException {
  final int? statusCode;

  const NetworkException(super.message, [this.statusCode, super.detail]);

  factory NetworkException.noConnection() =>
      const NetworkException('No internet connection. Please check your network.');

  factory NetworkException.timeout() =>
      const NetworkException('Request timed out. Please try again.');

  factory NetworkException.server([int? code]) =>
      NetworkException('Server error. Please try again later.', code);

  factory NetworkException.unauthorized() =>
      const NetworkException('Session expired. Please login again.', 401);
}

class AuthException extends AppException {
  const AuthException(super.message, [super.detail]);

  factory AuthException.invalidCredentials() =>
      const AuthException('Invalid email or password.');

  factory AuthException.emailTaken() =>
      const AuthException('This email is already registered.');

  factory AuthException.sessionExpired() =>
      const AuthException('Your session has expired. Please login again.');
}

class CacheException extends AppException {
  const CacheException(super.message, [super.detail]);
}

class PaymentException extends AppException {
  const PaymentException(super.message, [super.detail]);
}

class UsageLimitException extends AppException {
  final String feature;
  final int limit;

  const UsageLimitException(this.feature, this.limit)
      : super('Daily limit reached');
}
