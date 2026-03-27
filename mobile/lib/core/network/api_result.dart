/// Generic result wrapper — eliminates try/catch at call sites.
/// Forces callers to handle both success and failure.
sealed class ApiResult<T> {
  const ApiResult();

  /// Execute callback based on result type
  R when<R>({
    required R Function(T data) success,
    required R Function(String message) failure,
  }) {
    return switch (this) {
      ApiSuccess<T>(data: final d) => success(d),
      ApiFailure<T>(message: final m) => failure(m),
    };
  }

  bool get isSuccess => this is ApiSuccess<T>;
  bool get isFailure => this is ApiFailure<T>;

  T? get dataOrNull => switch (this) {
        ApiSuccess<T>(data: final d) => d,
        ApiFailure<T>() => null,
      };
}

class ApiSuccess<T> extends ApiResult<T> {
  final T data;
  const ApiSuccess(this.data);
}

class ApiFailure<T> extends ApiResult<T> {
  final String message;
  final int? statusCode;
  const ApiFailure(this.message, [this.statusCode]);
}
