//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//

import 'package:dio/dio.dart';
import 'package:built_value/serializer.dart';
import 'package:alfanumrik_api_v2/src/serializers.dart';
import 'package:alfanumrik_api_v2/src/auth/api_key_auth.dart';
import 'package:alfanumrik_api_v2/src/auth/basic_auth.dart';
import 'package:alfanumrik_api_v2/src/auth/bearer_auth.dart';
import 'package:alfanumrik_api_v2/src/auth/oauth.dart';
import 'package:alfanumrik_api_v2/src/api/learn_api.dart';
import 'package:alfanumrik_api_v2/src/api/parent_api.dart';
import 'package:alfanumrik_api_v2/src/api/quiz_api.dart';
import 'package:alfanumrik_api_v2/src/api/student_api.dart';
import 'package:alfanumrik_api_v2/src/api/today_api.dart';

class AlfanumrikApiV2 {
  static const String basePath = r'/api';

  final Dio dio;
  final Serializers serializers;

  AlfanumrikApiV2({
    Dio? dio,
    Serializers? serializers,
    String? basePathOverride,
    List<Interceptor>? interceptors,
  })  : this.serializers = serializers ?? standardSerializers,
        this.dio = dio ??
            Dio(BaseOptions(
              baseUrl: basePathOverride ?? basePath,
              connectTimeout: const Duration(milliseconds: 5000),
              receiveTimeout: const Duration(milliseconds: 3000),
            )) {
    if (interceptors == null) {
      this.dio.interceptors.addAll([
        OAuthInterceptor(),
        BasicAuthInterceptor(),
        BearerAuthInterceptor(),
        ApiKeyAuthInterceptor(),
      ]);
    } else {
      this.dio.interceptors.addAll(interceptors);
    }
  }

  void setOAuthToken(String name, String token) {
    if (this.dio.interceptors.any((i) => i is OAuthInterceptor)) {
      (this.dio.interceptors.firstWhere((i) => i is OAuthInterceptor) as OAuthInterceptor).tokens[name] = token;
    }
  }

  void setBearerAuth(String name, String token) {
    if (this.dio.interceptors.any((i) => i is BearerAuthInterceptor)) {
      (this.dio.interceptors.firstWhere((i) => i is BearerAuthInterceptor) as BearerAuthInterceptor).tokens[name] = token;
    }
  }

  void setBasicAuth(String name, String username, String password) {
    if (this.dio.interceptors.any((i) => i is BasicAuthInterceptor)) {
      (this.dio.interceptors.firstWhere((i) => i is BasicAuthInterceptor) as BasicAuthInterceptor).authInfo[name] = BasicAuthInfo(username, password);
    }
  }

  void setApiKey(String name, String apiKey) {
    if (this.dio.interceptors.any((i) => i is ApiKeyAuthInterceptor)) {
      (this.dio.interceptors.firstWhere((element) => element is ApiKeyAuthInterceptor) as ApiKeyAuthInterceptor).apiKeys[name] = apiKey;
    }
  }

  /// Get LearnApi instance, base route and serializer can be overridden by a given but be careful,
  /// by doing that all interceptors will not be executed
  LearnApi getLearnApi() {
    return LearnApi(dio, serializers);
  }

  /// Get ParentApi instance, base route and serializer can be overridden by a given but be careful,
  /// by doing that all interceptors will not be executed
  ParentApi getParentApi() {
    return ParentApi(dio, serializers);
  }

  /// Get QuizApi instance, base route and serializer can be overridden by a given but be careful,
  /// by doing that all interceptors will not be executed
  QuizApi getQuizApi() {
    return QuizApi(dio, serializers);
  }

  /// Get StudentApi instance, base route and serializer can be overridden by a given but be careful,
  /// by doing that all interceptors will not be executed
  StudentApi getStudentApi() {
    return StudentApi(dio, serializers);
  }

  /// Get TodayApi instance, base route and serializer can be overridden by a given but be careful,
  /// by doing that all interceptors will not be executed
  TodayApi getTodayApi() {
    return TodayApi(dio, serializers);
  }
}
