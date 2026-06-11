import 'package:dio/dio.dart';
import 'package:supabase_flutter/supabase_flutter.dart';

import '../constants/api_constants.dart';
import '../errors/app_exception.dart';

/// Configured Dio client for API calls outside Supabase.
/// Handles auth headers, timeouts, retry, and error mapping.
class ApiClient {
  late final Dio _dio;
  static ApiClient? _instance;

  ApiClient._() {
    _dio = Dio(BaseOptions(
      baseUrl: ApiConstants.apiBase,
      connectTimeout: ApiConstants.connectTimeout,
      receiveTimeout: ApiConstants.receiveTimeout,
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
    ));

    _dio.interceptors.add(_AuthInterceptor());
    _dio.interceptors.add(_RetryInterceptor(_dio));
  }

  factory ApiClient() => _instance ??= ApiClient._();

  Future<Response<T>> get<T>(String path,
      {Map<String, dynamic>? queryParameters}) async {
    try {
      return await _dio.get<T>(path, queryParameters: queryParameters);
    } on DioException catch (e) {
      throw _mapDioError(e);
    }
  }

  Future<Response<T>> post<T>(String path, {dynamic data}) async {
    try {
      return await _dio.post<T>(path, data: data);
    } on DioException catch (e) {
      throw _mapDioError(e);
    }
  }

  AppException _mapDioError(DioException e) {
    return switch (e.type) {
      DioExceptionType.connectionTimeout ||
      DioExceptionType.sendTimeout ||
      DioExceptionType.receiveTimeout =>
        NetworkException.timeout(),
      DioExceptionType.connectionError => NetworkException.noConnection(),
      DioExceptionType.badResponse => _mapStatusCode(e.response?.statusCode),
      _ => const NetworkException('Something went wrong. Please try again.'),
    };
  }

  AppException _mapStatusCode(int? code) {
    return switch (code) {
      401 => NetworkException.unauthorized(),
      // The web payment routes return 403 { code: 'PERMISSION_DENIED' } when
      // the caller lacks the 'payments.subscribe' permission. Surface a clear,
      // user-actionable message instead of leaking the raw exception string.
      403 => PaymentException.permissionDenied(),
      429 => const UsageLimitException('api', 0),
      // `int() && >= 500` narrows the nullable `code` to non-null before the
      // relational match (Dart's stricter null-flow analysis now rejects a
      // bare `>= 500` on an int?). Behaviour is unchanged: any 5xx maps to a
      // server error.
      int() && >= 500 => NetworkException.server(code),
      _ => NetworkException('Request failed', code),
    };
  }
}

/// Injects Supabase access token into every request.
class _AuthInterceptor extends Interceptor {
  @override
  void onRequest(RequestOptions options, RequestInterceptorHandler handler) {
    final session = Supabase.instance.client.auth.currentSession;
    if (session != null) {
      options.headers['Authorization'] = 'Bearer ${session.accessToken}';
    }
    handler.next(options);
  }
}

/// Retries failed requests with exponential backoff (network errors only).
class _RetryInterceptor extends Interceptor {
  final Dio _dio;
  static const int _maxRetries = 3;

  _RetryInterceptor(this._dio);

  @override
  void onError(DioException err, ErrorInterceptorHandler handler) async {
    if (_shouldRetry(err)) {
      for (int attempt = 1; attempt <= _maxRetries; attempt++) {
        await Future.delayed(Duration(seconds: attempt * 2));
        try {
          final response = await _dio.fetch(err.requestOptions);
          return handler.resolve(response);
        } on DioException {
          if (attempt == _maxRetries) break;
        }
      }
    }
    handler.next(err);
  }

  bool _shouldRetry(DioException err) {
    // Pre-flight failures (the request never reached the server) are safe
    // to retry regardless of HTTP method — there's no server-side state to
    // duplicate.
    final preFlight = err.type == DioExceptionType.connectionTimeout ||
        err.type == DioExceptionType.connectionError;
    if (preFlight) return true;

    // Post-flight 5xx is more dangerous: the server received the request
    // and may have already committed state (e.g. created a payment order,
    // recorded a quiz submission) before failing on a downstream call.
    // Retrying a non-idempotent method on 5xx risks double-writes.
    //
    // Only retry methods the HTTP spec defines as idempotent / safe:
    // GET, HEAD, OPTIONS. Mutations (POST, PUT, PATCH, DELETE) need the
    // caller to retry consciously, with their own idempotency key if the
    // server-side route doesn't dedupe.
    final is5xx = err.response?.statusCode != null &&
        err.response!.statusCode! >= 500 &&
        err.response!.statusCode! < 600;
    if (!is5xx) return false;

    final method = err.requestOptions.method.toUpperCase();
    const idempotentMethods = {'GET', 'HEAD', 'OPTIONS'};
    return idempotentMethods.contains(method);
  }
}
