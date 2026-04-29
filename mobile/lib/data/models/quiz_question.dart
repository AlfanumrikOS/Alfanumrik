import 'package:equatable/equatable.dart';

class QuizQuestion extends Equatable {
  final String id;
  final String questionText;
  final String? questionTextHi;
  final List<String> options;

  /// Original (pre-shuffle) correct option index, 0..3.
  ///
  /// In the v2 server-shuffle path this is `-1` because the server never
  /// reveals it to the client (P1+P6 fix, migration `20260428160000`). The
  /// client never uses this for scoring under v2 — `submit_quiz_results_v2`
  /// re-derives `is_correct` against the snapshot. Kept on the model for
  /// backward compatibility with the v1 path that still flows through
  /// `getQuestions()`.
  final int correctIndex;
  final String? explanation;
  final String? explanationHi;
  final String subject;
  final String grade;
  final String? chapterTitle;
  final int difficulty; // 1-5
  final String bloomLevel;

  const QuizQuestion({
    required this.id,
    required this.questionText,
    this.questionTextHi,
    required this.options,
    required this.correctIndex,
    this.explanation,
    this.explanationHi,
    required this.subject,
    required this.grade,
    this.chapterTitle,
    this.difficulty = 1,
    this.bloomLevel = 'remember',
  });

  factory QuizQuestion.fromJson(Map<String, dynamic> json) {
    final optionsList = <String>[];
    for (int i = 1; i <= 4; i++) {
      final opt = json['option_$i'] as String?;
      if (opt != null) optionsList.add(opt);
    }

    return QuizQuestion(
      id: json['id'] as String,
      questionText: json['question_text'] as String,
      questionTextHi: json['question_text_hi'] as String?,
      options: optionsList,
      correctIndex: (json['correct_option'] as int? ?? 1) - 1,
      explanation: json['explanation'] as String?,
      explanationHi: json['explanation_hi'] as String?,
      subject: json['subject'] as String? ?? '',
      grade: json['grade'] as String? ?? '',
      chapterTitle: json['chapter_title'] as String?,
      difficulty: json['difficulty'] as int? ?? 1,
      bloomLevel: json['bloom_level'] as String? ?? 'remember',
    );
  }

  /// Build from a single entry in the `questions` array returned by the
  /// `start_quiz_session` RPC. The server has already applied the shuffle and
  /// snapshotted the correct answer index; the client receives the shuffled
  /// `options_displayed` array and MUST NOT learn the correct index.
  ///
  /// `correctIndex` is therefore set to `-1` as a sentinel meaning
  /// "server-owned, do not consult". `submit_quiz_results_v2` is the only
  /// authority for scoring v2 quizzes.
  factory QuizQuestion.fromServerSession(
    Map<String, dynamic> json, {
    required String subject,
    required String grade,
  }) {
    final optsRaw = json['options_displayed'];
    final opts = <String>[];
    if (optsRaw is List) {
      for (final o in optsRaw) {
        if (o is String) opts.add(o);
      }
    }

    return QuizQuestion(
      id: json['question_id'] as String,
      questionText: json['question_text'] as String? ?? '',
      questionTextHi: json['question_hi'] as String?,
      options: opts,
      // Sentinel — server-side authority, see class doc.
      correctIndex: -1,
      explanation: json['explanation'] as String?,
      explanationHi: json['explanation_hi'] as String?,
      subject: subject,
      grade: grade,
      chapterTitle: null,
      difficulty: (json['difficulty'] as num?)?.toInt() ?? 1,
      bloomLevel: json['bloom_level'] as String? ?? 'remember',
    );
  }

  @override
  List<Object?> get props => [id, questionText, correctIndex];
}

/// Result of `start_quiz_session` RPC. Pairs a server-generated `sessionId`
/// with the shuffled questions to display to the student.
///
/// The `sessionId` MUST be passed back to `submit_quiz_results_v2` so the
/// server can re-derive correctness against the per-session snapshot. If
/// the RPC is unavailable (older deployment, network failure) the caller
/// should fall through to v1 with `sessionId == null`.
class ServerQuizSession extends Equatable {
  final String sessionId;
  final List<QuizQuestion> questions;

  const ServerQuizSession({
    required this.sessionId,
    required this.questions,
  });

  @override
  List<Object?> get props => [sessionId, questions];
}

/// Per-question review row returned by `submit_quiz_results_v2`. The server
/// is the single source of truth for `correctOptionText` and `isCorrect`;
/// the client must display these verbatim and never derive from its own
/// `options` array (which could be stale relative to the session snapshot).
class QuestionReview extends Equatable {
  final String questionId;
  final bool isCorrect;
  final String? correctOptionText;
  final int correctOriginalIndex;
  final int selectedDisplayedIndex;
  final int selectedOriginalIndex;

  const QuestionReview({
    required this.questionId,
    required this.isCorrect,
    required this.correctOptionText,
    required this.correctOriginalIndex,
    required this.selectedDisplayedIndex,
    required this.selectedOriginalIndex,
  });

  factory QuestionReview.fromJson(Map<String, dynamic> json) {
    return QuestionReview(
      questionId: json['question_id'] as String,
      isCorrect: json['is_correct'] as bool? ?? false,
      correctOptionText: json['correct_option_text'] as String?,
      correctOriginalIndex:
          (json['correct_original_index'] as num?)?.toInt() ?? -1,
      selectedDisplayedIndex:
          (json['selected_displayed_index'] as num?)?.toInt() ?? -1,
      selectedOriginalIndex:
          (json['selected_original_index'] as num?)?.toInt() ?? -1,
    );
  }

  @override
  List<Object?> get props => [
        questionId,
        isCorrect,
        correctOptionText,
        correctOriginalIndex,
        selectedDisplayedIndex,
        selectedOriginalIndex,
      ];
}

class QuizResult extends Equatable {
  final int totalQuestions;
  final int correctAnswers;

  /// Score percentage as returned by the server (already rounded -- P1).
  final int scorePercent;

  /// @deprecated Legacy XP earned. Kept for backward compatibility during
  /// migration. New code should use [coinsEarned] once the server returns
  /// `coins_earned`. See web `coin-rules.ts` for the canonical values.
  final int xpEarned;

  /// Foxy Coins earned for this quiz (from `coin-rules.ts`).
  /// Falls back to 0 when the server has not yet been migrated to return
  /// `coins_earned` in the RPC response.
  final int coinsEarned;

  final Duration timeTaken;
  final String? sessionId;
  final bool flagged;

  /// Per-question review rows. Populated only by `submit_quiz_results_v2`.
  /// On v1 (no session) this is an empty list and the client falls back to
  /// the local `correctIndex` field on each [QuizQuestion].
  final List<QuestionReview> review;

  const QuizResult({
    required this.totalQuestions,
    required this.correctAnswers,
    required this.scorePercent,
    required this.xpEarned,
    this.coinsEarned = 0,
    required this.timeTaken,
    this.sessionId,
    this.flagged = false,
    this.review = const [],
  });

  /// Build from the JSONB map returned by submit_quiz_results RPC (v1 or v2).
  ///
  /// v2 includes a `questions` array with per-question review rows; v1
  /// returns an empty `review` list and the client falls back to the
  /// (legacy) local-shuffle path.
  factory QuizResult.fromRpc(
    Map<String, dynamic> rpc,
    Duration timeTaken,
  ) {
    final reviewRaw = rpc['questions'];
    final review = <QuestionReview>[];
    if (reviewRaw is List) {
      for (final r in reviewRaw) {
        if (r is Map<String, dynamic>) {
          review.add(QuestionReview.fromJson(r));
        } else if (r is Map) {
          // Defensive cast for runtime types from supabase_flutter that
          // sometimes deserialise as Map<dynamic, dynamic>.
          review.add(
            QuestionReview.fromJson(Map<String, dynamic>.from(r)),
          );
        }
      }
    }

    return QuizResult(
      totalQuestions: (rpc['total'] as num).toInt(),
      correctAnswers: (rpc['correct'] as num).toInt(),
      scorePercent: (rpc['score_percent'] as num).toInt(),
      xpEarned: (rpc['xp_earned'] as num?)?.toInt() ?? 0,
      coinsEarned: (rpc['coins_earned'] as num?)?.toInt() ?? 0,
      timeTaken: timeTaken,
      sessionId: rpc['session_id'] as String?,
      flagged: rpc['flagged'] as bool? ?? false,
      review: review,
    );
  }

  /// Letter grade derived from server-authoritative scorePercent.
  String get grade {
    if (scorePercent >= 90) return 'A+';
    if (scorePercent >= 80) return 'A';
    if (scorePercent >= 70) return 'B';
    if (scorePercent >= 60) return 'C';
    return 'D';
  }

  @override
  List<Object?> get props =>
      [totalQuestions, correctAnswers, scorePercent, xpEarned, coinsEarned];
}
