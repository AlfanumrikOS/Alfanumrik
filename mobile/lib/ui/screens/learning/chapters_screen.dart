import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../core/constants/app_colors.dart';
import '../../../providers/learning_provider.dart';
import '../../widgets/loading_widget.dart';
import '../../widgets/error_widget.dart';

class ChaptersScreen extends ConsumerWidget {
  final String subjectCode;

  const ChaptersScreen({super.key, required this.subjectCode});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final chaptersAsync = ref.watch(chaptersProvider(subjectCode));
    final color = AppColors.subjectColor(subjectCode);

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
        loading: () => Padding(
          padding: const EdgeInsets.all(16),
          child: ShimmerList(count: 6, itemHeight: 72),
        ),
        error: (e, _) => AppErrorWidget(
          message: e.toString(),
          onRetry: () => ref.invalidate(chaptersProvider(subjectCode)),
        ),
        data: (chapters) {
          if (chapters.isEmpty) {
            return const Center(
              child: Text(
                'No chapters available yet.',
                style: TextStyle(color: AppColors.textTertiary),
              ),
            );
          }
          return ListView.separated(
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
                          color: color.withOpacity(0.1),
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
                                '${ch.topicCount} topics',
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
                      Icon(Icons.arrow_forward_ios_rounded,
                          size: 12, color: AppColors.textTertiary),
                    ],
                  ),
                ),
              );
            },
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
