import 'package:equatable/equatable.dart';

class Chapter extends Equatable {
  final String id;
  final String title;
  final String? titleHi;
  final int chapterNumber;
  final String subjectCode;
  final String grade;
  final int topicCount;
  final int completedTopics;
  final String? description;

  const Chapter({
    required this.id,
    required this.title,
    this.titleHi,
    required this.chapterNumber,
    required this.subjectCode,
    required this.grade,
    this.topicCount = 0,
    this.completedTopics = 0,
    this.description,
  });

  factory Chapter.fromJson(Map<String, dynamic> json) {
    return Chapter(
      id: json['id'] as String,
      title: json['title'] as String,
      titleHi: json['title_hi'] as String?,
      chapterNumber: json['chapter_number'] as int? ?? 0,
      subjectCode: json['subject_code'] as String,
      grade: json['grade'] as String,
      topicCount: json['topic_count'] as int? ?? 0,
      completedTopics: json['completed_topics'] as int? ?? 0,
      description: json['description'] as String?,
    );
  }

  double get progress => topicCount > 0 ? completedTopics / topicCount : 0;

  @override
  List<Object?> get props => [id, title, chapterNumber, subjectCode];
}

class Topic extends Equatable {
  final String id;
  final String chapterId;
  final String title;
  final String? titleHi;
  final int topicOrder;
  final String? conceptText;
  final String? conceptTextHi;
  final bool isCompleted;

  const Topic({
    required this.id,
    required this.chapterId,
    required this.title,
    this.titleHi,
    required this.topicOrder,
    this.conceptText,
    this.conceptTextHi,
    this.isCompleted = false,
  });

  factory Topic.fromJson(Map<String, dynamic> json) {
    return Topic(
      id: json['id'] as String,
      chapterId: json['chapter_id'] as String,
      title: json['title'] as String,
      titleHi: json['title_hi'] as String?,
      topicOrder: json['topic_order'] as int? ?? 0,
      conceptText: json['concept_text'] as String?,
      conceptTextHi: json['concept_text_hi'] as String?,
      isCompleted: json['is_completed'] as bool? ?? false,
    );
  }

  @override
  List<Object?> get props => [id, chapterId, title, topicOrder];
}
