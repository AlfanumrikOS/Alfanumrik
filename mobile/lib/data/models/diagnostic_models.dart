// Data models for the Diagnostic Assessment flow — mobile parity for
// `apps/host/src/app/diagnostic/page.tsx` and its two-call REST lifecycle:
// `POST /api/diagnostic/start` → `POST /api/diagnostic/complete`.
library;

import 'dart:convert';

import 'package:equatable/equatable.dart';

class DiagnosticQuestion extends Equatable {
  final String id;
  final String questionText;
  final String? questionHi;
  final String questionType;
  final List<String> options;

  /// Unlike the main quiz's v2 server-shuffle path, the diagnostic route
  /// DOES return the correct index directly (verified against
  /// `apps/host/src/app/api/diagnostic/start/route.ts` — no shuffle
  /// snapshot system backs this flow). The client computes `is_correct`
  /// itself and sends it to `/complete`, matching the real, confirmed
  /// contract — not a P1 violation, since diagnostic never awards XP/score
  /// through the quiz-scoring RPCs.
  final int correctAnswerIndex;
  final String? explanation;
  final String? explanationHi;
  final int difficulty;
  final String bloomLevel;
  final int? chapterNumber;
  final String? topicId;

  const DiagnosticQuestion({
    required this.id,
    required this.questionText,
    this.questionHi,
    this.questionType = 'mcq',
    required this.options,
    required this.correctAnswerIndex,
    this.explanation,
    this.explanationHi,
    this.difficulty = 1,
    this.bloomLevel = 'remember',
    this.chapterNumber,
    this.topicId,
  });

  factory DiagnosticQuestion.fromJson(Map<String, dynamic> json) {
    return DiagnosticQuestion(
      id: json['id'] as String? ?? '',
      questionText: json['question_text'] as String? ?? '',
      questionHi: json['question_hi'] as String?,
      questionType: json['question_type'] as String? ?? 'mcq',
      options: _parseOptions(json['options']),
      correctAnswerIndex: (json['correct_answer_index'] as num?)?.toInt() ?? 0,
      explanation: json['explanation'] as String?,
      explanationHi: json['explanation_hi'] as String?,
      difficulty: (json['difficulty'] as num?)?.toInt() ?? 1,
      bloomLevel: json['bloom_level'] as String? ?? 'remember',
      chapterNumber: (json['chapter_number'] as num?)?.toInt(),
      topicId: json['topic_id'] as String?,
    );
  }

  static List<String> _parseOptions(dynamic raw) {
    if (raw is List) return raw.map((e) => e.toString()).toList(growable: false);
    if (raw is String) {
      try {
        final decoded = jsonDecode(raw);
        if (decoded is List) {
          return decoded.map((e) => e.toString()).toList(growable: false);
        }
      } catch (_) {
        // Fall through to empty.
      }
    }
    return const [];
  }

  String displayText(bool isHi) =>
      (isHi && questionHi != null && questionHi!.isNotEmpty) ? questionHi! : questionText;

  @override
  List<Object?> get props => [id, questionText, correctAnswerIndex];
}

/// Result of `POST /api/diagnostic/start`.
class DiagnosticStartResult extends Equatable {
  final String sessionId;
  final List<DiagnosticQuestion> questions;

  const DiagnosticStartResult({required this.sessionId, required this.questions});

  @override
  List<Object?> get props => [sessionId, questions];
}

/// One entry in the `responses` array sent to `POST /api/diagnostic/complete`.
/// Field names/shape match the route's request contract EXACTLY.
class DiagnosticResponseItem extends Equatable {
  final String questionId;
  final int selectedAnswerIndex;
  final bool isCorrect;
  final int timeTakenSeconds;
  final String? topic;
  final int difficulty;
  final String bloomLevel;

  const DiagnosticResponseItem({
    required this.questionId,
    required this.selectedAnswerIndex,
    required this.isCorrect,
    required this.timeTakenSeconds,
    required this.topic,
    required this.difficulty,
    required this.bloomLevel,
  });

  Map<String, dynamic> toJson() => {
        'question_id': questionId,
        'selected_answer_index': selectedAnswerIndex,
        'is_correct': isCorrect,
        'time_taken_seconds': timeTakenSeconds,
        'topic': topic,
        'difficulty': difficulty,
        'bloom_level': bloomLevel,
      };

  @override
  List<Object?> get props =>
      [questionId, selectedAnswerIndex, isCorrect, timeTakenSeconds, topic, difficulty, bloomLevel];
}

/// Result of `POST /api/diagnostic/complete`.
class DiagnosticSummary extends Equatable {
  final String sessionId;
  final int scorePercent;
  final int correctAnswers;
  final int totalQuestions;
  final List<String> weakTopics;
  final List<String> strongTopics;
  final String recommendedDifficulty; // 'easy' | 'medium' | 'hard'

  const DiagnosticSummary({
    required this.sessionId,
    required this.scorePercent,
    required this.correctAnswers,
    required this.totalQuestions,
    required this.weakTopics,
    required this.strongTopics,
    required this.recommendedDifficulty,
  });

  factory DiagnosticSummary.fromJson(Map<String, dynamic> json) {
    List<String> parseTopics(dynamic raw) => raw is List
        ? raw.map((e) => e.toString()).toList(growable: false)
        : const [];
    return DiagnosticSummary(
      sessionId: json['session_id'] as String? ?? '',
      scorePercent: (json['score_percent'] as num?)?.toInt() ?? 0,
      correctAnswers: (json['correct_answers'] as num?)?.toInt() ?? 0,
      totalQuestions: (json['total_questions'] as num?)?.toInt() ?? 0,
      weakTopics: parseTopics(json['weak_topics']),
      strongTopics: parseTopics(json['strong_topics']),
      recommendedDifficulty: json['recommended_difficulty'] as String? ?? 'medium',
    );
  }

  @override
  List<Object?> get props => [
        sessionId,
        scorePercent,
        correctAnswers,
        totalQuestions,
        weakTopics,
        strongTopics,
        recommendedDifficulty,
      ];
}
