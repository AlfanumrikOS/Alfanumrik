import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/constants/app_colors.dart';
import '../../../core/services/subjects_provider.dart';
import '../../../data/models/quiz_question.dart';
import '../../../providers/auth_provider.dart';
import '../../../providers/quiz_provider.dart';
import '../../widgets/loading_widget.dart';

class QuizScreen extends ConsumerWidget {
  const QuizScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final quiz = ref.watch(quizProvider);
    final student = ref.watch(studentProvider).valueOrNull;

    // Show result screen
    if (quiz.result != null) {
      return _ResultScreen(quiz: quiz);
    }

    // Show quiz in progress
    if (quiz.questions.isNotEmpty) {
      return _QuizInProgress(quiz: quiz);
    }

    // Show loading
    if (quiz.isLoading) {
      return Scaffold(
        backgroundColor: AppColors.background,
        appBar: AppBar(title: const Text('Quiz')),
        body: const LoadingScreen(message: 'Loading questions...'),
      );
    }

    // Subject selection
    final subjectsAsync = ref.watch(subjectsProvider);

    return Scaffold(
      backgroundColor: AppColors.background,
      appBar: AppBar(title: const Text('Practice Quiz')),
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          const Text(
            'Choose a subject',
            style: TextStyle(
              fontSize: 16,
              fontWeight: FontWeight.w600,
              color: AppColors.textSecondary,
            ),
          ),
          const SizedBox(height: 12),
          if (student != null)
            ...subjectsAsync.when(
              loading: () => const [
                Padding(
                  padding: EdgeInsets.symmetric(vertical: 24),
                  child: Center(child: CircularProgressIndicator()),
                ),
              ],
              error: (e, _) => [
                Padding(
                  padding: const EdgeInsets.symmetric(vertical: 12),
                  child: Text(
                    e.toString(),
                    style: const TextStyle(color: AppColors.error, fontSize: 13),
                    textAlign: TextAlign.center,
                  ),
                ),
              ],
              data: (subjects) => subjects.where((s) => !s.isLocked).map((subj) {
                final color = AppColors.subjectColor(subj.code);
                return Padding(
                  padding: const EdgeInsets.only(bottom: 8),
                  child: GestureDetector(
                    onTap: () {
                      ref.read(quizProvider.notifier).startQuiz(
                            subject: subj.code,
                            count: 10,
                          );
                    },
                    child: Container(
                      padding: const EdgeInsets.all(16),
                      decoration: BoxDecoration(
                        color: AppColors.surface,
                        borderRadius: BorderRadius.circular(12),
                        border: Border.all(color: color.withValues(alpha: 0.15)),
                      ),
                      child: Row(
                        children: [
                          Text(subj.icon, style: const TextStyle(fontSize: 24)),
                          const SizedBox(width: 14),
                          Expanded(
                            child: Text(
                              subj.name,
                              style: const TextStyle(
                                fontSize: 15,
                                fontWeight: FontWeight.w600,
                                color: AppColors.textPrimary,
                              ),
                            ),
                          ),
                          Text(
                            '10 Qs',
                            style: TextStyle(
                              fontSize: 12,
                              color: color,
                              fontWeight: FontWeight.w500,
                            ),
                          ),
                          const SizedBox(width: 6),
                          Icon(Icons.play_arrow_rounded, color: color, size: 20),
                        ],
                      ),
                    ),
                  ),
                );
              }).toList(),
            ),
          if (quiz.error != null)
            Padding(
              padding: const EdgeInsets.only(top: 12),
              child: Text(
                quiz.error!,
                style: const TextStyle(color: AppColors.error, fontSize: 13),
                textAlign: TextAlign.center,
              ),
            ),
        ],
      ),
    );
  }
}

class _QuizInProgress extends ConsumerWidget {
  final QuizState quiz;

  const _QuizInProgress({required this.quiz});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final q = quiz.currentQuestion;
    if (q == null) return const SizedBox.shrink();

    final selectedOption = quiz.answers[quiz.currentIndex];

    return Scaffold(
      backgroundColor: AppColors.background,
      appBar: AppBar(
        title: Text('Q ${quiz.currentIndex + 1}/${quiz.questions.length}'),
        leading: IconButton(
          icon: const Icon(Icons.close_rounded),
          onPressed: () => ref.read(quizProvider.notifier).reset(),
        ),
      ),
      body: Column(
        children: [
          // Progress bar
          LinearProgressIndicator(
            value: quiz.progress,
            minHeight: 3,
            backgroundColor: AppColors.borderLight,
            valueColor: const AlwaysStoppedAnimation(AppColors.accent),
          ),

          Expanded(
            child: SingleChildScrollView(
              padding: const EdgeInsets.all(20),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  // Question text
                  Text(
                    q.questionText,
                    style: const TextStyle(
                      fontSize: 16,
                      fontWeight: FontWeight.w600,
                      color: AppColors.textPrimary,
                      height: 1.5,
                    ),
                  ),
                  const SizedBox(height: 24),

                  // Options
                  ...List.generate(q.options.length, (i) {
                    final isSelected = selectedOption == i;
                    return Padding(
                      padding: const EdgeInsets.only(bottom: 10),
                      child: GestureDetector(
                        onTap: () =>
                            ref.read(quizProvider.notifier).selectAnswer(i),
                        child: AnimatedContainer(
                          duration: const Duration(milliseconds: 200),
                          padding: const EdgeInsets.all(14),
                          decoration: BoxDecoration(
                            color: isSelected
                                ? AppColors.primary.withValues(alpha: 0.06)
                                : AppColors.surface,
                            borderRadius: BorderRadius.circular(12),
                            border: Border.all(
                              color: isSelected
                                  ? AppColors.primary
                                  : AppColors.borderLight,
                              width: isSelected ? 1.5 : 1,
                            ),
                          ),
                          child: Row(
                            children: [
                              Container(
                                width: 28,
                                height: 28,
                                decoration: BoxDecoration(
                                  color: isSelected
                                      ? AppColors.primary
                                      : AppColors.borderLight,
                                  shape: BoxShape.circle,
                                ),
                                alignment: Alignment.center,
                                child: Text(
                                  String.fromCharCode(65 + i), // A, B, C, D
                                  style: TextStyle(
                                    fontSize: 13,
                                    fontWeight: FontWeight.w700,
                                    color: isSelected
                                        ? Colors.white
                                        : AppColors.textSecondary,
                                  ),
                                ),
                              ),
                              const SizedBox(width: 12),
                              Expanded(
                                child: Text(
                                  q.options[i],
                                  style: TextStyle(
                                    fontSize: 14,
                                    color: isSelected
                                        ? AppColors.primary
                                        : AppColors.textPrimary,
                                    fontWeight: isSelected
                                        ? FontWeight.w600
                                        : FontWeight.w400,
                                    height: 1.4,
                                  ),
                                ),
                              ),
                            ],
                          ),
                        ),
                      ),
                    );
                  }),
                ],
              ),
            ),
          ),

          // Navigation buttons
          Container(
            padding: const EdgeInsets.fromLTRB(20, 12, 20, 12),
            decoration: const BoxDecoration(
              color: AppColors.surface,
              border: Border(top: BorderSide(color: AppColors.borderLight)),
            ),
            child: SafeArea(
              top: false,
              child: Row(
                children: [
                  if (quiz.currentIndex > 0)
                    OutlinedButton(
                      onPressed: () =>
                          ref.read(quizProvider.notifier).previousQuestion(),
                      child: const Text('Previous'),
                    ),
                  const Spacer(),
                  if (quiz.currentIndex < quiz.questions.length - 1)
                    ElevatedButton(
                      onPressed: selectedOption != null
                          ? () => ref
                              .read(quizProvider.notifier)
                              .nextQuestion()
                          : null,
                      child: const Text('Next'),
                    )
                  else
                    ElevatedButton(
                      onPressed: quiz.answeredCount == quiz.questions.length
                          ? () => ref.read(quizProvider.notifier).submitQuiz()
                          : null,
                      style: ElevatedButton.styleFrom(
                        backgroundColor: AppColors.success,
                      ),
                      child: quiz.isSubmitting
                          ? const SizedBox(
                              width: 18,
                              height: 18,
                              child: CircularProgressIndicator(
                                strokeWidth: 2,
                                color: Colors.white,
                              ),
                            )
                          : const Text('Submit'),
                    ),
                ],
              ),
            ),
          ),
        ],
      ),
    );
  }
}

/// Lightweight Hindi-detection helper. Mobile has no app-wide language
/// toggle yet; until one ships we honour the device locale. This matches
/// the data-side `_hi` field convention already used elsewhere in mobile.
bool _isHindi(BuildContext context) {
  return Localizations.localeOf(context).languageCode == 'hi';
}

class _ResultScreen extends ConsumerWidget {
  final QuizState quiz;

  const _ResultScreen({required this.quiz});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final result = quiz.result!;

    // Phase 1.2: when the server raised `session_not_started`, the
    // result is a synthetic zero-score row. Show the dedicated "session
    // expired" recovery card instead of the regular results UI.
    if (quiz.sessionExpired) {
      return _SessionExpiredScreen(quiz: quiz);
    }

    final isGood = result.scorePercent >= 70;
    final isHi = _isHindi(context);

    return Scaffold(
      backgroundColor: AppColors.background,
      body: SafeArea(
        child: Center(
          child: SingleChildScrollView(
            padding: const EdgeInsets.all(32),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                Text(
                  isGood ? '🎉' : '💪',
                  style: const TextStyle(fontSize: 52),
                ),
                const SizedBox(height: 16),
                Text(
                  isGood ? 'Great Job!' : 'Keep Practicing!',
                  style: const TextStyle(
                    fontSize: 24,
                    fontWeight: FontWeight.w700,
                    color: AppColors.textPrimary,
                  ),
                ),
                const SizedBox(height: 24),

                // Score circle
                Container(
                  width: 100,
                  height: 100,
                  decoration: BoxDecoration(
                    shape: BoxShape.circle,
                    color: (isGood ? AppColors.success : AppColors.warning)
                        .withValues(alpha: 0.1),
                    border: Border.all(
                      color: isGood ? AppColors.success : AppColors.warning,
                      width: 3,
                    ),
                  ),
                  alignment: Alignment.center,
                  child: Column(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      Text(
                        '${result.scorePercent}%',
                        style: TextStyle(
                          fontSize: 24,
                          fontWeight: FontWeight.w700,
                          color: isGood ? AppColors.success : AppColors.warning,
                        ),
                      ),
                      Text(
                        result.grade,
                        style: TextStyle(
                          fontSize: 14,
                          fontWeight: FontWeight.w600,
                          color: isGood ? AppColors.success : AppColors.warning,
                        ),
                      ),
                    ],
                  ),
                ),
                const SizedBox(height: 24),

                // Daily-XP-cap banner (above the stats row, only when the
                // server flagged today's XP as capped).
                if (result.xpCapped) _DailyCapBanner(result: result, isHi: isHi),

                // Stats row
                Row(
                  mainAxisAlignment: MainAxisAlignment.spaceEvenly,
                  children: [
                    _ResultStat(
                      label: 'Correct',
                      value: '${result.correctAnswers}/${result.totalQuestions}',
                      color: AppColors.success,
                    ),
                    // Show Foxy Coins when the server returns them,
                    // otherwise fall back to legacy XP display.
                    // TODO(mobile-sync): Remove XP fallback once
                    // server fully migrates to Foxy Coins.
                    _ResultStat(
                      label: result.coinsEarned > 0
                          ? 'Coins Earned'
                          : 'XP Earned',
                      // When the daily cap fired, prefer the server's
                      // `effective_xp` (the clamped value the student
                      // actually got) over the raw `xp_earned`. Falls
                      // through to xpEarned for older deploys.
                      value: result.coinsEarned > 0
                          ? '+${result.coinsEarned}'
                          : '+${result.effectiveXp ?? result.xpEarned}',
                      color: AppColors.xpGold,
                    ),
                    _ResultStat(
                      label: 'Time',
                      value: '${result.timeTaken.inMinutes}:${(result.timeTaken.inSeconds % 60).toString().padLeft(2, '0')}',
                      color: AppColors.accent,
                    ),
                  ],
                ),
                const SizedBox(height: 32),

                ElevatedButton(
                  onPressed: () => ref.read(quizProvider.notifier).reset(),
                  child: const Text('Try Another Quiz'),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

/// Friendly bilingual banner shown when `atomic_quiz_profile_update`
/// clamps today's XP at the daily cap (200, see web `xp-config.ts`). The
/// server passes through `xp_capped`, `effective_xp`, `xp_uncapped` in
/// the RPC JSONB; this widget reads those off [QuizResult].
///
/// Bilingual rendering follows mobile's existing pattern (device locale
/// → Hindi or English; no app-wide toggle yet).
class _DailyCapBanner extends StatelessWidget {
  final QuizResult result;
  final bool isHi;

  const _DailyCapBanner({required this.result, required this.isHi});

  @override
  Widget build(BuildContext context) {
    // Defensive: if effectiveXp / xpUncapped are null (older RPC build),
    // still render a useful banner using the available values.
    final effective = result.effectiveXp ?? result.xpEarned;
    final uncapped = result.xpUncapped ?? result.xpEarned;

    final message = isHi
        ? '🎯 आज की XP सीमा पूरी हो गई! आज आपने $effective XP कमाए ($uncapped होते). कल फिर मिलते हैं!'
        : '🎯 Daily XP cap reached! You earned $effective XP today (would have been $uncapped). Come back tomorrow for more!';

    return Container(
      margin: const EdgeInsets.only(bottom: 16),
      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
      decoration: BoxDecoration(
        // Re-use existing warm/orange tokens; no new design tokens.
        color: AppColors.warning.withValues(alpha: 0.10),
        borderRadius: BorderRadius.circular(10),
        border: Border.all(color: AppColors.warning.withValues(alpha: 0.35)),
      ),
      child: Text(
        message,
        textAlign: TextAlign.center,
        style: const TextStyle(
          fontSize: 12.5,
          color: AppColors.textPrimary,
          height: 1.45,
          fontWeight: FontWeight.w500,
        ),
      ),
    );
  }
}

/// Recovery screen shown when the server raised `session_not_started`
/// (Phase 1.2, SQLSTATE P0001). The student's `quiz_session_shuffles`
/// snapshot rows are gone, so the only useful action is "restart the
/// quiz" — a retry would just hit the same RAISE.
class _SessionExpiredScreen extends ConsumerWidget {
  final QuizState quiz;

  const _SessionExpiredScreen({required this.quiz});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final isHi = _isHindi(context);

    final title = isHi ? 'क्विज़ सत्र समाप्त' : 'Quiz Session Expired';
    final body = isHi
        ? 'क्विज़ सत्र समाप्त हो गया है। कृपया क्विज़ फिर से शुरू करें।'
        : 'Quiz session expired. Please restart the quiz.';
    final cta = isHi ? 'क्विज़ फिर से शुरू करें' : 'Restart Quiz';

    return Scaffold(
      backgroundColor: AppColors.background,
      body: SafeArea(
        child: Center(
          child: Padding(
            padding: const EdgeInsets.all(32),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                const Text('⏱️', style: TextStyle(fontSize: 52)),
                const SizedBox(height: 16),
                Text(
                  title,
                  textAlign: TextAlign.center,
                  style: const TextStyle(
                    fontSize: 22,
                    fontWeight: FontWeight.w700,
                    color: AppColors.textPrimary,
                  ),
                ),
                const SizedBox(height: 12),
                Text(
                  body,
                  textAlign: TextAlign.center,
                  style: const TextStyle(
                    fontSize: 14,
                    color: AppColors.textSecondary,
                    height: 1.5,
                  ),
                ),
                const SizedBox(height: 28),
                ElevatedButton(
                  onPressed: () {
                    // Clear local session state and return to the quiz
                    // setup screen (subject picker). Subject is
                    // intentionally not auto-selected — the student may
                    // pick a different one.
                    ref.read(quizProvider.notifier).reset();
                  },
                  style: ElevatedButton.styleFrom(
                    backgroundColor: AppColors.warning,
                    foregroundColor: Colors.white,
                  ),
                  child: Text(cta),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

class _ResultStat extends StatelessWidget {
  final String label;
  final String value;
  final Color color;

  const _ResultStat({
    required this.label,
    required this.value,
    required this.color,
  });

  @override
  Widget build(BuildContext context) {
    return Column(
      children: [
        Text(
          value,
          style: TextStyle(
            fontSize: 18,
            fontWeight: FontWeight.w700,
            color: color,
          ),
        ),
        const SizedBox(height: 2),
        Text(
          label,
          style: const TextStyle(
            fontSize: 11,
            color: AppColors.textTertiary,
          ),
        ),
      ],
    );
  }
}
