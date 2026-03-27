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
          state = state.copyWith(
            questions: questions,
            isLoading: false,
            startedAt: DateTime.now(),
          );
        }
      },
      failure: (msg) => state = state.copyWith(isLoading: false, error: msg),
    );
  }

  /// Select an answer for current question
  void selectAnswer(int optionIndex) {
    if (state.result != null) return;
    final newAnswers = Map<int, int>.from(state.answers);
    newAnswers[state.currentIndex] = optionIndex;
    state = state.copyWith(answers: newAnswers);
  }

  /// Move to next question
  void nextQuestion() {
    if (state.currentIndex < state.questions.length - 1) {
      state = state.copyWith(currentIndex: state.currentIndex + 1);
    }
  }

  /// Move to previous question
  void previousQuestion() {
    if (state.currentIndex > 0) {
      state = state.copyWith(currentIndex: state.currentIndex - 1);
    }
  }

  /// Submit quiz and calculate results
  Future<void> submitQuiz() async {
    if (state.isSubmitting || state.result != null) return;

    final student = ref.read(studentProvider).valueOrNull;
    if (student == null) return;

    state = state.copyWith(isSubmitting: true);

    int correct = 0;
    for (final entry in state.answers.entries) {
      final q = state.questions[entry.key];
      if (entry.value == q.correctIndex) correct++;
    }

    final timeTaken = DateTime.now().difference(state.startedAt ?? DateTime.now());

    final repo = ref.read(quizRepositoryProvider);
    final result = await repo.submitAttempt(
      studentId: student.id,
      subject: state.subject ?? '',
      grade: student.grade,
      totalQuestions: state.questions.length,
      correctAnswers: correct,
      timeTakenSeconds: timeTaken.inSeconds,
    );

    result.when(
      success: (quizResult) {
        state = state.copyWith(result: quizResult, isSubmitting: false);
        // Refresh dashboard to show updated XP
        ref.read(dashboardProvider.notifier).refresh();
      },
      failure: (msg) {
        // Still show result even if save failed
        state = state.copyWith(
          result: QuizResult(
            totalQuestions: state.questions.length,
            correctAnswers: correct,
            xpEarned: correct * 5,
            timeTaken: timeTaken,
          ),
          isSubmitting: false,
        );
      },
    );
  }

  /// Reset quiz state
  void reset() {
    state = const QuizState();
  }
}
