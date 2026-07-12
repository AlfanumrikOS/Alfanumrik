import 'package:alfanumrik_api_v2/alfanumrik_api_v2.dart' as v2;
import 'package:built_collection/built_collection.dart';
import 'package:dio/dio.dart';
import 'package:supabase_flutter/supabase_flutter.dart';

import '../../core/cache/cache_manager.dart';
import '../../core/network/api_result.dart';
import '../../core/network/v2_api_client.dart';
import '../models/offline_quiz_models.dart';
import '../models/quiz_question.dart';
import 'offline_drain_service.dart';

/// Quiz repository — bridges the Flutter UI to the server-authoritative
/// scoring path defined by `submit_quiz_results_v2` (migration
/// `20260428160000_quiz_session_shuffles.sql`).
///
/// ## Two surfaces, selected by server-assigned client injection
///
/// * **`useV2` OFF (default)** — BYTE-IDENTICAL to the historical app:
///   questions come straight from the `question_bank` table, the
///   server-shuffle session comes from the `start_quiz_session` RPC, and
///   submission goes through `submit_quiz_results_v2` / `submit_quiz_results`
///   RPCs. The generated `/v2` client is never constructed or called on this
///   path. This is the long-lived path for old builds in the wild.
///
/// * **`useV2` ON** — the same three operations route through the GENERATED
///   `/v2` dart-dio [v2.QuizApi] (Wave 2.3b): `GET /v2/quiz/questions`,
///   `POST /v2/quiz/start`, `POST /v2/quiz/submit`. Those routes are thin
///   pass-throughs to the SAME RPCs, so scoring/XP/anti-cheat semantics are
///   identical — the only difference is the transport.
///
/// ## Server contracts (both paths terminate at these RPCs)
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
/// **P1/P6 invariant** (BOTH paths): mobile MUST NOT compute `is_correct`,
/// `score_percent`, or `xp_earned` locally. `selected_displayed_index` is the
/// position the student tapped (0..3). The server is the single source of
/// truth for correctness, score, XP, and the "what was the right answer"
/// review text — the device displays the server's values VERBATIM.
class QuizRepository {
  final SupabaseClient _client;
  // ignore: unused_field
  final CacheManager _cache;

  /// Generated `/v2` client. Null on the `useV2`-OFF path so the legacy build
  /// never constructs the dart-dio client. Injected by the provider only when
  /// the flag is on.
  final V2ApiClient? _v2;

  QuizRepository({
    SupabaseClient? client,
    CacheManager? cache,
    V2ApiClient? v2Client,
  })  : _client = client ?? Supabase.instance.client,
        _cache = cache ?? CacheManager(),
        _v2 = v2Client;

  /// Fetch quiz questions for a subject + grade.
  ///
  /// Returns questions in their CANONICAL (un-shuffled) form. Callers that
  /// want the server-authoritative path should follow this with
  /// [startSessionForQuestions]; the resulting [ServerQuizSession.questions]
  /// is what the UI should render.
  ///
  /// When a generated client is present this calls `GET /v2/quiz/questions` via
  /// the generated [v2.QuizApi]; the route already enforces subject-governance
  /// + academic-scope and NEVER returns `correct_answer_index` (P6). When OFF
  /// it reads the `question_bank` table directly (byte-identical legacy path).
  Future<ApiResult<List<QuizQuestion>>> getQuestions({
    required String subject,
    required String grade,
    int count = 10,
    String? chapterTitle,
  }) async {
    if (_v2 != null) {
      return _getQuestionsV2(
        subject: subject,
        grade: grade,
        count: count,
        chapterTitle: chapterTitle,
      );
    }

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

  /// `useV2`-ON questions fetch via `GET /v2/quiz/questions`.
  ///
  /// The generated [v2.QuizQuestion] DTO carries `options` (in-scope, no
  /// correct index) — we map it onto the mobile [QuizQuestion] with
  /// `correctIndex = -1` (sentinel: server-owned, do not consult). The
  /// server already scopes + randomises, so no client shuffle is applied.
  Future<ApiResult<List<QuizQuestion>>> _getQuestionsV2({
    required String subject,
    required String grade,
    required int count,
    String? chapterTitle,
  }) async {
    try {
      // The /v2 contract takes an integer `chapter`; mobile callers pass a
      // chapter TITLE. Only forward when it parses to an int, otherwise omit
      // and let the route return the subject+grade scope.
      final chapterNum =
          chapterTitle == null ? null : int.tryParse(chapterTitle.trim());

      final resp = await _v2!.quizApi.getQuizQuestions(
        subject: subject,
        grade: grade,
        count: count,
        chapter: chapterNum,
      );
      final body = resp.data;
      if (body == null) {
        return const ApiFailure('Failed to load questions: empty response');
      }

      final selected = body.questions
          .map((q) => QuizQuestion.fromV2Question(q, subject: subject, grade: grade))
          .toList(growable: false);

      return ApiSuccess(selected);
    } catch (e) {
      return ApiFailure('Failed to load questions: ${_describe(e)}');
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

    if (_v2 != null) {
      return _startSessionV2(
        studentId: studentId,
        questionIds: questionIds,
        subject: subject,
        grade: grade,
      );
    }

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

  /// `useV2`-ON session start via `POST /v2/quiz/start`.
  ///
  /// Returns the server-shuffled questions + `session_id`. The shuffle map
  /// and correct index stay server-side (P6). On any failure we return null
  /// so the caller behaves exactly as the legacy soft-fail: render the
  /// already-fetched questions and submit without a session id.
  Future<ServerQuizSession?> _startSessionV2({
    required String studentId,
    required List<String> questionIds,
    required String subject,
    required String grade,
  }) async {
    try {
      final req = v2.QuizStartRequest((b) => b
        ..studentId = studentId
        ..questionIds.replace(questionIds));

      final resp = await _v2!.quizApi.postQuizStart(quizStartRequest: req);
      final body = resp.data;
      if (body == null || body.sessionId.isEmpty) return null;

      // Server-shuffled order = display order. Map each v2 start-question
      // (carrying `options_displayed`, no correct index) onto the mobile
      // model with the -1 sentinel.
      final questions = body.questions
          .map((q) =>
              QuizQuestion.fromV2StartQuestion(q, subject: subject, grade: grade))
          .toList(growable: false);

      return ServerQuizSession(sessionId: body.sessionId, questions: questions);
    } catch (_) {
      // Soft failure: caller falls back to the no-session path.
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
    String? idempotencyKey,
  }) async {
    if (_v2 != null) {
      return _submitAttemptV2(
        studentId: studentId,
        subject: subject,
        grade: grade,
        responses: responses,
        timeTakenSeconds: timeTakenSeconds,
        topicTitle: topicTitle,
        chapterNumber: chapterNumber,
        sessionId: sessionId,
        idempotencyKey: idempotencyKey,
      );
    }

    // ── Layer 1: v2 RPC (server-shuffle authority) ────────────────────────
    if (sessionId != null && sessionId.isNotEmpty) {
      try {
        // Phase 2.8: per-attempt idempotency token. Generated once by the
        // notifier (`QuizNotifier.startQuiz`) and reused on every retry of
        // a single attempt — the server short-circuits replays via the
        // partial unique index `quiz_sessions_idempotency_key_uniq` and
        // returns `idempotent_replay: true`. See migration
        // `20260504100200_quiz_idempotency_key.sql`.
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
            if (idempotencyKey != null) 'p_idempotency_key': idempotencyKey,
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
      } catch (e) {
        // Phase 1.2: server now RAISEs `session_not_started` (SQLSTATE
        // P0001) when the snapshot row is gone. Surface this as a
        // structured failure so the UI can show "session expired,
        // please restart" instead of falling through to v1 (which would
        // re-score against legacy unshuffled data — wrong).
        final msg = e.toString();
        if (msg.contains('session_not_started')) {
          return const ApiFailure('session_not_started: Quiz session expired.');
        }
        // Fall through to v1 for any other error.
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

  /// `useV2`-ON submission via `POST /v2/quiz/submit`.
  ///
  /// SERVER-AUTHORITATIVE (P1/P2/P3/P4): this is a thin pass-through to the
  /// `submit_quiz_results_v2` RPC (the route does NO math). We forward:
  ///   * one item per question with the REAL `time_taken_seconds` (no clamp /
  ///     transform — server anti-cheat P3 needs the true per-question timings),
  ///   * `totalTimeSeconds` = the real wall-clock attempt duration,
  ///   * an `Idempotency-Key` header (the per-attempt UUID) so transient-5xx
  ///     retries never double-count XP or rows.
  ///
  /// The returned [v2.QuizSubmitResult] is mapped onto [QuizResult] VERBATIM:
  /// `score_percent`, `xp_earned`, `correct`, `total`, `flagged`, and the
  /// per-question review come straight from the server. The device never
  /// derives correctness, score, or XP.
  ///
  /// `session_not_started` is surfaced as a structured failure (matching the
  /// RPC path) so the UI shows "session expired, please restart" rather than
  /// re-scoring against stale data.
  Future<ApiResult<QuizResult>> _submitAttemptV2({
    required String studentId,
    required String subject,
    required String grade,
    required List<Map<String, dynamic>> responses,
    required int timeTakenSeconds,
    String? topicTitle,
    int? chapterNumber,
    String? sessionId,
    String? idempotencyKey,
  }) async {
    // The /v2 submit route requires a session id (server-shuffle authority).
    // If session start soft-failed, surface a structured error rather than
    // silently scoring against an absent snapshot.
    if (sessionId == null || sessionId.isEmpty) {
      return const ApiFailure(
          'session_not_started: Quiz session expired.');
    }

    try {
      final req = v2.QuizSubmitRequest((b) => b
        ..studentId = studentId
        ..sessionId = sessionId
        ..subject = subject
        ..grade = grade
        ..topic = topicTitle
        ..chapter = chapterNumber
        ..totalTimeSeconds = timeTakenSeconds
        ..responses.replace(buildV2SubmitItems(responses)));

      // Idempotency-Key (UUID) header — required by the route contract.
      final headers = <String, dynamic>{
        if (idempotencyKey != null && idempotencyKey.isNotEmpty)
          'Idempotency-Key': idempotencyKey,
      };

      final resp = await _v2!.quizApi.postQuizSubmit(
        quizSubmitRequest: req,
        headers: headers.isEmpty ? null : headers,
      );
      final body = resp.data;
      if (body == null) {
        return const ApiFailure('Failed to submit quiz: empty response');
      }

      return ApiSuccess(
        QuizResult.fromV2(body, Duration(seconds: timeTakenSeconds)),
      );
    } catch (e) {
      final msg = _describe(e);
      if (msg.contains('session_not_started')) {
        return const ApiFailure('session_not_started: Quiz session expired.');
      }
      return ApiFailure('Failed to submit quiz: $msg');
    }
  }

  /// Build the generated `/v2` per-question submit items from the unified
  /// `[{question_id, selected_displayed_index, time_spent}]` response list.
  ///
  /// The wire field for the tapped position on `/v2/quiz/submit` is
  /// `selected_option` (the route forwards it to the RPC as
  /// `selected_displayed_index`). The REAL `time_spent` flows straight into
  /// `time_taken_seconds` with NO clamping/transform (P3). Exposed static for
  /// unit tests.
  static BuiltList<v2.QuizSubmitResponseItem> buildV2SubmitItems(
    List<Map<String, dynamic>> responses,
  ) {
    return BuiltList<v2.QuizSubmitResponseItem>(
      responses.map((r) {
        final selected = (r['selected_displayed_index'] ??
                r['selected_option'] ??
                -1) as int;
        final time = (r['time_spent'] ?? 0) as int;
        return v2.QuizSubmitResponseItem((b) => b
          ..questionId = (r['question_id'] ?? '') as String
          ..selectedOption = selected
          ..timeTakenSeconds = time);
      }),
    );
  }

  /// Drain ONE offline-captured attempt to `POST /v2/quiz/submit` with
  /// `attemptMode: offline_replay` (Wave 2.5.2). This is the offline twin of
  /// [_submitAttemptV2]; it is the ONLY method that sends the offline replay
  /// fields. Always requires the generated `/v2` client (offline replay is a
  /// `useV2`-ON-only feature) — when `useV2` is OFF the offline path does not
  /// exist and this is never called.
  ///
  /// IMMUTABLE IDEMPOTENCY KEY (P2): [attempt.idempotencyKey] is stamped on the
  /// `Idempotency-Key` header VERBATIM. The drain bumps [attempt.drainAttempt]
  /// before calling this, but NEVER regenerates the key — so a re-drain after a
  /// server-side commit is short-circuited as an idempotent replay rather than
  /// double-granting XP.
  ///
  /// P3 timing: [attempt.totalTimeSeconds] flows as BOTH `totalTimeSeconds`
  /// (the sole RPC timing source) and `clientCapturedTotalSeconds` (the server
  /// cross-check); per-question `time_spent` are the on-device measured values
  /// carried verbatim from the live attempt — never recomputed at drain time.
  ///
  /// Returns a [DrainOutcome] so the drain service can apply the
  /// discard-vs-retain matrix using the HTTP status the server returned:
  ///   * 200 / idempotent replay        → success (store result, remove)
  ///   * 4xx (409/422/400/...)          → discard (un-replayable)
  ///   * 5xx / network / timeout        → retain (retry, key unchanged)
  Future<DrainOutcome> submitOfflineReplay(QueuedQuizAttempt attempt) async {
    final v2Client = _v2;
    if (v2Client == null) {
      // Defensive: offline replay requires the /v2 client. Treat as transient
      // so the attempt is retained rather than silently dropped.
      return const DrainOutcome(DrainOutcomeKind.retain,
          reasonCode: 'v2_client_unavailable');
    }

    try {
      final req = buildOfflineSubmitRequest(attempt);

      final headers = <String, dynamic>{
        'Idempotency-Key': attempt.idempotencyKey,
      };

      final resp = await v2Client.quizApi.postQuizSubmit(
        quizSubmitRequest: req,
        headers: headers,
      );
      final body = resp.data;
      if (body == null) {
        // 2xx with empty body is unexpected — treat as transient.
        return const DrainOutcome(DrainOutcomeKind.retain,
            reasonCode: 'empty_response');
      }

      final result = QuizResult.fromV2(
        body,
        Duration(seconds: attempt.totalTimeSeconds),
      );
      return OfflineDrainService.classify(
        ApiSuccess(result),
        statusCode: resp.statusCode ?? 200,
      );
    } on DioException catch (e) {
      final status = e.response?.statusCode;
      // Surface the server's structured error code (e.g. SHUFFLE_MAP_MISMATCH)
      // as the reason — NEVER any answer text / PII (P13).
      final reason = _errorCode(e) ?? 'http_${status ?? 'unknown'}';
      return OfflineDrainService.classify(
        ApiFailure('offline replay failed: $reason', status),
        statusCode: status,
        reasonCode: reason,
      );
    } catch (e) {
      // Non-Dio error (serialization, etc.) — no HTTP status → retain.
      return DrainOutcome(DrainOutcomeKind.retain, reasonCode: _describe(e));
    }
  }

  /// Build the generated `/v2` offline-replay submit request from a queued
  /// attempt. Static + pure so the offline wire shape is directly unit-testable
  /// (without Dio). Encodes the Wave 2.5.2 offline obligations:
  ///   * `attemptMode = offline_replay`
  ///   * `capturedAt` parsed from the stored ISO-8601 (captured ONCE at
  ///     completion — never recomputed here)
  ///   * `clientCapturedTotalSeconds == totalTimeSeconds` (server cross-check)
  ///   * per-question times forwarded verbatim (P3)
  ///   * `shuffleMapsClientGradedAgainst` sent ONLY when the bundle carried a
  ///     map (it usually does not — P6 keeps the shuffle server-side)
  ///   * `drainAttempt` telemetry counter
  ///
  /// The `Idempotency-Key` header is NOT part of the body — it is stamped by
  /// [submitOfflineReplay] from [attempt.idempotencyKey] verbatim (never here).
  static v2.QuizSubmitRequest buildOfflineSubmitRequest(
    QueuedQuizAttempt attempt,
  ) {
    final responses = attempt.responses
        .map((r) => <String, dynamic>{
              'question_id': r.questionId,
              'selected_displayed_index': r.selectedDisplayedIndex,
              'time_spent': r.timeSpent,
            })
        .toList(growable: false);

    final builder = v2.QuizSubmitRequestBuilder()
      ..studentId = attempt.studentId
      ..sessionId = attempt.sessionId
      ..subject = attempt.subject
      ..grade = attempt.grade
      ..topic = attempt.topic
      ..chapter = attempt.chapter
      ..totalTimeSeconds = attempt.totalTimeSeconds
      ..attemptMode = v2.QuizSubmitRequestAttemptModeEnum.offlineReplay
      // capturedAt: device wall-clock at COMPLETION, captured once. The
      // generated DTO parses the stored ISO-8601 string into DateTime.
      ..capturedAt = DateTime.parse(attempt.capturedAt)
      // Must equal totalTimeSeconds (server: 400 OFFLINE_TIME_INCONSISTENT).
      ..clientCapturedTotalSeconds = attempt.totalTimeSeconds
      ..drainAttempt = attempt.drainAttempt
      ..responses.replace(buildV2SubmitItems(responses));

    // Shuffle maps are sent ONLY when the cached bundle actually carried them
    // (usually it does NOT — the server keeps the shuffle map server-side per
    // P6, so /v2/quiz/start never reveals it). When omitted, the server
    // verifies session integrity via its own snapshot (defers to the RPC's
    // session_not_started → 409 for a missing snapshot). Sending a fabricated
    // map would risk a false SHUFFLE_MAP_MISMATCH 422 — so we only send a map
    // we genuinely rendered against.
    if (attempt.shuffleMaps.isNotEmpty) {
      builder.shuffleMapsClientGradedAgainst.replace(
        attempt.shuffleMaps.map(
          (k, v) => MapEntry(k, BuiltList<int>(v)),
        ),
      );
    }

    return builder.build();
  }

  /// Pull the server's structured error `code` (e.g. `REPLAY_TOO_STALE`) from a
  /// DioException body, if present. Code strings only — no PII (P13).
  static String? _errorCode(DioException e) {
    final data = e.response?.data;
    if (data is Map) {
      final code = data['code'] ?? data['error_code'];
      if (code != null) return code.toString();
      final err = data['error'];
      if (err is Map && err['code'] != null) return err['code'].toString();
    }
    return null;
  }

  /// Extract a useful message from a thrown error (DioException server bodies
  /// carry the structured `{ error: ... }` payload; everything else falls
  /// back to `toString`). Never logs PII (P13) — message text only.
  static String _describe(Object e) {
    if (e is DioException) {
      final data = e.response?.data;
      if (data is Map && data['error'] != null) {
        return data['error'].toString();
      }
      if (data is String && data.isNotEmpty) return data;
      return e.message ?? e.toString();
    }
    return e.toString();
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
