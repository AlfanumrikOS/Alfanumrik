import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../core/constants/app_colors.dart';
import '../../../providers/diagnostic_provider.dart';
import '../../widgets/loading_widget.dart';
import '../../widgets/quiz_question_widgets.dart';

/// Diagnostic Assessment — mobile parity for
/// `apps/host/src/app/diagnostic/page.tsx`. Reuses [QuestionOptionsList]/
/// [QuizOptionTile] (extracted from `quiz_screen.dart`) for question
/// rendering rather than re-building option tiles from scratch.
///
/// Deep-linked from the `first_quiz_nudge` notification type (registered in
/// `notification_type_config.dart` — this route registration is what makes
/// that deep link resolve instead of being a dead link on mobile).
class DiagnosticScreen extends ConsumerWidget {
  const DiagnosticScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final isHi = Localizations.localeOf(context).languageCode == 'hi';
    final state = ref.watch(diagnosticProvider);

    return Scaffold(
      backgroundColor: AppColors.background,
      appBar: AppBar(
        backgroundColor: AppColors.surface,
        foregroundColor: AppColors.textPrimary,
        elevation: 0,
        title: Text(isHi ? '🎯 डायग्नोस्टिक टेस्ट' : '🎯 Diagnostic Assessment'),
      ),
      body: SafeArea(
        child: switch (state.screen) {
          DiagnosticScreenState.setup => _SetupScreen(state: state, isHi: isHi),
          DiagnosticScreenState.quiz => state.currentQuestion == null
              ? _NoQuestionsScreen(isHi: isHi)
              : _QuizScreen(state: state, isHi: isHi),
          DiagnosticScreenState.results =>
            state.summary == null
                ? const LoadingScreen()
                : _ResultsScreen(state: state, isHi: isHi),
        },
      ),
    );
  }
}

class _SetupScreen extends ConsumerWidget {
  final DiagnosticState state;
  final bool isHi;
  const _SetupScreen({required this.state, required this.isHi});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    return ListView(
      padding: const EdgeInsets.all(20),
      children: [
        Center(child: Text(isHi ? '🎯' : '🎯', style: const TextStyle(fontSize: 40))),
        const SizedBox(height: 12),
        Text(
          isHi
              ? '15 प्रश्नों का टेस्ट देकर जानें आप किस स्तर पर हैं।'
              : 'Answer 15 questions to discover your current level and get personalised recommendations.',
          textAlign: TextAlign.center,
          style: const TextStyle(fontSize: 13, color: AppColors.textSecondary, height: 1.5),
        ),
        const SizedBox(height: 24),
        Text(
          isHi ? 'कक्षा' : 'Grade',
          style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w600, color: AppColors.textSecondary),
        ),
        const SizedBox(height: 6),
        Wrap(
          spacing: 8,
          runSpacing: 8,
          children: kDiagnosticGrades.map((g) {
            final isSelected = state.grade == g;
            return GestureDetector(
              onTap: () => ref.read(diagnosticProvider.notifier).selectGrade(g),
              child: Container(
                padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 10),
                decoration: BoxDecoration(
                  color: isSelected ? AppColors.brand : AppColors.surface,
                  borderRadius: BorderRadius.circular(10),
                  border: Border.all(color: isSelected ? AppColors.brand : AppColors.borderLight),
                ),
                child: Text(
                  isHi ? 'कक्षा $g' : 'Grade $g',
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
        if (state.grade.isNotEmpty) ...[
          const SizedBox(height: 20),
          Text(
            isHi ? 'विषय' : 'Subject',
            style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w600, color: AppColors.textSecondary),
          ),
          const SizedBox(height: 8),
          GridView.count(
            crossAxisCount: 2,
            shrinkWrap: true,
            physics: const NeverScrollableScrollPhysics(),
            crossAxisSpacing: 8,
            mainAxisSpacing: 8,
            childAspectRatio: 2.2,
            children: state.subjectOptions.map((opt) {
              final isSelected = state.subject == opt.code;
              return GestureDetector(
                onTap: () => ref.read(diagnosticProvider.notifier).selectSubject(opt.code),
                child: Container(
                  decoration: BoxDecoration(
                    color: isSelected ? AppColors.brand.withValues(alpha: 0.06) : AppColors.surface,
                    borderRadius: BorderRadius.circular(10),
                    border: Border.all(color: isSelected ? AppColors.brand : AppColors.borderLight, width: 2),
                  ),
                  alignment: Alignment.center,
                  child: Column(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      Text(opt.icon, style: const TextStyle(fontSize: 16)),
                      const SizedBox(height: 2),
                      Text(
                        isHi ? opt.labelHi : opt.label,
                        style: TextStyle(
                          fontSize: 11,
                          fontWeight: FontWeight.w600,
                          color: isSelected ? AppColors.brand : AppColors.textSecondary,
                        ),
                      ),
                    ],
                  ),
                ),
              );
            }).toList(growable: false),
          ),
        ],
        if (state.missingSelection) ...[
          const SizedBox(height: 14),
          Text(
            isHi ? 'कृपया कक्षा और विषय चुनें।' : 'Please select grade and subject.',
            style: const TextStyle(fontSize: 12, color: AppColors.error, fontWeight: FontWeight.w600),
          ),
        ],
        if (state.setupError != null) ...[
          const SizedBox(height: 14),
          Text(
            state.setupError!,
            style: const TextStyle(fontSize: 12, color: AppColors.error, fontWeight: FontWeight.w600),
          ),
        ],
        const SizedBox(height: 24),
        ElevatedButton(
          onPressed: state.starting ? null : () => ref.read(diagnosticProvider.notifier).start(),
          style: ElevatedButton.styleFrom(
            backgroundColor: AppColors.brand,
            foregroundColor: Colors.white,
            minimumSize: const Size.fromHeight(48),
          ),
          child: Text(
            state.starting
                ? (isHi ? 'लोड हो रहा है...' : 'Loading...')
                : (isHi ? 'टेस्ट शुरू करें' : 'Start Diagnostic'),
          ),
        ),
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
            Text(
              isHi ? 'प्रश्न लोड नहीं हो सके।' : 'Questions could not be loaded.',
              style: const TextStyle(fontSize: 14, color: AppColors.error),
            ),
            const SizedBox(height: 16),
            ElevatedButton(
              onPressed: () => ref.read(diagnosticProvider.notifier).retakeAnotherSubject(),
              child: Text(isHi ? 'वापस जाएं' : 'Go Back'),
            ),
          ],
        ),
      ),
    );
  }
}

class _QuizScreen extends ConsumerWidget {
  final DiagnosticState state;
  final bool isHi;
  const _QuizScreen({required this.state, required this.isHi});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final q = state.currentQuestion!;
    final total = state.questions.length;
    final progress = total == 0 ? 0.0 : state.currentIdx / total;

    return Column(
      children: [
        Padding(
          padding: const EdgeInsets.fromLTRB(16, 8, 16, 8),
          child: Column(
            children: [
              Row(
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                children: [
                  IconButton(
                    onPressed: () => ref.read(diagnosticProvider.notifier).retakeAnotherSubject(),
                    icon: const Icon(Icons.arrow_back_rounded, size: 20),
                  ),
                  Text(
                    isHi
                        ? 'प्रश्न ${state.currentIdx + 1} / $total'
                        : 'Question ${state.currentIdx + 1} of $total',
                    style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w600, color: AppColors.textSecondary),
                  ),
                  const SizedBox(width: 40),
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
                // Untimed, no immediate reveal (P3: diagnostic has no
                // anti-cheat/scoring pressure) — plain selection mode.
                QuestionOptionsList(
                  options: q.options,
                  selectedIndex: state.selectedOption,
                  onSelect: (i) => ref.read(diagnosticProvider.notifier).selectOption(i),
                ),
                if (state.quizError != null) ...[
                  const SizedBox(height: 8),
                  Text(
                    state.quizError!,
                    style: const TextStyle(fontSize: 12, color: AppColors.error, fontWeight: FontWeight.w600),
                  ),
                ],
                const SizedBox(height: 16),
                ElevatedButton(
                  onPressed: state.selectedOption == null || state.submitting
                      ? null
                      : () => ref.read(diagnosticProvider.notifier).next(),
                  style: ElevatedButton.styleFrom(
                    backgroundColor: AppColors.brand,
                    foregroundColor: Colors.white,
                    minimumSize: const Size.fromHeight(48),
                  ),
                  child: Text(
                    state.submitting
                        ? (isHi ? 'जमा हो रहा है...' : 'Submitting...')
                        : state.currentIdx < total - 1
                            ? (isHi ? 'अगला' : 'Next')
                            : (isHi ? 'परिणाम देखें' : 'See Results'),
                  ),
                ),
              ],
            ),
          ),
        ),
      ],
    );
  }
}

class _ResultsScreen extends ConsumerWidget {
  final DiagnosticState state;
  final bool isHi;
  const _ResultsScreen({required this.state, required this.isHi});

  static const Map<String, (String, String, Color)> _difficultyLabels = {
    'easy': ('Start with Easy questions', 'आसान प्रश्नों से शुरू करें', Color(0xFF16A34A)),
    'medium': ('Start with Medium questions', 'मध्यम प्रश्नों से शुरू करें', Color(0xFFD97706)),
    'hard': ('Start with Hard questions', 'कठिन प्रश्नों से शुरू करें', Color(0xFFDC2626)),
  };

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final summary = state.summary!;
    final pct = summary.scorePercent;
    final emoji = pct >= 70 ? '🏆' : pct >= 40 ? '💪' : '📚';
    final diff = _difficultyLabels[summary.recommendedDifficulty] ?? _difficultyLabels['medium']!;

    return ListView(
      padding: const EdgeInsets.all(20),
      children: [
        Center(
          child: Column(
            children: [
              Text(emoji, style: const TextStyle(fontSize: 40)),
              const SizedBox(height: 8),
              Text(
                isHi ? 'डायग्नोस्टिक परिणाम' : 'Diagnostic Results',
                style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w700, color: AppColors.textPrimary),
              ),
            ],
          ),
        ),
        const SizedBox(height: 20),
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
                '$pct%',
                style: TextStyle(
                  fontSize: 36,
                  fontWeight: FontWeight.w800,
                  color: pct >= 70 ? AppColors.success : (pct >= 40 ? AppColors.warning : AppColors.error),
                ),
              ),
              const SizedBox(height: 6),
              LinearProgressIndicator(
                value: pct / 100,
                minHeight: 8,
                backgroundColor: AppColors.borderLight,
                valueColor: AlwaysStoppedAnimation(
                  pct >= 70 ? AppColors.success : (pct >= 40 ? AppColors.warning : AppColors.error),
                ),
              ),
              const SizedBox(height: 10),
              Text(
                '${summary.correctAnswers}/${summary.totalQuestions} ${isHi ? 'सही' : 'correct'}',
                style: const TextStyle(fontSize: 15, fontWeight: FontWeight.w700, color: AppColors.textPrimary),
              ),
              const SizedBox(height: 4),
              Text(
                pct >= 70
                    ? (isHi ? 'शानदार! तुम इस विषय में अच्छे हो।' : 'Great work! You have a strong foundation.')
                    : pct >= 40
                        ? (isHi ? 'ठीक है! थोड़ा अभ्यास और करो।' : 'Good start! A bit more practice will help.')
                        : (isHi ? 'चलो मिलकर बेसिक्स मजबूत करते हैं।' : "Let's build a stronger foundation together."),
                textAlign: TextAlign.center,
                style: const TextStyle(fontSize: 12, color: AppColors.textTertiary),
              ),
            ],
          ),
        ),
        const SizedBox(height: 14),
        Container(
          padding: const EdgeInsets.all(14),
          decoration: BoxDecoration(
            color: diff.$3.withValues(alpha: 0.08),
            borderRadius: BorderRadius.circular(12),
            border: Border.all(color: diff.$3.withValues(alpha: 0.3)),
          ),
          child: Row(
            children: [
              const Text('🎯', style: TextStyle(fontSize: 18)),
              const SizedBox(width: 10),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      isHi ? 'सुझाव' : 'Recommendation',
                      style: const TextStyle(fontSize: 11, color: AppColors.textTertiary),
                    ),
                    Text(
                      isHi ? diff.$2 : diff.$1,
                      style: TextStyle(fontSize: 13, fontWeight: FontWeight.w700, color: diff.$3),
                    ),
                  ],
                ),
              ),
            ],
          ),
        ),
        if (summary.weakTopics.isNotEmpty) ...[
          const SizedBox(height: 14),
          _TopicChipGroup(
            title: isHi ? '⚠ सुधार की जरूरत' : '⚠ Areas to strengthen',
            color: AppColors.error,
            topics: summary.weakTopics,
          ),
        ],
        if (summary.strongTopics.isNotEmpty) ...[
          const SizedBox(height: 14),
          _TopicChipGroup(
            title: isHi ? '✓ मजबूत क्षेत्र' : '✓ Strong areas',
            color: AppColors.success,
            topics: summary.strongTopics,
          ),
        ],
        if (summary.weakTopics.isEmpty && summary.strongTopics.isEmpty) ...[
          const SizedBox(height: 14),
          Text(
            isHi
                ? 'विस्तृत topic विश्लेषण उपलब्ध नहीं है। कृपया अभ्यास शुरू करें।'
                : 'Detailed topic analysis is not available. Please start practising.',
            textAlign: TextAlign.center,
            style: const TextStyle(fontSize: 12, color: AppColors.textTertiary),
          ),
        ],
        const SizedBox(height: 24),
        ElevatedButton(
          onPressed: () => context.push('/quiz'),
          style: ElevatedButton.styleFrom(
            backgroundColor: AppColors.brand,
            foregroundColor: Colors.white,
            minimumSize: const Size.fromHeight(48),
          ),
          child: Text(isHi ? 'अभ्यास शुरू करें' : 'Start Practicing'),
        ),
        const SizedBox(height: 8),
        OutlinedButton(
          onPressed: () => ref.read(diagnosticProvider.notifier).retakeAnotherSubject(),
          style: OutlinedButton.styleFrom(minimumSize: const Size.fromHeight(48)),
          child: Text(isHi ? 'दूसरा विषय आज़माएं' : 'Try Another Subject'),
        ),
      ],
    );
  }
}

class _TopicChipGroup extends StatelessWidget {
  final String title;
  final Color color;
  final List<String> topics;
  const _TopicChipGroup({required this.title, required this.color, required this.topics});

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: AppColors.surface,
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: AppColors.borderLight),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(title, style: TextStyle(fontSize: 12.5, fontWeight: FontWeight.w700, color: color)),
          const SizedBox(height: 8),
          Wrap(
            spacing: 8,
            runSpacing: 6,
            children: topics.map((t) {
              return Container(
                padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 5),
                decoration: BoxDecoration(
                  color: color.withValues(alpha: 0.08),
                  borderRadius: BorderRadius.circular(20),
                  border: Border.all(color: color.withValues(alpha: 0.2)),
                ),
                child: Text(t, style: TextStyle(fontSize: 11, fontWeight: FontWeight.w600, color: color)),
              );
            }).toList(growable: false),
          ),
        ],
      ),
    );
  }
}
