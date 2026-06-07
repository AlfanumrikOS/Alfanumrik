import 'package:alfanumrik_api_v2/alfanumrik_api_v2.dart';
import 'package:dio/dio.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:supabase_flutter/supabase_flutter.dart';

import '../constants/api_constants.dart';

/// Riverpod-exposed singleton wrapping the GENERATED `/v2` dart-dio client
/// (`package:alfanumrik_api_v2`). This is the single construction site for the
/// generated client so base-path + auth wiring lives in exactly one place.
///
/// Why a dedicated wrapper rather than the existing [ApiClient]:
///   * The generated client owns its own [Dio] + built_value [Serializers] and
///     installs its own auth interceptors (OAuth / Basic / Bearer / ApiKey).
///     We hand it a base path and feed the Bearer token; we do NOT replace its
///     Dio so its generated (de)serialization keeps working.
///   * The `/v2` routes live at `<host>/api/v2/...`. The generated
///     `TodayApi.getToday()` requests the relative path `/v2/today` and the
///     client's `basePath` constant is `/api`, so we pass
///     `basePathOverride: <host>/api` (== [ApiConstants.v2BasePath]) → the
///     resolved URL is `<host>/api/v2/today`.
///
/// Auth: the generated client carries a `bearerAuth` security scheme (an HTTP
/// `bearer` scheme named `bearerAuth`; see the `secure` extras in
/// `today_api.dart` and `BearerAuthInterceptor`). We reuse the SAME Supabase
/// session access token the legacy `_AuthInterceptor` uses — no new auth
/// mechanism is introduced. Because access tokens auto-refresh, we re-stamp
/// the token from `currentSession` on every call via [api], so a refreshed
/// session is always honoured.
class V2ApiClient {
  V2ApiClient._() {
    _client = AlfanumrikApiV2(
      basePathOverride: ApiConstants.v2BasePath,
      // The generated client applies sane defaults; we widen the receive
      // timeout to match the legacy client's tolerance for Indian-4G latency
      // (the generated default of 3s is too tight for a cold server-driven
      // "Today" resolve).
      dio: Dio(BaseOptions(
        baseUrl: ApiConstants.v2BasePath,
        connectTimeout: ApiConstants.connectTimeout,
        receiveTimeout: ApiConstants.receiveTimeout,
        headers: const {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
        },
      )),
    );
  }

  late final AlfanumrikApiV2 _client;

  /// Returns the generated client with the current Supabase access token
  /// stamped onto its Bearer interceptor. Call this on every use so a token
  /// refreshed by `supabase_flutter` between calls is always applied.
  AlfanumrikApiV2 get api {
    final session = Supabase.instance.client.auth.currentSession;
    if (session != null) {
      // The security-scheme name is `bearerAuth` (see today_api.dart `secure`
      // extras). `setBearerAuth(name, token)` populates the
      // `BearerAuthInterceptor.tokens` map keyed by that name.
      _client.setBearerAuth('bearerAuth', session.accessToken);
    }
    return _client;
  }

  /// Convenience accessor for the Today surface (Wave 2.3 scope).
  TodayApi get todayApi => api.getTodayApi();

  /// Quiz surface (Wave 2.3b): `GET /v2/quiz/questions`,
  /// `POST /v2/quiz/start`, `POST /v2/quiz/submit`.
  QuizApi get quizApi => api.getQuizApi();

  /// Learn surface (Wave 2.3b): `GET /v2/learn/curriculum`,
  /// `GET /v2/learn/concept`.
  LearnApi get learnApi => api.getLearnApi();

  /// Student surface (Wave 2.3b): `GET /v2/student/profile`,
  /// `GET /v2/student/progress`, `GET /v2/student/leaderboard`.
  StudentApi get studentApi => api.getStudentApi();
}

/// Singleton provider for the generated `/v2` client. Kept app-scoped (no
/// autoDispose) so the underlying Dio + serializers are constructed once.
final v2ApiClientProvider = Provider<V2ApiClient>((ref) => V2ApiClient._());
