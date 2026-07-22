import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../core/constants/app_colors.dart';
import '../../../data/models/exam_models.dart';
import '../../../providers/exam_provider.dart';
import '../../widgets/quiz_question_widgets.dart';

/// Mock exam results — mobile parity for the web results page
/// (`packages/ui/src/exams/MockTestResultsParts.tsx`).
///
/// ─────────────────────────────────────────────────────────────────────────
/// P1 — EVERY number on this screen is read straight off
/// [ExamSubmitResult.summary], which is the verbatim decode of
/// `POST /api/exams/papers/{id}/submit`'s response (itself produced by the
/// `submit_mock_test_attempt` RPC scoring against the attempt's stored
/// `question_snapshot`).
///
/// This screen deliberately contains:
///   * NO `correct / total` arithmetic
///   * NO marks summation over [ExamSubmitResult.review]
///   * NO XP formula
///   * NO percentage rounding
///
/// It reads `summary.scorePercent`, `summary.rawScore`, `summary.maxScore`,
/// `summary.correctCount` and `summary.xpEarned` as given. The only local
/// arithmetic is `scorePercent / 100` to drive a progress bar's 0..1 value,
/// which renders the server's own number and does not derive it.
///
/// This mirrors `quiz_repository.dart`'s standing rule: "the device displays
/// the server's values VERBATIM".
/// ─────────────────────────────────────────────────────────────────────────
class MockExamResultsScreen extends ConsumerWidget {
  final String paperId;
  const MockExamResultsScreen({super.key, required this.paperId});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final isHi = Localizations.localeOf(context).languageCode == 'hi';
    final state = ref.watch(examAttemptProvider);
    final result = state.submitResult;

    return Scaffold(
      backgroundColor: AppColors.background,
      appBar: AppBar(
        backgroundColor: AppColors.surface,
        foregroundColor: AppColors.textPrimary,
        elevation: 0,
        title: Text(isHi ? 'परिणाम' : 'Results'),
        automaticallyImplyLeading: false,
        actions: [
          TextButton(
            onPressed: () {
              ref.read(examAttemptProvider.notifier).reset();
              context.go('/exams');
            },
            child: Text(isHi ? 'हो गया' : 'Done'),
          ),
        ],
      ),
      body: SafeArea(
        child: result == null
            ? _NoResult(isHi: isHi)
            : _Results(result: result, isHi: isHi),
      ),
    );
  }
}

class _NoResult extends ConsumerWidget {
  final bool isHi;
  const _NoResult({required this.isHi});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(28),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            const Text('🗒️', style: TextStyle(fontSize: 40)),
            const SizedBox(height: 12),
            Text(
              isHi ? 'कोई परिणाम उपलब्ध नहीं' : 'No result to show',
              style: const TextStyle(
                fontSize: 15,
                fontWeight: FontWeight.w700,
                color: AppColors.textPrimary,
              ),
            ),
            const SizedBox(height: 6),
            Text(
              isHi
                  ? 'यह परिणाम इस सत्र में उपलब्ध नहीं है।'
                  : 'This result is not available in this session.',
              textAlign: TextAlign.center,
              style: const TextStyle(fontSize: 12.5, color: AppColors.textTertiary),
            ),
            const SizedBox(height: 20),
            ElevatedButton(
              onPressed: () {
                ref.read(examAttemptProvider.notifier).reset();
                context.go('/exams');
              },
              style: ElevatedButton.styleFrom(
                backgroundColor: AppColors.brand,
                foregroundColor: Colors.white,
                minimumSize: const Size(200, 46),
              ),
              child: Text(isHi ? 'मॉक टेस्ट देखें' : 'Back to mock tests'),
            ),
          ],
        ),
      ),
    );
  }
}

class _Results extends StatelessWidget {
  final ExamSubmitResult result;
  final bool isHi;
  const _Results({required this.result, required this.isHi});

  @override
  Widget build(BuildContext context) {
    final s = result.summary;
    // P1: `s.scorePercent` is the SERVER's number. It is only compared
    // against thresholds to pick an emoji/colour — never recomputed.
    final pct = s.scorePercent;
    final emoji = pct >= 80 ? '🏆' : (pct >= 50 ? '💪' : '📚');
    final tone = pct >= 80
        ? AppColors.success
        : (pct >= 50 ? AppColors.warning : AppColors.error);

    return ListView(
      padding: const EdgeInsets.all(20),
      children: [
        Center(child: Text(emoji, style: const TextStyle(fontSize: 44))),
        const SizedBox(height: 14),
        Container(
          padding: const EdgeInsets.all(20),
          decoration: BoxDecoration(
            color: AppColors.surface,
            borderRadius: BorderRadius.circular(16),
            border: Border.all(color: AppColors.borderLight),
          ),
          child: Column(
            children: [
              Text(
                // Verbatim server value.
                '$pct%',
                key: const Key('exam_result_score_percent'),
                style: TextStyle(fontSize: 40, fontWeight: FontWeight.w800, color: tone),
              ),
              const SizedBox(height: 8),
              LinearProgressIndicator(
                value: (pct / 100).clamp(0.0, 1.0),
                minHeight: 8,
                backgroundColor: AppColors.borderLight,
                valueColor: AlwaysStoppedAnimation(tone),
              ),
              const SizedBox(height: 12),
              Text(
                // Verbatim server marks — not summed from `review`.
                isHi
                    ? '${s.rawScore} / ${s.maxScore} अंक'
                    : '${s.rawScore} / ${s.maxScore} marks',
                key: const Key('exam_result_marks'),
                style: const TextStyle(
                  fontSize: 16,
                  fontWeight: FontWeight.w700,
                  color: AppColors.textPrimary,
                ),
              ),
            ],
          ),
        ),
        const SizedBox(height: 14),
        GridView.count(
          crossAxisCount: 2,
          shrinkWrap: true,
          physics: const NeverScrollableScrollPhysics(),
          crossAxisSpacing: 10,
          mainAxisSpacing: 10,
          childAspectRatio: 2.6,
          children: [
            _StatTile(
              label: isHi ? 'सही' : 'Correct',
              value: '${s.correctCount}',
              color: AppColors.success,
              valueKey: const Key('exam_result_correct'),
            ),
            _StatTile(
              label: isHi ? 'गलत' : 'Wrong',
              value: '${s.wrongCount}',
              color: AppColors.error,
            ),
            _StatTile(
              label: isHi ? 'छोड़े' : 'Skipped',
              value: '${s.skippedCount}',
              color: AppColors.textTertiary,
            ),
            _StatTile(
              // P2: XP comes only from the server response.
              label: 'XP',
              value: '+${s.xpEarned}',
              color: AppColors.brand,
              valueKey: const Key('exam_result_xp'),
            ),
          ],
        ),
        const SizedBox(height: 10),
        Container(
          padding: const EdgeInsets.all(14),
          decoration: BoxDecoration(
            color: AppColors.surface,
            borderRadius: BorderRadius.circular(12),
            border: Border.all(color: AppColors.borderLight),
          ),
          child: Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              Text(
                isHi ? 'लगा समय' : 'Time taken',
                style: const TextStyle(fontSize: 12.5, color: AppColors.textSecondary),
              ),
              Text(
                _formatDuration(s.timeTakenSeconds, isHi),
                style: const TextStyle(
                  fontSize: 12.5,
                  fontWeight: FontWeight.w700,
                  color: AppColors.textPrimary,
                ),
              ),
            ],
          ),
        ),
        const SizedBox(height: 22),
        if (result.review.isNotEmpty) ...[
          Text(
            isHi ? 'उत्तर समीक्षा' : 'Answer review',
            style: const TextStyle(
              fontSize: 15,
              fontWeight: FontWeight.w800,
              color: AppColors.textPrimary,
            ),
          ),
          const SizedBox(height: 10),
          for (var i = 0; i < result.review.length; i++)
            _ReviewCard(index: i, item: result.review[i], isHi: isHi),
        ],
      ],
    );
  }

  static String _formatDuration(int seconds, bool isHi) {
    final m = seconds ~/ 60;
    final s = seconds % 60;
    if (m == 0) return isHi ? '$s सेकंड' : '${s}s';
    return isHi ? '$m मिनट $s सेकंड' : '${m}m ${s}s';
  }
}

class _StatTile extends StatelessWidget {
  final String label;
  final String value;
  final Color color;
  final Key? valueKey;

  const _StatTile({
    required this.label,
    required this.value,
    required this.color,
    this.valueKey,
  });

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
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
            label,
            style: const TextStyle(fontSize: 11, color: AppColors.textTertiary),
          ),
          const SizedBox(height: 2),
          Text(
            value,
            key: valueKey,
            style: TextStyle(fontSize: 18, fontWeight: FontWeight.w800, color: color),
          ),
        ],
      ),
    );
  }
}

/// One review row. `isCorrect`, `marksAwarded` and `correctAnswerIndex` all
/// come from the server's `review[]` — the tile only paints them.
class _ReviewCard extends StatelessWidget {
  final int index;
  final ExamReviewItem item;
  final bool isHi;

  const _ReviewCard({required this.index, required this.item, required this.isHi});

  @override
  Widget build(BuildContext context) {
    final statusColor = item.isSkipped
        ? AppColors.textTertiary
        : (item.isCorrect ? AppColors.success : AppColors.error);
    final statusLabel = item.isSkipped
        ? (isHi ? 'छोड़ा' : 'Skipped')
        : (item.isCorrect ? (isHi ? 'सही' : 'Correct') : (isHi ? 'गलत' : 'Wrong'));

    return Padding(
      padding: const EdgeInsets.only(bottom: 12),
      child: Container(
        padding: const EdgeInsets.all(14),
        decoration: BoxDecoration(
          color: AppColors.surface,
          borderRadius: BorderRadius.circular(12),
          border: Border.all(color: AppColors.borderLight),
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Text(
                  'Q${index + 1}',
                  style: const TextStyle(
                    fontSize: 12,
                    fontWeight: FontWeight.w800,
                    color: AppColors.textTertiary,
                  ),
                ),
                const SizedBox(width: 8),
                Container(
                  padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                  decoration: BoxDecoration(
                    color: statusColor.withValues(alpha: 0.1),
                    borderRadius: BorderRadius.circular(20),
                  ),
                  child: Text(
                    statusLabel,
                    style: TextStyle(
                      fontSize: 10.5,
                      fontWeight: FontWeight.w700,
                      color: statusColor,
                    ),
                  ),
                ),
                const Spacer(),
                Text(
                  // Server-awarded marks for this question, verbatim.
                  isHi ? '${item.marksAwarded} अंक' : '${item.marksAwarded} marks',
                  style: const TextStyle(
                    fontSize: 11.5,
                    fontWeight: FontWeight.w700,
                    color: AppColors.textSecondary,
                  ),
                ),
              ],
            ),
            const SizedBox(height: 10),
            Text(
              item.questionText,
              style: const TextStyle(
                fontSize: 13.5,
                fontWeight: FontWeight.w600,
                color: AppColors.textPrimary,
                height: 1.45,
              ),
            ),
            const SizedBox(height: 10),
            if (item.options.isNotEmpty)
              // Reuses the shared quiz option tiles in reveal mode — the
              // correct index shown is the SERVER's `correct_answer_index`,
              // which only exists in the post-submit payload.
              QuestionOptionsList(
                options: item.options,
                selectedIndex: item.responseIndex,
                showResult: true,
                correctIndex: item.correctAnswerIndex,
              ),
            if (item.explanation != null && item.explanation!.trim().isNotEmpty) ...[
              const SizedBox(height: 4),
              Container(
                padding: const EdgeInsets.all(12),
                decoration: BoxDecoration(
                  color: AppColors.background,
                  borderRadius: BorderRadius.circular(10),
                ),
                child: Text(
                  item.explanation!,
                  style: const TextStyle(
                    fontSize: 12.5,
                    color: AppColors.textSecondary,
                    height: 1.5,
                  ),
                ),
              ),
            ],
          ],
        ),
      ),
    );
  }
}
