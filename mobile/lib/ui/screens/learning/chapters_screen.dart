import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../core/constants/app_colors.dart';
import '../../../data/repositories/learning_repository.dart';
import '../../../providers/learning_provider.dart';
import '../../widgets/learn_states.dart';
import '../../widgets/loading_widget.dart';
import '../../widgets/error_widget.dart';

class ChaptersScreen extends ConsumerWidget {
  final String subjectCode;

  const ChaptersScreen({super.key, required this.subjectCode});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final chaptersAsync = ref.watch(chaptersProvider(subjectCode));
    final color = AppColors.subjectColor(subjectCode);
    final isHi = Localizations.localeOf(context).languageCode == 'hi';

    return Scaffold(
      backgroundColor: AppColors.background,
      appBar: AppBar(
        title: Text(_subjectName(subjectCode)),
        leading: IconButton(
          icon: const Icon(Icons.arrow_back_rounded),
          onPressed: () => context.go('/learn'),
        ),
      ),
      body: chaptersAsync.when(
        // Loading state.
        loading: () => const Padding(
          padding: EdgeInsets.all(16),
          child: ShimmerList(count: 6, itemHeight: 72),
        ),
        // Offline-refuse state vs generic Error state.
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
          // Empty / Coming-soon state.
          if (chapters.isEmpty) {
            return Center(
              child: Text(
                isHi
                    ? 'अभी कोई अध्याय उपलब्ध नहीं है।'
                    : 'No chapters available yet.',
                style: const TextStyle(color: AppColors.textTertiary),
              ),
            );
          }
          return Column(
            children: [
              // Non-blocking "content as of {date}" chip when served from
              // cache while offline.
              if (result.isStaleOffline && result.asOf != null)
                OfflineAsOfChip(asOf: result.asOf!, isHi: isHi),
              Expanded(
                child: ListView.separated(
                  padding: const EdgeInsets.all(16),
                  itemCount: chapters.length,
                  separatorBuilder: (_, __) => const SizedBox(height: 8),
                  itemBuilder: (context, index) {
                    final ch = chapters[index];
                    return GestureDetector(
                      onTap: () => context.go('/learn/$subjectCode/${ch.id}'),
                      child: Container(
                        padding: const EdgeInsets.all(14),
                        decoration: BoxDecoration(
                          color: AppColors.surface,
                          borderRadius: BorderRadius.circular(12),
                          border: Border.all(color: AppColors.borderLight),
                        ),
                        child: Row(
                          children: [
                            // Chapter number
                            Container(
                              width: 36,
                              height: 36,
                              decoration: BoxDecoration(
                                color: color.withValues(alpha: 0.1),
                                borderRadius: BorderRadius.circular(10),
                              ),
                              alignment: Alignment.center,
                              child: Text(
                                '${ch.chapterNumber}',
                                style: TextStyle(
                                  fontSize: 14,
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
                                      fontSize: 14,
                                      fontWeight: FontWeight.w600,
                                      color: AppColors.textPrimary,
                                    ),
                                  ),
                                  if (ch.topicCount > 0)
                                    Text(
                                      isHi
                                          ? '${ch.topicCount} विषय'
                                          : '${ch.topicCount} topics',
                                      style: const TextStyle(
                                        fontSize: 11,
                                        color: AppColors.textTertiary,
                                      ),
                                    ),
                                ],
                              ),
                            ),
                            if (ch.progress > 0)
                              SizedBox(
                                width: 32,
                                height: 32,
                                child: CircularProgressIndicator(
                                  value: ch.progress,
                                  strokeWidth: 3,
                                  backgroundColor: AppColors.borderLight,
                                  valueColor: AlwaysStoppedAnimation(color),
                                ),
                              ),
                            const SizedBox(width: 6),
                            const Icon(Icons.arrow_forward_ios_rounded,
                                size: 12, color: AppColors.textTertiary),
                          ],
                        ),
                      ),
                    );
                  },
                ),
              ),
            ],
          );
        },
      ),
    );
  }

  String _subjectName(String code) {
    const names = {
      'math': 'Mathematics',
      'science': 'Science',
      'physics': 'Physics',
      'chemistry': 'Chemistry',
      'biology': 'Biology',
      'english': 'English',
      'hindi': 'Hindi',
      'social_studies': 'Social Studies',
      'coding': 'Coding',
      'computer_science': 'Computer Science',
    };
    return names[code] ?? code;
  }
}
