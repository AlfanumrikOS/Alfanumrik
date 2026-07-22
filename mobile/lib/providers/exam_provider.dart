import 'dart:async';

import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../data/models/exam_models.dart';
import '../data/repositories/exam_repository.dart';
import 'auth_provider.dart';

final examRepositoryProvider = Provider<ExamRepository>((ref) => ExamRepository());

// ═══════════════════════════════════════════════════════════════════════════
// Catalog
// ═══════════════════════════════════════════════════════════════════════════

/// Exam families offered in the mobile catalog filter. Mirrors the server's
/// `VALID_EXAM_FAMILIES` subset that actually has seeded papers.
class ExamFamilyOption {
  final String code;
  final String label;
  final String labelHi;
  const ExamFamilyOption(this.code, this.label, this.labelHi);
}

const List<ExamFamilyOption> kExamFamilies = [
  ExamFamilyOption('cbse_board', 'CBSE Board', 'CBSE बोर्ड'),
  ExamFamilyOption('jee_main', 'JEE Main', 'JEE मेन'),
  ExamFamilyOption('jee_advanced', 'JEE Advanced', 'JEE एडवांस्ड'),
  ExamFamilyOption('neet', 'NEET', 'NEET'),
  ExamFamilyOption('olympiad_math', 'Math Olympiad', 'गणित ओलंपियाड'),
  ExamFamilyOption('olympiad_phy', 'Physics Olympiad', 'भौतिकी ओलंपियाड'),
  ExamFamilyOption('olympiad_chem', 'Chemistry Olympiad', 'रसायन ओलंपियाड'),
  ExamFamilyOption('olympiad_bio', 'Biology Olympiad', 'जीव विज्ञान ओलंपियाड'),
];

class ExamSubjectOption {
  final String code;
  final String label;
  final String labelHi;
  const ExamSubjectOption(this.code, this.label, this.labelHi);
}

/// The EXACT 16-code catalog the server's `VALID_SUBJECTS` accepts on
/// `GET /api/exams/papers` (any other code is rejected with 400
/// `invalid_subject`). Kept byte-aligned with that list deliberately.
const List<ExamSubjectOption> kExamSubjects = [
  ExamSubjectOption('math', 'Mathematics', 'गणित'),
  ExamSubjectOption('science', 'Science', 'विज्ञान'),
  ExamSubjectOption('english', 'English', 'अंग्रेज़ी'),
  ExamSubjectOption('hindi', 'Hindi', 'हिंदी'),
  ExamSubjectOption('social_studies', 'Social Studies', 'सामाजिक विज्ञान'),
  ExamSubjectOption('physics', 'Physics', 'भौतिकी'),
  ExamSubjectOption('chemistry', 'Chemistry', 'रसायन विज्ञान'),
  ExamSubjectOption('biology', 'Biology', 'जीव विज्ञान'),
  ExamSubjectOption('economics', 'Economics', 'अर्थशास्त्र'),
  ExamSubjectOption('accountancy', 'Accountancy', 'लेखाशास्त्र'),
  ExamSubjectOption('business_studies', 'Business Studies', 'व्यवसाय अध्ययन'),
  ExamSubjectOption('political_science', 'Political Science', 'राजनीति विज्ञान'),
  ExamSubjectOption('history_sr', 'History', 'इतिहास'),
  ExamSubjectOption('geography', 'Geography', 'भूगोल'),
  ExamSubjectOption('computer_science', 'Computer Science', 'कंप्यूटर विज्ञान'),
  ExamSubjectOption('coding', 'Coding', 'कोडिंग'),
];

/// P5: grades are STRINGS.
const List<String> kExamGrades = ['6', '7', '8', '9', '10', '11', '12'];

class ExamCatalogState {
  final bool loading;
  final String? error;
  final ExamPaperCatalog? catalog;

  /// Active filters (null = "All").
  final String? examFamily;
  final String? subject;
  final String? grade;

  const ExamCatalogState({
    this.loading = false,
    this.error,
    this.catalog,
    this.examFamily,
    this.subject,
    this.grade,
  });

  List<ExamPaper> get papers => catalog?.papers ?? const [];
  bool get isEmpty => !loading && error == null && catalog != null && papers.isEmpty;
  bool get flagEnabled => catalog?.flagEnabled ?? false;

  bool isLocked(ExamPaper paper) => catalog?.isLocked(paper) ?? !paper.isCbseBoard;

  ExamCatalogState copyWith({
    bool? loading,
    String? error,
    bool clearError = false,
    ExamPaperCatalog? catalog,
    String? examFamily,
    bool clearExamFamily = false,
    String? subject,
    bool clearSubject = false,
    String? grade,
    bool clearGrade = false,
  }) {
    return ExamCatalogState(
      loading: loading ?? this.loading,
      error: clearError ? null : (error ?? this.error),
      catalog: catalog ?? this.catalog,
      examFamily: clearExamFamily ? null : (examFamily ?? this.examFamily),
      subject: clearSubject ? null : (subject ?? this.subject),
      grade: clearGrade ? null : (grade ?? this.grade),
    );
  }
}

final examCatalogProvider =
    NotifierProvider<ExamCatalogNotifier, ExamCatalogState>(ExamCatalogNotifier.new);

/// Catalog state — mobile parity for `MockTestCatalog.tsx`.
///
/// The default filter is `cbse_board` + the student's own grade, because
/// that is the only family with a full 51-paper grade x subject seed and the
/// only one that is free-tier. Competitive families are one tap away.
class ExamCatalogNotifier extends Notifier<ExamCatalogState> {
  @override
  ExamCatalogState build() {
    final student = ref.read(studentProvider).valueOrNull;
    final raw = student?.grade
        .replaceAll(RegExp(r'^Grade\s*', caseSensitive: false), '')
        .trim();
    final grade = (raw != null && kExamGrades.contains(raw)) ? raw : null;
    return ExamCatalogState(examFamily: 'cbse_board', grade: grade);
  }

  Future<void> load() async {
    state = state.copyWith(loading: true, clearError: true);
    final repo = ref.read(examRepositoryProvider);
    final result = await repo.getPapers(
      examFamily: state.examFamily,
      subject: state.subject,
      // The `grade` column is only populated on cbse_board rows, so sending
      // it while browsing a competitive family would return nothing.
      grade: state.examFamily == 'cbse_board' ? state.grade : null,
      limit: 50,
    );
    result.when(
      success: (catalog) => state = state.copyWith(loading: false, catalog: catalog),
      failure: (msg) => state = state.copyWith(loading: false, error: msg),
    );
  }

  Future<void> setExamFamily(String? code) async {
    state = code == null
        ? state.copyWith(clearExamFamily: true)
        : state.copyWith(examFamily: code);
    await load();
  }

  Future<void> setSubject(String? code) async {
    state = code == null ? state.copyWith(clearSubject: true) : state.copyWith(subject: code);
    await load();
  }

  Future<void> setGrade(String? grade) async {
    state = grade == null ? state.copyWith(clearGrade: true) : state.copyWith(grade: grade);
    await load();
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// Attempt (start → answer → submit)
// ═══════════════════════════════════════════════════════════════════════════

enum ExamAttemptPhase {
  /// Nothing loaded yet.
  idle,

  /// Fetching paper metadata (and, for cbse_board, starting the attempt).
  loading,

  /// Questions ready; showing the pre-exam "Exam Structure" confirm card.
  /// The countdown has NOT started.
  structure,

  /// Countdown running, student answering.
  running,

  /// Submit in flight.
  submitting,

  /// Server returned the scorecard.
  submitted,

  /// 200 + zero questions — the `content_insufficient` contract. A calm
  /// "not ready yet" state, not an error.
  notReady,

  /// 402 — Competition plan required.
  upgradeRequired,

  /// 404 — paper is gone / inactive.
  notFound,

  /// Anything else (including "the server did not supply a duration").
  error,
}

/// One question's local answer state. Nothing here is ever scored locally.
class ExamResponseEntry {
  final int? selectedIndex;
  final bool marked;
  final bool visited;

  const ExamResponseEntry({this.selectedIndex, this.marked = false, this.visited = false});

  ExamResponseEntry copyWith({
    int? selectedIndex,
    bool clearSelectedIndex = false,
    bool? marked,
    bool? visited,
  }) {
    return ExamResponseEntry(
      selectedIndex: clearSelectedIndex ? null : (selectedIndex ?? this.selectedIndex),
      marked: marked ?? this.marked,
      visited: visited ?? this.visited,
    );
  }
}

enum ExamQuestionStatus { unattempted, attempted, marked, skipped }

ExamQuestionStatus deriveExamStatus(ExamResponseEntry r) {
  if (r.marked) return ExamQuestionStatus.marked;
  if (r.selectedIndex != null) return ExamQuestionStatus.attempted;
  if (r.visited) return ExamQuestionStatus.skipped;
  return ExamQuestionStatus.unattempted;
}

class ExamAttemptState {
  final ExamAttemptPhase phase;
  final ExamPaper? paper;
  final List<ExamAttemptQuestion> questions;

  /// Present only for the cbse_board dynamic flow — forwarded on submit so
  /// the server scores against its stored snapshot.
  final String? attemptId;

  final List<ExamResponseEntry> responses;
  final int cursor;

  /// Seeded from `paper.durationMinutes * 60` — the SERVER's number. There
  /// is no mobile fallback duration.
  final int totalSeconds;
  final int remainingSeconds;

  final ExamSubmitResult? submitResult;
  final String? errorMessage;
  final String? upgradeUrl;

  const ExamAttemptState({
    this.phase = ExamAttemptPhase.idle,
    this.paper,
    this.questions = const [],
    this.attemptId,
    this.responses = const [],
    this.cursor = 0,
    this.totalSeconds = 0,
    this.remainingSeconds = 0,
    this.submitResult,
    this.errorMessage,
    this.upgradeUrl,
  });

  ExamAttemptQuestion? get currentQuestion =>
      cursor >= 0 && cursor < questions.length ? questions[cursor] : null;

  ExamResponseEntry get currentResponse => cursor >= 0 && cursor < responses.length
      ? responses[cursor]
      : const ExamResponseEntry();

  int get answeredCount => responses.where((r) => r.selectedIndex != null).length;

  List<ExamSectionSummary> get sections => ExamSectionSummary.fromQuestions(questions);

  /// Total marks AVAILABLE in this paper as assembled (structure, not score).
  int get availableMarks => questions.fold(0, (sum, q) => sum + q.marks);

  /// Wall-clock seconds consumed so far. Reported to the server as
  /// `time_taken_seconds`; it is NOT used to compute anything scored.
  int get elapsedSeconds {
    final e = totalSeconds - remainingSeconds;
    return e < 0 ? 0 : e;
  }

  ExamAttemptState copyWith({
    ExamAttemptPhase? phase,
    ExamPaper? paper,
    List<ExamAttemptQuestion>? questions,
    String? attemptId,
    bool clearAttemptId = false,
    List<ExamResponseEntry>? responses,
    int? cursor,
    int? totalSeconds,
    int? remainingSeconds,
    ExamSubmitResult? submitResult,
    String? errorMessage,
    bool clearError = false,
    String? upgradeUrl,
  }) {
    return ExamAttemptState(
      phase: phase ?? this.phase,
      paper: paper ?? this.paper,
      questions: questions ?? this.questions,
      attemptId: clearAttemptId ? null : (attemptId ?? this.attemptId),
      responses: responses ?? this.responses,
      cursor: cursor ?? this.cursor,
      totalSeconds: totalSeconds ?? this.totalSeconds,
      remainingSeconds: remainingSeconds ?? this.remainingSeconds,
      submitResult: submitResult ?? this.submitResult,
      errorMessage: clearError ? null : (errorMessage ?? this.errorMessage),
      upgradeUrl: upgradeUrl ?? this.upgradeUrl,
    );
  }
}

final examAttemptProvider =
    NotifierProvider<ExamAttemptNotifier, ExamAttemptState>(ExamAttemptNotifier.new);

/// Mock-exam attempt state machine — mobile parity for the web's
/// `useMockTestState` + `/exams/mock/[paperId]/page.tsx`.
///
/// ─────────────────────────────────────────────────────────────────────────
/// P1 — this notifier NEVER computes a score. [submit] posts raw
/// `response_index` values and stores the server's [ExamSubmitResult]
/// verbatim in [ExamAttemptState.submitResult]. There is no field, getter or
/// branch here that derives correctness, marks, percentage or XP.
/// [ExamAttemptState.answeredCount] counts what the STUDENT touched (used
/// only for the "12 of 39 answered" affordance) and never appears on the
/// results screen.
///
/// Duration — [totalSeconds] comes from `paper.durationMinutes` (the
/// server's `exam_papers.duration_minutes`). If the server does not supply a
/// positive duration the attempt refuses to start ([ExamAttemptPhase.error])
/// rather than substituting a client-side default. `exam-engine.ts` timing
/// math is NOT reimplemented here — the clock is a plain countdown of the
/// server's number.
///
/// P3 — the countdown is presentation-only. On expiry [tick] calls the SAME
/// [submit] path with whatever the student has answered. Nothing is
/// invalidated, flagged or zeroed client-side.
/// ─────────────────────────────────────────────────────────────────────────
class ExamAttemptNotifier extends Notifier<ExamAttemptState> {
  Timer? _timer;

  @override
  ExamAttemptState build() {
    ref.onDispose(_cancelTimer);
    return const ExamAttemptState();
  }

  void _cancelTimer() {
    _timer?.cancel();
    _timer = null;
  }

  /// Load a paper and, for `cbse_board`, immediately start a dynamically
  /// assembled attempt. Ends in [ExamAttemptPhase.structure] on success.
  Future<void> load(String paperId) async {
    _cancelTimer();
    state = const ExamAttemptState(phase: ExamAttemptPhase.loading);

    final repo = ref.read(examRepositoryProvider);
    final detail = await repo.getPaperDetail(paperId);

    switch (detail) {
      case ExamPaperDetailUpgradeRequired(:final upgradeUrl):
        state = state.copyWith(
          phase: ExamAttemptPhase.upgradeRequired,
          upgradeUrl: upgradeUrl,
        );
        return;
      case ExamPaperDetailNotFound():
        state = state.copyWith(phase: ExamAttemptPhase.notFound);
        return;
      case ExamPaperDetailFailure(:final message):
        state = state.copyWith(phase: ExamAttemptPhase.error, errorMessage: message);
        return;
      case ExamPaperDetailSuccess(:final paper, :final questions):
        // The countdown is only legitimate if the SERVER told us how long
        // the exam is. Never fall back to a hardcoded duration.
        if (!paper.hasServerDuration) {
          state = state.copyWith(
            phase: ExamAttemptPhase.error,
            paper: paper,
            errorMessage: 'exam_duration_unavailable',
          );
          return;
        }
        if (paper.isCbseBoard) {
          await _startDynamic(paper);
        } else {
          _prepare(paper: paper, questions: questions, attemptId: null);
        }
    }
  }

  Future<void> _startDynamic(ExamPaper paper) async {
    final repo = ref.read(examRepositoryProvider);
    final outcome = await repo.startAttempt(paper.id);

    switch (outcome) {
      case ExamStartSuccess(:final result):
        _prepare(paper: paper, questions: result.questions, attemptId: result.attemptId);
      case ExamStartContentInsufficient():
        state = state.copyWith(phase: ExamAttemptPhase.notReady, paper: paper);
      case ExamStartUpgradeRequired(:final upgradeUrl):
        state = state.copyWith(
          phase: ExamAttemptPhase.upgradeRequired,
          paper: paper,
          upgradeUrl: upgradeUrl,
        );
      case ExamStartNotFound():
        state = state.copyWith(phase: ExamAttemptPhase.notFound, paper: paper);
      case ExamStartFailure(:final message):
        state = state.copyWith(
          phase: ExamAttemptPhase.error,
          paper: paper,
          errorMessage: message,
        );
    }
  }

  void _prepare({
    required ExamPaper paper,
    required List<ExamAttemptQuestion> questions,
    required String? attemptId,
  }) {
    if (questions.isEmpty) {
      // A static paper with no linked rows reads exactly like the dynamic
      // content-insufficient case to the student.
      state = state.copyWith(phase: ExamAttemptPhase.notReady, paper: paper);
      return;
    }
    final seconds = paper.durationSeconds;
    state = ExamAttemptState(
      phase: ExamAttemptPhase.structure,
      paper: paper,
      questions: questions,
      attemptId: attemptId,
      responses: List<ExamResponseEntry>.filled(
        questions.length,
        const ExamResponseEntry(),
        growable: false,
      ),
      cursor: 0,
      totalSeconds: seconds,
      remainingSeconds: seconds,
    );
  }

  /// Dismiss the structure card and start the clock.
  void beginExam() {
    if (state.phase != ExamAttemptPhase.structure) return;
    final responses = [...state.responses];
    if (responses.isNotEmpty) {
      responses[0] = responses[0].copyWith(visited: true);
    }
    state = state.copyWith(phase: ExamAttemptPhase.running, responses: responses);
    _cancelTimer();
    _timer = Timer.periodic(const Duration(seconds: 1), (_) => tick());
  }

  /// One second of the countdown. Public so tests can drive the clock
  /// deterministically without waiting on a real [Timer].
  void tick() {
    if (state.phase != ExamAttemptPhase.running) return;
    final next = state.remainingSeconds - 1;
    if (next <= 0) {
      _cancelTimer();
      state = state.copyWith(remainingSeconds: 0);
      // Presentation-only expiry: submit whatever exists, normal path.
      unawaited(submit());
      return;
    }
    state = state.copyWith(remainingSeconds: next);
  }

  void navigateTo(int index) {
    if (state.phase != ExamAttemptPhase.running) return;
    if (index < 0 || index >= state.questions.length) return;
    final responses = [...state.responses];
    responses[index] = responses[index].copyWith(visited: true);
    state = state.copyWith(cursor: index, responses: responses);
  }

  void selectOption(int optionIndex) {
    if (state.phase != ExamAttemptPhase.running) return;
    final i = state.cursor;
    if (i < 0 || i >= state.responses.length) return;
    final responses = [...state.responses];
    responses[i] = responses[i].copyWith(selectedIndex: optionIndex, visited: true);
    state = state.copyWith(responses: responses);
  }

  /// Clear the current answer (the student may leave a question blank —
  /// unattempted questions score 0, per the server).
  void clearAnswer() {
    if (state.phase != ExamAttemptPhase.running) return;
    final i = state.cursor;
    if (i < 0 || i >= state.responses.length) return;
    final responses = [...state.responses];
    responses[i] = responses[i].copyWith(clearSelectedIndex: true, visited: true);
    state = state.copyWith(responses: responses);
  }

  void toggleMarked() {
    if (state.phase != ExamAttemptPhase.running) return;
    final i = state.cursor;
    if (i < 0 || i >= state.responses.length) return;
    final responses = [...state.responses];
    responses[i] = responses[i].copyWith(marked: !responses[i].marked, visited: true);
    state = state.copyWith(responses: responses);
  }

  void next() => navigateTo(state.cursor + 1);

  void previous() => navigateTo(state.cursor - 1);

  /// Submit the attempt. Safe to call from the timer expiry and the button —
  /// re-entrant calls while already submitting/submitted are ignored.
  Future<void> submit() async {
    if (state.phase == ExamAttemptPhase.submitting ||
        state.phase == ExamAttemptPhase.submitted) {
      return;
    }
    final paper = state.paper;
    if (paper == null || state.questions.isEmpty) return;

    _cancelTimer();
    final elapsed = state.elapsedSeconds;
    state = state.copyWith(phase: ExamAttemptPhase.submitting, clearError: true);

    final responses = <ExamResponseItem>[
      for (var i = 0; i < state.questions.length; i++)
        ExamResponseItem(
          questionId: state.questions[i].questionId,
          responseIndex:
              i < state.responses.length ? state.responses[i].selectedIndex : null,
          markedForReview: i < state.responses.length && state.responses[i].marked,
        ),
    ];

    final repo = ref.read(examRepositoryProvider);
    final outcome = await repo.submitAttempt(
      paperId: paper.id,
      responses: responses,
      timeTakenSeconds: elapsed,
      attemptId: state.attemptId,
    );

    switch (outcome) {
      case ExamSubmitSuccess(:final result):
        // P1: stored EXACTLY as returned. No post-processing.
        state = state.copyWith(
          phase: ExamAttemptPhase.submitted,
          submitResult: result,
          remainingSeconds: state.remainingSeconds,
        );
      case ExamSubmitUpgradeRequired(:final upgradeUrl):
        state = state.copyWith(
          phase: ExamAttemptPhase.upgradeRequired,
          upgradeUrl: upgradeUrl,
        );
      case ExamSubmitFailure(:final message):
        // Stay recoverable: return to `running` so the student can retry
        // without losing answers. The clock does NOT resume (it already
        // stopped) — the elapsed value sent on retry is unchanged.
        state = state.copyWith(
          phase: ExamAttemptPhase.running,
          errorMessage: message,
        );
    }
  }

  /// Retry after a failed submit — same path, same payload.
  Future<void> retrySubmit() async {
    if (state.phase != ExamAttemptPhase.running) return;
    state = state.copyWith(clearError: true);
    await submit();
  }

  void reset() {
    _cancelTimer();
    state = const ExamAttemptState();
  }
}
