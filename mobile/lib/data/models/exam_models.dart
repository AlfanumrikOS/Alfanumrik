// Data models for the Exams / Mock Test surface — mobile parity for
// `apps/host/src/app/(student)/exams/mock/**` and the shared web types in
// `packages/ui/src/exams/mock-test-types.ts`.
//
// These model the CURRENT (post Phase 2.2 rebuild) API contract:
//
//   GET  /api/exams/papers                  → { papers[], flag_enabled, total }
//   GET  /api/exams/papers/{id}             → { paper, questions[], served_count, viewer_role }
//   POST /api/exams/papers/{id}/start       → { attempt_id, questions[] }   (cbse_board only)
//   POST /api/exams/papers/{id}/submit      → { attempt_id, paper_id, summary, review[] }
//
// ─────────────────────────────────────────────────────────────────────────
// P1 INVARIANT — the device NEVER computes a score.
//
// [ExamSubmitSummary] is a pure decode of the server's `summary` object.
// There is deliberately NO constructor, factory, or getter on it that
// derives `scorePercent`, `rawScore`, `correctCount` or `xpEarned` from
// anything else. `submit_mock_test_attempt` scores the attempt against its
// stored `question_snapshot` (per-question marks vary by CBSE section) and
// the app renders those numbers verbatim — exactly the precedent set by
// `quiz_repository.dart` ("mobile MUST NOT compute is_correct,
// score_percent, or xp_earned locally").
//
// The ONLY arithmetic in this file is [ExamSectionSummary.fromQuestions],
// which sums the *paper structure* (how many questions and how many marks
// are AVAILABLE per section) for the pre-exam "Exam Structure" card. It
// runs before a single answer exists and is never used post-submit.
//
// P2: no XP constant appears anywhere in this file — `xp_earned` is read
// off the server response only.
// ─────────────────────────────────────────────────────────────────────────
library;

import 'dart:convert';

import 'package:equatable/equatable.dart';

// ── Catalog ───────────────────────────────────────────────────────────────

/// One row of `GET /api/exams/papers` (and the `paper` object returned by
/// `GET /api/exams/papers/{id}`, which is a `select('*')` superset).
///
/// [durationMinutes] is the SERVER's authoritative exam duration
/// (`exam_papers.duration_minutes`). The countdown timer is seeded from this
/// and from nothing else — mobile has no duration constant and does not
/// reimplement `packages/lib/src/exam-engine.ts`.
class ExamPaper extends Equatable {
  final String id;
  final String paperCode;
  final String examFamily;
  final String? examSession;
  final String? paperPattern;
  final int examYear;
  final int? examMonth;
  final String? shift;

  /// P5: grades are STRINGS ('6'..'12'). Only `cbse_board` rows populate it.
  final String? grade;

  final List<String> subjectScope;
  final int totalQuestions;
  final int totalMarks;

  /// Server-supplied exam duration. Never defaulted to a hardcoded exam
  /// length — a missing/zero value is surfaced as "duration unavailable"
  /// rather than silently substituted (see [hasServerDuration]).
  final int durationMinutes;

  final String? markingScheme;
  final String? sourceUrl;
  final String? sourceAttribution;

  const ExamPaper({
    required this.id,
    required this.paperCode,
    required this.examFamily,
    this.examSession,
    this.paperPattern,
    this.examYear = 0,
    this.examMonth,
    this.shift,
    this.grade,
    this.subjectScope = const [],
    this.totalQuestions = 0,
    this.totalMarks = 0,
    this.durationMinutes = 0,
    this.markingScheme,
    this.sourceUrl,
    this.sourceAttribution,
  });

  factory ExamPaper.fromJson(Map<String, dynamic> json) {
    return ExamPaper(
      id: json['id'] as String? ?? '',
      paperCode: json['paper_code'] as String? ?? '',
      examFamily: json['exam_family'] as String? ?? '',
      examSession: json['exam_session'] as String?,
      paperPattern: json['paper_pattern'] as String?,
      examYear: (json['exam_year'] as num?)?.toInt() ?? 0,
      examMonth: (json['exam_month'] as num?)?.toInt(),
      shift: json['shift'] as String?,
      // P5: coerce to String even if a future server build emits an int.
      grade: json['grade']?.toString(),
      subjectScope: json['subject_scope'] is List
          ? (json['subject_scope'] as List).map((e) => e.toString()).toList(growable: false)
          : const [],
      totalQuestions: (json['total_questions'] as num?)?.toInt() ?? 0,
      totalMarks: (json['total_marks'] as num?)?.toInt() ?? 0,
      durationMinutes: (json['duration_minutes'] as num?)?.toInt() ?? 0,
      markingScheme: json['marking_scheme']?.toString(),
      sourceUrl: json['source_url'] as String?,
      sourceAttribution: json['source_attribution'] as String?,
    );
  }

  bool get isCbseBoard => examFamily == 'cbse_board';

  /// True only when the server actually supplied a usable duration. The
  /// runner refuses to start a timed exam without it rather than inventing
  /// a client-side default.
  bool get hasServerDuration => durationMinutes > 0;

  /// Seconds on the countdown clock, straight from the server's minutes.
  int get durationSeconds => durationMinutes * 60;

  String? get primarySubject => subjectScope.isEmpty ? null : subjectScope.first;

  @override
  List<Object?> get props => [id, paperCode, examFamily, grade, durationMinutes];
}

/// Full `GET /api/exams/papers` envelope.
///
/// [flagEnabled] mirrors `ff_competitive_exams_v1`. The catalog always
/// returns every matching paper; non-`cbse_board` rows render with a locked
/// badge when this is false (the detail/submit routes are the real 402
/// boundary — this is display only).
class ExamPaperCatalog extends Equatable {
  final List<ExamPaper> papers;
  final bool flagEnabled;
  final int total;

  const ExamPaperCatalog({
    this.papers = const [],
    this.flagEnabled = false,
    this.total = 0,
  });

  factory ExamPaperCatalog.fromJson(Map<String, dynamic> json) {
    final raw = json['papers'];
    final papers = raw is List
        ? raw
            .whereType<Map>()
            .map((e) => ExamPaper.fromJson(Map<String, dynamic>.from(e)))
            .toList(growable: false)
        : const <ExamPaper>[];
    return ExamPaperCatalog(
      papers: papers,
      flagEnabled: json['flag_enabled'] == true,
      total: (json['total'] as num?)?.toInt() ?? papers.length,
    );
  }

  bool isLocked(ExamPaper paper) => !paper.isCbseBoard && !flagEnabled;

  @override
  List<Object?> get props => [papers, flagEnabled, total];
}

// ── Attempt questions ─────────────────────────────────────────────────────

/// A single question in a running attempt.
///
/// Decodes BOTH shapes the backend can hand us:
///  * `StartAttemptQuestion` from `POST .../start` (cbse_board dynamic) —
///    `{ question_id, section, marks, order, text, text_hi, options }`
///  * the slim student question row from `GET .../{id}` (static JEE / NEET /
///    Olympiad) — `{ id, question_text, options, marks_correct,
///    question_number }`, which carries no `section`.
///
/// [correctAnswerIndex] is intentionally absent: neither shape exposes it to
/// a student, and mobile has no use for it before submit (P1/P3).
class ExamAttemptQuestion extends Equatable {
  final String questionId;

  /// CBSE section label ('A'..'E'). Null for static papers.
  final String? section;

  /// Marks this question is worth, per the server's snapshot. Displayed to
  /// the student; never summed into a score by the client.
  final int marks;

  final int order;
  final String text;
  final String? textHi;
  final List<String> options;

  const ExamAttemptQuestion({
    required this.questionId,
    this.section,
    this.marks = 0,
    this.order = 0,
    required this.text,
    this.textHi,
    this.options = const [],
  });

  /// `POST /api/exams/papers/{id}/start` question shape.
  factory ExamAttemptQuestion.fromStartJson(Map<String, dynamic> json) {
    return ExamAttemptQuestion(
      questionId: json['question_id'] as String? ?? '',
      section: (json['section'] as String?)?.trim().isEmpty ?? true
          ? null
          : (json['section'] as String).trim(),
      marks: (json['marks'] as num?)?.toInt() ?? 0,
      order: (json['order'] as num?)?.toInt() ?? 0,
      text: json['text'] as String? ?? '',
      textHi: json['text_hi'] as String?,
      options: parseOptions(json['options']),
    );
  }

  /// Static-paper question row from `GET /api/exams/papers/{id}`.
  /// [fallbackOrder] is the array position, used when `question_number` is
  /// null or non-numeric (the column is text on the server).
  factory ExamAttemptQuestion.fromStaticJson(
    Map<String, dynamic> json, {
    required int fallbackOrder,
  }) {
    final rawNumber = json['question_number'];
    final parsedOrder = rawNumber is num
        ? rawNumber.toInt()
        : int.tryParse(rawNumber?.toString() ?? '') ?? fallbackOrder;
    return ExamAttemptQuestion(
      questionId: json['id'] as String? ?? '',
      section: null,
      marks: (json['marks_correct'] as num?)?.toInt() ?? 0,
      order: parsedOrder,
      text: json['question_text'] as String? ?? '',
      textHi: json['question_hi'] as String?,
      options: parseOptions(json['options']),
    );
  }

  /// `options` arrives as a native JSON array normally, or as a JSON-encoded
  /// string for some legacy `question_bank` rows — same defensive parse the
  /// PYQ model already uses.
  static List<String> parseOptions(dynamic raw) {
    if (raw is List) return raw.map((e) => e.toString()).toList(growable: false);
    if (raw is String) {
      try {
        final decoded = jsonDecode(raw);
        if (decoded is List) {
          return decoded.map((e) => e.toString()).toList(growable: false);
        }
      } catch (_) {
        // fall through
      }
    }
    return const [];
  }

  /// P7: prefer Hindi when the locale is Hindi AND the server supplied it.
  /// `text_hi` is explicitly NOT guaranteed by the contract — render
  /// defensively.
  String displayText(bool isHi) =>
      (isHi && textHi != null && textHi!.trim().isNotEmpty) ? textHi! : text;

  @override
  List<Object?> get props => [questionId, section, marks, order, text];
}

/// Read-only per-section summary of the PAPER STRUCTURE, used by the
/// pre-exam "Exam Structure" card (mirrors the web's `buildSectionSummary`).
///
/// [marks] is the marks AVAILABLE in the section, not marks scored. This is
/// computed before the attempt starts and is never used to display a result.
class ExamSectionSummary extends Equatable {
  final String key;
  final int count;
  final int marks;

  const ExamSectionSummary({
    required this.key,
    required this.count,
    required this.marks,
  });

  static List<ExamSectionSummary> fromQuestions(List<ExamAttemptQuestion> questions) {
    final counts = <String, int>{};
    final marks = <String, int>{};
    for (final q in questions) {
      final key = q.section ?? '';
      counts[key] = (counts[key] ?? 0) + 1;
      marks[key] = (marks[key] ?? 0) + q.marks;
    }
    final keys = counts.keys.toList()..sort();
    return keys
        .map((k) => ExamSectionSummary(key: k, count: counts[k]!, marks: marks[k]!))
        .toList(growable: false);
  }

  @override
  List<Object?> get props => [key, count, marks];
}

// ── Start ─────────────────────────────────────────────────────────────────

/// Result of `POST /api/exams/papers/{id}/start`.
///
/// The route's all-or-nothing content contract: when the `question_bank`
/// pool cannot fill every CBSE section, it returns HTTP 200 with a truthy
/// (non-persisted) `attempt_id` and an EMPTY `questions` array. That is the
/// `content_insufficient` case — a calm "not ready yet" state, NOT an error.
/// Assessment sign-off (Phase 2.2) expects 5 of the 51 CBSE papers to hit
/// this legitimately until more board-tagged content is authored.
class ExamStartResult extends Equatable {
  final String attemptId;
  final List<ExamAttemptQuestion> questions;

  const ExamStartResult({required this.attemptId, this.questions = const []});

  factory ExamStartResult.fromJson(Map<String, dynamic> json) {
    final raw = json['questions'];
    final questions = raw is List
        ? (raw
            .whereType<Map>()
            .map((e) => ExamAttemptQuestion.fromStartJson(Map<String, dynamic>.from(e)))
            .toList()
          ..sort((a, b) => a.order.compareTo(b.order)))
        : <ExamAttemptQuestion>[];
    return ExamStartResult(
      attemptId: json['attempt_id'] as String? ?? '',
      questions: List.unmodifiable(questions),
    );
  }

  /// True when the server could assemble no paper — render the "not ready
  /// yet" card instead of the runner.
  bool get contentInsufficient => questions.isEmpty;

  @override
  List<Object?> get props => [attemptId, questions];
}

// ── Submit ────────────────────────────────────────────────────────────────

/// One entry of the submit payload's `responses` array.
///
/// The server validates `response_index` as null or 0..3 and requires
/// `time_taken_seconds` (when present) to be a non-negative integer.
class ExamResponseItem extends Equatable {
  final String questionId;
  final int? responseIndex;
  final int? timeTakenSeconds;
  final bool markedForReview;

  const ExamResponseItem({
    required this.questionId,
    this.responseIndex,
    this.timeTakenSeconds,
    this.markedForReview = false,
  });

  Map<String, dynamic> toJson() => {
        'question_id': questionId,
        'response_index': responseIndex,
        if (timeTakenSeconds != null) 'time_taken_seconds': timeTakenSeconds,
        'marked_for_review': markedForReview,
      };

  @override
  List<Object?> get props => [questionId, responseIndex, timeTakenSeconds, markedForReview];
}

/// The server-computed scorecard. EVERY field here is a verbatim decode of
/// `submit_mock_test_attempt`'s output (P1) — nothing is derived locally.
class ExamSubmitSummary extends Equatable {
  final int totalQuestions;
  final int attemptedCount;
  final int correctCount;
  final int wrongCount;
  final int skippedCount;
  final int rawScore;
  final int maxScore;
  final int scorePercent;
  final int xpEarned;
  final int timeTakenSeconds;
  final String submittedAt;

  const ExamSubmitSummary({
    this.totalQuestions = 0,
    this.attemptedCount = 0,
    this.correctCount = 0,
    this.wrongCount = 0,
    this.skippedCount = 0,
    this.rawScore = 0,
    this.maxScore = 0,
    this.scorePercent = 0,
    this.xpEarned = 0,
    this.timeTakenSeconds = 0,
    this.submittedAt = '',
  });

  factory ExamSubmitSummary.fromJson(Map<String, dynamic> json) {
    return ExamSubmitSummary(
      totalQuestions: (json['total_questions'] as num?)?.toInt() ?? 0,
      attemptedCount: (json['attempted_count'] as num?)?.toInt() ?? 0,
      correctCount: (json['correct_count'] as num?)?.toInt() ?? 0,
      wrongCount: (json['wrong_count'] as num?)?.toInt() ?? 0,
      skippedCount: (json['skipped_count'] as num?)?.toInt() ?? 0,
      rawScore: (json['raw_score'] as num?)?.round() ?? 0,
      maxScore: (json['max_score'] as num?)?.round() ?? 0,
      scorePercent: (json['score_percent'] as num?)?.round() ?? 0,
      xpEarned: (json['xp_earned'] as num?)?.toInt() ?? 0,
      timeTakenSeconds: (json['time_taken_seconds'] as num?)?.toInt() ?? 0,
      submittedAt: json['submitted_at']?.toString() ?? '',
    );
  }

  @override
  List<Object?> get props => [
        totalQuestions,
        attemptedCount,
        correctCount,
        wrongCount,
        skippedCount,
        rawScore,
        maxScore,
        scorePercent,
        xpEarned,
        timeTakenSeconds,
        submittedAt,
      ];
}

/// One post-submit review row. `is_correct` and `marks_awarded` come from
/// the server — the review UI shows them as given.
class ExamReviewItem extends Equatable {
  final String questionId;
  final String questionText;
  final List<String> options;
  final int? responseIndex;
  final int? correctAnswerIndex;
  final bool isCorrect;
  final int marksAwarded;
  final String? explanation;
  final String? chapterTitle;

  const ExamReviewItem({
    required this.questionId,
    this.questionText = '',
    this.options = const [],
    this.responseIndex,
    this.correctAnswerIndex,
    this.isCorrect = false,
    this.marksAwarded = 0,
    this.explanation,
    this.chapterTitle,
  });

  factory ExamReviewItem.fromJson(Map<String, dynamic> json) {
    return ExamReviewItem(
      questionId: json['question_id'] as String? ?? '',
      questionText: json['question_text'] as String? ?? '',
      options: ExamAttemptQuestion.parseOptions(json['options']),
      responseIndex: (json['response_index'] as num?)?.toInt(),
      correctAnswerIndex: (json['correct_answer_index'] as num?)?.toInt(),
      isCorrect: json['is_correct'] == true,
      marksAwarded: (json['marks_awarded'] as num?)?.round() ?? 0,
      explanation: json['explanation'] as String?,
      chapterTitle: json['chapter_title'] as String?,
    );
  }

  bool get isSkipped => responseIndex == null;

  @override
  List<Object?> get props =>
      [questionId, responseIndex, correctAnswerIndex, isCorrect, marksAwarded];
}

/// Full `POST /api/exams/papers/{id}/submit` envelope.
class ExamSubmitResult extends Equatable {
  final String attemptId;
  final String paperId;
  final ExamSubmitSummary summary;
  final List<ExamReviewItem> review;

  const ExamSubmitResult({
    required this.attemptId,
    required this.paperId,
    required this.summary,
    this.review = const [],
  });

  factory ExamSubmitResult.fromJson(Map<String, dynamic> json) {
    final rawReview = json['review'];
    return ExamSubmitResult(
      attemptId: json['attempt_id'] as String? ?? '',
      paperId: json['paper_id'] as String? ?? '',
      summary: json['summary'] is Map
          ? ExamSubmitSummary.fromJson(Map<String, dynamic>.from(json['summary'] as Map))
          : const ExamSubmitSummary(),
      review: rawReview is List
          ? rawReview
              .whereType<Map>()
              .map((e) => ExamReviewItem.fromJson(Map<String, dynamic>.from(e)))
              .toList(growable: false)
          : const <ExamReviewItem>[],
    );
  }

  @override
  List<Object?> get props => [attemptId, paperId, summary, review];
}

// ── Repository outcomes ───────────────────────────────────────────────────

/// Distinct outcomes of `GET /api/exams/papers/{id}` — 402 (Competition
/// plan required) has to stay distinguishable from a generic failure, so
/// this is a sealed union rather than an `ApiResult<T>` string.
sealed class ExamPaperDetailOutcome {
  const ExamPaperDetailOutcome();
}

class ExamPaperDetailSuccess extends ExamPaperDetailOutcome {
  final ExamPaper paper;

  /// Static (JEE/NEET/Olympiad) question set. Always EMPTY for `cbse_board`
  /// papers — those have no `exam_paper_id`-linked rows by design and must
  /// be started via `POST .../start`.
  final List<ExamAttemptQuestion> questions;

  const ExamPaperDetailSuccess({required this.paper, this.questions = const []});
}

class ExamPaperDetailUpgradeRequired extends ExamPaperDetailOutcome {
  final String upgradeUrl;
  const ExamPaperDetailUpgradeRequired([this.upgradeUrl = '/upgrade']);
}

class ExamPaperDetailNotFound extends ExamPaperDetailOutcome {
  const ExamPaperDetailNotFound();
}

class ExamPaperDetailFailure extends ExamPaperDetailOutcome {
  final String message;
  final int? statusCode;
  const ExamPaperDetailFailure(this.message, [this.statusCode]);
}

/// Distinct outcomes of `POST /api/exams/papers/{id}/start`.
sealed class ExamStartOutcome {
  const ExamStartOutcome();
}

class ExamStartSuccess extends ExamStartOutcome {
  final ExamStartResult result;
  const ExamStartSuccess(this.result);
}

/// 200 + empty `questions` — the assessment-sanctioned `content_insufficient`
/// case. Deliberately NOT a failure.
class ExamStartContentInsufficient extends ExamStartOutcome {
  const ExamStartContentInsufficient();
}

class ExamStartUpgradeRequired extends ExamStartOutcome {
  final String upgradeUrl;
  const ExamStartUpgradeRequired([this.upgradeUrl = '/upgrade']);
}

class ExamStartNotFound extends ExamStartOutcome {
  const ExamStartNotFound();
}

class ExamStartFailure extends ExamStartOutcome {
  final String message;
  final int? statusCode;
  const ExamStartFailure(this.message, [this.statusCode]);
}

/// Distinct outcomes of `POST /api/exams/papers/{id}/submit`.
sealed class ExamSubmitOutcome {
  const ExamSubmitOutcome();
}

class ExamSubmitSuccess extends ExamSubmitOutcome {
  final ExamSubmitResult result;
  const ExamSubmitSuccess(this.result);
}

class ExamSubmitUpgradeRequired extends ExamSubmitOutcome {
  final String upgradeUrl;
  const ExamSubmitUpgradeRequired([this.upgradeUrl = '/upgrade']);
}

class ExamSubmitFailure extends ExamSubmitOutcome {
  final String message;
  final int? statusCode;
  const ExamSubmitFailure(this.message, [this.statusCode]);
}
