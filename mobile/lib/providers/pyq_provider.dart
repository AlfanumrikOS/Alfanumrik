import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../data/models/pyq_models.dart';
import '../data/repositories/pyq_repository.dart';

final pyqRepositoryProvider = Provider<PyqRepository>((ref) => PyqRepository());

/// Screen states — mirrors the `Screen` union in
/// `apps/host/src/app/(student)/pyq/page.tsx` ('select' | 'quiz' | 'done').
enum PyqScreenState { select, quiz, done }

class PyqState {
  final PyqScreenState screen;
  final String? selectedSubjectCode;
  final int? selectedYear;
  final List<PyqQuestion> questions;
  final int currentIdx;
  final int? selectedOption;
  final bool showExplanation;
  final int correctCount;
  final bool loading;

  /// True when the shown questions came from the ungapped subject+grade
  /// fallback rather than year-tagged rows (web's `noQuestions` flag).
  final bool isFallback;
  final String? error;

  const PyqState({
    this.screen = PyqScreenState.select,
    this.selectedSubjectCode,
    this.selectedYear,
    this.questions = const [],
    this.currentIdx = 0,
    this.selectedOption,
    this.showExplanation = false,
    this.correctCount = 0,
    this.loading = false,
    this.isFallback = false,
    this.error,
  });

  PyqQuestion? get currentQuestion =>
      currentIdx < questions.length ? questions[currentIdx] : null;

  PyqState copyWith({
    PyqScreenState? screen,
    String? selectedSubjectCode,
    int? selectedYear,
    List<PyqQuestion>? questions,
    int? currentIdx,
    int? selectedOption,
    bool clearSelectedOption = false,
    bool? showExplanation,
    int? correctCount,
    bool? loading,
    bool? isFallback,
    String? error,
    bool clearError = false,
  }) {
    return PyqState(
      screen: screen ?? this.screen,
      selectedSubjectCode: selectedSubjectCode ?? this.selectedSubjectCode,
      selectedYear: selectedYear ?? this.selectedYear,
      questions: questions ?? this.questions,
      currentIdx: currentIdx ?? this.currentIdx,
      selectedOption: clearSelectedOption ? null : (selectedOption ?? this.selectedOption),
      showExplanation: showExplanation ?? this.showExplanation,
      correctCount: correctCount ?? this.correctCount,
      loading: loading ?? this.loading,
      isFallback: isFallback ?? this.isFallback,
      error: clearError ? null : (error ?? this.error),
    );
  }
}

final pyqProvider = NotifierProvider<PyqNotifier, PyqState>(PyqNotifier.new);

/// PYQ state machine — mobile parity for the select → quiz → done flow in
/// `apps/host/src/app/(student)/pyq/page.tsx`. Scoring here is LOCAL/display
/// only (a practice tool with no XP/coins on either web or mobile — unlike
/// the main quiz flow, there is no server RPC to award anything for PYQ
/// practice, so no P1/P2 concerns apply).
class PyqNotifier extends Notifier<PyqState> {
  @override
  PyqState build() => const PyqState();

  void selectSubject(String code) {
    state = state.copyWith(selectedSubjectCode: code);
  }

  void selectYear(int year) {
    state = state.copyWith(selectedYear: year);
  }

  Future<void> startPractice({required String grade}) async {
    final subject = state.selectedSubjectCode;
    final year = state.selectedYear;
    if (subject == null || year == null) return;

    state = state.copyWith(loading: true, clearError: true);
    final repo = ref.read(pyqRepositoryProvider);
    final result = await repo.fetchQuestions(subject: subject, grade: grade, year: year);

    result.when(
      success: (r) {
        state = state.copyWith(
          questions: r.questions,
          isFallback: r.isFallback,
          currentIdx: 0,
          correctCount: 0,
          clearSelectedOption: true,
          showExplanation: false,
          loading: false,
          screen: PyqScreenState.quiz,
        );
      },
      failure: (msg) {
        state = state.copyWith(
          loading: false,
          error: msg,
          isFallback: true,
          questions: const [],
          screen: PyqScreenState.quiz,
        );
      },
    );
  }

  /// Lock in an answer for the current question — mirrors the web's
  /// `handleAnswer`: immediate reveal, no going back.
  void selectAnswer(int idx) {
    if (state.showExplanation) return;
    final q = state.currentQuestion;
    if (q == null) return;
    final isCorrect = idx == q.correctAnswerIndex;
    state = state.copyWith(
      selectedOption: idx,
      showExplanation: true,
      correctCount: isCorrect ? state.correctCount + 1 : state.correctCount,
    );
  }

  void nextQuestion() {
    if (state.currentIdx + 1 >= state.questions.length) {
      state = state.copyWith(screen: PyqScreenState.done);
      return;
    }
    state = state.copyWith(
      currentIdx: state.currentIdx + 1,
      clearSelectedOption: true,
      showExplanation: false,
    );
  }

  /// Retry the SAME subject/year (web's "Try Again" on the done screen).
  Future<void> retry({required String grade}) => startPractice(grade: grade);

  /// Full reset back to the subject/year picker (web's "Different Year /
  /// Subject" / "Go back").
  void restart() {
    state = const PyqState();
  }
}
