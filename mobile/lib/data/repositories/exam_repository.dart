import 'package:dio/dio.dart';

import '../../core/network/api_client.dart';
import '../../core/network/api_result.dart';
import '../models/exam_models.dart';

/// Exams / Mock Test repository — mobile parity for the web runner at
/// `apps/host/src/app/(student)/exams/mock/[paperId]/page.tsx`.
///
/// Transport: REST via [ApiClient]'s raw [Dio] (the
/// `assignments_repository.dart` pattern) rather than [ApiClient.post],
/// because these routes encode meaning in their non-2xx bodies that
/// `_mapDioError` would flatten:
///   * 402 `competition_plan_required` + `upgrade_url` → upsell, not an error
///   * 404 `paper_not_found`                            → back to catalog
///   * 200 with an EMPTY `questions[]`                  → `content_insufficient`
/// The auth Bearer header and retry interceptor still apply (the retry
/// interceptor only retries idempotent methods on 5xx, so submit is never
/// silently double-posted).
///
/// ─────────────────────────────────────────────────────────────────────────
/// P1 — this repository NEVER computes a score. [submitAttempt] posts the
/// student's raw `response_index` values and returns the server's
/// `summary` object as decoded. There is no correctness check, no
/// `correct/total`, and no marks summation on this path. This mirrors
/// `quiz_repository.dart` exactly ("the server is the single source of truth
/// for correctness, score, XP").
///
/// P3 — the countdown is presentation-only. On expiry the provider calls
/// [submitAttempt] through this same normal path; there is no client-side
/// "invalidate the attempt" concept anywhere in the mobile exam flow.
/// ─────────────────────────────────────────────────────────────────────────
class ExamRepository {
  final ApiClient _api;

  ExamRepository({ApiClient? api}) : _api = api ?? ApiClient();

  // ── Catalog ─────────────────────────────────────────────────────────────

  /// `GET /api/exams/papers` — catalog metadata only (no questions).
  ///
  /// All filters are optional and are validated server-side:
  ///   * [examFamily] — `cbse_board`, `jee_main`, `neet`, `olympiad_*`, …
  ///   * [subject]    — one of the 16 CBSE catalog codes
  ///   * [grade]      — P5 STRING '6'..'12'; only `cbse_board` rows carry a
  ///                    non-null grade, so supplying it naturally scopes the
  ///                    catalog to the CBSE template papers.
  Future<ApiResult<ExamPaperCatalog>> getPapers({
    String? examFamily,
    String? subject,
    String? grade,
    int? limit,
  }) async {
    try {
      final response = await _api.dio.get<dynamic>(
        '/exams/papers',
        queryParameters: {
          if (examFamily != null && examFamily.isNotEmpty) 'exam_family': examFamily,
          if (subject != null && subject.isNotEmpty) 'subject': subject,
          if (grade != null && grade.isNotEmpty) 'grade': grade,
          if (limit != null) 'limit': limit,
        },
      );
      final data = response.data;
      if (data is! Map) {
        return const ApiFailure('Could not load exam papers. Please try again.');
      }
      return ApiSuccess(ExamPaperCatalog.fromJson(Map<String, dynamic>.from(data)));
    } on DioException catch (e) {
      return ApiFailure(_messageFor(e), e.response?.statusCode);
    } catch (_) {
      return const ApiFailure('Connection error. Please try again.');
    }
  }

  // ── Paper detail ────────────────────────────────────────────────────────

  /// `GET /api/exams/papers/{paperId}`.
  ///
  /// Used for BOTH families, but for different reasons:
  ///   * static (JEE/NEET/Olympiad) — supplies the paper metadata AND the
  ///     fixed question set.
  ///   * `cbse_board` — supplies ONLY the paper metadata (header, and
  ///     critically the authoritative `duration_minutes` that seeds the
  ///     countdown). Its `questions` array is empty by design; the real set
  ///     comes from [startAttempt].
  Future<ExamPaperDetailOutcome> getPaperDetail(String paperId) async {
    try {
      final response = await _api.dio.get<dynamic>('/exams/papers/$paperId');
      return _classifyDetail(response.statusCode, response.data);
    } on DioException catch (e) {
      if (e.response != null) {
        return _classifyDetail(e.response!.statusCode, e.response!.data);
      }
      return ExamPaperDetailFailure(_messageFor(e));
    } catch (_) {
      return const ExamPaperDetailFailure('Connection error. Please try again.');
    }
  }

  /// Pure classifier for the detail response — testable without a network.
  static ExamPaperDetailOutcome classifyDetailResponse(int? statusCode, dynamic data) =>
      _classifyDetail(statusCode, data);

  static ExamPaperDetailOutcome _classifyDetail(int? statusCode, dynamic data) {
    final map = data is Map ? Map<String, dynamic>.from(data) : const <String, dynamic>{};

    if (statusCode == 402) {
      return ExamPaperDetailUpgradeRequired(
        map['upgrade_url'] as String? ?? '/upgrade',
      );
    }
    if (statusCode == 404) return const ExamPaperDetailNotFound();
    if (statusCode == null || statusCode < 200 || statusCode >= 300) {
      return ExamPaperDetailFailure(
        map['error'] as String? ?? 'Could not load this paper. Please try again.',
        statusCode,
      );
    }

    final rawPaper = map['paper'];
    if (rawPaper is! Map) {
      return const ExamPaperDetailFailure('Could not load this paper. Please try again.');
    }
    final paper = ExamPaper.fromJson(Map<String, dynamic>.from(rawPaper));

    final rawQuestions = map['questions'];
    final questions = <ExamAttemptQuestion>[];
    if (rawQuestions is List) {
      var i = 0;
      for (final entry in rawQuestions) {
        if (entry is Map) {
          questions.add(
            ExamAttemptQuestion.fromStaticJson(
              Map<String, dynamic>.from(entry),
              fallbackOrder: i + 1,
            ),
          );
        }
        i++;
      }
      questions.sort((a, b) => a.order.compareTo(b.order));
    }

    return ExamPaperDetailSuccess(paper: paper, questions: List.unmodifiable(questions));
  }

  // ── Start (cbse_board dynamic assembly) ─────────────────────────────────

  /// `POST /api/exams/papers/{paperId}/start`.
  ///
  /// Only valid for `cbse_board` papers — the route rejects every other
  /// family with 400 `paper_not_cbse_board`. The RPC selects 39 questions
  /// across sections A-E (20@1 + 6@2 + 7@3 + 3@5 + 3@4 = 80 marks),
  /// snapshots them into `mock_test_attempts.question_snapshot`, and returns
  /// `{ attempt_id, questions }`.
  ///
  /// A 200 with an empty `questions` array is the all-or-nothing
  /// `content_insufficient` contract and maps to
  /// [ExamStartContentInsufficient] — NOT a failure.
  Future<ExamStartOutcome> startAttempt(String paperId) async {
    try {
      final response = await _api.dio.post<dynamic>('/exams/papers/$paperId/start');
      return _classifyStart(response.statusCode, response.data);
    } on DioException catch (e) {
      if (e.response != null) {
        return _classifyStart(e.response!.statusCode, e.response!.data);
      }
      return ExamStartFailure(_messageFor(e));
    } catch (_) {
      return const ExamStartFailure('Connection error. Please try again.');
    }
  }

  /// Pure classifier for the start response — testable without a network.
  static ExamStartOutcome classifyStartResponse(int? statusCode, dynamic data) =>
      _classifyStart(statusCode, data);

  static ExamStartOutcome _classifyStart(int? statusCode, dynamic data) {
    final map = data is Map ? Map<String, dynamic>.from(data) : const <String, dynamic>{};

    if (statusCode == 402) {
      return ExamStartUpgradeRequired(map['upgrade_url'] as String? ?? '/upgrade');
    }
    if (statusCode == 404) return const ExamStartNotFound();
    if (statusCode == null || statusCode < 200 || statusCode >= 300) {
      return ExamStartFailure(
        map['error'] as String? ?? 'Could not start this paper. Please try again.',
        statusCode,
      );
    }

    final result = ExamStartResult.fromJson(map);
    if (result.attemptId.isEmpty) {
      return const ExamStartFailure('Could not start this paper. Please try again.');
    }
    if (result.contentInsufficient) return const ExamStartContentInsufficient();
    return ExamStartSuccess(result);
  }

  // ── Submit ──────────────────────────────────────────────────────────────

  /// `POST /api/exams/papers/{paperId}/submit`.
  ///
  /// [attemptId] is sent ONLY for the `cbse_board` dynamic flow (it tells
  /// `submit_mock_test_attempt` to score against the stored snapshot, where
  /// per-question marks vary by section). Static papers omit it entirely,
  /// leaving their legacy `exam_paper_id`-join scoring path untouched.
  ///
  /// [timeTakenSeconds] must be a POSITIVE integer per the route's
  /// validator; the caller clamps to >= 1 (an instant timeout submit would
  /// otherwise 400).
  ///
  /// P1: the returned [ExamSubmitResult.summary] is the server's scorecard,
  /// decoded and handed back untouched.
  Future<ExamSubmitOutcome> submitAttempt({
    required String paperId,
    required List<ExamResponseItem> responses,
    required int timeTakenSeconds,
    String? attemptId,
    Map<String, dynamic>? clientMetadata,
  }) async {
    try {
      final response = await _api.dio.post<dynamic>(
        '/exams/papers/$paperId/submit',
        data: {
          if (attemptId != null && attemptId.isNotEmpty) 'attempt_id': attemptId,
          'responses': responses.map((r) => r.toJson()).toList(growable: false),
          'time_taken_seconds': timeTakenSeconds < 1 ? 1 : timeTakenSeconds,
          if (clientMetadata != null) 'client_metadata': clientMetadata,
        },
      );
      return _classifySubmit(response.statusCode, response.data);
    } on DioException catch (e) {
      if (e.response != null) {
        return _classifySubmit(e.response!.statusCode, e.response!.data);
      }
      return ExamSubmitFailure(_messageFor(e));
    } catch (_) {
      return const ExamSubmitFailure('Connection error. Please try again.');
    }
  }

  /// Pure classifier for the submit response — testable without a network.
  static ExamSubmitOutcome classifySubmitResponse(int? statusCode, dynamic data) =>
      _classifySubmit(statusCode, data);

  static ExamSubmitOutcome _classifySubmit(int? statusCode, dynamic data) {
    final map = data is Map ? Map<String, dynamic>.from(data) : const <String, dynamic>{};

    if (statusCode == 402) {
      return ExamSubmitUpgradeRequired(map['upgrade_url'] as String? ?? '/upgrade');
    }
    if (statusCode == null || statusCode < 200 || statusCode >= 300) {
      return ExamSubmitFailure(
        map['error'] as String? ?? 'Could not submit your paper. Please try again.',
        statusCode,
      );
    }
    if (map['attempt_id'] is! String || map['summary'] is! Map) {
      return const ExamSubmitFailure('Could not read the result. Please try again.');
    }
    return ExamSubmitSuccess(ExamSubmitResult.fromJson(map));
  }

  // ── Shared error copy ───────────────────────────────────────────────────

  static String _messageFor(DioException e) {
    return switch (e.type) {
      DioExceptionType.connectionTimeout ||
      DioExceptionType.sendTimeout ||
      DioExceptionType.receiveTimeout =>
        'The request timed out. Please try again.',
      DioExceptionType.connectionError => 'No internet connection.',
      _ => 'Something went wrong. Please try again.',
    };
  }
}
