import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../data/models/chapter.dart';
import '../data/repositories/learning_repository.dart';
import 'auth_provider.dart';
import 'experience_provider.dart';

final learningRepositoryProvider = Provider<LearningRepository>((ref) {
  // Server assignment, rather than the permissive build switch, selects the
  // generated V2 data plane. Explicit legacy remains on Supabase tables.
  return LearningRepository(
    v2Client: ref.watch(oneExperienceV2ApiClientProvider),
  );
});

/// Chapters for a given subject — keyed by subject code
final chaptersProvider =
    FutureProvider.family<List<Chapter>, String>((ref, subjectCode) async {
  final student = ref.watch(studentProvider).valueOrNull;
  if (student == null) return [];

  final repo = ref.watch(learningRepositoryProvider);
  final result = await repo.getChapters(
    subjectCode: subjectCode,
    grade: student.grade,
  );
  return result.dataOrNull ?? [];
});

/// Topics for a given chapter
final topicsProvider =
    FutureProvider.family<List<Topic>, String>((ref, chapterId) async {
  final repo = ref.watch(learningRepositoryProvider);
  final result = await repo.getTopics(chapterId);
  return result.dataOrNull ?? [];
});

/// Single topic content (legacy `topics`-table path; `useV2` OFF).
final topicContentProvider =
    FutureProvider.family<Topic?, String>((ref, topicId) async {
  final repo = ref.watch(learningRepositoryProvider);
  final result = await repo.getTopicContent(topicId);
  return result.dataOrNull;
});

/// `useV2`-ON concept content via `GET /v2/learn/concept`.
///
/// Keyed by `(subjectCode, chapterId)` because the `/v2` concept route needs
/// the subject + chapter (the legacy table path only needed a topic id). The
/// chapter id is the chapter NUMBER string produced by the v2 curriculum
/// mapping. Grade is read from the current student. Only the concept screen
/// uses this — and only when the flag is on, so the legacy provider above is
/// untouched on flag-OFF builds.
final conceptV2Provider = FutureProvider.family<Topic?, ({String subjectCode, String chapterId})>(
    (ref, args) async {
  final student = ref.watch(studentProvider).valueOrNull;
  if (student == null) return null;
  final repo = ref.watch(learningRepositoryProvider);
  final result = await repo.getConceptV2(
    subjectCode: args.subjectCode,
    grade: student.grade,
    chapterId: args.chapterId,
  );
  return result.dataOrNull;
});
