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
                          color: AppColors.accent.withOpacity(0.06),
                          borderRadius: BorderRadius.circular(12),
                          border: Border.all(
                            color: AppColors.accent.withOpacity(0.15),
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

/// Renders concept text with formatting: headings, bullets, numbered lists,
/// bold/italic inline text, and highlighted key terms.
class _ConceptContent extends StatelessWidget {
  final String text;

  const _ConceptContent({required this.text});

  static final _numberedListPattern = RegExp(r'^\d+[\.\)]\s+');
  static final _boldPattern = RegExp(r'\*\*(.+?)\*\*');
  static final _italicPattern = RegExp(r'\*(.+?)\*');

  @override
  Widget build(BuildContext context) {
    final lines = text.split('\n');
    final widgets = <Widget>[];

    for (final line in lines) {
      final trimmed = line.trim();
      if (trimmed.isEmpty) {
        widgets.add(const SizedBox(height: 8));
        continue;
      }

      // Heading
      if (trimmed.startsWith('#')) {
        final level = trimmed.indexOf(RegExp(r'[^#]'));
        final cleaned = trimmed.substring(level).trim();
        widgets.add(Padding(
          padding: const EdgeInsets.only(top: 16, bottom: 6),
          child: Text(
            cleaned,
            style: TextStyle(
              fontSize: level <= 1 ? 18 : (level == 2 ? 16 : 15),
              fontWeight: FontWeight.w700,
              color: AppColors.textPrimary,
              height: 1.4,
            ),
          ),
        ));
        continue;
      }

      // Bullet points
      if (trimmed.startsWith('- ') || trimmed.startsWith('• ')) {
        widgets.add(Padding(
          padding: const EdgeInsets.only(bottom: 4, left: 8),
          child: Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              const Padding(
                padding: EdgeInsets.only(top: 6),
                child: Icon(Icons.circle, size: 5, color: AppColors.textTertiary),
              ),
              const SizedBox(width: 10),
              Expanded(child: _buildRichText(trimmed.substring(2))),
            ],
          ),
        ));
        continue;
      }

      // Numbered lists
      final numMatch = _numberedListPattern.firstMatch(trimmed);
      if (numMatch != null) {
        final number = trimmed.substring(0, numMatch.end - 1).trim();
        final content = trimmed.substring(numMatch.end);
        widgets.add(Padding(
          padding: const EdgeInsets.only(bottom: 4, left: 8),
          child: Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              SizedBox(
                width: 22,
                child: Text(
                  '$number.',
                  style: const TextStyle(
                    fontSize: 14,
                    fontWeight: FontWeight.w600,
                    color: AppColors.textSecondary,
                    height: 1.6,
                  ),
                ),
              ),
              const SizedBox(width: 6),
              Expanded(child: _buildRichText(content)),
            ],
          ),
        ));
        continue;
      }

      // Regular paragraph
      widgets.add(Padding(
        padding: const EdgeInsets.only(bottom: 8),
        child: _buildRichText(trimmed),
      ));
    }

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: widgets,
    );
  }

  /// Renders text with **bold** and *italic* inline formatting.
  Widget _buildRichText(String text) {
    if (!text.contains('*')) {
      return Text(
        text,
        style: const TextStyle(
          fontSize: 14,
          color: AppColors.textPrimary,
          height: 1.7,
        ),
      );
    }

    final spans = <TextSpan>[];
    var remaining = text;

    while (remaining.isNotEmpty) {
      // Try bold first
      final boldMatch = _boldPattern.firstMatch(remaining);
      final italicMatch = _italicPattern.firstMatch(remaining);

      // Find the earliest match
      RegExpMatch? earliest;
      bool isBold = false;
      if (boldMatch != null && (italicMatch == null || boldMatch.start <= italicMatch.start)) {
        earliest = boldMatch;
        isBold = true;
      } else if (italicMatch != null) {
        earliest = italicMatch;
      }

      if (earliest == null) {
        spans.add(TextSpan(text: remaining));
        break;
      }

      // Add text before match
      if (earliest.start > 0) {
        spans.add(TextSpan(text: remaining.substring(0, earliest.start)));
      }

      // Add formatted text
      spans.add(TextSpan(
        text: earliest.group(1),
        style: TextStyle(
          fontWeight: isBold ? FontWeight.w700 : FontWeight.w400,
          fontStyle: isBold ? FontStyle.normal : FontStyle.italic,
          color: isBold ? AppColors.textPrimary : AppColors.textSecondary,
        ),
      ));

      remaining = remaining.substring(earliest.end);
    }

    return RichText(
      text: TextSpan(
        style: const TextStyle(
          fontSize: 14,
          color: AppColors.textPrimary,
          height: 1.7,
        ),
        children: spans,
      ),
    );
  }
}
