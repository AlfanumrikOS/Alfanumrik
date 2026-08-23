import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:uuid/uuid.dart';

import '../core/network/network_info.dart';
import '../data/models/offline_quiz_models.dart';
import '../data/models/quiz_question.dart';
import '../data/repositories/quiz_repository.dart';
import 'assignments_provider.dart';
import 'auth_provider.dart';
import 'dashboard_provider.dart';
import 'experience_provider.dart';
import 'offline_quiz_provider.dart';

const _uuidGen = Uuid();

final quizRepositoryProvider = Provider<QuizRepository>((ref) {
  // The generated transport is injected only for an explicit server-enabled
  // assignment. A permissive build remains legacy until that response arrives.
  return QuizRepository(
    v2Client: ref.watch(oneExperienceV2ApiClientProvider),
  );
});

/// Quiz state — manages questions, answers, scoring.
///
/// Under the v2 server-authoritative path (P1+P6 fix, migration
/// `20260428160000_quiz_session_shuffles.sql`):
///   * [questions] is the list returned by `start_quiz_session` — already
///     server-shuffled. Display order MUST match the order in this list.
///   * [serverSessionId] is the `session_id` from the same RPC. Pass it
///     back to `submit_quiz_results_v2` so the server can re-derive
///     correctness against its snapshot.
///   * Each entry in [answers] is the **displayed** index the student
///     tapped (0..3), not an original index. The server resolves the
///     shuffle.
class QuizState {
  final List<QuizQuestion> questions;
  final int currentIndex;
  final Map<int, int> answers; // questionIndex -> selectedDisplayedIndex
  /// Per-question time in seconds: questionIndex -> seconds spent on that question.
  final Map<int, int> questionTimes;

  /// Timestamp when the current question was first shown.
  final DateTime? currentQuestionStartedAt;
  final bool isLoading;
  final bool isSubmitting;
  final QuizResult? result;
  final String? error;
  final String? subject;
  final DateTime? startedAt;

  /// Server-issued session ID (from `start_quiz_session`). When non-null,
  /// `submit_quiz_results_v2` is the scoring path. When null, the
  /// repository falls back to the legacy v1 RPC.
  final String? serverSessionId;

  /// Phase 2.8 idempotency token. Generated ONCE per quiz attempt in
  /// [QuizNotifier.startQuiz] and reused on every retry of
  /// `submit_quiz_results_v2`. The server uses this to short-circuit
  /// replays on transient 5xx so the same attempt never produces two
  /// `quiz_sessions` rows or duplicate XP. See migration
  /// `20260504100200_quiz_idempotency_key.sql`.
  final String? idempotencyKey;

  /// Set to true when the server returned `session_not_started`
  /// (SQLSTATE P0001). The result screen swaps the generic error banner
  /// for a "Quiz session expired — please restart" CTA.
  final bool sessionExpired;

  /// Wave 2.5.2: set to true when the attempt was completed OFFLINE and queued
  /// for later drain instead of submitted immediately. The screen shows a
  /// bilingual "Saved offline — will sync when you're back online" state
  /// instead of a score. Only reachable on the `useV2`-ON path.
  final bool savedOffline;

  /// Phase 6 sub-phase 5 (Assignments): non-null ONLY when this quiz was
  /// launched via the `/quiz?...&from=assignment&assignmentId=<id>` deep
  /// link from the Assignments screen (mirrors the web's `from=assignment`
  /// query param handling in `(student)/quiz/page.tsx`). Never affects
  /// scoring/XP/submission (P1-P4) — it ONLY decides whether
  /// [QuizNotifier.submitQuiz] fires the post-submit
  /// `assignmentCompletionProvider` side-effect once a real result exists.
  final String? assignmentId;

  /// M2 forensic-audit fix: a comma-separated list of machine-readable P3
  /// anti-cheat flag codes (`too_fast`, `pattern`, `count_mismatch`) that
  /// tripped just before submission, or null if none did. Codes — not
  /// display text — so the UI can render bilingual copy (P7).
  ///
  /// Mirrors the web quiz page's advisory-only checks
  /// (`apps/host/src/app/(student)/quiz/page.tsx`, the "ANTI-CHEAT:
  /// Client-side validation before submission (P3)" block): same
  /// thresholds (avg < 3s/question, >3 MCQ all-same-index), same "warn but
  /// always still submit" behavior — the server RPC remains the sole
  /// authority on flagging + zero-XP (P3/P9). Unlike web (which only
  /// `console.warn`s, invisible to the student), mobile surfaces this as a
  /// one-shot SnackBar so the student isn't blindsided by a flagged,
  /// zero-XP result. This is a one-shot transient value — see the
  /// direct-assign (not `??`) handling in [copyWith], same pattern as
  /// [error].
  final String? antiCheatWarning;

  const QuizState({
    this.questions = const [],
    this.currentIndex = 0,
    this.answers = const {},
    this.questionTimes = const {},
    this.currentQuestionStartedAt,
    this.isLoading = false,
    this.isSubmitting = false,
    this.result,
    this.error,
    this.subject,
    this.startedAt,
    this.serverSessionId,
    this.idempotencyKey,
    this.sessionExpired = false,
    this.savedOffline = false,
    this.assignmentId,
    this.antiCheatWarning,
  });

  QuizState copyWith({
    List<QuizQuestion>? questions,
    int? currentIndex,
    Map<int, int>? answers,
    Map<int, int>? questionTimes,
    DateTime? currentQuestionStartedAt,
    bool? isLoading,
    bool? isSubmitting,
    QuizResult? result,
    String? error,
    String? subject,
    DateTime? startedAt,
    String? serverSessionId,
    String? idempotencyKey,
    bool? sessionExpired,
    bool? savedOffline,
    String? assignmentId,
    String? antiCheatWarning,
  }) {
    return QuizState(
      questions: questions ?? this.questions,
      currentIndex: currentIndex ?? this.currentIndex,
      answers: answers ?? this.answers,
      questionTimes: questionTimes ?? this.questionTimes,
      currentQuestionStartedAt:
          currentQuestionStartedAt ?? this.currentQuestionStartedAt,
      isLoading: isLoading ?? this.isLoading,
      isSubmitting: isSubmitting ?? this.isSubmitting,
      result: result ?? this.result,
      error: error,
      subject: subject ?? this.subject,
      startedAt: startedAt ?? this.startedAt,
      serverSessionId: serverSessionId ?? this.serverSessionId,
      idempotencyKey: idempotencyKey ?? this.idempotencyKey,
      sessionExpired: sessionExpired ?? this.sessionExpired,
      savedOffline: savedOffline ?? this.savedOffline,
      assignmentId: assignmentId ?? this.assignmentId,
      // Direct-assign (like `error` above), not `??`-coalesced: this is a
      // one-shot advisory banner. Any subsequent copyWith call that doesn't
      // explicitly re-pass it clears it, so the SnackBar shown by the UI
      // never reappears on unrelated state transitions.
      antiCheatWarning: antiCheatWarning,
    );
  }

  QuizQuestion? get currentQuestion =>
      currentIndex < questions.length ? questions[currentIndex] : null;
  bool get isComplete => currentIndex >= questions.length && questions.isNotEmpty;
  int get answeredCount => answers.length;
  double get progress =>
      questions.isNotEmpty ? (currentIndex + 1) / questions.length : 0;
}

/// Riverpod provider for [QuizState].
final quizProvider = NotifierProvider<QuizNotifier, QuizState>(QuizNotifier.new);

class QuizNotifier extends Notifier<QuizState> {
  @override
  QuizState build() => const QuizState();

  /// Load quiz questions for a subject and obtain a server-shuffled session.
  ///
  /// Two-phase load (P1+P6 fix):
  ///   1. Fetch a candidate question pool from `question_bank` (v1-style).
  ///   2. Pass those question IDs to `start_quiz_session` so the server
  ///      generates per-question shuffles and snapshots options +
  ///      correct_answer_index. The resulting `serverSessionId` flows into
  ///      [QuizState.serverSessionId] and the SHUFFLED questions returned
  ///      by the RPC replace the originally-fetched ones.
  ///
  /// If `start_quiz_session` is unavailable we keep the v1 behaviour
  /// (client-side shuffled questions, no session, legacy
  /// `submit_quiz_results` at submit time). This preserves backwards
  /// compatibility with older Supabase deployments.
  /// R8 (2026-08-11): [boardYear] is the PYQ board-paper hint from the `/pyq`
  /// launcher (`/quiz?...&year=`), already range-validated by the router. It is
  /// forwarded to [QuizRepository.getQuestions] as a question-SELECTION
  /// preference ONLY — it never reaches the session, the submit call, or any
  /// scoring input, so P1/P2/P3/P4 are untouched by it. Null for every non-PYQ
  /// launch, which leaves selection byte-identical to before.
  Future<void> startQuiz({
    required String subject,
    String? chapterTitle,
    int count = 10,
    int? boardYear,
    // Phase 6 sub-phase 5 (Assignments): set ONLY when launched from the
    // Assignments screen's "Start"/"Retry" deep link. Threaded through to
    // [QuizState.assignmentId] — see that field's doc comment for the exact
    // (narrow) effect this has on the submit flow.
    String? assignmentId,
  }) async {
    final student = ref.read(studentProvider).valueOrNull;
    if (student == null) return;

    // Phase 2.8: generate the idempotency key ONCE per attempt. It is
    // reused on every retry of submit_quiz_results_v2 so the server can
    // short-circuit replays. NEVER regenerate on retry — that would
    // defeat the whole point of the partial unique index.
    final attemptKey = _uuidGen.v4();

    state = QuizState(
      isLoading: true,
      subject: subject,
      idempotencyKey: attemptKey,
      assignmentId: assignmentId,
    );

    final repo = ref.read(quizRepositoryProvider);
    final fetchResult = await repo.getQuestions(
      subject: subject,
      grade: student.grade,
      count: count,
      chapterTitle: chapterTitle,
      boardYear: boardYear,
    );

    await fetchResult.when(
      success: (rawQuestions) async {
        if (rawQuestions.isEmpty) {
          state = state.copyWith(
            isLoading: false,
            error: 'No questions available for this subject yet.',
          );
          return;
        }

        // Phase 2: ask the server for a shuffle session. Soft-fail to v1.
        final session = await repo.startSessionForQuestions(
          studentId: student.id,
          questionIds: rawQuestions.map((q) => q.id).toList(growable: false),
          subject: subject,
          grade: student.grade,
        );

        final now = DateTime.now();
        if (session != null && session.questions.isNotEmpty) {
          // Server-shuffled path. Display order = server order.
          state = state.copyWith(
            questions: session.questions,
            isLoading: false,
            startedAt: now,
            currentQuestionStartedAt: now,
            serverSessionId: session.sessionId,
          );
        } else {
          // v1 fallback — client-side shuffle already applied by getQuestions().
          state = state.copyWith(
            questions: rawQuestions,
            isLoading: false,
            startedAt: now,
            currentQuestionStartedAt: now,
            // serverSessionId stays null → submit goes via v1.
          );
        }
      },
      failure: (msg) async => state = state.copyWith(isLoading: false, error: msg),
    );
  }

  /// Record elapsed time for the current question index and return updated map.
  Map<int, int> _recordCurrentQuestionTime(Map<int, int> existing) {
    final start = state.currentQuestionStartedAt ?? DateTime.now();
    final elapsed = DateTime.now().difference(start).inSeconds;
    return Map<int, int>.from(existing)..[state.currentIndex] = elapsed;
  }

  /// Select an answer for the current question.
  ///
  /// [optionIndex] is the **displayed** index (0..3) — i.e. the position
  /// the student tapped in the order the server presented. Under v2 this
  /// goes to the server as `selected_displayed_index`; the server resolves
  /// the shuffle. Mobile MUST NOT translate to "original index" locally.
  void selectAnswer(int optionIndex) {
    if (state.result != null) return;
    final newAnswers = Map<int, int>.from(state.answers);
    newAnswers[state.currentIndex] = optionIndex;
    state = state.copyWith(answers: newAnswers);
  }

  /// Move to next question — records time spent on the current question first.
  void nextQuestion() {
    if (state.currentIndex < state.questions.length - 1) {
      final updatedTimes = _recordCurrentQuestionTime(state.questionTimes);
      state = state.copyWith(
        currentIndex: state.currentIndex + 1,
        questionTimes: updatedTimes,
        currentQuestionStartedAt: DateTime.now(),
      );
    }
  }

  /// Move to previous question — records time spent on the current question first.
  void previousQuestion() {
    if (state.currentIndex > 0) {
      final updatedTimes = _recordCurrentQuestionTime(state.questionTimes);
      state = state.copyWith(
        currentIndex: state.currentIndex - 1,
        questionTimes: updatedTimes,
        currentQuestionStartedAt: DateTime.now(),
      );
    }
  }

  /// Submit quiz via `submit_quiz_results_v2` (preferred) or v1 fallback.
  ///
  /// Builds the per-question response list using the v2 wire field
  /// `selected_displayed_index`. The repository's [QuizRepository.submitAttempt]
  /// dispatches between v1 and v2 based on whether [QuizState.serverSessionId]
  /// is set. Score, XP, anti-cheat, atomicity (P1-P4) are all enforced
  /// server-side.
  Future<void> submitQuiz() async {
    if (state.isSubmitting || state.result != null || state.savedOffline) return;

    final student = ref.read(studentProvider).valueOrNull;
    if (student == null) return;

    state = state.copyWith(isSubmitting: true);

    // Record time for the last question before building the responses list.
    final finalTimes = _recordCurrentQuestionTime(state.questionTimes);

    final timeTaken = DateTime.now().difference(state.startedAt ?? DateTime.now());

    // Build per-question response objects in the v2 wire format.
    // Unanswered questions are included with `selected_displayed_index = -1`
    // so the server can count them as incorrect without breaking P3
    // (response count must equal question count).
    final responses = <Map<String, dynamic>>[];
    for (int i = 0; i < state.questions.length; i++) {
      responses.add({
        'question_id': state.questions[i].id,
        'selected_displayed_index': state.answers[i] ?? -1,
        'time_spent': finalTimes[i] ?? 0,
      });
    }

    // ── M2: client-side P3 anti-cheat heuristics (advisory-only) ───────────
    // Mirrors `apps/host/src/app/(student)/quiz/page.tsx`'s pre-submit block
    // EXACTLY (same thresholds, same "warn, never block" behavior). The
    // server RPC re-checks all three and remains the sole authority on
    // flag + zero-XP — this only gives the mobile student a heads-up that
    // web students effectively don't get either (web only `console.warn`s).
    final warning = _computeAntiCheatWarning(
      responses: responses,
      totalTimeSeconds: timeTaken.inSeconds,
      questionCount: state.questions.length,
    );
    if (warning != null) {
      state = state.copyWith(antiCheatWarning: warning);
    }

    // ── Wave 2.5.2 OFFLINE branch ─────────────────────────────────────────
    // When the device is OFFLINE at completion AND we're on the useV2 path
    // AND we have a server session id (required for server-authoritative
    // grading), queue the attempt instead of submitting. The coordinator
    // drains it when connectivity returns. When ONLINE — or when useV2 is OFF —
    // this whole block is skipped and submission is byte-identical to today.
    final coordinator = ref.read(oneExperienceRuntimeEnabledProvider)
        ? ref.read(offlineQuizCoordinatorProvider)
        : null;
    final sessionId = state.serverSessionId;
    if (coordinator != null &&
        sessionId != null &&
        sessionId.isNotEmpty &&
        !await hasConnection()) {
      // capturedAt: device wall-clock at COMPLETION, captured ONCE here and
      // stored immutably (P-obligation 2). The idempotencyKey was generated
      // ONCE in startQuiz() and is reused verbatim — NEVER regenerated.
      final capturedAt = DateTime.now().toUtc().toIso8601String();
      final attempt = QueuedQuizAttempt(
        localId: _uuidGen.v4(),
        sessionId: sessionId,
        studentId: student.id,
        subject: state.subject ?? '',
        grade: student.grade,
        responses: responses
            .map((r) => OfflineResponse(
                  questionId: r['question_id'] as String,
                  selectedDisplayedIndex:
                      (r['selected_displayed_index'] as num?)?.toInt() ?? -1,
                  timeSpent: (r['time_spent'] as num?)?.toInt() ?? 0,
                ))
            .toList(growable: false),
        // Same device-summed total used as totalTimeSeconds AND
        // clientCapturedTotalSeconds (server cross-checks equality — P3).
        totalTimeSeconds: timeTaken.inSeconds,
        capturedAt: capturedAt,
        // IMMUTABLE grading token — generated once at startQuiz, reused on
        // every drain. Fallback to a fresh v4 ONLY if startQuiz somehow left it
        // null (should never happen on the v2 path).
        idempotencyKey: state.idempotencyKey ?? _uuidGen.v4(),
        // Shuffle maps stay server-side (P6); the bundle never carries them, so
        // none are sent and the server verifies via its own snapshot.
        shuffleMaps: const {},
        drainAttempt: 0,
      );

      await coordinator.enqueueCompletedAttempt(attempt);

      // Show the "saved offline" state — NOT a score (grading is deferred).
      state = state.copyWith(isSubmitting: false, savedOffline: true);
      return;
    }

    final repo = ref.read(quizRepositoryProvider);
    final result = await repo.submitAttempt(
      studentId: student.id,
      subject: state.subject ?? '',
      grade: student.grade,
      responses: responses,
      timeTakenSeconds: timeTaken.inSeconds,
      sessionId: state.serverSessionId,
      idempotencyKey: state.idempotencyKey,
    );

    result.when(
      success: (quizResult) {
        state = state.copyWith(result: quizResult, isSubmitting: false);
        // Refresh dashboard to show updated coins/score. Skip on
        // idempotent replay — the server already counted this attempt
        // on the first commit and the dashboard was refreshed then;
        // re-firing would re-animate XP gain in the UI for the same
        // attempt, which is exactly what the replay short-circuit
        // exists to prevent.
        if (!quizResult.idempotentReplay) {
          ref.read(dashboardProvider.notifier).refresh();
        }

        // Phase 6 sub-phase 5 (Assignments): fire-and-tracked side-effect
        // ONLY when this quiz was launched from an assignment deep link AND
        // the server actually returned a session id (a v1 fallback quiz with
        // no server session has nothing to record against). This call is
        // STRICTLY AFTER the normal P1-P4 scoring/XP path has already
        // completed and does not feed back into it in any way — it only
        // relays the already-graded session into
        // `assignment_submissions` and surfaces the outcome via
        // [assignmentCompletionProvider] for the result screen to render.
        final assignmentId = state.assignmentId;
        final sessionId = quizResult.sessionId;
        if (assignmentId != null && assignmentId.isNotEmpty &&
            sessionId != null && sessionId.isNotEmpty) {
          ref.read(assignmentCompletionProvider.notifier).completeFromQuiz(
                assignmentId: assignmentId,
                sessionId: sessionId,
              );
        }
      },
      failure: (msg) {
        // Phase 1.2: server RAISEs `session_not_started` (P0001) when the
        // shuffle snapshot is missing. Surface a structured flag so the
        // UI shows a "Quiz session expired — please restart" CTA instead
        // of a generic banner. The repository tags the failure message
        // with the `session_not_started:` prefix.
        final isSessionExpired = msg.startsWith('session_not_started');

        // RPC failed — show a zero-score result so the student at least sees
        // the quiz ended. Do NOT compute XP/coins locally; values will be 0
        // to avoid awarding unverified rewards (P2).
        state = state.copyWith(
          result: QuizResult(
            totalQuestions: state.questions.length,
            correctAnswers: 0,
            scorePercent: 0,
            xpEarned: 0,
            coinsEarned: 0,
            timeTaken: timeTaken,
          ),
          isSubmitting: false,
          error: msg,
          sessionExpired: isSessionExpired,
        );
      },
    );
  }

  /// Computes P3 anti-cheat flag codes, advisory-only. See
  /// [QuizState.antiCheatWarning] for the exact web parity contract.
  ///
  /// Returns a comma-separated code string, or null if nothing tripped.
  /// Pure/static — no side effects, easy to unit test independently of
  /// Riverpod state.
  static String? _computeAntiCheatWarning({
    required List<Map<String, dynamic>> responses,
    required int totalTimeSeconds,
    required int questionCount,
  }) {
    final flags = <String>[];

    // 1. Minimum time: 3 seconds avg per question (bots submit instantly).
    final totalResponses = responses.length;
    final avgTimePerQ =
        totalResponses > 0 ? totalTimeSeconds / totalResponses : 0.0;
    if (totalResponses > 0 && avgTimePerQ < 3) {
      flags.add('too_fast');
    }

    // 2. All MCQ answers the same index, with >3 MCQ questions answered.
    // "MCQ response" = a built response with a real (non -1) selected index.
    final mcqResponses = responses
        .where((r) => (r['selected_displayed_index'] as int? ?? -1) >= 0)
        .toList(growable: false);
    final optionCounts = [0, 0, 0, 0];
    for (final r in mcqResponses) {
      final idx = r['selected_displayed_index'] as int;
      if (idx >= 0 && idx < 4) optionCounts[idx]++;
    }
    final maxSameOption =
        optionCounts.isEmpty ? 0 : optionCounts.reduce((a, b) => a > b ? a : b);
    if (mcqResponses.length > 3 && maxSameOption == mcqResponses.length) {
      flags.add('pattern');
    }

    // 3. Response count must equal question count. Mobile always builds
    // exactly one response per question (unanswered → -1), so this should
    // never trip in practice — kept for exact parity with the web check.
    if (responses.length != questionCount) {
      flags.add('count_mismatch');
    }

    return flags.isEmpty ? null : flags.join(',');
  }

  /// Reset quiz state.
  void reset() {
    state = const QuizState();
    // Clear any stale assignment-completion banner (max-attempts/closed/
    // success) so the NEXT quiz attempt — which may not be assignment-linked
    // at all — never inherits a previous attempt's outcome.
    ref.read(assignmentCompletionProvider.notifier).reset();
  }
}
