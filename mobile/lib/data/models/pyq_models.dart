// Data models for PYQ (Previous Year Questions) practice — mobile parity
// for `apps/host/src/app/(student)/pyq/page.tsx`.
//
// Confirmed backend: PYQ reads DIRECTLY from `question_bank` (year-tagged
// via `tags` contains the year string, falling back to any question_bank
// row for the subject+grade) — it does NOT share the exam_papers /
// `start_mock_test_attempt` mock-test system. See `pyq_repository.dart`.
library;

import 'dart:convert';

import 'package:equatable/equatable.dart';

class PyqQuestion extends Equatable {
  final String id;
  final String questionText;
  final String? questionHi;
  final List<String> options;
  final int correctAnswerIndex;
  final String? explanation;
  final String? explanationHi;
  final int difficulty;
  final String bloomLevel;
  final List<String> tags;

  const PyqQuestion({
    required this.id,
    required this.questionText,
    this.questionHi,
    required this.options,
    required this.correctAnswerIndex,
    this.explanation,
    this.explanationHi,
    this.difficulty = 1,
    this.bloomLevel = 'remember',
    this.tags = const [],
  });

  factory PyqQuestion.fromJson(Map<String, dynamic> json) {
    return PyqQuestion(
      id: json['id'] as String? ?? '',
      questionText: json['question_text'] as String? ?? '',
      questionHi: json['question_hi'] as String?,
      options: _parseOptions(json['options']),
      correctAnswerIndex: (json['correct_answer_index'] as num?)?.toInt() ?? 0,
      explanation: json['explanation'] as String?,
      explanationHi: json['explanation_hi'] as String?,
      difficulty: (json['difficulty'] as num?)?.toInt() ?? 1,
      bloomLevel: json['bloom_level'] as String? ?? 'remember',
      tags: json['tags'] is List
          ? (json['tags'] as List).map((e) => e.toString()).toList(growable: false)
          : const [],
    );
  }

  /// `options` may arrive as a native JSON array (typical Postgrest JSONB
  /// deserialisation) or as a JSON-encoded string (legacy rows) — mirrors
  /// the web's `parseOptions()` helper on the PYQ page.
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

  String? displayExplanation(bool isHi) =>
      (isHi && explanationHi != null && explanationHi!.isNotEmpty) ? explanationHi : explanation;

  @override
  List<Object?> get props => [id, questionText, correctAnswerIndex];
}

/// Result of a PYQ fetch — the questions plus whether they came from the
/// year-tagged query (`isFallback: false`) or the ungapped subject+grade
/// fallback (`isFallback: true`, mirrors the web's `noQuestions` flag —
/// named `isFallback` here to avoid confusion with "zero questions").
class PyqFetchResult extends Equatable {
  final List<PyqQuestion> questions;
  final bool isFallback;

  const PyqFetchResult({required this.questions, required this.isFallback});

  @override
  List<Object?> get props => [questions, isFallback];
}
