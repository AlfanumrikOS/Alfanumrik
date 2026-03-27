import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../core/constants/app_colors.dart';
import '../../../providers/learning_provider.dart';
import '../../../providers/auth_provider.dart';
import '../../widgets/loading_widget.dart';
import '../../widgets/error_widget.dart';

class ConceptScreen extends ConsumerWidget {
  final String topicId;
  final String subjectCode;

  const ConceptScreen({
    super.key,
    required this.topicId,
    required this.subjectCode,
  });

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final topicAsync = ref.watch(topicContentProvider(topicId));
    final color = AppColors.subjectColor(subjectCode);

    return Scaffold(
      backgroundColor: AppColors.background,
      appBar: AppBar(
        leading: IconButton(
          icon: const Icon(Icons.arrow_back_rounded),
          onPressed: () => Navigator.of(context).pop(),
        ),
        actions: [
          // Ask Foxy about this topic
          IconButton(
            icon: const Icon(Icons.chat_bubble_outline_rounded),
            tooltip: 'Ask Foxy',
            onPressed: () => context.go('/chat'),
          ),
        ],
      ),
      body: topicAsync.when(
        loading: () => const LoadingScreen(message: 'Loading concept...'),
        error: (e, _) => AppErrorWidget(
          message: e.toString(),
          onRetry: () => ref.invalidate(topicContentProvider(topicId)),
        ),
        data: (topic) {
          if (topic == null) {
            return const AppErrorWidget(message: 'Topic not found.');
          }

          return Column(
            children: [
              // Content area
              Expanded(
                child: SingleChildScrollView(
                  padding: const EdgeInsets.all(20),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      // Title
                      Text(
                        topic.title,
                        style: TextStyle(
                          fontSize: 20,
                          fontWeight: FontWeight.w700,
                          color: color,
                          height: 1.3,
                        ),
                      ),
                      if (topic.titleHi != null) ...[
                        const SizedBox(height: 4),
                        Text(
                          topic.titleHi!,
                          style: const TextStyle(
                            fontSize: 14,
                            color: AppColors.textTertiary,
                          ),
                        ),
                      ],
                      const SizedBox(height: 20),

                      // Concept text
                      if (topic.conceptText != null)
                        _ConceptContent(text: topic.conceptText!),

                      const SizedBox(height: 24),

                      // Ask Foxy prompt
                      Container(
                        padding: const EdgeInsets.all(14),
                        decoration: BoxDecoration(
                          color: AppColors.accent.withValues(alpha: 0.06),
                          borderRadius: BorderRadius.circular(12),
                          border: Border.all(
                            color: AppColors.accent.withValues(alpha: 0.15),
                          ),
                        ),
                        child: Row(
                          children: [
                            const Text('🦊', style: TextStyle(fontSize: 20)),
                            const SizedBox(width: 10),
                            Expanded(
                              child: Column(
                                crossAxisAlignment: CrossAxisAlignment.start,
                                children: [
                                  const Text(
                                    'Didn\'t understand something?',
                                    style: TextStyle(
                                      fontSize: 13,
                                      fontWeight: FontWeight.w600,
                                      color: AppColors.textPrimary,
                                    ),
                                  ),
                                  const Text(
                                    'Ask Foxy to explain it differently',
                                    style: TextStyle(
                                      fontSize: 11,
                                      color: AppColors.textTertiary,
                                    ),
                                  ),
                                ],
                              ),
                            ),
                            TextButton(
                              onPressed: () => context.go('/chat'),
                              child: const Text('Ask'),
                            ),
                          ],
                        ),
                      ),
                    ],
                  ),
                ),
              ),

              // Bottom action bar
              Container(
                padding: const EdgeInsets.fromLTRB(20, 12, 20, 12),
                decoration: BoxDecoration(
                  color: AppColors.surface,
                  border: Border(
                    top: BorderSide(color: AppColors.borderLight),
                  ),
                ),
                child: SafeArea(
                  top: false,
                  child: Row(
                    children: [
                      Expanded(
                        child: ElevatedButton.icon(
                          onPressed: () async {
                            final student =
                                ref.read(studentProvider).valueOrNull;
                            if (student == null) return;

                            final repo = ref.read(learningRepositoryProvider);
                            await repo.markCompleted(
                              studentId: student.id,
                              topicId: topicId,
                            );

                            if (context.mounted) {
                              ScaffoldMessenger.of(context).showSnackBar(
                                const SnackBar(
                                  content: Text('Topic completed! +10 XP'),
                                  duration: Duration(seconds: 2),
                                ),
                              );
                              Navigator.of(context).pop();
                            }
                          },
                          icon: const Icon(Icons.check_rounded, size: 18),
                          label: const Text('Mark Complete'),
                        ),
                      ),
                    ],
                  ),
                ),
              ),
            ],
          );
        },
      ),
    );
  }
}

/// Renders concept text with basic formatting support
class _ConceptContent extends StatelessWidget {
  final String text;

  const _ConceptContent({required this.text});

  @override
  Widget build(BuildContext context) {
    // Split by double newlines for paragraphs
    final paragraphs = text.split('\n\n');

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: paragraphs.map((para) {
        final trimmed = para.trim();
        if (trimmed.isEmpty) return const SizedBox(height: 8);

        // Heading detection (starts with # or is short + bold-ish)
        if (trimmed.startsWith('#')) {
          final cleaned = trimmed.replaceAll(RegExp(r'^#+\s*'), '');
          return Padding(
            padding: const EdgeInsets.only(top: 16, bottom: 8),
            child: Text(
              cleaned,
              style: const TextStyle(
                fontSize: 17,
                fontWeight: FontWeight.w700,
                color: AppColors.textPrimary,
                height: 1.4,
              ),
            ),
          );
        }

        // Bullet points
        if (trimmed.startsWith('- ') || trimmed.startsWith('• ')) {
          return Padding(
            padding: const EdgeInsets.only(bottom: 6, left: 4),
            child: Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const Text('•  ',
                    style: TextStyle(
                        fontSize: 14, color: AppColors.textSecondary)),
                Expanded(
                  child: Text(
                    trimmed.substring(2),
                    style: const TextStyle(
                      fontSize: 14,
                      color: AppColors.textPrimary,
                      height: 1.6,
                    ),
                  ),
                ),
              ],
            ),
          );
        }

        // Regular paragraph
        return Padding(
          padding: const EdgeInsets.only(bottom: 12),
          child: Text(
            trimmed,
            style: const TextStyle(
              fontSize: 14,
              color: AppColors.textPrimary,
              height: 1.7,
            ),
          ),
        );
      }).toList(),
    );
  }
}
