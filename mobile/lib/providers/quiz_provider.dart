import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../data/models/quiz_question.dart';
import '../data/repositories/quiz_repository.dart';
import 'auth_provider.dart';
import 'dashboard_provider.dart';

final quizRepositoryProvider = Provider<QuizRepository>((ref) {
  return QuizRepository();
});

/// Quiz state — manages questions, answers, scoring
final quizProvider = NotifierProvider<QuizNotifier, QuizState>(QuizNotifier.new);

class QuizState {
  final List<QuizQuestion> questions;
  final int currentIndex;
  final Map<int, int> answers; // questionIndex -> selectedOption
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
    );
  }

  QuizQuestion? get currentQuestion =>
      currentIndex < questions.length ? questions[currentIndex] : null;
  bool get isComplete => currentIndex >= questions.length && questions.isNotEmpty;
  int get answeredCount => answers.length;
  double get progress =>
      questions.isNotEmpty ? (currentIndex + 1) / questions.length : 0;
}

class QuizNotifier extends Notifier<QuizState> {
  @override
  QuizState build() => const QuizState();

  /// Load quiz questions for a subject
  Future<void> startQuiz({
    required String subject,
    String? chapterTitle,
    int count = 10,
  }) async {
    final student = ref.read(studentProvider).valueOrNull;
    if (student == null) return;

    state = QuizState(isLoading: true, subject: subject);

    final repo = ref.read(quizRepositoryProvider);
    final result = await repo.getQuestions(
      subject: subject,
      grade: student.grade,
      count: count,
      chapterTitle: chapterTitle,
    );

    result.when(
      success: (questions) {
        if (questions.isEmpty) {
          state = state.copyWith(
            isLoading: false,
            error: 'No questions available for this subject yet.',
          );
        } else {
          final now = DateTime.now();
          state = state.copyWith(
            questions: questions,
            isLoading: false,
            startedAt: now,
            currentQuestionStartedAt: now,
          );
        }
      },
      failure: (msg) => state = state.copyWith(isLoading: false, error: msg),
    );
  }

  /// Record elapsed time for the current question index and return updated map.
  Map<int, int> _recordCurrentQuestionTime(Map<int, int> existing) {
    final start = state.currentQuestionStartedAt ?? DateTime.now();
    final elapsed = DateTime.now().difference(start).inSeconds;
    return Map<int, int>.from(existing)..[state.currentIndex] = elapsed;
  }

  /// Select an answer for current question
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

  /// Submit quiz via submit_quiz_results RPC.
  ///
  /// Builds the per-question responses list that the RPC expects:
  ///   [{ question_id, selected_option, time_spent }]
  /// Score, XP, anti-cheat, and atomicity are all handled server-side (P1-P4).
  Future<void> submitQuiz() async {
    if (state.isSubmitting || state.result != null) return;

    final student = ref.read(studentProvider).valueOrNull;
    if (student == null) return;

    state = state.copyWith(isSubmitting: true);

    // Record time for the last question before building the responses list.
    final finalTimes = _recordCurrentQuestionTime(state.questionTimes);

    final timeTaken = DateTime.now().difference(state.startedAt ?? DateTime.now());

    // Build per-question response objects required by submit_quiz_results.
    // Unanswered questions are included with selected_option = -1 so the
    // server can count them as incorrect without affecting the response count
    // check (P3: response count must equal question count).
    final responses = <Map<String, dynamic>>[];
    for (int i = 0; i < state.questions.length; i++) {
      responses.add({
        'question_id': state.questions[i].id,
        'selected_option': state.answers[i] ?? -1,
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
    );

    result.when(
      success: (quizResult) {
        state = state.copyWith(result: quizResult, isSubmitting: false);
        // Refresh dashboard to show updated XP
        ref.read(dashboardProvider.notifier).refresh();
      },
      failure: (msg) {
        // RPC failed — show a zero-score result so the student at least sees
        // the quiz ended. Do NOT compute XP locally; values will be 0 to
        // avoid awarding unverified XP (P2).
        state = state.copyWith(
          result: QuizResult(
            totalQuestions: state.questions.length,
            correctAnswers: 0,
            scorePercent: 0,
            xpEarned: 0,
            timeTaken: timeTaken,
          ),
          isSubmitting: false,
          error: msg,
        );
      },
    );
  }

  /// Reset quiz state
  void reset() {
    state = const QuizState();
  }
}
