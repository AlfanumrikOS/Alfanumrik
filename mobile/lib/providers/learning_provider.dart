import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../data/models/chapter.dart';
import '../data/repositories/learning_repository.dart';
import 'auth_provider.dart';

final learningRepositoryProvider = Provider<LearningRepository>((ref) {
  return LearningRepository();
});

/// Chapters for a given subject — keyed by subject code
final chaptersProvider =
    FutureProvider.family<List<Chapter>, String>((ref, subjectCode) async {
  final student = ref.watch(studentProvider).valueOrNull;
  if (student == null) return [];

  final repo = ref.read(learningRepositoryProvider);
  final result = await repo.getChapters(
    subjectCode: subjectCode,
    grade: student.grade,
  );
  return result.dataOrNull ?? [];
});

/// Topics for a given chapter
final topicsProvider =
    FutureProvider.family<List<Topic>, String>((ref, chapterId) async {
  final repo = ref.read(learningRepositoryProvider);
  final result = await repo.getTopics(chapterId);
  return result.dataOrNull ?? [];
});

/// Single topic content
final topicContentProvider =
    FutureProvider.family<Topic?, String>((ref, topicId) async {
  final repo = ref.read(learningRepositoryProvider);
  final result = await repo.getTopicContent(topicId);
  return result.dataOrNull;
});
