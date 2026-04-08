import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/constants/app_colors.dart';
import '../../../core/constants/grade_subjects.dart';
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
            ...GradeSubjects.forGrade(student.gradeNumber).map((subj) {
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
                        Text(subj.emoji, style: const TextStyle(fontSize: 24)),
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
            }),
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
            decoration: BoxDecoration(
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

class _ResultScreen extends ConsumerWidget {
  final QuizState quiz;

  const _ResultScreen({required this.quiz});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final result = quiz.result!;
    final isGood = result.scorePercent >= 70;

    return Scaffold(
      backgroundColor: AppColors.background,
      body: SafeArea(
        child: Center(
          child: Padding(
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

                // Stats row
                Row(
                  mainAxisAlignment: MainAxisAlignment.spaceEvenly,
                  children: [
                    _ResultStat(
                      label: 'Correct',
                      value: '${result.correctAnswers}/${result.totalQuestions}',
                      color: AppColors.success,
                    ),
                    _ResultStat(
                      label: 'XP Earned',
                      value: '+${result.xpEarned}',
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
