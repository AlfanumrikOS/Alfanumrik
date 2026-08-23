import 'package:alfanumrik_api_v2/alfanumrik_api_v2.dart';
import 'package:dio/dio.dart';
import 'package:flutter/foundation.dart' show visibleForTesting;
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
  V2ApiClient._({Dio? dio, String? Function()? accessTokenSource})
      : _accessTokenSource = accessTokenSource ?? _supabaseAccessToken {
    _client = AlfanumrikApiV2(
      basePathOverride: ApiConstants.v2BasePath,
      // The generated client applies sane defaults; we widen the receive
      // timeout to match the legacy client's tolerance for Indian-4G latency
      // (the generated default of 3s is too tight for a cold server-driven
      // "Today" resolve).
      dio: dio ??
          Dio(BaseOptions(
            baseUrl: ApiConstants.v2BasePath,
            connectTimeout: ApiConstants.connectTimeout,
            receiveTimeout: ApiConstants.receiveTimeout,
            headers: const {
              'Content-Type': 'application/json',
              'Accept': 'application/json',
            },
          )),
    );
    // MUST be installed on every instance (production AND test) — without it
    // the generated deserializers reject every real `/v2` payload. See
    // [SchemaVersionCompatInterceptor].
    _client.dio.interceptors.add(SchemaVersionCompatInterceptor());
  }

  /// **Test-only seam.** Builds the wrapper around a caller-supplied [Dio] so a
  /// test can install a fake `HttpClientAdapter` and drive REAL response bodies
  /// through the generated client — and therefore through the repository code
  /// that reads them.
  ///
  /// This exists because the production path is otherwise untestable end-to-end
  /// in two ways that hid a live defect: the constructor was private (no way to
  /// supply a Dio) and [api] read `Supabase.instance` (throws with no
  /// initialised Supabase). The consequence was that
  /// `QuizRepository.submitOfflineReplay` — the ONLY place the server's
  /// `retryable` flag is wired into `OfflineDrainService.classify` — had no
  /// test. Deleting that one argument left all drain unit tests green while
  /// silently reverting the entire server-side fix on mobile.
  ///
  /// [accessTokenSource] defaults to returning null (no Bearer stamped), which
  /// is what keeps this usable without a Supabase runtime. Pass one to assert
  /// on auth wiring.
  ///
  /// Production is unaffected: the provider still uses the private constructor,
  /// whose defaults reproduce the previous behaviour exactly.
  @visibleForTesting
  factory V2ApiClient.forTesting({
    required Dio dio,
    String? Function()? accessTokenSource,
  }) =>
      V2ApiClient._(
        dio: dio,
        accessTokenSource: accessTokenSource ?? () => null,
      );

  late final AlfanumrikApiV2 _client;

  /// Where the Bearer token comes from. Production reads the live Supabase
  /// session (see [_supabaseAccessToken]); tests inject their own so the class
  /// is constructible without a Supabase runtime.
  final String? Function() _accessTokenSource;

  /// The production token source: the current Supabase session's access token,
  /// re-read on every call so `supabase_flutter`'s auto-refresh is honoured.
  static String? _supabaseAccessToken() =>
      Supabase.instance.client.auth.currentSession?.accessToken;

  /// Returns the generated client with the current access token stamped onto
  /// its Bearer interceptor. Call this on every use so a token refreshed by
  /// `supabase_flutter` between calls is always applied.
  AlfanumrikApiV2 get api {
    final token = _accessTokenSource();
    if (token != null) {
      // The security-scheme name is `bearerAuth` (see today_api.dart `secure`
      // extras). `setBearerAuth(name, token)` populates the
      // `BearerAuthInterceptor.tokens` map keyed by that name.
      _client.setBearerAuth('bearerAuth', token);
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

  /// Parent surface (Wave 2.4): `GET /v2/parent/children`,
  /// `GET /v2/parent/glance?student_id=`, `POST /v2/parent/encourage`.
  /// Reached ONLY when `ApiConstants.useV2` is on AND the authenticated user is
  /// a guardian (see [roleProvider] / the role-aware router fork). The same
  /// Supabase Bearer token a student uses authenticates the guardian — the
  /// server's RBAC (`child.view_progress` / `child.encourage`) + the
  /// guardian↔student link gate every read.
  ParentApi get parentApi => api.getParentApi();
}

/// Coerces the `schemaVersion` discriminator from a JSON **number** to the
/// **string** the generated built_value enum serializer demands, before the
/// generated deserializer sees the body.
///
/// ## The defect this works around (found 2026-08-12 by the offline-replay
/// composition test, `test/data/repositories/offline_replay_composition_test.dart`)
///
/// The contract declares the field as a numeric enum:
/// `schemaVersion: { type: 'number', enum: [1] }` (openapi/v2.json), and the
/// server emits `schemaVersion: 1 as const` — a JSON **number**
/// (`apps/host/src/app/api/v2/quiz/submit/route.ts`, and
/// `packages/lib/src/api/v2/contract.ts` where 14 payload schemas use
/// `z.literal(1)`).
///
/// openapi-generator's dart-dio target compiles that numeric enum to a
/// STRING-keyed serializer:
///
/// ```dart
/// static const Map<Object, String> _fromWire = <Object, String>{ '1': 'n1' };
/// ...deserialize(...) => valueOf(_fromWire[serialized] ??
///     (serialized is String ? serialized : ''));   //  int 1  ⇒  ''  ⇒  throws
/// ```
///
/// So the int `1` misses `_fromWire`, fails the `is String` guard, and
/// `valueOf('')` throws `Invalid argument(s)`. The generated API method wraps
/// that in `DioException(type: unknown, response: <the 200>)`.
///
/// **Blast radius: all 12 top-level `/v2` response models** carry this
/// discriminator (today, quiz questions/start/submit, learn curriculum/concept,
/// student profile/progress/leaderboard, parent children/glance, exam
/// schedule) — i.e. the ENTIRE generated client could not decode a single real
/// server response. It went unnoticed because `ApiConstants.useV2` defaults OFF
/// and the v2 cohort is server-assigned.
///
/// Concretely on the offline path: a genuinely GRADED submission (HTTP 200)
/// surfaced to `QuizRepository.submitOfflineReplay` as a `DioException` with
/// `statusCode == 200`, which `OfflineDrainService.classify` fell through to
/// `retain` — so a successfully-scored quiz never left the queue, was re-sent
/// until the replay window closed, and the student never saw their score. No
/// XP was ever double-granted (the immutable idempotency key made every
/// re-send an idempotent replay), so this was a silent-loss bug, not a
/// scoring bug.
///
/// ## Why the fix lives HERE
/// `mobile/lib/api/v2/**` is codegen output ("AUTO-GENERATED FILE, DO NOT
/// MODIFY") and any hand-edit is erased by the next `npm run gen:dart`. This
/// hand-written wrapper is the correct place for a transport-level shim: it
/// survives regeneration and applies uniformly to all 12 models.
///
/// ⚠️ **This is a workaround, not the cure.** The durable fix is a contract /
/// codegen change (owners: backend + architect) — either emit the
/// discriminator as a string, or drop the `enum` so it generates as a plain
/// `num`. Delete this interceptor once that lands; the composition test's
/// 200-path case will tell you whether it is still needed.
///
/// Deliberately narrow and total: it rewrites ONLY a key named exactly
/// `schemaVersion` whose value is a `num`, is depth-limited, and never throws —
/// a shim that can break a response is worse than the bug it patches.
class SchemaVersionCompatInterceptor extends Interceptor {
  /// The one key this shim is allowed to touch.
  static const String key = 'schemaVersion';

  /// Recursion guard. Real `/v2` payloads nest a handful of levels; anything
  /// deeper is left untouched rather than risking a pathological walk.
  static const int maxDepth = 12;

  @override
  void onResponse(Response<dynamic> response, ResponseInterceptorHandler handler) {
    try {
      _normalize(response.data, 0);
    } catch (_) {
      // Never let the shim fail a response. If normalization can't run, the
      // generated deserializer produces exactly the error it would have
      // produced without this interceptor.
    }
    handler.next(response);
  }

  static void _normalize(Object? node, int depth) {
    if (depth > maxDepth) return;
    if (node is Map) {
      final v = node[key];
      // `bool` is not a `num` in Dart, so flags can't be caught by accident.
      // Both `1` and `1.0` must map to the wire literal `'1'` — a naive
      // `toString()` on a double would emit `'1.0'` and miss the enum.
      String? replacement;
      if (v is int) {
        replacement = v.toString();
      } else if (v is double && v.isFinite && v == v.truncateToDouble()) {
        replacement = v.truncate().toString();
      }
      if (replacement != null) {
        try {
          node[key] = replacement;
        } catch (_) {
          // An unmodifiable or narrowly-typed map (never produced by
          // `jsonDecode`, but possible for a hand-built body). Skip this node
          // and keep walking rather than aborting the whole response.
        }
      }
      for (final child in node.values) {
        _normalize(child, depth + 1);
      }
    } else if (node is List) {
      for (final child in node) {
        _normalize(child, depth + 1);
      }
    }
  }
}

/// Singleton provider for the generated `/v2` client. Kept app-scoped (no
/// autoDispose) so the underlying Dio + serializers are constructed once.
final v2ApiClientProvider = Provider<V2ApiClient>((ref) => V2ApiClient._());
