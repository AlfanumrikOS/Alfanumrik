import 'package:dio/dio.dart';

import '../../core/network/api_client.dart';
import '../models/synthesis_models.dart';

/// Monthly Synthesis repository — mobile parity for the web `/synthesis`
/// surface (Pedagogy v2 Wave 3).
///
/// PURE REST-via-[ApiClient]. No direct `monthly_synthesis_runs` table read:
/// `GET /api/synthesis/state` does more than a SELECT — it LAZY-FILLS the
/// bilingual summary on first view (Claude call → item-4.2 fabrication oracle
/// → word-cap → deterministic template fallback → service-role persist). A
/// direct table read from mobile would return an EMPTY summary forever and
/// bypass the safety oracle entirely. Verified 2026-07-22.
///
/// ── BOTH ROUTES USE THE RAW DIO CLIENT ──────────────────────────────────────
/// [ApiClient.post]/[ApiClient.get] map a status code to one opaque
/// [AppException] and DISCARD the response body. That is unusable here:
///   * `/state` returns 404 for BOTH "flag off" and "no student profile" —
///     same handling, fine — but a 200 carries a `state` discriminator that
///     must be read.
///   * `/parent-share` packs NINE distinct error codes into FIVE status codes
///     (404 = flag-off | row-missing | no-guardian | guardian-missing;
///     422 = phone-missing | flagged-for-review). Only the body's `error`
///     string tells them apart.
///   * `ApiClient._mapStatusCode` additionally rewrites EVERY 403 into
///     `PaymentException.permissionDenied()` ("This account can't purchase a
///     plan"), which would be flatly wrong copy for `guardian_opted_out`.
/// Same rationale and shape as `AssignmentsRepository.completeAssignment`.
///
/// P13: never logs summary text, student/guardian names, or phone numbers.
class SynthesisRepository {
  final ApiClient _api;

  SynthesisRepository({ApiClient? apiClient}) : _api = apiClient ?? ApiClient();

  /// `GET /api/synthesis/state`.
  ///
  /// The monthly-synthesis feature flag (`ff_pedagogy_v2_monthly_synthesis`)
  /// is still OFF in production as of 2026-07-22, so [SynthesisUnavailable]
  /// (404) is currently the EXPECTED response for essentially every student.
  /// It is modelled as a first-class outcome, never an error.
  Future<SynthesisStateResult> getState() async {
    try {
      final response = await _api.dio.get<dynamic>('/synthesis/state');
      return classifyStateResponse(response.statusCode, response.data);
    } on DioException catch (e) {
      return classifyStateResponse(e.response?.statusCode, e.response?.data);
    } catch (_) {
      return const SynthesisStateFailure(
        'Connection error. Please try again.',
      );
    }
  }

  /// `POST /api/synthesis/parent-share` with `{ synthesisRunId }`.
  Future<ParentShareOutcome> shareToParent(String synthesisRunId) async {
    try {
      final response = await _api.dio.post<dynamic>(
        '/synthesis/parent-share',
        data: {'synthesisRunId': synthesisRunId},
      );
      return classifyParentShareResponse(response.statusCode, response.data);
    } on DioException catch (e) {
      return classifyParentShareResponse(
        e.response?.statusCode,
        e.response?.data,
      );
    } catch (_) {
      return const ParentShareFailure('Connection error. Please try again.');
    }
  }

  // ── Pure helpers (testable without network) ───────────────────────────────

  static Map<String, dynamic> _asMap(dynamic data) =>
      data is Map ? Map<String, dynamic>.from(data) : const <String, dynamic>{};

  /// Maps a `/api/synthesis/state` response to a [SynthesisStateResult].
  static SynthesisStateResult classifyStateResponse(
    int? statusCode,
    dynamic data,
  ) {
    final map = _asMap(data);

    if (statusCode == 404) return const SynthesisUnavailable();

    if (statusCode == 200) {
      final state = map['state'];
      if (state == 'no_synthesis_yet') return const SynthesisNotYet();
      if (state == 'ready' && map['row'] is Map) {
        return SynthesisReady(
          SynthesisRow.fromJson(Map<String, dynamic>.from(map['row'] as Map)),
        );
      }
      // A 200 that matches neither discriminator is a contract break. Degrade
      // to "not yet" (a calm wait state) rather than inventing a row — the
      // student is never shown fabricated synthesis content.
      return const SynthesisNotYet();
    }

    if (statusCode == 401) {
      return const SynthesisStateFailure('Session expired. Please login again.');
    }

    return const SynthesisStateFailure(
      "Couldn't load your monthly synthesis. Please try again.",
    );
  }

  /// Maps a `/api/synthesis/parent-share` response to a [ParentShareOutcome].
  ///
  /// Keys off the machine-readable `error` code first, falling back to the
  /// status code. Deliberately does NOT copy the web page's shortcut of
  /// treating EVERY 403 as `opted_out`: the route added an
  /// `authorizeRequest('report.download_own')` RBAC gate on 2026-07-20 that
  /// also emits 403, and telling a student "your parent opted out" when the
  /// real cause is a permission denial would be a false statement about
  /// someone else's choice.
  static ParentShareOutcome classifyParentShareResponse(
    int? statusCode,
    dynamic data,
  ) {
    final map = _asMap(data);
    final code = map['error'] is String ? map['error'] as String : '';

    if (statusCode == 200) {
      if (map['alreadySent'] == true) return const ParentShareAlreadySent();
      final sentAt = map['sentAt'];
      return ParentShareSent(sentAt is String ? sentAt : null);
    }

    return switch (code) {
      'guardian_opted_out' => const ParentShareOptedOut(),
      'flagged_for_review' => const ParentShareFlagged(),
      'guardian_phone_missing' => const ParentSharePhoneMissing(),
      'no_linked_guardian' || 'guardian_not_found' =>
        const ParentShareNoGuardian(),
      'not_found' => const ParentShareUnavailable(),
      'whatsapp_delivery_failed' => const ParentShareDeliveryFailed(),
      _ => switch (statusCode) {
          // Unknown code on a known status — fall back to the safest reading
          // of that status rather than a generic error.
          502 => const ParentShareDeliveryFailed(),
          404 => const ParentShareUnavailable(),
          _ => const ParentShareFailure(
              "Couldn't share this month's summary. Please try again.",
            ),
        },
    };
  }
}
