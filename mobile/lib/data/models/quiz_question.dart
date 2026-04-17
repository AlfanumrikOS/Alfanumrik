import 'package:equatable/equatable.dart';

class QuizQuestion extends Equatable {
  final String id;
  final String questionText;
  final String? questionTextHi;
  final List<String> options;
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

  @override
  List<Object?> get props => [id, questionText, correctIndex];
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

  const QuizResult({
    required this.totalQuestions,
    required this.correctAnswers,
    required this.scorePercent,
    required this.xpEarned,
    this.coinsEarned = 0,
    required this.timeTaken,
    this.sessionId,
    this.flagged = false,
  });

  /// Build from the JSONB map returned by submit_quiz_results RPC.
  ///
  /// The RPC currently returns `xp_earned`. When the server migrates to
  /// Foxy Coins it will also return `coins_earned`. We read both — the
  /// caller should prefer [coinsEarned] when available, falling back to
  /// [xpEarned] during the transition.
  factory QuizResult.fromRpc(
    Map<String, dynamic> rpc,
    Duration timeTaken,
  ) {
    return QuizResult(
      totalQuestions: (rpc['total'] as num).toInt(),
      correctAnswers: (rpc['correct'] as num).toInt(),
      scorePercent: (rpc['score_percent'] as num).toInt(),
      xpEarned: (rpc['xp_earned'] as num?)?.toInt() ?? 0,
      coinsEarned: (rpc['coins_earned'] as num?)?.toInt() ?? 0,
      timeTaken: timeTaken,
      sessionId: rpc['session_id'] as String?,
      flagged: rpc['flagged'] as bool? ?? false,
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
  List<Object?> get props => [totalQuestions, correctAnswers, scorePercent, xpEarned, coinsEarned];
}
