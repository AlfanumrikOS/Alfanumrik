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
      429 => const UsageLimitException('api', 0),
      >= 500 => NetworkException.server(code),
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
    return err.type == DioExceptionType.connectionTimeout ||
        err.type == DioExceptionType.connectionError ||
        (err.response?.statusCode != null && err.response!.statusCode! >= 500);
  }
}
