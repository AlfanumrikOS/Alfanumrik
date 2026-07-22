import 'package:dio/dio.dart';

import '../../core/errors/app_exception.dart';
import '../../core/network/api_client.dart';
import '../../core/network/api_result.dart';
import '../models/dive_models.dart';

/// Weekly Curiosity Dive repository — mobile parity for the web `/dive` and
/// `/dive/history` surfaces (Pedagogy v2 Wave 2).
///
/// PURE REST-via-[ApiClient]. Unlike [RevisionRepository] there is NO direct
/// Supabase table read here: `dive_artifacts` writes must go through
/// `/api/dive/artifact` (it resolves the SURROGATE `students.id`, enforces the
/// UNIQUE(student_id, iso_week) constraint, and recomputes the weekly streak
/// with the canonical `computeWeeklyStreakFromHistory()` algorithm). Reading
/// `dive_artifacts` directly would also mean re-deriving `currentIsoWeek` and
/// the streak client-side — exactly the kind of duplicated rule the house
/// keeps server-only. Verified against the four route files 2026-07-22.
///
/// ── 404 IS NOT AN ERROR ─────────────────────────────────────────────────────
/// Every `/api/dive/*` route returns **404 `{ error: 'not_found' }` when the
/// `ff_pedagogy_v2_weekly_dive` server flag is off**, so the surface is fully
/// hidden. The web pages render a soft "not available for you yet" fallback on
/// 404 (`apps/host/src/app/dive/page.tsx`). Mobile mirrors that: the read
/// methods return `ApiSuccess(null)` for 404 — an explicit "feature
/// unavailable" value, never an `ApiFailure`, so it can't surface as a crash
/// banner.
///
/// (Context: the flag was enabled globally on 2026-06-24 and the dive is LIVE
/// at 100% in production, so the 404 branch is a safety net rather than the
/// common path — but it must stay correct for a flag rollback.)
///
/// P13: never logs artifact/topic contents — failures carry message text only.
class DiveRepository {
  final ApiClient _api;

  DiveRepository({ApiClient? apiClient}) : _api = apiClient ?? ApiClient();

  /// `GET /api/dive/state`.
  ///
  /// Returns `ApiSuccess(null)` when the feature is unavailable (404 — flag
  /// off). Returns [ApiFailure] only for genuine transport/server errors.
  Future<ApiResult<DiveState?>> getState() async {
    try {
      final res = await _api.get<Map<String, dynamic>>('/dive/state');
      final body = res.data;
      if (body == null) return const ApiSuccess<DiveState?>(null);
      return ApiSuccess<DiveState?>(DiveState.fromJson(body));
    } on AppException catch (e) {
      if (e is NetworkException && e.statusCode == 404) {
        return const ApiSuccess<DiveState?>(null);
      }
      return ApiFailure<DiveState?>(e.message);
    } catch (e) {
      return ApiFailure<DiveState?>('Failed to load dive: ${e.toString()}');
    }
  }

  /// `POST /api/dive/start`.
  ///
  /// [option] decides which single payload key the route requires:
  ///   * [DivePickerOption.phenomenon] → `phenomenonSlug`
  ///   * [DivePickerOption.weakTopic]  → `weakTopicId`
  ///   * [DivePickerOption.ownTopic]   → `ownTopic`
  /// Anything else is a 400 `invalid_picker_payload` server-side.
  ///
  /// Returns `ApiSuccess(null)` on 404 — which covers BOTH the flag-off case
  /// and `phenomenon_not_found` (an inactive/stale slug). Both mean "this
  /// choice can't start a dive right now"; the caller re-renders the picker.
  Future<ApiResult<ResolvedDive?>> start({
    required DivePickerOption option,
    String? phenomenonSlug,
    String? weakTopicId,
    String? ownTopic,
  }) async {
    final payload = <String, dynamic>{'pickerOption': option.value};
    switch (option) {
      case DivePickerOption.phenomenon:
        payload['phenomenonSlug'] = phenomenonSlug ?? '';
      case DivePickerOption.weakTopic:
        payload['weakTopicId'] = weakTopicId ?? '';
      case DivePickerOption.ownTopic:
        payload['ownTopic'] = ownTopic ?? '';
    }

    try {
      final res = await _api.post<Map<String, dynamic>>(
        '/dive/start',
        data: payload,
      );
      final body = res.data;
      if (body == null) {
        return const ApiFailure<ResolvedDive?>('Empty response from /dive/start');
      }
      return ApiSuccess<ResolvedDive?>(
        ResolvedDive.fromJson(body, pickerOption: option),
      );
    } on AppException catch (e) {
      if (e is NetworkException && e.statusCode == 404) {
        return const ApiSuccess<ResolvedDive?>(null);
      }
      return ApiFailure<ResolvedDive?>(e.message);
    } catch (e) {
      return ApiFailure<ResolvedDive?>('Failed to start dive: ${e.toString()}');
    }
  }

  /// `POST /api/dive/artifact`.
  ///
  /// Uses the RAW [ApiClient.dio] rather than [ApiClient.post] because this
  /// route's non-2xx outcomes are materially different from each other
  /// (409 already-saved is a SUCCESS for the student; 400 is a fixable input
  /// problem; 404 is feature-unavailable) and `_mapDioError` collapses each
  /// status into one opaque [AppException] with no body. Same rationale and
  /// shape as `AssignmentsRepository.completeAssignment`.
  ///
  /// [keyConcepts] is sent verbatim; the server trims, drops empties, and caps
  /// at 12. [workedExample] is omitted entirely when blank (the route treats
  /// blank and absent identically, but omitting matches the web composer).
  Future<DiveArtifactOutcome> saveArtifact({
    required DivePickerOption pickerOption,
    required String diveTopic,
    required List<String> diveSubjects,
    String? phenomenonSlug,
    required String title,
    required List<String> keyConcepts,
    String? workedExample,
    required String studentVoice,
  }) async {
    final trimmedExample = workedExample?.trim() ?? '';
    try {
      final response = await _api.dio.post<dynamic>(
        '/dive/artifact',
        data: {
          'pickerOption': pickerOption.value,
          'diveTopic': diveTopic,
          'diveSubjects': diveSubjects,
          'phenomenonSlug': phenomenonSlug,
          'title': title.trim(),
          'keyConcepts': keyConcepts,
          if (trimmedExample.isNotEmpty) 'workedExample': trimmedExample,
          'studentVoice': studentVoice.trim(),
        },
      );
      return classifyArtifactResponse(response.statusCode, response.data);
    } on DioException catch (e) {
      return classifyArtifactResponse(e.response?.statusCode, e.response?.data);
    } catch (_) {
      return const DiveArtifactFailure('Connection error. Please try again.');
    }
  }

  /// `GET /api/dive/history?limit=N`.
  ///
  /// Returns `ApiSuccess(null)` on 404 (flag off). An empty list is a valid,
  /// distinct success: the student simply has no artifacts yet.
  Future<ApiResult<List<DiveHistoryItem>?>> getHistory({int limit = 60}) async {
    try {
      final res = await _api.get<Map<String, dynamic>>(
        '/dive/history',
        queryParameters: {'limit': limit},
      );
      final raw = res.data?['artifacts'];
      if (raw is! List) {
        return const ApiSuccess<List<DiveHistoryItem>?>(<DiveHistoryItem>[]);
      }
      return ApiSuccess<List<DiveHistoryItem>?>(
        raw
            .whereType<Map>()
            .map((e) => DiveHistoryItem.fromJson(Map<String, dynamic>.from(e)))
            .toList(growable: false),
      );
    } on AppException catch (e) {
      if (e is NetworkException && e.statusCode == 404) {
        return const ApiSuccess<List<DiveHistoryItem>?>(null);
      }
      return ApiFailure<List<DiveHistoryItem>?>(e.message);
    } catch (e) {
      return ApiFailure<List<DiveHistoryItem>?>(
        'Failed to load dive history: ${e.toString()}',
      );
    }
  }

  // ── Pure helper (testable without network) ────────────────────────────────

  /// Maps an artifact-save HTTP response — either a 2xx body or a
  /// [DioException]'s `(statusCode, body)` — to a distinct
  /// [DiveArtifactOutcome].
  ///
  /// Unlike the assignments-completion equivalent, this needs NO fragile
  /// substring matching: `/api/dive/artifact` already returns a
  /// machine-readable `error` code on every failure branch
  /// (`already_saved_this_week`, `missing_title`, `missing_student_voice`,
  /// `invalid_picker_option`, `student_profile_not_found`, `not_found`,
  /// `artifact_save_failed`). We key off the status code and only read the
  /// code string to surface WHICH validation rule failed.
  static DiveArtifactOutcome classifyArtifactResponse(
    int? statusCode,
    dynamic data,
  ) {
    final map = data is Map
        ? Map<String, dynamic>.from(data)
        : const <String, dynamic>{};

    if (statusCode == 200) {
      final artifactId = map['artifactId'];
      if (artifactId is String && artifactId.isNotEmpty) {
        return DiveArtifactSaved(DiveArtifactSaveResult.fromJson(map));
      }
      // 200 with no artifactId shouldn't happen; treat as retriable rather
      // than silently claiming the dive was saved.
      return const DiveArtifactFailure('Unexpected response. Please try again.');
    }

    return switch (statusCode) {
      409 => const DiveArtifactAlreadySaved(),
      404 => const DiveArtifactUnavailable(),
      400 => DiveArtifactInvalid(
          (map['error'] is String && (map['error'] as String).isNotEmpty)
              ? map['error'] as String
              : 'invalid_body',
        ),
      _ => const DiveArtifactFailure(
          "Couldn't save your artifact. Please try again.",
        ),
    };
  }
}
