import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../core/constants/diagnostic_copy.dart';
import '../data/models/diagnostic_models.dart';
import '../data/repositories/diagnostic_repository.dart';
import 'auth_provider.dart';

final diagnosticRepositoryProvider =
    Provider<DiagnosticRepository>((ref) => DiagnosticRepository());

/// Screen states.
///
/// `setup` / `quiz` / `results` mirror the web `DiagnosticScreen` union.
/// `insufficient` and `streamRequired` are the two NON-ERROR HTTP 200 states
/// `/api/diagnostic/start` gained on 2026-07-29 (both return
/// `diagnostic: null`). Without them a 200 with no questions rendered either a
/// misleading "Connection error" or an empty quiz — the app must never turn a
/// deliberate, honest server stop into a crash, a spinner, or a dead end.
enum DiagnosticScreenState { setup, quiz, results, insufficient, streamRequired }

/// P5: grades are STRINGS "6".."12", never integers.
///
/// Mirrors `VALID_DIAGNOSTIC_GRADES` in `packages/lib/src/diagnostic/blueprint.ts`,
/// which was widened from 6-10 to 6-12 on 2026-07-29. Grades 11-12 are no
/// longer hard-rejected with a 400: the route resolves their subjects through
/// stream-aware governance and returns the `streamRequired` state only when it
/// genuinely cannot unlock a single subject.
const List<String> kDiagnosticGrades = ['6', '7', '8', '9', '10', '11', '12'];

/// The three stream codes the route sends back on the `streamRequired` state.
/// Kept only as a fallback if the payload omits `streamOptions`; the API is
/// the source of truth. Not translated (CBSE stream names stay in English).
const List<String> kDiagnosticStreams = ['science', 'commerce', 'humanities'];

class DiagnosticState {
  final DiagnosticScreenState screen;
  final String grade;

  /// The grade on the student's profile, when it is a valid diagnostic grade.
  /// `/api/diagnostic/start` §4 G3 treats this as AUTHORITATIVE and silently
  /// overrides a mismatched client pick, so the UI tells the student when the
  /// two disagree instead of implying the picker won.
  final String profileGrade;
  final String? subject;
  final bool missingSelection;

  /// Bilingual (P7). Holds the resolved copy for a failed `/start` call.
  final DiagnosticBilingual? setupError;
  final bool starting;

  final String? sessionId;
  final List<DiagnosticQuestion> questions;
  final int currentIdx;
  final int? selectedOption;
  final List<DiagnosticResponseItem> responses;
  final bool submitting;
  final DiagnosticBilingual? quizError;

  /// §7.1 short-form banner — set when the server could only assemble 10-14
  /// items. The check still counts; the student is told why it is shorter.
  final DiagnosticBilingual? shortFormMessage;

  /// §7.5c setup reassurance, sent by the server on every successful start.
  final DiagnosticBilingual? setupReassurance;

  /// Populated when `screen == insufficient`.
  final DiagnosticInsufficientContent? insufficient;

  /// Populated when `screen == streamRequired`.
  final DiagnosticStreamRequired? streamRequired;

  final DiagnosticSummary? summary;

  const DiagnosticState({
    this.screen = DiagnosticScreenState.setup,
    this.grade = '',
    this.profileGrade = '',
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
    this.shortFormMessage,
    this.setupReassurance,
    this.insufficient,
    this.streamRequired,
    this.summary,
  });

  DiagnosticQuestion? get currentQuestion =>
      currentIdx < questions.length ? questions[currentIdx] : null;

  DiagnosticState copyWith({
    DiagnosticScreenState? screen,
    String? grade,
    String? profileGrade,
    String? subject,
    bool clearSubject = false,
    bool? missingSelection,
    DiagnosticBilingual? setupError,
    bool clearSetupError = false,
    bool? starting,
    String? sessionId,
    List<DiagnosticQuestion>? questions,
    int? currentIdx,
    int? selectedOption,
    bool clearSelectedOption = false,
    List<DiagnosticResponseItem>? responses,
    bool? submitting,
    DiagnosticBilingual? quizError,
    bool clearQuizError = false,
    DiagnosticBilingual? shortFormMessage,
    bool clearShortFormMessage = false,
    DiagnosticBilingual? setupReassurance,
    DiagnosticInsufficientContent? insufficient,
    bool clearInsufficient = false,
    DiagnosticStreamRequired? streamRequired,
    bool clearStreamRequired = false,
    DiagnosticSummary? summary,
  }) {
    return DiagnosticState(
      screen: screen ?? this.screen,
      grade: grade ?? this.grade,
      profileGrade: profileGrade ?? this.profileGrade,
      subject: clearSubject ? null : (subject ?? this.subject),
      missingSelection: missingSelection ?? this.missingSelection,
      setupError: clearSetupError ? null : (setupError ?? this.setupError),
      starting: starting ?? this.starting,
      sessionId: sessionId ?? this.sessionId,
      questions: questions ?? this.questions,
      currentIdx: currentIdx ?? this.currentIdx,
      selectedOption:
          clearSelectedOption ? null : (selectedOption ?? this.selectedOption),
      responses: responses ?? this.responses,
      submitting: submitting ?? this.submitting,
      quizError: clearQuizError ? null : (quizError ?? this.quizError),
      shortFormMessage: clearShortFormMessage
          ? null
          : (shortFormMessage ?? this.shortFormMessage),
      setupReassurance: setupReassurance ?? this.setupReassurance,
      insufficient: clearInsufficient ? null : (insufficient ?? this.insufficient),
      streamRequired:
          clearStreamRequired ? null : (streamRequired ?? this.streamRequired),
      summary: summary ?? this.summary,
    );
  }
}

final diagnosticProvider =
    NotifierProvider<DiagnosticNotifier, DiagnosticState>(DiagnosticNotifier.new);

/// Diagnostic state machine — mobile parity for the setup → quiz-loop →
/// complete flow, plus the two content-honesty stops.
///
/// P3: no anti-cheat here (the diagnostic is untimed and XP-neutral). The
/// server's `placement_confidence: 'low'` speed-run signal is a placement
/// validity flag, not a rejection.
/// P5: grade is a STRING throughout.
/// P7: every user-facing string is a [DiagnosticBilingual]; the SERVER supplies
///     the copy for the new states and [DiagnosticCopy] is the offline fallback.
/// P13: no student identifier is ever put into state, logs, or analytics here.
///
/// Subjects are NOT hardcoded. They come from `subjectsProvider`
/// (`GET /api/student/subjects` → the `get_available_subjects` governance RPC),
/// the same source the web diagnostic page uses, so grade × stream × plan
/// gating and `isLocked` are decided server-side.
class DiagnosticNotifier extends Notifier<DiagnosticState> {
  DateTime _questionStartedAt = DateTime.now();

  @override
  DiagnosticState build() {
    // Pre-fill grade from the student profile when it's a valid diagnostic
    // grade. NOTE: `/api/diagnostic/start` §4 G3 treats the PROFILE grade as
    // authoritative and silently overrides a mismatched client pick, so this
    // pre-fill is what keeps the picker honest about what will actually run.
    final student = ref.read(studentProvider).valueOrNull;
    final raw = student?.grade
        .replaceAll(RegExp(r'^Grade\s*', caseSensitive: false), '')
        .trim();
    final grade = (raw != null && kDiagnosticGrades.contains(raw)) ? raw : '';
    return DiagnosticState(grade: grade, profileGrade: grade);
  }

  void selectGrade(String grade) {
    // Reset subject when grade changes (mirrors the web's reset useEffect).
    state = state.copyWith(grade: grade, clearSubject: true);
  }

  void selectSubject(String code) {
    state = state.copyWith(subject: code, missingSelection: false);
  }

  Future<void> start() async {
    if (state.grade.isEmpty || state.subject == null) {
      state = state.copyWith(missingSelection: true, clearSetupError: true);
      return;
    }

    state = state.copyWith(
      starting: true,
      missingSelection: false,
      clearSetupError: true,
      clearInsufficient: true,
      clearStreamRequired: true,
      clearShortFormMessage: true,
    );

    final repo = ref.read(diagnosticRepositoryProvider);
    final result = await repo.start(grade: state.grade, subject: state.subject!);

    result.when(
      success: (r) {
        // Exhaustive over the sealed union — a new server state becomes a
        // compile error here, not a blank screen on a student's phone.
        switch (r) {
          case final DiagnosticFormReady ready:
            _questionStartedAt = DateTime.now();
            state = state.copyWith(
              starting: false,
              sessionId: ready.sessionId,
              questions: ready.questions,
              currentIdx: 0,
              responses: const [],
              clearSelectedOption: true,
              shortFormMessage: ready.shortForm ? ready.shortFormMessage : null,
              setupReassurance: ready.setupReassurance,
              screen: DiagnosticScreenState.quiz,
            );
          case final DiagnosticInsufficientContent stop:
            state = state.copyWith(
              starting: false,
              insufficient: stop,
              screen: DiagnosticScreenState.insufficient,
            );
          case final DiagnosticStreamRequired stop:
            state = state.copyWith(
              starting: false,
              streamRequired: stop,
              screen: DiagnosticScreenState.streamRequired,
            );
        }
      },
      failure: (key) {
        state = state.copyWith(
          starting: false,
          setupError: DiagnosticCopy.resolveError(key),
        );
      },
    );
  }

  void selectOption(int idx) {
    state = state.copyWith(selectedOption: idx);
  }

  /// Advance to the next question — records the current question's response
  /// with the REAL elapsed time. Submits on the last question.
  ///
  /// `isCorrect` is computed locally for the wire payload only; the server
  /// re-derives correctness from `question_bank.correct_answer_index` (§C1)
  /// and ignores what we send. The displayed score comes from the server
  /// response, never from this value (P1).
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
      state = state.copyWith(
        quizError: DiagnosticCopy.errorFor('MISSING_SESSION_ID'),
      );
      return;
    }

    state = state.copyWith(submitting: true, clearQuizError: true);
    final repo = ref.read(diagnosticRepositoryProvider);
    final result =
        await repo.complete(sessionId: sessionId, responses: finalResponses);

    result.when(
      success: (summary) {
        state = state.copyWith(
          submitting: false,
          summary: summary,
          screen: DiagnosticScreenState.results,
        );
      },
      failure: (key) {
        state = state.copyWith(
          submitting: false,
          quizError: DiagnosticCopy.resolveError(key),
        );
      },
    );
  }

  /// "Try Another Subject" / "Pick a different subject" — full reset back to
  /// setup, keeping the grade (subject cleared). Also clears the two stop
  /// states so the setup screen is never rendered behind stale copy.
  void retakeAnotherSubject() {
    state = DiagnosticState(grade: state.grade, profileGrade: state.profileGrade);
  }

  /// An `other_subject` fallback CTA: switch to the suggested subject and
  /// immediately re-run `/start` for it, so the tap does what it says.
  Future<void> switchSubjectAndRestart(String code) async {
    state = DiagnosticState(
      grade: state.grade,
      profileGrade: state.profileGrade,
      subject: code,
    );
    await start();
  }
}
