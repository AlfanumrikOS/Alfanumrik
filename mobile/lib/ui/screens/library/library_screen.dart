import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../core/constants/app_colors.dart';
import '../../../core/services/subjects_provider.dart';
import '../../../data/repositories/learning_repository.dart';
import '../../../providers/learning_provider.dart';
import '../../../providers/library_recent_provider.dart';
import '../../widgets/error_widget.dart';
import '../../widgets/learn_states.dart';
import '../../widgets/loading_widget.dart';

/// Library — browse-first content discovery (Tier 3 mobile parity for
/// `apps/host/src/app/(student)/library/page.tsx`).
///
/// A second, browse-first entry point onto the SAME curriculum data
/// [SubjectsScreen]/[ChaptersScreen] already fetch (subjects via
/// [subjectsProvider], chapters via [chaptersProvider]) — no new repository.
/// Unlike `/learn`, there is no progress framing here: students pick a
/// subject chip and scan every chapter freely. Chapter taps navigate into
/// the EXISTING `/learn/:subjectCode/:topicId` route (which resolves to
/// [ChaptersScreen]'s sibling `ConceptScreen`) — this screen never
/// duplicates that screen.
class LibraryScreen extends ConsumerStatefulWidget {
  const LibraryScreen({super.key});

  @override
  ConsumerState<LibraryScreen> createState() => _LibraryScreenState();
}

class _LibraryScreenState extends ConsumerState<LibraryScreen> {
  String? _selectedSubjectCode;

  @override
  Widget build(BuildContext context) {
    final isHi = Localizations.localeOf(context).languageCode == 'hi';
    final subjectsAsync = ref.watch(subjectsProvider);

    return Scaffold(
      backgroundColor: AppColors.background,
      appBar: AppBar(
        backgroundColor: AppColors.surface,
        foregroundColor: AppColors.textPrimary,
        elevation: 0,
        title: Text(isHi ? '📚 NCERT पुस्तकालय' : '📚 NCERT Library'),
      ),
      body: SafeArea(
        child: subjectsAsync.when(
          loading: () =>
              LoadingScreen(message: isHi ? 'लोड हो रहा है...' : 'Loading...'),
          error: (e, _) => AppErrorWidget(
            message: e.toString(),
            onRetry: () => ref.invalidate(subjectsProvider),
          ),
          data: (subjects) {
            if (subjects.isEmpty) {
              return Center(
                child: Text(
                  isHi
                      ? 'अभी कोई विषय उपलब्ध नहीं है।'
                      : 'No subjects available yet.',
                  style: const TextStyle(color: AppColors.textTertiary),
                ),
              );
            }

            _selectedSubjectCode ??= subjects.first.code;
            final selected = subjects.firstWhere(
              (s) => s.code == _selectedSubjectCode,
              orElse: () => subjects.first,
            );

            return ListView(
              padding: const EdgeInsets.all(16),
              children: [
                _RecentlyExplored(isHi: isHi),
                SizedBox(
                  height: 40,
                  child: ListView.separated(
                    scrollDirection: Axis.horizontal,
                    itemCount: subjects.length,
                    separatorBuilder: (_, __) => const SizedBox(width: 8),
                    itemBuilder: (context, i) {
                      final s = subjects[i];
                      final isSelected = s.code == selected.code;
                      final color = AppColors.subjectColor(s.code);
                      return GestureDetector(
                        onTap: () {
                          if (s.isLocked) {
                            context.push('/plans');
                            return;
                          }
                          setState(() => _selectedSubjectCode = s.code);
                        },
                        child: Container(
                          padding:
                              const EdgeInsets.symmetric(horizontal: 14, vertical: 8),
                          decoration: BoxDecoration(
                            color: isSelected ? color : AppColors.surface,
                            borderRadius: BorderRadius.circular(20),
                            border: Border.all(
                              color: isSelected
                                  ? Colors.transparent
                                  : AppColors.borderLight,
                            ),
                          ),
                          alignment: Alignment.center,
                          child: Row(
                            mainAxisSize: MainAxisSize.min,
                            children: [
                              Text(s.icon, style: const TextStyle(fontSize: 14)),
                              const SizedBox(width: 6),
                              Text(
                                isHi ? s.nameHi : s.name,
                                style: TextStyle(
                                  fontSize: 12,
                                  fontWeight: FontWeight.w700,
                                  color: isSelected
                                      ? Colors.white
                                      : (s.isLocked
                                          ? AppColors.textTertiary
                                          : AppColors.textSecondary),
                                ),
                              ),
                              if (s.isLocked) ...[
                                const SizedBox(width: 4),
                                const Text('🔒', style: TextStyle(fontSize: 11)),
                              ],
                            ],
                          ),
                        ),
                      );
                    },
                  ),
                ),
                const SizedBox(height: 16),
                _ChapterList(
                  subjectCode: selected.code,
                  subjectName: isHi ? selected.nameHi : selected.name,
                  isHi: isHi,
                ),
              ],
            );
          },
        ),
      ),
    );
  }
}

class _RecentlyExplored extends ConsumerWidget {
  final bool isHi;
  const _RecentlyExplored({required this.isHi});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final recentAsync = ref.watch(libraryRecentProvider);
    final items = recentAsync.valueOrNull ?? const <RecentLibraryChapter>[];
    if (items.isEmpty) return const SizedBox.shrink();

    return Padding(
      padding: const EdgeInsets.only(bottom: 16),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            isHi ? '📖 हाल ही में पढ़ा' : '📖 Recently explored',
            style: const TextStyle(
              fontSize: 13,
              fontWeight: FontWeight.w700,
              color: AppColors.textSecondary,
            ),
          ),
          const SizedBox(height: 8),
          SizedBox(
            height: 64,
            child: ListView.separated(
              scrollDirection: Axis.horizontal,
              itemCount: items.length,
              separatorBuilder: (_, __) => const SizedBox(width: 8),
              itemBuilder: (context, i) {
                final item = items[i];
                return GestureDetector(
                  onTap: () =>
                      context.push('/learn/${item.subjectCode}/${item.chapterId}'),
                  child: Container(
                    width: 160,
                    padding: const EdgeInsets.all(10),
                    decoration: BoxDecoration(
                      color: AppColors.surface,
                      borderRadius: BorderRadius.circular(12),
                      border: Border.all(color: AppColors.borderLight),
                    ),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      mainAxisAlignment: MainAxisAlignment.center,
                      children: [
                        Text(
                          item.subjectName,
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style: const TextStyle(
                            fontSize: 10,
                            fontWeight: FontWeight.w700,
                            color: AppColors.primary,
                          ),
                        ),
                        const SizedBox(height: 2),
                        Text(
                          item.chapterTitle,
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style: const TextStyle(
                            fontSize: 12,
                            fontWeight: FontWeight.w600,
                            color: AppColors.textPrimary,
                          ),
                        ),
                        Text(
                          isHi
                              ? 'अध्याय ${item.chapterNumber}'
                              : 'Ch ${item.chapterNumber}',
                          style: const TextStyle(
                            fontSize: 9,
                            color: AppColors.textTertiary,
                          ),
                        ),
                      ],
                    ),
                  ),
                );
              },
            ),
          ),
        ],
      ),
    );
  }
}

class _ChapterList extends ConsumerWidget {
  final String subjectCode;
  final String subjectName;
  final bool isHi;

  const _ChapterList({
    required this.subjectCode,
    required this.subjectName,
    required this.isHi,
  });

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final chaptersAsync = ref.watch(chaptersProvider(subjectCode));
    final color = AppColors.subjectColor(subjectCode);

    return chaptersAsync.when(
      loading: () => const Padding(
        padding: EdgeInsets.symmetric(vertical: 12),
        child: ShimmerList(count: 4, itemHeight: 64),
      ),
      error: (e, _) => e is LearnOfflineException
          ? LearnOfflineState(
              isHi: isHi,
              onRetry: () => ref.invalidate(chaptersProvider(subjectCode)),
            )
          : AppErrorWidget(
              message: e.toString(),
              onRetry: () => ref.invalidate(chaptersProvider(subjectCode)),
            ),
      data: (result) {
        final chapters = result.data;
        if (chapters.isEmpty) {
          return Padding(
            padding: const EdgeInsets.symmetric(vertical: 24),
            child: Center(
              child: Column(
                children: [
                  const Text('🔍', style: TextStyle(fontSize: 40)),
                  const SizedBox(height: 8),
                  Text(
                    isHi ? 'अभी कोई अध्याय उपलब्ध नहीं' : 'No chapters available yet',
                    style: const TextStyle(
                      fontSize: 13,
                      fontWeight: FontWeight.w600,
                      color: AppColors.textSecondary,
                    ),
                  ),
                  const SizedBox(height: 4),
                  Text(
                    isHi
                        ? 'इस विषय का कंटेंट जल्द आ रहा है'
                        : 'Content coming soon for this subject',
                    style: const TextStyle(fontSize: 11, color: AppColors.textTertiary),
                  ),
                ],
              ),
            ),
          );
        }

        return Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            if (result.isStaleOffline && result.asOf != null)
              OfflineAsOfChip(asOf: result.asOf!, isHi: isHi),
            Padding(
              padding: const EdgeInsets.only(bottom: 10),
              child: Text(
                isHi
                    ? '${chapters.length} अध्याय उपलब्ध'
                    : '${chapters.length} chapter${chapters.length != 1 ? 's' : ''} available',
                style: const TextStyle(fontSize: 11, color: AppColors.textTertiary),
              ),
            ),
            ...chapters.map((ch) => Padding(
                  padding: const EdgeInsets.only(bottom: 8),
                  child: GestureDetector(
                    onTap: () {
                      ref.read(libraryRecentProvider.notifier).recordChapterViewed(
                            subjectCode: subjectCode,
                            subjectName: subjectName,
                            chapterId: ch.id,
                            chapterNumber: ch.chapterNumber,
                            chapterTitle: ch.title,
                          );
                      context.push('/learn/$subjectCode/${ch.id}');
                    },
                    child: Container(
                      padding: const EdgeInsets.all(14),
                      decoration: BoxDecoration(
                        color: AppColors.surface,
                        borderRadius: BorderRadius.circular(14),
                        border: Border.all(color: color.withValues(alpha: 0.15)),
                      ),
                      child: Row(
                        children: [
                          Container(
                            width: 36,
                            height: 36,
                            decoration: BoxDecoration(
                              color: color.withValues(alpha: 0.12),
                              borderRadius: BorderRadius.circular(10),
                            ),
                            alignment: Alignment.center,
                            child: Text(
                              '${ch.chapterNumber}',
                              style: TextStyle(
                                fontSize: 13,
                                fontWeight: FontWeight.w700,
                                color: color,
                              ),
                            ),
                          ),
                          const SizedBox(width: 12),
                          Expanded(
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                Text(
                                  ch.title,
                                  style: const TextStyle(
                                    fontSize: 13,
                                    fontWeight: FontWeight.w600,
                                    color: AppColors.textPrimary,
                                  ),
                                ),
                                if (ch.topicCount > 0)
                                  Text(
                                    isHi ? '${ch.topicCount} विषय' : '${ch.topicCount} topics',
                                    style: const TextStyle(
                                      fontSize: 11,
                                      color: AppColors.textTertiary,
                                    ),
                                  ),
                              ],
                            ),
                          ),
                          const Icon(Icons.arrow_forward_ios_rounded,
                              size: 12, color: AppColors.textTertiary),
                        ],
                      ),
                    ),
                  ),
                )),
          ],
        );
      },
    );
  }
}
