import 'package:alfanumrik_api_v2/alfanumrik_api_v2.dart' as v2;
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

  /// Build from the generated `/v2` [v2.QuizQuestion] DTO returned by
  /// `GET /v2/quiz/questions` (Wave 2.3b). The route NEVER returns
  /// `correct_answer_index` (P6), so `correctIndex` is set to the `-1`
  /// sentinel — identical to the [fromServerSession] contract. Subject +
  /// grade are not echoed by this DTO so the caller threads them through.
  factory QuizQuestion.fromV2Question(
    v2.QuizQuestion q, {
    required String subject,
    required String grade,
  }) {
    return QuizQuestion(
      id: q.questionId,
      questionText: q.questionText,
      questionTextHi: q.questionHi,
      options: q.options.toList(growable: false),
      // Sentinel — server-side authority, never reveal the correct index.
      correctIndex: -1,
      explanation: q.explanation,
      explanationHi: q.explanationHi,
      subject: subject,
      grade: grade,
      chapterTitle: null,
      difficulty: q.difficulty.toInt(),
      bloomLevel: q.bloomLevel ?? 'remember',
    );
  }

  /// Build from the generated `/v2` [v2.QuizStartQuestion] DTO returned by
  /// `POST /v2/quiz/start` (Wave 2.3b). Carries the SERVER-SHUFFLED
  /// `options_displayed`; the correct index + shuffle map stay server-side
  /// (P1+P6). `correctIndex` is the `-1` sentinel.
  factory QuizQuestion.fromV2StartQuestion(
    v2.QuizStartQuestion q, {
    required String subject,
    required String grade,
  }) {
    return QuizQuestion(
      id: q.questionId,
      questionText: q.questionText,
      questionTextHi: q.questionHi,
      options: q.optionsDisplayed.toList(growable: false),
      // Sentinel — server owns correctness under the v2 shuffle.
      correctIndex: -1,
      explanation: q.explanation,
      explanationHi: q.explanationHi,
      subject: subject,
      grade: grade,
      chapterTitle: null,
      difficulty: q.difficulty.toInt(),
      bloomLevel: q.bloomLevel ?? 'remember',
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

  /// Daily-XP-cap surfacing (server JSONB pass-through from
  /// `atomic_quiz_profile_update`, migration `20260427000003_enforce_daily_xp_cap`).
  ///
  /// When `xpCapped == true`, the server clamped today's XP at the daily
  /// cap (200 XP, see web `xp-rules.ts`). The UI should show a friendly
  /// banner explaining this — see `_DailyCapBanner` in `quiz_screen.dart`.
  /// All three fields are nullable for forward compatibility: older RPC
  /// builds that don't return them yield `xpCapped == false`,
  /// `effectiveXp == null` (callers should fall back to [xpEarned]).
  final bool xpCapped;
  final int? xpUncapped;
  final int? effectiveXp;

  /// Set to `true` by `submit_quiz_results_v2` (Phase 2.8, migration
  /// `20260504100200_quiz_idempotency_key.sql`) when the call hit the
  /// (student_id, idempotency_key) cache instead of running the scoring
  /// path again. Mobile uses this to skip XP/coin re-animation on retry.
  final bool idempotentReplay;

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
    this.xpCapped = false,
    this.xpUncapped,
    this.effectiveXp,
    this.idempotentReplay = false,
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

    // Daily-XP-cap fields. The server JSONB shape is:
    //   { effective_xp: int, xp_capped: bool, xp_uncapped: int }
    // when the call hit the daily cap. Older deploys omit these — keep
    // every read defensive.
    final xpCapped = rpc['xp_capped'] as bool? ?? false;
    final effectiveXp = (rpc['effective_xp'] as num?)?.toInt();
    final xpUncapped = (rpc['xp_uncapped'] as num?)?.toInt();
    final idempotentReplay = rpc['idempotent_replay'] as bool? ?? false;

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
      xpCapped: xpCapped,
      xpUncapped: xpUncapped,
      effectiveXp: effectiveXp,
      idempotentReplay: idempotentReplay,
    );
  }

  /// Build from the generated `/v2` [v2.QuizSubmitResult] DTO returned by
  /// `POST /v2/quiz/submit` (Wave 2.3b).
  ///
  /// SERVER-AUTHORITATIVE (P1/P2): every displayed value is read VERBATIM
  /// from the server response — `score_percent`, `xp_earned`, `correct`,
  /// `total`, `flagged`, and the per-question review. The device computes
  /// NONE of these. The review rows arrive as a generic JSON map
  /// (`BuiltMap<String, JsonObject?>`); we read them through [QuestionReview]
  /// exactly as the RPC path does, so the result screen behaves identically.
  factory QuizResult.fromV2(
    v2.QuizSubmitResult res,
    Duration timeTaken,
  ) {
    final review = <QuestionReview>[];
    for (final row in res.questions) {
      final map = <String, dynamic>{};
      for (final entry in row.entries) {
        map[entry.key] = entry.value?.value;
      }
      review.add(QuestionReview.fromJson(map));
    }

    return QuizResult(
      totalQuestions: res.total,
      correctAnswers: res.correct,
      scorePercent: res.scorePercent.toInt(),
      xpEarned: res.xpEarned.toInt(),
      // The /v2 submit contract surfaces XP, not Foxy Coins — leave coins 0
      // (matches the RPC path until the server returns coins_earned).
      coinsEarned: 0,
      timeTaken: timeTaken,
      sessionId: res.sessionId,
      flagged: res.flagged,
      review: review,
      // `xp_capped` is the only cap field in the typed v2 contract; the
      // effective/uncapped values are not exposed there, so the banner falls
      // back to xpEarned (the widget already tolerates nulls).
      xpCapped: res.xpCapped ?? false,
      xpUncapped: null,
      effectiveXp: null,
      idempotentReplay: res.idempotentReplay,
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
