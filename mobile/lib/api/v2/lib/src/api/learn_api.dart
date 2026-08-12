//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//

import 'dart:async';

import 'package:built_value/json_object.dart';
import 'package:built_value/serializer.dart';
import 'package:dio/dio.dart';

import 'package:alfanumrik_api_v2/src/api_util.dart';
import 'package:alfanumrik_api_v2/src/model/concept_response.dart';
import 'package:alfanumrik_api_v2/src/model/curriculum_response.dart';
import 'package:alfanumrik_api_v2/src/model/error_response.dart';

class LearnApi {

  final Dio _dio;

  final Serializers _serializers;

  const LearnApi(this._dio, this._serializers);

  /// Concept content for a subject + chapter
  /// Returns the ordered NCERT chapter prose (markdown + source attribution) for a subject + chapter. Reuses fetchChapterContent (rag_content_chunks read used by /learn). An unknown &#x60;subject&#x60; is a 400 UNKNOWN_SUBJECT — the 404 NO_CONTENT response is reserved for a KNOWN subject whose chapter genuinely has no content. Requires study_plan.view.
  ///
  /// Parameters:
  /// * [subject] - Subject CODE (e.g. `math`, `science`) — NOT the display name (\"Mathematics\"). A value matching none of the student's subjects returns 400 UNKNOWN_SUBJECT with details: SubjectNotAllowedDetails listing the valid codes.
  /// * [grade] 
  /// * [chapter] 
  /// * [cancelToken] - A [CancelToken] that can be used to cancel the operation
  /// * [headers] - Can be used to add additional headers to the request
  /// * [extras] - Can be used to add flags to the request
  /// * [validateStatus] - A [ValidateStatus] callback that can be used to determine request success based on the HTTP status of the response
  /// * [onSendProgress] - A [ProgressCallback] that can be used to get the send progress
  /// * [onReceiveProgress] - A [ProgressCallback] that can be used to get the receive progress
  ///
  /// Returns a [Future] containing a [Response] with a [ConceptResponse] as data
  /// Throws [DioException] if API call or serialization fails
  Future<Response<ConceptResponse>> getLearnConcept({ 
    required String subject,
    required String grade,
    required int chapter,
    CancelToken? cancelToken,
    Map<String, dynamic>? headers,
    Map<String, dynamic>? extra,
    ValidateStatus? validateStatus,
    ProgressCallback? onSendProgress,
    ProgressCallback? onReceiveProgress,
  }) async {
    final _path = r'/v2/learn/concept';
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
      r'chapter': encodeQueryParameter(_serializers, chapter, const FullType(int)),
    };

    final _response = await _dio.request<Object>(
      _path,
      options: _options,
      queryParameters: _queryParameters,
      cancelToken: cancelToken,
      onSendProgress: onSendProgress,
      onReceiveProgress: onReceiveProgress,
    );

    ConceptResponse? _responseData;

    try {
      final rawResponse = _response.data;
      _responseData = rawResponse == null ? null : _serializers.deserialize(
        rawResponse,
        specifiedType: const FullType(ConceptResponse),
      ) as ConceptResponse;

    } catch (error, stackTrace) {
      throw DioException(
        requestOptions: _response.requestOptions,
        response: _response,
        type: DioExceptionType.unknown,
        error: error,
        stackTrace: stackTrace,
      );
    }

    return Response<ConceptResponse>(
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

  /// Curriculum tree (subjects → chapters → topics)
  /// Returns the plan-gated curriculum tree the mobile Learn screen needs. Reuses get_available_subjects (plan/grade/stream gating) + curriculum_topics. An unknown &#x60;subject&#x60; filter is a 400 UNKNOWN_SUBJECT (never an empty-success 200 — that shape is reserved for a student who genuinely has zero subjects and sent no filter). Requires study_plan.view.
  ///
  /// Parameters:
  /// * [subject] - Optional filter. Subject CODE (e.g. `math`, `science`) — NOT the display name (\"Mathematics\"). A value matching none of the student's subjects returns 400 UNKNOWN_SUBJECT with details: SubjectNotAllowedDetails listing the valid codes (locked subjects included — they are valid filter values and render with is_locked).
  /// * [cancelToken] - A [CancelToken] that can be used to cancel the operation
  /// * [headers] - Can be used to add additional headers to the request
  /// * [extras] - Can be used to add flags to the request
  /// * [validateStatus] - A [ValidateStatus] callback that can be used to determine request success based on the HTTP status of the response
  /// * [onSendProgress] - A [ProgressCallback] that can be used to get the send progress
  /// * [onReceiveProgress] - A [ProgressCallback] that can be used to get the receive progress
  ///
  /// Returns a [Future] containing a [Response] with a [CurriculumResponse] as data
  /// Throws [DioException] if API call or serialization fails
  Future<Response<CurriculumResponse>> getLearnCurriculum({ 
    String? subject,
    CancelToken? cancelToken,
    Map<String, dynamic>? headers,
    Map<String, dynamic>? extra,
    ValidateStatus? validateStatus,
    ProgressCallback? onSendProgress,
    ProgressCallback? onReceiveProgress,
  }) async {
    final _path = r'/v2/learn/curriculum';
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
      if (subject != null) r'subject': encodeQueryParameter(_serializers, subject, const FullType(String)),
    };

    final _response = await _dio.request<Object>(
      _path,
      options: _options,
      queryParameters: _queryParameters,
      cancelToken: cancelToken,
      onSendProgress: onSendProgress,
      onReceiveProgress: onReceiveProgress,
    );

    CurriculumResponse? _responseData;

    try {
      final rawResponse = _response.data;
      _responseData = rawResponse == null ? null : _serializers.deserialize(
        rawResponse,
        specifiedType: const FullType(CurriculumResponse),
      ) as CurriculumResponse;

    } catch (error, stackTrace) {
      throw DioException(
        requestOptions: _response.requestOptions,
        response: _response,
        type: DioExceptionType.unknown,
        error: error,
        stackTrace: stackTrace,
      );
    }

    return Response<CurriculumResponse>(
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
