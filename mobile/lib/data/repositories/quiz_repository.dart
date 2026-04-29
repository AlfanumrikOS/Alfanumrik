import 'package:supabase_flutter/supabase_flutter.dart';

import '../../core/cache/cache_manager.dart';
import '../../core/network/api_result.dart';
import '../models/quiz_question.dart';

/// Quiz repository — bridges the Flutter UI to the server-authoritative
/// scoring path defined by `submit_quiz_results_v2` (migration
/// `20260428160000_quiz_session_shuffles.sql`).
///
/// Two server contracts are wired here:
///
///   1. `start_quiz_session(p_student_id, p_question_ids)` — generates a
///      per-question shuffle, snapshots `options` + `correct_answer_index`
///      into `quiz_session_shuffles`, and returns the SHUFFLED options
///      WITHOUT the correct index. The mobile client must display
///      questions in this server-shuffled order.
///
///   2. `submit_quiz_results_v2(p_session_id, p_student_id, p_subject,
///      p_grade, p_topic, p_chapter, p_responses, p_time)` — receives one
///      `{ question_id, selected_displayed_index, time_spent }` row per
///      question, looks up the snapshot, re-derives `is_correct`, and
///      returns canonical `correct_option_text` per question for the
///      review screen.
///
/// Backwards compatibility: when `start_quiz_session` is unavailable or
/// fails (older server, network error during session start) the repo falls
/// back to fetching questions directly from `question_bank` and submitting
/// via the legacy v1 RPC `submit_quiz_results`. The v1 RPC is preserved
/// indefinitely for old mobile builds in the wild.
///
/// **P1/P6 invariant**: under v2, mobile MUST NOT compute `is_correct`
/// locally. `selected_displayed_index` is the position the student tapped
/// (0..3). The server is the single source of truth for correctness and
/// for the "what was the right answer" review text.
class QuizRepository {
  final SupabaseClient _client;
  // ignore: unused_field
  final CacheManager _cache;

  QuizRepository({
    SupabaseClient? client,
    CacheManager? cache,
  })  : _client = client ?? Supabase.instance.client,
        _cache = cache ?? CacheManager();

  /// Fetch quiz questions for a subject + grade.
  ///
  /// Returns questions in their CANONICAL (un-shuffled) form. Callers that
  /// want the v2 server-authoritative path should follow this with
  /// [startSessionForQuestions]; the resulting [ServerQuizSession.questions]
  /// is what the UI should render.
  Future<ApiResult<List<QuizQuestion>>> getQuestions({
    required String subject,
    required String grade,
    int count = 10,
    String? chapterTitle,
  }) async {
    try {
      var query = _client
          .from('question_bank')
          .select()
          .eq('subject', subject)
          .eq('grade', grade)
          .eq('is_active', true);

      if (chapterTitle != null) {
        query = query.eq('chapter_title', chapterTitle);
      }

      // Random selection via Supabase — order by random()
      final res = await query.limit(count * 3); // over-fetch for randomization

      final allQuestions = (res as List<dynamic>)
          .map((e) => QuizQuestion.fromJson(e as Map<String, dynamic>))
          .toList();

      // Shuffle and take `count`
      allQuestions.shuffle();
      final selected = allQuestions.take(count).toList(growable: false);

      return ApiSuccess(selected);
    } catch (e) {
      return ApiFailure('Failed to load questions: ${e.toString()}');
    }
  }

  /// Call `start_quiz_session` to obtain a server-shuffled session for the
  /// given question IDs.
  ///
  /// Returns `null` on RPC failure so the caller can fall back to the v1
  /// path (using the originally-fetched questions in their client-side
  /// shuffled order). This mirrors the web's `startQuizSession` behaviour
  /// in `src/lib/supabase.ts`.
  ///
  /// SECURITY: the server enforces that `p_student_id` matches
  /// `auth.uid()`. If that check fails the RPC raises and we return `null`
  /// so the user sees the v1 path rather than an error.
  Future<ServerQuizSession?> startSessionForQuestions({
    required String studentId,
    required List<String> questionIds,
    required String subject,
    required String grade,
  }) async {
    if (questionIds.isEmpty) return null;

    try {
      final dynamic raw = await _client.rpc('start_quiz_session', params: {
        'p_student_id': studentId,
        'p_question_ids': questionIds,
      });

      return parseStartSessionResponse(
        raw,
        subject: subject,
        grade: grade,
      );
    } catch (_) {
      // Soft failure: caller falls back to v1.
      return null;
    }
  }

  /// Pure response-shape adapter exposed for unit tests.
  ///
  /// Accepts the raw `start_quiz_session` payload (already deserialised by
  /// `supabase_flutter` as a `Map<String, dynamic>`) and returns a typed
  /// [ServerQuizSession], or `null` if the shape is malformed.
  static ServerQuizSession? parseStartSessionResponse(
    dynamic raw, {
    required String subject,
    required String grade,
  }) {
    if (raw is! Map) return null;
    final map = Map<String, dynamic>.from(raw);
    final sessionId = map['session_id'] as String?;
    final questionsRaw = map['questions'];
    if (sessionId == null || sessionId.isEmpty) return null;
    if (questionsRaw is! List) return null;

    final questions = <QuizQuestion>[];
    for (final q in questionsRaw) {
      if (q is Map) {
        questions.add(
          QuizQuestion.fromServerSession(
            Map<String, dynamic>.from(q),
            subject: subject,
            grade: grade,
          ),
        );
      }
    }
    return ServerQuizSession(sessionId: sessionId, questions: questions);
  }

  /// Submit quiz attempt — dispatches between v1 and v2 RPC.
  ///
  /// Mirror of the web's `submitQuizResults` in `src/lib/supabase.ts`:
  ///   * Layer 1 (v2): when [sessionId] is non-null, call
  ///     `submit_quiz_results_v2` with the v2 response shape
  ///     (`selected_displayed_index`).
  ///   * Layer 2 (v1): when [sessionId] is null OR v2 throws, call the
  ///     legacy `submit_quiz_results` with the v1 response shape
  ///     (`selected_option`).
  ///
  /// Score (P1), XP/Coins (P2), anti-cheat (P3), and atomicity (P4) are
  /// all enforced server-side by the RPCs. Do NOT compute correctness, XP,
  /// or coins on the mobile side. The server returns `correct_option_text`
  /// per question in the v2 response — the review screen MUST display
  /// that, never the local options array.
  ///
  /// [grade] must be a String ('6'..'12') — never an int (P5).
  ///
  /// [responses] schema:
  ///   v2: { question_id, selected_displayed_index, time_spent }
  ///   v1: { question_id, selected_option,           time_spent }
  /// The dispatcher rewrites the field name based on the path taken.
  Future<ApiResult<QuizResult>> submitAttempt({
    required String studentId,
    required String subject,
    required String grade,
    required List<Map<String, dynamic>> responses,
    required int timeTakenSeconds,
    String? topicTitle,
    int? chapterNumber,
    String? sessionId,
  }) async {
    // ── Layer 1: v2 (server-shuffle authority) ────────────────────────────
    if (sessionId != null && sessionId.isNotEmpty) {
      try {
        final dynamic v2raw = await _client.rpc(
          'submit_quiz_results_v2',
          params: {
            'p_session_id': sessionId,
            'p_student_id': studentId,
            'p_subject': subject,
            'p_grade': grade,
            'p_topic': topicTitle,
            'p_chapter': chapterNumber,
            'p_responses': mapResponsesForV2(responses),
            'p_time': timeTakenSeconds,
          },
        );
        if (v2raw is Map) {
          return ApiSuccess(
            QuizResult.fromRpc(
              Map<String, dynamic>.from(v2raw),
              Duration(seconds: timeTakenSeconds),
            ),
          );
        }
        // Fall through to v1 if shape is unexpected.
      } catch (_) {
        // Fall through to v1.
      }
    }

    // ── Layer 2: v1 (legacy / no-session fallback) ────────────────────────
    try {
      final dynamic raw = await _client.rpc('submit_quiz_results', params: {
        'p_student_id': studentId,
        'p_subject': subject,
        'p_grade': grade,
        'p_topic': topicTitle,
        'p_chapter': chapterNumber,
        'p_responses': mapResponsesForV1(responses),
        'p_time': timeTakenSeconds,
      });

      // The RPC returns a JSONB object; Supabase Flutter deserialises it as
      // Map<String, dynamic>.
      final rpc = Map<String, dynamic>.from(raw as Map);

      return ApiSuccess(
        QuizResult.fromRpc(rpc, Duration(seconds: timeTakenSeconds)),
      );
    } catch (e) {
      return ApiFailure('Failed to submit quiz: ${e.toString()}');
    }
  }

  // ── Pure helpers (testable without a network) ───────────────────────────

  /// Translate a unified `[{question_id, selected_displayed_index,
  /// time_spent}]` response list into the v2 wire format. The dispatcher
  /// always builds responses with the v2 field name internally; this helper
  /// is the identity / passthrough used by [submitAttempt] when calling
  /// `submit_quiz_results_v2`. Exposed for tests.
  static List<Map<String, dynamic>> mapResponsesForV2(
    List<Map<String, dynamic>> responses,
  ) {
    return responses.map((r) {
      // Accept either field name on input — the v2 server reads
      // `selected_displayed_index`. We never send `selected_option` on the
      // v2 path because the field name actively encodes the contract.
      final displayedIdx = r['selected_displayed_index'] ??
          r['selected_option'] ??
          -1;
      final out = <String, dynamic>{
        'question_id': r['question_id'],
        'selected_displayed_index': displayedIdx,
        'time_spent': r['time_spent'] ?? 0,
      };
      // Optional written-answer companion fields (SA/MA/LA) preserved for
      // forward compatibility with the ncert-question-engine path. Not
      // currently used on mobile but mirrors web.
      if (r.containsKey('error_type')) out['error_type'] = r['error_type'];
      if (r.containsKey('student_answer_text')) {
        out['student_answer_text'] = r['student_answer_text'];
      }
      if (r.containsKey('marks_awarded')) out['marks_awarded'] = r['marks_awarded'];
      if (r.containsKey('marks_possible')) {
        out['marks_possible'] = r['marks_possible'];
      }
      if (r.containsKey('rubric_feedback')) {
        out['rubric_feedback'] = r['rubric_feedback'];
      }
      return out;
    }).toList(growable: false);
  }

  /// Translate the same unified response list into the v1 wire format. v1
  /// expects `selected_option` (NOT `selected_displayed_index`). When the
  /// caller already used the v2 field name, this rewrite is what makes
  /// the v1 fallback path keep working.
  static List<Map<String, dynamic>> mapResponsesForV1(
    List<Map<String, dynamic>> responses,
  ) {
    return responses.map((r) {
      final selected = r['selected_option'] ??
          r['selected_displayed_index'] ??
          -1;
      return <String, dynamic>{
        'question_id': r['question_id'],
        'selected_option': selected,
        'time_spent': r['time_spent'] ?? 0,
      };
    }).toList(growable: false);
  }
}
