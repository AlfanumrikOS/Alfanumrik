import '../../core/errors/app_exception.dart';
import '../../core/network/api_client.dart';
import '../../core/network/api_result.dart';
import '../models/diagnostic_models.dart';

/// Diagnostic Assessment repository — REST calls via [ApiClient] (Dio),
/// same transport pattern as [SubscriptionRepository]. Confirmed clean
/// 2-call lifecycle against `apps/host/src/app/api/diagnostic/{start,complete}/route.ts`:
///
///   * `POST /diagnostic/start`    { grade, subject } → { session_id, questions }
///   * `POST /diagnostic/complete` { session_id, responses[] } → summary
///
/// The auth Bearer header is injected by [ApiClient]'s `_AuthInterceptor`
/// (`authorizeRequest(request, 'diagnostic.attempt'|'diagnostic.complete')`
/// enforces RBAC server-side — P9).
class DiagnosticRepository {
  final ApiClient _api;

  DiagnosticRepository({ApiClient? api}) : _api = api ?? ApiClient();

  Future<ApiResult<DiagnosticStartResult>> start({
    required String grade,
    required String subject,
  }) async {
    try {
      final response = await _api.post(
        '/diagnostic/start',
        data: {'grade': grade, 'subject': subject},
      );
      final data = response.data as Map<String, dynamic>;
      if (data['success'] != true) {
        return ApiFailure(
          data['error'] as String? ?? 'Could not start diagnostic. Please try again.',
        );
      }
      final d = Map<String, dynamic>.from(data['data'] as Map);
      final sessionId = d['session_id'] as String? ?? '';
      final rawQuestions = d['questions'];
      final questions = rawQuestions is List
          ? rawQuestions
              .whereType<Map>()
              .map((e) => DiagnosticQuestion.fromJson(Map<String, dynamic>.from(e)))
              .toList(growable: false)
          : const <DiagnosticQuestion>[];
      return ApiSuccess(DiagnosticStartResult(sessionId: sessionId, questions: questions));
    } on AppException catch (e) {
      return ApiFailure(e.message);
    } catch (e) {
      return const ApiFailure('Connection error. Please try again.');
    }
  }

  Future<ApiResult<DiagnosticSummary>> complete({
    required String sessionId,
    required List<DiagnosticResponseItem> responses,
  }) async {
    try {
      final response = await _api.post(
        '/diagnostic/complete',
        data: {
          'session_id': sessionId,
          'responses': responses.map((r) => r.toJson()).toList(growable: false),
        },
      );
      final data = response.data as Map<String, dynamic>;
      if (data['success'] != true) {
        return ApiFailure(
          data['error'] as String? ?? 'Could not save results. Please try again.',
        );
      }
      return ApiSuccess(
        DiagnosticSummary.fromJson(Map<String, dynamic>.from(data['data'] as Map)),
      );
    } on AppException catch (e) {
      return ApiFailure(e.message);
    } catch (e) {
      return const ApiFailure('Connection error. Please try again.');
    }
  }
}
