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
  final int xpEarned;
  final Duration timeTaken;

  const QuizResult({
    required this.totalQuestions,
    required this.correctAnswers,
    required this.xpEarned,
    required this.timeTaken,
  });

  double get percentage =>
      totalQuestions > 0 ? (correctAnswers / totalQuestions) * 100 : 0;

  String get grade {
    if (percentage >= 90) return 'A+';
    if (percentage >= 80) return 'A';
    if (percentage >= 70) return 'B';
    if (percentage >= 60) return 'C';
    return 'D';
  }

  @override
  List<Object?> get props => [totalQuestions, correctAnswers, xpEarned];
}
