import 'package:dio/dio.dart';

import '../../core/constants/diagnostic_copy.dart';
import '../../core/errors/app_exception.dart';
import '../../core/network/api_client.dart';
import '../../core/network/api_result.dart';
import '../models/diagnostic_models.dart';

/// Diagnostic Assessment repository — REST calls via [ApiClient] (Dio),
/// same transport pattern as [SubscriptionRepository]. 2-call lifecycle
/// against `apps/host/src/app/api/diagnostic/{start,complete}/route.ts`:
///
///   * `POST /diagnostic/start`    { grade, subject } → one of THREE 200 shapes
///   * `POST /diagnostic/complete` { session_id, responses[] } → summary
///
/// The auth Bearer header is injected by [ApiClient]'s `_AuthInterceptor`
/// (`authorizeRequest(request, 'diagnostic.attempt'|'diagnostic.complete')`
/// enforces RBAC server-side — P9).
///
/// ── Contract sync (verified 2026-07-29 against the route source) ──────────
///
/// `/start` HTTP 200 outcomes, all with `success: true, ok: true`:
///   a) form assembled     → `{ rung, blueprint, data: { session_id, questions, … } }`
///   b) content gap        → `{ diagnostic: null, insufficientContent: true,
///                              reason: 'INSUFFICIENT_POOL', headline, message,
///                              alternatives: [...], data: { content_insufficient: true,
///                              quality_tier: 'insufficient', reason, available_count,
///                              alternatives } }`
///   c) stream required    → `{ diagnostic: null, streamRequired: true, headline,
///                              message, cta, streamOptions: [...] }` — NOTE there is
///                              NO `data` key on this branch, which is exactly what
///                              used to make the old parser throw and surface a
///                              misleading "Connection error".
///
/// `/start` non-200: 400 (INVALID_BODY / INVALID_GRADE / INVALID_SUBJECT /
/// CHAPTER_NOT_SUPPORTED), 404 (NO_STUDENT), 422 subject governance
/// (`{ error: <code>, subject, reason, allowed }`), 500. We read the body on
/// every sub-500 status so the student gets the real reason instead of Dio's
/// generic per-status message.
class DiagnosticRepository {
  final ApiClient _api;

  DiagnosticRepository({ApiClient? api}) : _api = api ?? ApiClient();

  /// Read 4xx bodies instead of throwing on them. 5xx still throws so the
  /// shared retry/timeouts behaviour in [ApiClient] is unchanged.
  static final Options _readErrorBodies =
      Options(validateStatus: (s) => s != null && s < 500);

  Future<ApiResult<DiagnosticStartResult>> start({
    required String grade,
    required String subject,
  }) async {
    try {
      final response = await _api.dio.post<dynamic>(
        '/diagnostic/start',
        // P5: `grade` is a STRING "6".."12". Never send an int — the route
        // hard-rejects a non-string with 400 INVALID_GRADE.
        data: {'grade': grade, 'subject': subject},
        options: _readErrorBodies,
      );

      final data = _asMap(response.data);
      if (data == null) return const ApiFailure(DiagnosticCopy.genericErrorKey);

      final status = response.statusCode ?? 0;
      if (status < 200 || status >= 300) {
        return ApiFailure(_errorMessage(data));
      }

      return ApiSuccess(parseStartResponse(data, grade: grade, subject: subject));
    } on AppException catch (e) {
      return ApiFailure(e.message);
    } on DioException {
      return const ApiFailure(DiagnosticCopy.connectionErrorKey);
    } catch (_) {
      return const ApiFailure(DiagnosticCopy.connectionErrorKey);
    }
  }

  Future<ApiResult<DiagnosticSummary>> complete({
    required String sessionId,
    required List<DiagnosticResponseItem> responses,
  }) async {
    try {
      final response = await _api.dio.post<dynamic>(
        '/diagnostic/complete',
        data: {
          'session_id': sessionId,
          // `is_correct` rides along for wire-compat only — the route
          // re-derives correctness from question_bank (§C1) and never reads it.
          'responses': responses.map((r) => r.toJson()).toList(growable: false),
        },
        options: _readErrorBodies,
      );

      final data = _asMap(response.data);
      if (data == null) return const ApiFailure(DiagnosticCopy.genericErrorKey);

      final status = response.statusCode ?? 0;
      if (status < 200 || status >= 300 || data['success'] != true) {
        return ApiFailure(_errorMessage(data));
      }

      final payload = _asMap(data['data']);
      if (payload == null) return ApiFailure(_errorMessage(data));

      return ApiSuccess(DiagnosticSummary.fromJson(payload));
    } on AppException catch (e) {
      return ApiFailure(e.message);
    } on DioException {
      return const ApiFailure(DiagnosticCopy.connectionErrorKey);
    } catch (_) {
      return const ApiFailure(DiagnosticCopy.connectionErrorKey);
    }
  }

  // ── parsing ───────────────────────────────────────────────────────────────

  /// Pure classifier for a 2xx `/diagnostic/start` body. Public so it can be
  /// unit-tested against the exact shapes the route emits (same convention as
  /// `SynthesisRepository.classifyStateResponse`).
  ///
  /// Order matters: the two `diagnostic: null` states also carry
  /// `success: true`, so they MUST be recognised before the ready branch.
  static DiagnosticStartResult parseStartResponse(
    Map<String, dynamic> data, {
    required String grade,
    required String subject,
  }) {
    final payload = _asMap(data['data']);

    // (c) stream required — no `data` key at all on this branch.
    if (data['streamRequired'] == true) {
      return DiagnosticStreamRequired(
        headline:
            DiagnosticBilingual.tryParse(data['headline']) ?? DiagnosticCopy.streamHeadline,
        message: DiagnosticBilingual.tryParse(data['message']) ??
            DiagnosticCopy.streamBody.fill({'grade': grade}),
        cta: DiagnosticBilingual.tryParse(data['cta']) ?? DiagnosticCopy.streamCta,
        streamOptions: _stringList(data['streamOptions']).isEmpty
            ? const ['science', 'commerce', 'humanities']
            : _stringList(data['streamOptions']),
      );
    }

    // (b) content gap. Accept either the frozen top-level flag or the
    // spec-shaped `data.content_insufficient` mirror.
    final insufficient = data['insufficientContent'] == true ||
        payload?['content_insufficient'] == true ||
        payload?['quality_tier'] == 'insufficient';
    if (insufficient) {
      final alternatives = () {
        final top = DiagnosticAlternative.parseList(data['alternatives']);
        if (top.isNotEmpty) return top;
        return DiagnosticAlternative.parseList(payload?['alternatives']);
      }();
      return DiagnosticInsufficientContent(
        headline: DiagnosticBilingual.tryParse(data['headline']) ??
            DiagnosticCopy.insufficientHeadline,
        message: DiagnosticBilingual.tryParse(data['message']) ??
            DiagnosticCopy.insufficientBody.fill({'grade': grade, 'subject': subject}),
        reason: data['reason'] as String? ?? 'INSUFFICIENT_POOL',
        detailReason: payload?['reason'] as String?,
        // May legitimately be empty only if the server contract regressed;
        // the UI synthesises a Foxy CTA in that case so it is never a dead end.
        alternatives: alternatives,
      );
    }

    // (a) ready. A `diagnostic: null` we don't recognise, a missing `data`, or
    // an empty question list all degrade to the honest stop rather than a quiz
    // screen with nothing in it.
    final sessionId = payload?['session_id'] as String? ?? '';
    final questions = _parseQuestions(payload?['questions']);
    if (sessionId.isEmpty || questions.isEmpty) {
      return const DiagnosticInsufficientContent(
        headline: DiagnosticCopy.unknownStopHeadline,
        message: DiagnosticCopy.unknownStopBody,
        reason: 'UNRECOGNISED_EMPTY_FORM',
        alternatives: [],
      );
    }

    return DiagnosticFormReady(
      sessionId: sessionId,
      questions: questions,
      rung: (data['rung'] as num?)?.toInt() ?? (payload?['rung'] as num?)?.toInt(),
      qualityTier: payload?['quality_tier'] as String?,
      shortForm: payload?['short_form'] == true,
      shortFormMessage: DiagnosticBilingual.tryParse(payload?['short_form_message']),
      setupReassurance: DiagnosticBilingual.tryParse(payload?['setup_reassurance']),
    );
  }

  static List<DiagnosticQuestion> _parseQuestions(dynamic raw) {
    if (raw is! List) return const [];
    return raw
        .whereType<Map>()
        .map((e) => DiagnosticQuestion.fromJson(Map<String, dynamic>.from(e)))
        .toList(growable: false);
  }

  static Map<String, dynamic>? _asMap(dynamic raw) =>
      raw is Map ? Map<String, dynamic>.from(raw) : null;

  static List<String> _stringList(dynamic raw) => raw is List
      ? raw.map((e) => e.toString()).toList(growable: false)
      : const <String>[];

  /// Error bodies come in two shapes:
  ///   `{ success: false, error: <english>, code: <CODE> }` (most branches)
  ///   `{ error: <GOVERNANCE_CODE>, subject, reason, allowed }` (the 422)
  ///
  /// Returns the KEY the UI resolves with `DiagnosticCopy.resolveError` — a
  /// stable code when one is available (so it can be shown in Hindi), else the
  /// server's English sentence. Never includes a student identifier (P13).
  static String _errorMessage(Map<String, dynamic> data) {
    final code = data['code'] as String?;
    if (code != null && code.isNotEmpty) return code;
    final error = data['error'] as String?;
    if (error != null && error.isNotEmpty) return error;
    return DiagnosticCopy.genericErrorKey;
  }
}
