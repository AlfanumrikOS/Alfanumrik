import 'package:supabase_flutter/supabase_flutter.dart';

import '../../core/errors/app_exception.dart';
import '../../core/network/api_client.dart';
import '../../core/network/api_result.dart';
import '../models/revision_models.dart';

/// Refresh / spaced-repetition repository — mobile parity for
/// `apps/host/src/app/refresh/page.tsx`'s three sections (Quick Recall,
/// Chapter Refresh, Retention Tests).
///
/// SAFETY BOUNDARY (do not weaken, see also `revision_models.dart`): all
/// SM-2 (spaced-repetition) scheduling math is computed SERVER-SIDE.
///   - Reading due cards is a plain filtered SELECT
///     (`spaced_repetition_cards` WHERE `next_review_date <= today`) — no
///     scheduling formula is involved in the read path.
///   - Grading a card calls `POST /api/learner/review/grade`, which runs
///     `applySm2()` server-side (`.../review/grade/helpers.ts`) and returns
///     the NEW schedule. This repository NEVER recomputes ease_factor /
///     interval_days / streak locally — it is a thin pass-through, exactly
///     like the web's own `QuickRecallSection.tsx` `rateCard()`.
/// Verified against `apps/host/src/app/api/learner/review/grade/route.ts` +
/// `helpers.ts` and `apps/host/src/app/api/learner/revise-stack/route.ts`,
/// 2026-07-21.
///
/// Table/RPC/route contracts (verified against
/// `packages/lib/src/domains/profile.ts`,
/// `packages/ui/src/refresh/{QuickRecallSection,ChapterRefreshSection,RetentionTestsSection}.tsx`):
///   * RPC `get_review_cards(p_student_id, p_limit)` → primary source for
///     Quick Recall cards.
///   * Table `spaced_repetition_cards` — fallback source when the RPC is
///     unavailable, using the SAME predicate the web's fallback uses:
///     `student_id = ? AND next_review_date <= today`, ordered by
///     `next_review_date`. (The web has a THIRD-tier `concept_mastery`
///     fallback that degrades to bare concept ids with no front/back text —
///     intentionally not mirrored here since the mobile flashcard UI has
///     nothing to render from it; RPC + table cover the overwhelming
///     majority of cases.)
///   * `POST /api/learner/review/grade` — `{ cardId, quality }` →
///     `{ ok, card: {...server-computed SM-2 fields} }`.
///   * `GET /api/learner/revise-stack` — decayed-chapter stack. A 404 means
///     either nothing is decayed OR the route's feature flag is off; both
///     cases render as an empty list (section auto-hides), never an error —
///     mirrors `ChapterRefreshSection.tsx`'s `res.status === 404` handling.
///   * Table `retention_tests` — pending retention quizzes
///     (`student_id = ?, status = 'pending', scheduled_date <= today`,
///     ordered by `scheduled_date`).
///
/// P13: never logs card/topic/test payload contents — failures are
/// message-text only.
class RevisionRepository {
  final SupabaseClient _client;
  final ApiClient _api;

  RevisionRepository({SupabaseClient? client, ApiClient? apiClient})
      : _client = client ?? Supabase.instance.client,
        _api = apiClient ?? ApiClient();

  /// Fetch up to [limit] due SM-2 flashcards for [studentId]. Mirrors
  /// `getReviewCards()` in `packages/lib/src/domains/profile.ts`: RPC
  /// first, then a direct table fallback.
  Future<ApiResult<List<RevisionCard>>> getQuickRecallCards({
    required String studentId,
    int limit = 20,
  }) async {
    try {
      final dynamic raw = await _client.rpc('get_review_cards', params: {
        'p_student_id': studentId,
        'p_limit': limit,
      });
      if (raw is List) {
        return ApiSuccess(_parseCards(raw));
      }
    } catch (_) {
      // RPC unavailable — fall through to the direct table read below.
    }

    try {
      final today = _todayYmd();
      final res = await _client
          .from('spaced_repetition_cards')
          .select(
            'id, student_id, subject, topic, chapter_title, front_text, back_text, '
            'hint, source, ease_factor, interval_days, streak, repetition_count, '
            'total_reviews, correct_reviews, next_review_date, last_review_date, created_at',
          )
          .eq('student_id', studentId)
          .lte('next_review_date', today)
          .order('next_review_date')
          .limit(limit);
      return ApiSuccess(_parseCards(res as List));
    } catch (e) {
      return ApiFailure('Failed to load review cards: ${e.toString()}');
    }
  }

  List<RevisionCard> _parseCards(List raw) {
    return raw
        .whereType<Map>()
        .map((e) => RevisionCard.fromJson(Map<String, dynamic>.from(e)))
        .toList(growable: false);
  }

  /// Grade one card. The SERVER computes the new SM-2 schedule
  /// (`applySm2()`) — this call is a thin pass-through; the response IS the
  /// new state and is never derived locally. [quality] must be one of
  /// `0, 3, 4, 5` (also enforced by the server's zod schema).
  Future<ApiResult<RevisionGradeResult>> gradeCard({
    required String cardId,
    required int quality,
  }) async {
    try {
      final res = await _api.post<Map<String, dynamic>>(
        '/learner/review/grade',
        data: {'cardId': cardId, 'quality': quality},
      );
      final body = res.data;
      final cardJson = body?['card'];
      if (cardJson is! Map) {
        return const ApiFailure('Empty response from /learner/review/grade');
      }
      return ApiSuccess(
        RevisionGradeResult.fromJson(Map<String, dynamic>.from(cardJson)),
      );
    } on AppException catch (e) {
      return ApiFailure(e.message);
    } catch (e) {
      return ApiFailure('Failed to grade card: ${e.toString()}');
    }
  }

  /// Decayed-chapter stack ("Chapter Refresh"). A 404 means either nothing
  /// is decayed or the server-side feature flag is off — both cases render
  /// as an empty list (never an error state), matching
  /// `ChapterRefreshSection.tsx`.
  Future<ApiResult<List<RevisionStackItem>>> getReviseStack() async {
    try {
      final res = await _api.get<Map<String, dynamic>>('/learner/revise-stack');
      final body = res.data;
      final itemsRaw = body?['items'];
      if (itemsRaw is! List) return const ApiSuccess(<RevisionStackItem>[]);
      final items = itemsRaw
          .whereType<Map>()
          .map((e) => RevisionStackItem.fromJson(Map<String, dynamic>.from(e)))
          .toList(growable: false);
      return ApiSuccess(items);
    } on AppException catch (e) {
      if (e is NetworkException && e.statusCode == 404) {
        return const ApiSuccess(<RevisionStackItem>[]);
      }
      return ApiFailure(e.message);
    } catch (e) {
      return ApiFailure('Failed to load chapter refresh stack: ${e.toString()}');
    }
  }

  /// Pending retention quizzes ("Retention Tests"). Direct table read —
  /// mirrors `RetentionTestsSection.tsx` exactly (same predicate, order,
  /// limit). No formula: `predicted_retention` is a stored column written
  /// elsewhere by the cognitive engine, not computed here.
  Future<ApiResult<List<RevisionRetentionTest>>> getRetentionTests({
    required String studentId,
    int limit = 5,
  }) async {
    try {
      final today = _todayYmd();
      final res = await _client
          .from('retention_tests')
          .select('id, topic_title, subject, predicted_retention, scheduled_date')
          .eq('student_id', studentId)
          .eq('status', 'pending')
          .lte('scheduled_date', today)
          .order('scheduled_date')
          .limit(limit);
      final items = (res as List)
          .whereType<Map>()
          .map((e) => RevisionRetentionTest.fromJson(Map<String, dynamic>.from(e)))
          .toList(growable: false);
      return ApiSuccess(items);
    } catch (e) {
      return ApiFailure('Failed to load retention tests: ${e.toString()}');
    }
  }

  String _todayYmd() => DateTime.now().toUtc().toIso8601String().split('T').first;
}
