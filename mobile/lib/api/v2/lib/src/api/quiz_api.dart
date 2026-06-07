//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//

import 'dart:async';

import 'package:built_value/json_object.dart';
import 'package:built_value/serializer.dart';
import 'package:dio/dio.dart';

import 'package:alfanumrik_api_v2/src/api_util.dart';
import 'package:alfanumrik_api_v2/src/model/error_response.dart';
import 'package:alfanumrik_api_v2/src/model/quiz_questions_response.dart';
import 'package:alfanumrik_api_v2/src/model/quiz_start_request.dart';
import 'package:alfanumrik_api_v2/src/model/quiz_start_response.dart';
import 'package:alfanumrik_api_v2/src/model/quiz_submit_request.dart';
import 'package:alfanumrik_api_v2/src/model/quiz_submit_result.dart';

class QuizApi {

  final Dio _dio;

  final Serializers _serializers;

  const QuizApi(this._dio, this._serializers);

  /// Fetch quiz questions in academic scope
  /// Returns in-scope quiz questions for the authenticated student. Reuses the select_quiz_questions_rag path with subject-governance + academic-scope checks. correct_answer_index is NEVER returned (P6). 422 with { available, requested, scope } when a chapter is set and fewer than &#x60;count&#x60; in-scope questions exist. Requires quiz.attempt.
  ///
  /// Parameters:
  /// * [subject] 
  /// * [grade] 
  /// * [count] 
  /// * [chapter] 
  /// * [difficulty] 
  /// * [mode] 
  /// * [cancelToken] - A [CancelToken] that can be used to cancel the operation
  /// * [headers] - Can be used to add additional headers to the request
  /// * [extras] - Can be used to add flags to the request
  /// * [validateStatus] - A [ValidateStatus] callback that can be used to determine request success based on the HTTP status of the response
  /// * [onSendProgress] - A [ProgressCallback] that can be used to get the send progress
  /// * [onReceiveProgress] - A [ProgressCallback] that can be used to get the receive progress
  ///
  /// Returns a [Future] containing a [Response] with a [QuizQuestionsResponse] as data
  /// Throws [DioException] if API call or serialization fails
  Future<Response<QuizQuestionsResponse>> getQuizQuestions({ 
    required String subject,
    required String grade,
    required int count,
    int? chapter,
    String? difficulty,
    String? mode,
    CancelToken? cancelToken,
    Map<String, dynamic>? headers,
    Map<String, dynamic>? extra,
    ValidateStatus? validateStatus,
    ProgressCallback? onSendProgress,
    ProgressCallback? onReceiveProgress,
  }) async {
    final _path = r'/v2/quiz/questions';
    final _options = Options(
      method: r'GET',
      headers: <String, dynamic>{
        ...?headers,
      },
      extra: <String, dynamic>{
        'secure': <Map<String, String>>[
          {
            'type': 'apiKey',
            'name': 'cookieAuth',
            'keyName': 'sb-access-token',
            'where': '',
          },{
            'type': 'http',
            'scheme': 'bearer',
            'name': 'bearerAuth',
          },
        ],
        ...?extra,
      },
      validateStatus: validateStatus,
    );

    final _queryParameters = <String, dynamic>{
      r'subject': encodeQueryParameter(_serializers, subject, const FullType(String)),
      r'grade': encodeQueryParameter(_serializers, grade, const FullType(String)),
      if (chapter != null) r'chapter': encodeQueryParameter(_serializers, chapter, const FullType(int)),
      r'count': encodeQueryParameter(_serializers, count, const FullType(int)),
      if (difficulty != null) r'difficulty': encodeQueryParameter(_serializers, difficulty, const FullType(String)),
      if (mode != null) r'mode': encodeQueryParameter(_serializers, mode, const FullType(String)),
    };

    final _response = await _dio.request<Object>(
      _path,
      options: _options,
      queryParameters: _queryParameters,
      cancelToken: cancelToken,
      onSendProgress: onSendProgress,
      onReceiveProgress: onReceiveProgress,
    );

    QuizQuestionsResponse? _responseData;

    try {
      final rawResponse = _response.data;
      _responseData = rawResponse == null ? null : _serializers.deserialize(
        rawResponse,
        specifiedType: const FullType(QuizQuestionsResponse),
      ) as QuizQuestionsResponse;

    } catch (error, stackTrace) {
      throw DioException(
        requestOptions: _response.requestOptions,
        response: _response,
        type: DioExceptionType.unknown,
        error: error,
        stackTrace: stackTrace,
      );
    }

    return Response<QuizQuestionsResponse>(
      data: _responseData,
      headers: _response.headers,
      isRedirect: _response.isRedirect,
      requestOptions: _response.requestOptions,
      redirects: _response.redirects,
      statusCode: _response.statusCode,
      statusMessage: _response.statusMessage,
      extra: _response.extra,
    );
  }

  /// Start a server-shuffled quiz session
  /// Creates a quiz session via the start_quiz_session RPC (server-owned shuffle authority). Returns the per-session shuffled options; the shuffle_map and correct index stay server-side (P6). studentId is cross-checked against the JWT (403 on mismatch). Requires quiz.attempt.
  ///
  /// Parameters:
  /// * [quizStartRequest] 
  /// * [cancelToken] - A [CancelToken] that can be used to cancel the operation
  /// * [headers] - Can be used to add additional headers to the request
  /// * [extras] - Can be used to add flags to the request
  /// * [validateStatus] - A [ValidateStatus] callback that can be used to determine request success based on the HTTP status of the response
  /// * [onSendProgress] - A [ProgressCallback] that can be used to get the send progress
  /// * [onReceiveProgress] - A [ProgressCallback] that can be used to get the receive progress
  ///
  /// Returns a [Future] containing a [Response] with a [QuizStartResponse] as data
  /// Throws [DioException] if API call or serialization fails
  Future<Response<QuizStartResponse>> postQuizStart({ 
    QuizStartRequest? quizStartRequest,
    CancelToken? cancelToken,
    Map<String, dynamic>? headers,
    Map<String, dynamic>? extra,
    ValidateStatus? validateStatus,
    ProgressCallback? onSendProgress,
    ProgressCallback? onReceiveProgress,
  }) async {
    final _path = r'/v2/quiz/start';
    final _options = Options(
      method: r'POST',
      headers: <String, dynamic>{
        ...?headers,
      },
      extra: <String, dynamic>{
        'secure': <Map<String, String>>[
          {
            'type': 'apiKey',
            'name': 'cookieAuth',
            'keyName': 'sb-access-token',
            'where': '',
          },{
            'type': 'http',
            'scheme': 'bearer',
            'name': 'bearerAuth',
          },
        ],
        ...?extra,
      },
      contentType: 'application/json',
      validateStatus: validateStatus,
    );

    dynamic _bodyData;

    try {
      const _type = FullType(QuizStartRequest);
      _bodyData = quizStartRequest == null ? null : _serializers.serialize(quizStartRequest, specifiedType: _type);

    } catch(error, stackTrace) {
      throw DioException(
         requestOptions: _options.compose(
          _dio.options,
          _path,
        ),
        type: DioExceptionType.unknown,
        error: error,
        stackTrace: stackTrace,
      );
    }

    final _response = await _dio.request<Object>(
      _path,
      data: _bodyData,
      options: _options,
      cancelToken: cancelToken,
      onSendProgress: onSendProgress,
      onReceiveProgress: onReceiveProgress,
    );

    QuizStartResponse? _responseData;

    try {
      final rawResponse = _response.data;
      _responseData = rawResponse == null ? null : _serializers.deserialize(
        rawResponse,
        specifiedType: const FullType(QuizStartResponse),
      ) as QuizStartResponse;

    } catch (error, stackTrace) {
      throw DioException(
        requestOptions: _response.requestOptions,
        response: _response,
        type: DioExceptionType.unknown,
        error: error,
        stackTrace: stackTrace,
      );
    }

    return Response<QuizStartResponse>(
      data: _responseData,
      headers: _response.headers,
      isRedirect: _response.isRedirect,
      requestOptions: _response.requestOptions,
      redirects: _response.redirects,
      statusCode: _response.statusCode,
      statusMessage: _response.statusMessage,
      extra: _response.extra,
    );
  }

  /// Submit a quiz for server-authoritative grading
  /// Thin pass-through to the submit_quiz_results_v2 RPC, which owns P1 scoring, P2 XP + 200/day cap, all 3 P3 anti-cheat checks, and P4 atomicity. The route does NO score / XP / anti-cheat math — it forwards inputs and returns the RPC result verbatim. Requires an Idempotency-Key (UUID) header and quiz.attempt. studentId is cross-checked against the JWT (403 on mismatch). When attemptMode &#x3D;&#x3D;&#x3D; offline_replay the route runs offline gates BEFORE the RPC: capturedAt required (400 OFFLINE_CAPTURED_AT_REQUIRED), clock-skew (422 REPLAY_CLOCK_INVALID), staleness &gt;168h (422 REPLAY_TOO_STALE), clientCapturedTotalSeconds mismatch (400 OFFLINE_TIME_INCONSISTENT), and shuffle-map verification against the server snapshot (422 SHUFFLE_MAP_MISMATCH). Online submissions are byte-identical to today — no offline gate fires.
  ///
  /// Parameters:
  /// * [quizSubmitRequest] 
  /// * [cancelToken] - A [CancelToken] that can be used to cancel the operation
  /// * [headers] - Can be used to add additional headers to the request
  /// * [extras] - Can be used to add flags to the request
  /// * [validateStatus] - A [ValidateStatus] callback that can be used to determine request success based on the HTTP status of the response
  /// * [onSendProgress] - A [ProgressCallback] that can be used to get the send progress
  /// * [onReceiveProgress] - A [ProgressCallback] that can be used to get the receive progress
  ///
  /// Returns a [Future] containing a [Response] with a [QuizSubmitResult] as data
  /// Throws [DioException] if API call or serialization fails
  Future<Response<QuizSubmitResult>> postQuizSubmit({ 
    QuizSubmitRequest? quizSubmitRequest,
    CancelToken? cancelToken,
    Map<String, dynamic>? headers,
    Map<String, dynamic>? extra,
    ValidateStatus? validateStatus,
    ProgressCallback? onSendProgress,
    ProgressCallback? onReceiveProgress,
  }) async {
    final _path = r'/v2/quiz/submit';
    final _options = Options(
      method: r'POST',
      headers: <String, dynamic>{
        ...?headers,
      },
      extra: <String, dynamic>{
        'secure': <Map<String, String>>[
          {
            'type': 'apiKey',
            'name': 'cookieAuth',
            'keyName': 'sb-access-token',
            'where': '',
          },{
            'type': 'http',
            'scheme': 'bearer',
            'name': 'bearerAuth',
          },
        ],
        ...?extra,
      },
      contentType: 'application/json',
      validateStatus: validateStatus,
    );

    dynamic _bodyData;

    try {
      const _type = FullType(QuizSubmitRequest);
      _bodyData = quizSubmitRequest == null ? null : _serializers.serialize(quizSubmitRequest, specifiedType: _type);

    } catch(error, stackTrace) {
      throw DioException(
         requestOptions: _options.compose(
          _dio.options,
          _path,
        ),
        type: DioExceptionType.unknown,
        error: error,
        stackTrace: stackTrace,
      );
    }

    final _response = await _dio.request<Object>(
      _path,
      data: _bodyData,
      options: _options,
      cancelToken: cancelToken,
      onSendProgress: onSendProgress,
      onReceiveProgress: onReceiveProgress,
    );

    QuizSubmitResult? _responseData;

    try {
      final rawResponse = _response.data;
      _responseData = rawResponse == null ? null : _serializers.deserialize(
        rawResponse,
        specifiedType: const FullType(QuizSubmitResult),
      ) as QuizSubmitResult;

    } catch (error, stackTrace) {
      throw DioException(
        requestOptions: _response.requestOptions,
        response: _response,
        type: DioExceptionType.unknown,
        error: error,
        stackTrace: stackTrace,
      );
    }

    return Response<QuizSubmitResult>(
      data: _responseData,
      headers: _response.headers,
      isRedirect: _response.isRedirect,
      requestOptions: _response.requestOptions,
      redirects: _response.redirects,
      statusCode: _response.statusCode,
      statusMessage: _response.statusMessage,
      extra: _response.extra,
    );
  }

}
