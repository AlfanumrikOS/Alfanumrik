import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../data/models/diagnostic_models.dart';
import '../data/repositories/diagnostic_repository.dart';
import 'auth_provider.dart';

final diagnosticRepositoryProvider =
    Provider<DiagnosticRepository>((ref) => DiagnosticRepository());

/// Screen states — mirrors the `DiagnosticScreen` union in
/// `apps/host/src/app/diagnostic/page.tsx` ('setup' | 'quiz' | 'results').
enum DiagnosticScreenState { setup, quiz, results }

/// Diagnostic only supports grades 6-10 (matches
/// `VALID_DIAGNOSTIC_GRADES`/`SUBJECT_OPTIONS` on the web page).
const List<String> kDiagnosticGrades = ['6', '7', '8', '9', '10'];

class DiagnosticSubjectOption {
  final String code;
  final String label;
  final String labelHi;
  final String icon;
  const DiagnosticSubjectOption({
    required this.code,
    required this.label,
    required this.labelHi,
    required this.icon,
  });
}

/// Port of the web's `SUBJECT_OPTIONS` — a deliberately small, static subset
/// (NOT the dynamic grade×stream×plan `get_available_subjects` governance
/// used elsewhere), matching the diagnostic page exactly.
const Map<String, List<DiagnosticSubjectOption>> kDiagnosticSubjectOptions = {
  '6': [
    DiagnosticSubjectOption(code: 'math', label: 'Mathematics', labelHi: 'गणित', icon: '∑'),
    DiagnosticSubjectOption(code: 'science', label: 'Science', labelHi: 'विज्ञान', icon: '⚛'),
  ],
  '7': [
    DiagnosticSubjectOption(code: 'math', label: 'Mathematics', labelHi: 'गणित', icon: '∑'),
    DiagnosticSubjectOption(code: 'science', label: 'Science', labelHi: 'विज्ञान', icon: '⚛'),
  ],
  '8': [
    DiagnosticSubjectOption(code: 'math', label: 'Mathematics', labelHi: 'गणित', icon: '∑'),
    DiagnosticSubjectOption(code: 'science', label: 'Science', labelHi: 'विज्ञान', icon: '⚛'),
  ],
  '9': [
    DiagnosticSubjectOption(code: 'math', label: 'Mathematics', labelHi: 'गणित', icon: '∑'),
    DiagnosticSubjectOption(code: 'physics', label: 'Physics', labelHi: 'भौतिकी', icon: '⚡'),
    DiagnosticSubjectOption(code: 'chemistry', label: 'Chemistry', labelHi: 'रसायन', icon: '🧪'),
    DiagnosticSubjectOption(code: 'biology', label: 'Biology', labelHi: 'जीव विज्ञान', icon: '🧬'),
  ],
  '10': [
    DiagnosticSubjectOption(code: 'math', label: 'Mathematics', labelHi: 'गणित', icon: '∑'),
    DiagnosticSubjectOption(code: 'physics', label: 'Physics', labelHi: 'भौतिकी', icon: '⚡'),
    DiagnosticSubjectOption(code: 'chemistry', label: 'Chemistry', labelHi: 'रसायन', icon: '🧪'),
    DiagnosticSubjectOption(code: 'biology', label: 'Biology', labelHi: 'जीव विज्ञान', icon: '🧬'),
  ],
};

class DiagnosticState {
  final DiagnosticScreenState screen;
  final String grade;
  final String? subject;
  final bool missingSelection;
  final String? setupError;
  final bool starting;

  final String? sessionId;
  final List<DiagnosticQuestion> questions;
  final int currentIdx;
  final int? selectedOption;
  final List<DiagnosticResponseItem> responses;
  final bool submitting;
  final String? quizError;

  final DiagnosticSummary? summary;

  const DiagnosticState({
    this.screen = DiagnosticScreenState.setup,
    this.grade = '',
    this.subject,
    this.missingSelection = false,
    this.setupError,
    this.starting = false,
    this.sessionId,
    this.questions = const [],
    this.currentIdx = 0,
    this.selectedOption,
    this.responses = const [],
    this.submitting = false,
    this.quizError,
    this.summary,
  });

  DiagnosticQuestion? get currentQuestion =>
      currentIdx < questions.length ? questions[currentIdx] : null;

  List<DiagnosticSubjectOption> get subjectOptions =>
      kDiagnosticSubjectOptions[grade] ?? const [];

  DiagnosticState copyWith({
    DiagnosticScreenState? screen,
    String? grade,
    String? subject,
    bool clearSubject = false,
    bool? missingSelection,
    String? setupError,
    bool clearSetupError = false,
    bool? starting,
    String? sessionId,
    List<DiagnosticQuestion>? questions,
    int? currentIdx,
    int? selectedOption,
    bool clearSelectedOption = false,
    List<DiagnosticResponseItem>? responses,
    bool? submitting,
    String? quizError,
    bool clearQuizError = false,
    DiagnosticSummary? summary,
  }) {
    return DiagnosticState(
      screen: screen ?? this.screen,
      grade: grade ?? this.grade,
      subject: clearSubject ? null : (subject ?? this.subject),
      missingSelection: missingSelection ?? this.missingSelection,
      setupError: clearSetupError ? null : (setupError ?? this.setupError),
      starting: starting ?? this.starting,
      sessionId: sessionId ?? this.sessionId,
      questions: questions ?? this.questions,
      currentIdx: currentIdx ?? this.currentIdx,
      selectedOption: clearSelectedOption ? null : (selectedOption ?? this.selectedOption),
      responses: responses ?? this.responses,
      submitting: submitting ?? this.submitting,
      quizError: clearQuizError ? null : (quizError ?? this.quizError),
      summary: summary ?? this.summary,
    );
  }
}

final diagnosticProvider =
    NotifierProvider<DiagnosticNotifier, DiagnosticState>(DiagnosticNotifier.new);

/// Diagnostic state machine — mobile parity for the setup → quiz-loop →
/// complete flow in `apps/host/src/app/diagnostic/page.tsx`.
///
/// P3: no anti-cheat (diagnostic is untimed, no XP awarded — matches web
/// comment). P5: grade is a string. P7: bilingual copy lives in the screen,
/// keyed off [DiagnosticState.missingSelection] / raw server error text.
class DiagnosticNotifier extends Notifier<DiagnosticState> {
  DateTime _questionStartedAt = DateTime.now();

  @override
  DiagnosticState build() {
    // Pre-fill grade from the student profile when it's a valid diagnostic
    // grade (mirrors the web's pre-fill `useEffect`).
    final student = ref.read(studentProvider).valueOrNull;
    final raw = student?.grade.replaceAll(RegExp(r'^Grade\s*', caseSensitive: false), '').trim();
    final grade = (raw != null && kDiagnosticGrades.contains(raw)) ? raw : '';
    return DiagnosticState(grade: grade);
  }

  void selectGrade(String grade) {
    // Reset subject when grade changes (mirrors the web's reset useEffect).
    state = state.copyWith(grade: grade, clearSubject: true);
  }

  void selectSubject(String code) {
    state = state.copyWith(subject: code);
  }

  Future<void> start() async {
    if (state.grade.isEmpty || state.subject == null) {
      state = state.copyWith(missingSelection: true, clearSetupError: true);
      return;
    }

    state = state.copyWith(starting: true, missingSelection: false, clearSetupError: true);
    final repo = ref.read(diagnosticRepositoryProvider);
    final result = await repo.start(grade: state.grade, subject: state.subject!);

    result.when(
      success: (r) {
        _questionStartedAt = DateTime.now();
        state = state.copyWith(
          starting: false,
          sessionId: r.sessionId,
          questions: r.questions,
          currentIdx: 0,
          responses: const [],
          clearSelectedOption: true,
          screen: DiagnosticScreenState.quiz,
        );
      },
      failure: (msg) {
        state = state.copyWith(starting: false, setupError: msg);
      },
    );
  }

  void selectOption(int idx) {
    state = state.copyWith(selectedOption: idx);
  }

  /// Advance to the next question — records the current question's response
  /// with the REAL elapsed time (untimed for the student, but still
  /// recorded server-side for analytics, matching the web). Submits on the
  /// last question.
  Future<void> next() async {
    final q = state.currentQuestion;
    if (state.selectedOption == null || q == null) return;

    final timeTaken = DateTime.now().difference(_questionStartedAt).inSeconds;
    final isCorrect = state.selectedOption == q.correctAnswerIndex;
    final newResponse = DiagnosticResponseItem(
      questionId: q.id,
      selectedAnswerIndex: state.selectedOption!,
      isCorrect: isCorrect,
      timeTakenSeconds: timeTaken,
      topic: q.topicId,
      difficulty: q.difficulty,
      bloomLevel: q.bloomLevel,
    );

    final updated = [...state.responses, newResponse];

    if (state.currentIdx < state.questions.length - 1) {
      _questionStartedAt = DateTime.now();
      state = state.copyWith(
        responses: updated,
        currentIdx: state.currentIdx + 1,
        clearSelectedOption: true,
      );
    } else {
      state = state.copyWith(responses: updated, clearSelectedOption: true);
      await _submit(updated);
    }
  }

  Future<void> _submit(List<DiagnosticResponseItem> finalResponses) async {
    final sessionId = state.sessionId;
    if (sessionId == null || sessionId.isEmpty) {
      state = state.copyWith(quizError: 'Missing diagnostic session. Please restart.');
      return;
    }

    state = state.copyWith(submitting: true, clearQuizError: true);
    final repo = ref.read(diagnosticRepositoryProvider);
    final result = await repo.complete(sessionId: sessionId, responses: finalResponses);

    result.when(
      success: (summary) {
        state = state.copyWith(
          submitting: false,
          summary: summary,
          screen: DiagnosticScreenState.results,
        );
      },
      failure: (msg) {
        state = state.copyWith(submitting: false, quizError: msg);
      },
    );
  }

  /// Web's "Try Another Subject" — full reset back to setup, keeping the
  /// grade (subject cleared).
  void retakeAnotherSubject() {
    state = DiagnosticState(grade: state.grade);
  }
}
