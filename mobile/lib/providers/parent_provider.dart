import 'package:alfanumrik_api_v2/alfanumrik_api_v2.dart';
import 'package:dio/dio.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../core/network/v2_api_client.dart';

/// Parent surface state (Wave 2.4 mobile-parity) — fetched from the `/v2`
/// `ParentApi` via the GENERATED dart-dio client.
///
/// Two read providers + one write action, all reusing the generated client and
/// the Supabase Bearer token (no hand-written DTO parsing, no new auth):
///   • [parentChildrenProvider] — `GET /v2/parent/children`
///   • [parentGlanceProvider]   — `GET /v2/parent/glance?student_id=` (family)
///   • [encourageChild]         — `POST /v2/parent/encourage`
///
/// Reached ONLY when `ApiConstants.useV2` is ON AND the authenticated user is a
/// guardian (the role-aware router lands a guardian on `/parent`). The flag-OFF
/// app never mounts the parent tree, so these providers are never built.
///
/// NOTE (honesty): these providers are unit-covered for their pure mapping
/// helpers only. The live HTTP round-trips are NOT integration-tested here —
/// same posture as the existing student `/v2` repositories/providers (today,
/// progress, leaderboard). They are exercised against the running backend in
/// manual / CI-device runs.

/// The authenticated guardian's linked children.
final parentChildrenProvider =
    AsyncNotifierProvider<ParentChildrenNotifier, ParentChildrenResponse>(
        ParentChildrenNotifier.new);

class ParentChildrenNotifier extends AsyncNotifier<ParentChildrenResponse> {
  @override
  Future<ParentChildrenResponse> build() async => _fetch();

  /// Re-fetch the children list (pull-to-retry / pull-to-refresh).
  Future<void> refresh() async {
    state = const AsyncLoading();
    state = await AsyncValue.guard(_fetch);
  }

  Future<ParentChildrenResponse> _fetch() async {
    final client = ref.read(v2ApiClientProvider);
    final response = await client.parentApi.getParentChildren();
    final data = response.data;
    if (data == null) {
      throw StateError('Children response had no body');
    }
    return data;
  }
}

/// The at-a-glance view for ONE linked child. Family provider keyed by
/// `student_id` so switching the selected child re-resolves independently and
/// keeps each child's glance cached.
final parentGlanceProvider = AsyncNotifierProvider.family<ParentGlanceNotifier,
    ParentGlanceResponse, String>(ParentGlanceNotifier.new);

class ParentGlanceNotifier
    extends FamilyAsyncNotifier<ParentGlanceResponse, String> {
  @override
  Future<ParentGlanceResponse> build(String studentId) async =>
      _fetch(studentId);

  /// Re-fetch this child's glance.
  Future<void> refresh() async {
    state = const AsyncLoading();
    state = await AsyncValue.guard(() => _fetch(arg));
  }

  Future<ParentGlanceResponse> _fetch(String studentId) async {
    final client = ref.read(v2ApiClientProvider);
    final response =
        await client.parentApi.getParentGlance(studentId: studentId);
    final data = response.data;
    if (data == null) {
      throw StateError('Glance response had no body');
    }
    return data;
  }
}

/// Outcome of an Encourage send, mapped from the HTTP status the server returns
/// (mirrors `POST /api/v2/parent/encourage`: 200 ok, 429 rate-limited,
/// 403 not-linked / no parent profile, 4xx/5xx error).
enum EncourageOutcome {
  /// 200 — cheer sent.
  success,

  /// 429 — already cheered within the 6h window.
  rateLimited,

  /// 403 — not linked to this student / no parent profile.
  forbidden,

  /// Any other failure (400 bad key, 5xx, network, serialization).
  error,
}

/// Maps an [EncourageOutcome] to a friendly bilingual message for a toast.
/// Kept pure + outside the widget so it is unit-testable (P7).
String encourageMessage(EncourageOutcome outcome, bool isHi) {
  switch (outcome) {
    case EncourageOutcome.success:
      return isHi ? 'प्रोत्साहन भेज दिया गया! 🎉' : 'Cheer sent! 🎉';
    case EncourageOutcome.rateLimited:
      return isHi
          ? 'आपने हाल ही में प्रोत्साहन भेजा है। कुछ घंटे बाद दोबारा भेजें।'
          : 'You already cheered recently. Try again in a few hours.';
    case EncourageOutcome.forbidden:
      return isHi
          ? 'यह प्रोत्साहन नहीं भेजा जा सका।'
          : "This cheer couldn't be sent.";
    case EncourageOutcome.error:
      return isHi
          ? 'कुछ गड़बड़ हो गई। कृपया फिर से प्रयास करें।'
          : 'Something went wrong. Please try again.';
  }
}

/// Maps a Dio HTTP status code to an [EncourageOutcome]. Pure → unit-testable.
EncourageOutcome outcomeFromStatus(int? status) {
  switch (status) {
    case 200:
    case 201:
      return EncourageOutcome.success;
    case 429:
      return EncourageOutcome.rateLimited;
    case 403:
      return EncourageOutcome.forbidden;
    default:
      return EncourageOutcome.error;
  }
}

/// Provider exposing the Encourage action. Returns an [EncourageOutcome] the UI
/// maps to a bilingual toast. Sends ONLY `{ student_id, message_key }` — no PII
/// (P13). The `message_key` must be one of the curated preset keys
/// (`cheer_presets.dart`); the server rejects unknown keys (P12).
final encourageProvider = Provider<EncourageService>((ref) {
  return EncourageService(ref.read(v2ApiClientProvider));
});

class EncourageService {
  final V2ApiClient _client;
  const EncourageService(this._client);

  /// POST a preset cheer to a linked child.
  ///
  /// P13: logs nothing here — neither student_id nor message_key are written to
  /// any log. Callers must not log the request either.
  Future<EncourageOutcome> send({
    required String studentId,
    required String messageKey,
  }) async {
    try {
      final request = EncourageRequest((b) => b
        ..studentId = studentId
        ..messageKey = messageKey);

      // `validateStatus: (_) => true` so 4xx/429 don't throw — we read the
      // status and map it ourselves rather than catching a DioException for the
      // expected rate-limit / forbidden paths.
      final response = await _client.parentApi.postParentEncourage(
        encourageRequest: request,
        validateStatus: (_) => true,
      );
      return outcomeFromStatus(response.statusCode);
    } on DioException catch (e) {
      // Network/timeout/serialization — still try to honour a status if Dio
      // attached a response (it normally won't here given validateStatus above).
      return outcomeFromStatus(e.response?.statusCode);
    } catch (_) {
      return EncourageOutcome.error;
    }
  }
}
