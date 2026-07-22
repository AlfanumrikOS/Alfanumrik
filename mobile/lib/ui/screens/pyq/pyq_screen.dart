import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../core/constants/app_colors.dart';
import '../../../core/services/subjects_provider.dart';
import '../../../providers/auth_provider.dart';
import '../../../providers/pyq_provider.dart';
import '../../widgets/error_widget.dart';
import '../../widgets/quiz_question_widgets.dart';

/// PYQ (Previous Year Questions) practice — mobile parity for
/// `apps/host/src/app/(student)/pyq/page.tsx`.
///
/// Confirmed backend: reads directly from `question_bank` via
/// [PyqRepository] — NOT the exam_papers/`start_mock_test_attempt` mock-test
/// system (see that file's doc for the disambiguation).
class PyqScreen extends ConsumerWidget {
  const PyqScreen({super.key});

  static const List<int> _years = <int>[
    2025, 2024, 2023, 2022, 2021, 2020, 2019, 2018, 2017, 2016, 2015,
  ];

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final isHi = Localizations.localeOf(context).languageCode == 'hi';
    final state = ref.watch(pyqProvider);

    return Scaffold(
      backgroundColor: AppColors.background,
      appBar: AppBar(
        backgroundColor: AppColors.surface,
        foregroundColor: AppColors.textPrimary,
        elevation: 0,
        title: Text(isHi ? '📄 PYQ अभ्यास' : '📄 PYQ Practice'),
      ),
      body: SafeArea(
        child: switch (state.screen) {
          PyqScreenState.select => _SelectScreen(state: state, years: _years, isHi: isHi),
          PyqScreenState.quiz => state.questions.isEmpty
              ? _NoQuestionsScreen(isHi: isHi)
              : _QuizScreen(state: state, isHi: isHi),
          PyqScreenState.done => _DoneScreen(state: state, isHi: isHi),
        },
      ),
    );
  }
}

class _SelectScreen extends ConsumerWidget {
  final PyqState state;
  final List<int> years;
  final bool isHi;
  const _SelectScreen({required this.state, required this.years, required this.isHi});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final subjectsAsync = ref.watch(subjectsProvider);
    final student = ref.watch(studentProvider).valueOrNull;

    return ListView(
      padding: const EdgeInsets.all(16),
      children: [
        Text(
          isHi ? '1. विषय चुनें' : '1. Choose Subject',
          style: const TextStyle(fontSize: 14, fontWeight: FontWeight.w700, color: AppColors.textPrimary),
        ),
        const SizedBox(height: 10),
        subjectsAsync.when(
          loading: () => const Padding(
            padding: EdgeInsets.symmetric(vertical: 20),
            child: Center(child: CircularProgressIndicator()),
          ),
          error: (e, _) => AppErrorWidget(
            message: e.toString(),
            onRetry: () => ref.invalidate(subjectsProvider),
          ),
          data: (subjects) {
            final unlocked = subjects.where((s) => !s.isLocked).toList(growable: false);
            if (unlocked.isEmpty) {
              return Text(
                isHi
                    ? 'आपकी कक्षा और योजना के लिए कोई विषय उपलब्ध नहीं है।'
                    : 'No subjects available for your grade and plan.',
                style: const TextStyle(fontSize: 13, color: AppColors.textTertiary),
              );
            }
            return Wrap(
              spacing: 8,
              runSpacing: 8,
              children: unlocked.map((s) {
                final isSelected = state.selectedSubjectCode == s.code;
                final color = AppColors.subjectColor(s.code);
                return GestureDetector(
                  onTap: () => ref.read(pyqProvider.notifier).selectSubject(s.code),
                  child: Container(
                    padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
                    decoration: BoxDecoration(
                      color: isSelected ? color.withValues(alpha: 0.12) : AppColors.surface,
                      borderRadius: BorderRadius.circular(14),
                      border: Border.all(color: isSelected ? color : AppColors.borderLight, width: 2),
                    ),
                    child: Row(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        Text(s.icon, style: TextStyle(fontSize: 18, color: color)),
                        const SizedBox(width: 6),
                        Text(
                          isHi ? s.nameHi : s.name,
                          style: TextStyle(
                            fontSize: 12,
                            fontWeight: FontWeight.w600,
                            color: isSelected ? color : AppColors.textSecondary,
                          ),
                        ),
                      ],
                    ),
                  ),
                );
              }).toList(growable: false),
            );
          },
        ),
        if (state.selectedSubjectCode != null) ...[
          const SizedBox(height: 24),
          Text(
            isHi ? '2. वर्ष चुनें' : '2. Choose Year',
            style: const TextStyle(fontSize: 14, fontWeight: FontWeight.w700, color: AppColors.textPrimary),
          ),
          const SizedBox(height: 10),
          Wrap(
            spacing: 8,
            runSpacing: 8,
            children: years.map((yr) {
              final isSelected = state.selectedYear == yr;
              return GestureDetector(
                onTap: () => ref.read(pyqProvider.notifier).selectYear(yr),
                child: Container(
                  padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 10),
                  decoration: BoxDecoration(
                    color: isSelected ? AppColors.brand : AppColors.surface,
                    borderRadius: BorderRadius.circular(12),
                    border: Border.all(color: isSelected ? AppColors.brand : AppColors.borderLight),
                  ),
                  child: Text(
                    '$yr',
                    style: TextStyle(
                      fontSize: 13,
                      fontWeight: FontWeight.w700,
                      color: isSelected ? Colors.white : AppColors.textPrimary,
                    ),
                  ),
                ),
              );
            }).toList(growable: false),
          ),
        ],
        if (state.selectedSubjectCode != null && state.selectedYear != null) ...[
          const SizedBox(height: 28),
          ElevatedButton(
            onPressed: state.loading
                ? null
                : () => ref.read(pyqProvider.notifier).startPractice(
                      grade: student?.grade ?? '9',
                    ),
            style: ElevatedButton.styleFrom(
              backgroundColor: AppColors.brand,
              foregroundColor: Colors.white,
              minimumSize: const Size.fromHeight(48),
            ),
            child: Text(
              state.loading
                  ? (isHi ? 'लोड हो रहा है...' : 'Loading questions...')
                  : (isHi ? 'अभ्यास शुरू करें →' : 'Start Practice →'),
            ),
          ),
        ],
      ],
    );
  }
}

class _NoQuestionsScreen extends ConsumerWidget {
  final bool isHi;
  const _NoQuestionsScreen({required this.isHi});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(32),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            const Text('📄', style: TextStyle(fontSize: 48)),
            const SizedBox(height: 16),
            Text(
              isHi ? 'PYQ प्रश्न जोड़े जा रहे हैं' : 'PYQ papers being added',
              textAlign: TextAlign.center,
              style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w700, color: AppColors.textPrimary),
            ),
            const SizedBox(height: 8),
            Text(
              isHi
                  ? 'इस विषय के लिए पिछले साल के प्रश्न जल्द उपलब्ध होंगे।'
                  : 'Previous year questions for this subject are coming soon.',
              textAlign: TextAlign.center,
              style: const TextStyle(fontSize: 13, color: AppColors.textTertiary),
            ),
            const SizedBox(height: 24),
            ElevatedButton(
              onPressed: () => context.push('/quiz'),
              style: ElevatedButton.styleFrom(backgroundColor: AppColors.brand, foregroundColor: Colors.white),
              child: Text(isHi ? 'प्रश्न बैंक से अभ्यास करें' : 'Practice from Question Bank'),
            ),
            const SizedBox(height: 8),
            TextButton(
              onPressed: () => ref.read(pyqProvider.notifier).restart(),
              child: Text(isHi ? 'वापस जाएं' : 'Go back'),
            ),
          ],
        ),
      ),
    );
  }
}

class _QuizScreen extends ConsumerWidget {
  final PyqState state;
  final bool isHi;
  const _QuizScreen({required this.state, required this.isHi});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final q = state.currentQuestion!;
    final progress = state.questions.isEmpty ? 0.0 : state.currentIdx / state.questions.length;
    final isAnswered = state.showExplanation;
    final isCorrect = state.selectedOption == q.correctAnswerIndex;

    return Column(
      children: [
        Padding(
          padding: const EdgeInsets.fromLTRB(16, 8, 16, 8),
          child: Column(
            children: [
              Row(
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                children: [
                  TextButton(
                    onPressed: () => ref.read(pyqProvider.notifier).restart(),
                    child: Text(isHi ? '← वापस' : '← Back'),
                  ),
                  Text(
                    '${state.currentIdx + 1}/${state.questions.length}',
                    style: const TextStyle(fontSize: 12, color: AppColors.textTertiary),
                  ),
                  Text(
                    '${state.correctCount} ✓',
                    style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w700, color: AppColors.brand),
                  ),
                ],
              ),
              const SizedBox(height: 6),
              LinearProgressIndicator(
                value: progress,
                minHeight: 4,
                backgroundColor: AppColors.borderLight,
                valueColor: const AlwaysStoppedAnimation(AppColors.brand),
              ),
            ],
          ),
        ),
        if (state.isFallback)
          Container(
            margin: const EdgeInsets.symmetric(horizontal: 16, vertical: 4),
            padding: const EdgeInsets.all(10),
            decoration: BoxDecoration(
              color: const Color(0xFFFFF8E6),
              borderRadius: BorderRadius.circular(10),
              border: Border.all(color: const Color(0xFFF5C842)),
            ),
            child: Text(
              isHi
                  ? '📄 इस साल के PYQ प्रश्न जल्द आ रहे हैं — अभी प्रश्न बैंक से अभ्यास करें।'
                  : '📄 PYQ papers for this year are being added — practising from question bank for now.',
              style: const TextStyle(fontSize: 11.5, color: Color(0xFF6D5300)),
            ),
          ),
        Expanded(
          child: SingleChildScrollView(
            padding: const EdgeInsets.all(16),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Container(
                  padding: const EdgeInsets.all(16),
                  decoration: BoxDecoration(
                    color: AppColors.surface,
                    borderRadius: BorderRadius.circular(14),
                    border: Border.all(color: AppColors.borderLight),
                  ),
                  child: Text(
                    q.displayText(isHi),
                    style: const TextStyle(fontSize: 15, fontWeight: FontWeight.w600, color: AppColors.textPrimary, height: 1.5),
                  ),
                ),
                const SizedBox(height: 16),
                QuestionOptionsList(
                  options: q.options,
                  selectedIndex: state.selectedOption,
                  showResult: isAnswered,
                  correctIndex: q.correctAnswerIndex,
                  onSelect: (i) => ref.read(pyqProvider.notifier).selectAnswer(i),
                ),
                if (isAnswered) ...[
                  const SizedBox(height: 8),
                  Container(
                    padding: const EdgeInsets.all(14),
                    decoration: BoxDecoration(
                      color: (isCorrect ? AppColors.success : AppColors.error).withValues(alpha: 0.06),
                      borderRadius: BorderRadius.circular(12),
                      border: Border.all(color: (isCorrect ? AppColors.success : AppColors.error).withValues(alpha: 0.3)),
                    ),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          isCorrect ? (isHi ? '🎉 सही!' : '🎉 Correct!') : (isHi ? '📖 गलत' : '📖 Incorrect'),
                          style: TextStyle(
                            fontSize: 13,
                            fontWeight: FontWeight.w700,
                            color: isCorrect ? AppColors.success : AppColors.error,
                          ),
                        ),
                        const SizedBox(height: 6),
                        Text(
                          isHi
                              ? (isCorrect ? '+1 अंक (सही उत्तर)' : '0 अंक — कोई नकारात्मक अंकन नहीं')
                              : (isCorrect ? '+1 mark (correct answer)' : '0 marks — no negative marking'),
                          style: const TextStyle(fontSize: 12, color: AppColors.textSecondary),
                        ),
                        if (q.displayExplanation(isHi) != null) ...[
                          const SizedBox(height: 8),
                          Text(
                            q.displayExplanation(isHi)!,
                            style: const TextStyle(fontSize: 12.5, color: AppColors.textPrimary, height: 1.4),
                          ),
                        ],
                      ],
                    ),
                  ),
                  const SizedBox(height: 16),
                  ElevatedButton(
                    onPressed: () => ref.read(pyqProvider.notifier).nextQuestion(),
                    style: ElevatedButton.styleFrom(
                      backgroundColor: AppColors.brand,
                      foregroundColor: Colors.white,
                      minimumSize: const Size.fromHeight(48),
                    ),
                    child: Text(
                      state.currentIdx + 1 >= state.questions.length
                          ? (isHi ? 'परिणाम देखें →' : 'See Results →')
                          : (isHi ? 'अगला प्रश्न →' : 'Next Question →'),
                    ),
                  ),
                ],
              ],
            ),
          ),
        ),
      ],
    );
  }
}

class _DoneScreen extends ConsumerWidget {
  final PyqState state;
  final bool isHi;
  const _DoneScreen({required this.state, required this.isHi});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final student = ref.watch(studentProvider).valueOrNull;
    final total = state.questions.length;
    final pct = total > 0 ? ((state.correctCount / total) * 100).round() : 0;
    final emoji = pct >= 80 ? '🌟' : pct >= 60 ? '👍' : '📚';

    return Center(
      child: SingleChildScrollView(
        padding: const EdgeInsets.all(32),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Text(emoji, style: const TextStyle(fontSize: 52)),
            const SizedBox(height: 12),
            Text(
              isHi ? 'सत्र पूरा!' : 'Session Complete!',
              style: const TextStyle(fontSize: 20, fontWeight: FontWeight.w700, color: AppColors.textPrimary),
            ),
            const SizedBox(height: 20),
            Container(
              width: double.infinity,
              padding: const EdgeInsets.all(20),
              decoration: BoxDecoration(
                color: AppColors.surface,
                borderRadius: BorderRadius.circular(16),
                border: Border.all(color: AppColors.borderLight),
              ),
              child: Column(
                children: [
                  Text(
                    '$pct%',
                    style: const TextStyle(fontSize: 32, fontWeight: FontWeight.w800, color: AppColors.brand),
                  ),
                  const SizedBox(height: 4),
                  Text(
                    '${state.correctCount}/$total ${isHi ? 'सही' : 'correct'}',
                    style: const TextStyle(fontSize: 13, color: AppColors.textTertiary),
                  ),
                  const SizedBox(height: 12),
                  LinearProgressIndicator(
                    value: pct / 100,
                    minHeight: 6,
                    backgroundColor: AppColors.borderLight,
                    valueColor: const AlwaysStoppedAnimation(AppColors.brand),
                  ),
                ],
              ),
            ),
            const SizedBox(height: 24),
            ElevatedButton(
              onPressed: () => ref.read(pyqProvider.notifier).retry(grade: student?.grade ?? '9'),
              style: ElevatedButton.styleFrom(
                backgroundColor: AppColors.brand,
                foregroundColor: Colors.white,
                minimumSize: const Size.fromHeight(48),
              ),
              child: Text(isHi ? 'फिर से कोशिश करें' : 'Try Again'),
            ),
            const SizedBox(height: 8),
            OutlinedButton(
              onPressed: () => ref.read(pyqProvider.notifier).restart(),
              style: OutlinedButton.styleFrom(minimumSize: const Size.fromHeight(48)),
              child: Text(isHi ? 'दूसरा वर्ष/विषय' : 'Different Year / Subject'),
            ),
            const SizedBox(height: 8),
            TextButton(
              onPressed: () => context.go('/'),
              child: Text(isHi ? 'डैशबोर्ड' : 'Dashboard'),
            ),
          ],
        ),
      ),
    );
  }
}
