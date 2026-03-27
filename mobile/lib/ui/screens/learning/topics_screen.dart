import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../core/constants/app_colors.dart';
import '../../../providers/learning_provider.dart';
import '../../widgets/loading_widget.dart';
import '../../widgets/error_widget.dart';

class TopicsScreen extends ConsumerWidget {
  final String subjectCode;
  final String chapterId;
  final String chapterTitle;

  const TopicsScreen({
    super.key,
    required this.subjectCode,
    required this.chapterId,
    required this.chapterTitle,
  });

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final topicsAsync = ref.watch(topicsProvider(chapterId));
    final color = AppColors.subjectColor(subjectCode);

    return Scaffold(
      backgroundColor: AppColors.background,
      appBar: AppBar(
        title: Text(chapterTitle),
        leading: IconButton(
          icon: const Icon(Icons.arrow_back_rounded),
          onPressed: () => context.go('/learn/$subjectCode'),
        ),
      ),
      body: topicsAsync.when(
        loading: () => const Padding(
          padding: EdgeInsets.all(16),
          child: ShimmerList(count: 5, itemHeight: 64),
        ),
        error: (e, _) => AppErrorWidget(
          message: e.toString(),
          onRetry: () => ref.invalidate(topicsProvider(chapterId)),
        ),
        data: (topics) {
          if (topics.isEmpty) {
            return Center(
              child: Padding(
                padding: const EdgeInsets.all(32),
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Icon(Icons.topic_outlined,
                        size: 48, color: AppColors.textTertiary.withOpacity(0.5)),
                    const SizedBox(height: 12),
                    const Text(
                      'No topics available yet.',
                      style: TextStyle(
                        color: AppColors.textTertiary,
                        fontSize: 15,
                      ),
                    ),
                    const SizedBox(height: 4),
                    const Text(
                      'Content is being added soon!',
                      style: TextStyle(
                        color: AppColors.textTertiary,
                        fontSize: 12,
                      ),
                    ),
                  ],
                ),
              ),
            );
          }

          return RefreshIndicator(
            color: color,
            onRefresh: () async {
              ref.invalidate(topicsProvider(chapterId));
              await Future.delayed(const Duration(milliseconds: 300));
            },
            child: ListView.separated(
            physics: const AlwaysScrollableScrollPhysics(),
            padding: const EdgeInsets.all(16),
            itemCount: topics.length,
            separatorBuilder: (_, __) => const SizedBox(height: 8),
            itemBuilder: (context, index) {
              final topic = topics[index];
              return GestureDetector(
                onTap: () => context.go(
                  '/learn/$subjectCode/$chapterId/${topic.id}',
                ),
                child: Container(
                  padding: const EdgeInsets.all(14),
                  decoration: BoxDecoration(
                    color: AppColors.surface,
                    borderRadius: BorderRadius.circular(12),
                    border: Border.all(color: AppColors.borderLight),
                  ),
                  child: Row(
                    children: [
                      // Topic number
                      Container(
                        width: 32,
                        height: 32,
                        decoration: BoxDecoration(
                          color: topic.isCompleted
                              ? AppColors.success.withOpacity(0.1)
                              : color.withOpacity(0.1),
                          borderRadius: BorderRadius.circular(8),
                        ),
                        alignment: Alignment.center,
                        child: topic.isCompleted
                            ? const Icon(Icons.check_rounded,
                                size: 16, color: AppColors.success)
                            : Text(
                                '${topic.topicOrder}',
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
                              topic.title,
                              style: TextStyle(
                                fontSize: 14,
                                fontWeight: FontWeight.w600,
                                color: topic.isCompleted
                                    ? AppColors.textSecondary
                                    : AppColors.textPrimary,
                              ),
                            ),
                            if (topic.titleHi != null)
                              Text(
                                topic.titleHi!,
                                style: const TextStyle(
                                  fontSize: 11,
                                  color: AppColors.textTertiary,
                                ),
                              ),
                          ],
                        ),
                      ),
                      Icon(
                        Icons.arrow_forward_ios_rounded,
                        size: 12,
                        color: AppColors.textTertiary,
                      ),
                    ],
                  ),
                ),
              );
            },
          ),
          );
        },
      ),
    );
  }
}
