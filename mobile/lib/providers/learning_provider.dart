import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../data/models/chapter.dart';
import '../data/repositories/curriculum_version_repository.dart';
import '../data/repositories/learning_repository.dart';
import 'auth_provider.dart';
import 'experience_provider.dart';

/// Session-scoped curriculum-version client. Kept app-scoped (no autoDispose) so
/// its brief in-memory version-map cache survives across screen rebuilds within
/// a learn session.
final curriculumVersionRepositoryProvider =
    Provider<CurriculumVersionRepository>(
        (ref) => CurriculumVersionRepository());

final learningRepositoryProvider = Provider<LearningRepository>((ref) {
  // Server assignment, rather than the permissive build switch, selects the
  // generated V2 data plane. Explicit legacy remains on Supabase tables.
  return LearningRepository(
    v2Client: ref.watch(oneExperienceV2ApiClientProvider),
    versions: ref.watch(curriculumVersionRepositoryProvider),
  );
});

/// Chapters for a given subject — keyed by subject code.
///
/// Returns a [LearnData] envelope so the screen can render the offline "as of
/// {date}" chip. A thrown [LearnOfflineException] surfaces to the screen's error
/// branch as the dedicated Offline state (no swallow-to-empty — the five states
/// stay distinguishable).
final chaptersProvider =
    FutureProvider.family<LearnData<List<Chapter>>, String>(
        (ref, subjectCode) async {
  final student = ref.watch(studentProvider).valueOrNull;
  if (student == null) return const LearnData<List<Chapter>>(<Chapter>[]);

  final repo = ref.watch(learningRepositoryProvider);
  return repo.getChapters(
    subjectCode: subjectCode,
    grade: student.grade,
  );
});

/// Topics for a given chapter (legacy blind-TTL path; not currently rendered by
/// any screen — see [LearningRepository.getTopics]).
final topicsProvider =
    FutureProvider.family<List<Topic>, String>((ref, chapterId) async {
  final repo = ref.watch(learningRepositoryProvider);
  final result = await repo.getTopics(chapterId);
  return result.dataOrNull ?? [];
});

/// Single topic content (legacy `topics`-table path; `useV2` OFF).
///
/// Keyed by `(topicId, subjectCode)` because the version-anchored cache needs
/// the `<subject>-<grade>` scope. Grade is read from the current student.
final topicContentProvider = FutureProvider.family<LearnData<Topic?>,
    ({String topicId, String subjectCode})>((ref, args) async {
  final student = ref.watch(studentProvider).valueOrNull;
  if (student == null) return const LearnData<Topic?>(null);

  final repo = ref.watch(learningRepositoryProvider);
  return repo.getTopicContent(
    topicId: args.topicId,
    subjectCode: args.subjectCode,
    grade: student.grade,
  );
});

/// `useV2`-ON concept content via `GET /v2/learn/concept`.
///
/// Keyed by `(subjectCode, chapterId)` because the `/v2` concept route needs the
/// subject + chapter. The chapter id is the chapter NUMBER string produced by
/// the v2 curriculum mapping. Grade is read from the current student. Only the
/// concept screen uses this — and only when the flag is on.
final conceptV2Provider = FutureProvider.family<LearnData<Topic?>,
    ({String subjectCode, String chapterId})>((ref, args) async {
  final student = ref.watch(studentProvider).valueOrNull;
  if (student == null) return const LearnData<Topic?>(null);
  final repo = ref.watch(learningRepositoryProvider);
  return repo.getConceptV2(
    subjectCode: args.subjectCode,
    grade: student.grade,
    chapterId: args.chapterId,
  );
});
