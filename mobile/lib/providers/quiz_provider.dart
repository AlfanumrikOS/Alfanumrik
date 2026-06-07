import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:uuid/uuid.dart';

import '../core/constants/api_constants.dart';
import '../core/network/v2_api_client.dart';
import '../data/models/quiz_question.dart';
import '../data/repositories/quiz_repository.dart';
import 'auth_provider.dart';
import 'dashboard_provider.dart';

const _uuidGen = Uuid();

final quizRepositoryProvider = Provider<QuizRepository>((ref) {
  // Inject the generated /v2 client ONLY when the flag is on. Flag-OFF builds
  // pass null so the legacy Supabase-RPC/table path is byte-identical to today
  // and the dart-dio client is never even constructed.
  return QuizRepository(
    v2Client: ApiConstants.useV2 ? ref.read(v2ApiClientProvider) : null,
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
  Future<void> startQuiz({
    required String subject,
    String? chapterTitle,
    int count = 10,
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
    );

    final repo = ref.read(quizRepositoryProvider);
    final fetchResult = await repo.getQuestions(
      subject: subject,
      grade: student.grade,
      count: count,
      chapterTitle: chapterTitle,
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
    if (state.isSubmitting || state.result != null) return;

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

  /// Reset quiz state.
  void reset() {
    state = const QuizState();
  }
}
