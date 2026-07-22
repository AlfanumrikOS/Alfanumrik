import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../core/constants/app_colors.dart';
import '../../../core/services/subjects_provider.dart';
import '../../../data/models/quiz_question.dart';
import '../../../providers/assignments_provider.dart';
import '../../../providers/auth_provider.dart';
import '../../../providers/quiz_provider.dart';
import '../../widgets/loading_widget.dart';
import '../../widgets/quiz_question_widgets.dart';

/// Phase 6 sub-phase 5 (Assignments): the quiz screen's launch/argument
/// handling is extended MINIMALLY here to support deep-linking from the
/// Assignments screen (`/quiz?...&from=assignment&assignmentId=<id>` on
/// web). NONE of the scoring/submission internals below this constructor
/// are touched — [initialSubject]/[initialChapter]/[initialCount]/
/// [assignmentId] only decide what auto-starts on entry and are threaded
/// through to [QuizNotifier.startQuiz] exactly like the existing manual
/// subject-picker tap already does.
class QuizScreen extends ConsumerStatefulWidget {
  final String? initialSubject;
  final String? initialChapter;
  final int? initialCount;
  final String? assignmentId;

  const QuizScreen({
    super.key,
    this.initialSubject,
    this.initialChapter,
    this.initialCount,
    this.assignmentId,
  });

  @override
  ConsumerState<QuizScreen> createState() => _QuizScreenState();
}

class _QuizScreenState extends ConsumerState<QuizScreen> {
  bool _autoStartTriggered = false;

  @override
  void initState() {
    super.initState();
    final subject = widget.initialSubject;
    if (subject != null && subject.isNotEmpty) {
      // Deferred to the post-frame callback: startQuiz() mutates a provider,
      // which must not happen synchronously during the first build.
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (!mounted || _autoStartTriggered) return;
        _autoStartTriggered = true;
        ref.read(quizProvider.notifier).startQuiz(
              subject: subject,
              chapterTitle: widget.initialChapter,
              count: widget.initialCount ?? 10,
              assignmentId: widget.assignmentId,
            );
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    final quiz = ref.watch(quizProvider);
    final student = ref.watch(studentProvider).valueOrNull;

    // Wave 2.5.2: attempt was completed offline and queued — show the
    // "saved offline, will sync" state instead of a score.
    if (quiz.savedOffline) {
      return _SavedOfflineScreen(quiz: quiz);
    }

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

                  // Options — shared with PYQ/Diagnostic via
                  // QuestionOptionsList (plain selection mode: showResult
                  // false, no reveal). Same visuals/behaviour as before.
                  QuestionOptionsList(
                    options: q.options,
                    selectedIndex: selectedOption,
                    onSelect: (i) =>
                        ref.read(quizProvider.notifier).selectAnswer(i),
                  ),
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

                // Phase 6 sub-phase 5 (Assignments): renders ONLY when this
                // quiz was launched from an assignment deep link. Never
                // affects the score/XP shown above — purely informational.
                if (quiz.assignmentId != null)
                  _AssignmentCompletionBanner(isHi: isHi),

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
                    // Remove XP fallback once server fully migrates to
                    // Foxy Coins.
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

                // Assignment-launched quizzes get a dedicated way back to
                // the Assignments screen (where the just-recorded attempt/
                // status is now visible) alongside the normal reset CTA —
                // "Try Another Quiz" alone would strand the student outside
                // the assignment flow they came from.
                if (quiz.assignmentId != null) ...[
                  SizedBox(
                    width: double.infinity,
                    child: ElevatedButton(
                      onPressed: () {
                        ref.read(quizProvider.notifier).reset();
                        context.go('/assignments');
                      },
                      child: Text(isHi ? 'असाइनमेंट पर वापस जाएँ' : 'Back to Assignments'),
                    ),
                  ),
                  const SizedBox(height: 10),
                ],

                ElevatedButton(
                  onPressed: () => ref.read(quizProvider.notifier).reset(),
                  style: quiz.assignmentId != null
                      ? ElevatedButton.styleFrom(
                          backgroundColor: AppColors.surface,
                          foregroundColor: AppColors.textPrimary,
                          side: const BorderSide(color: AppColors.border),
                        )
                      : null,
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

/// Phase 6 sub-phase 5 (Assignments): renders the outcome of the
/// post-submit `POST /api/student/assignments/[id]/complete` call fired by
/// [QuizNotifier.submitQuiz]. Each [AssignmentCompletionStatus] gets
/// DISTINCT copy and colour treatment — `maxAttemptsReached` and
/// `submissionClosed` must never collapse into one generic error banner
/// (explicit product requirement, not a nice-to-have). Never affects the
/// score/XP shown elsewhere on this screen — purely informational.
class _AssignmentCompletionBanner extends ConsumerWidget {
  final bool isHi;
  const _AssignmentCompletionBanner({required this.isHi});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final state = ref.watch(assignmentCompletionProvider);

    String emoji;
    String message;
    Color color;

    switch (state.status) {
      case AssignmentCompletionStatus.idle:
      case AssignmentCompletionStatus.submitting:
        emoji = '⏳';
        color = AppColors.textTertiary;
        message = isHi
            ? 'असाइनमेंट में दर्ज हो रहा है…'
            : 'Recording this against your assignment…';
        break;
      case AssignmentCompletionStatus.success:
        final s = state.success;
        emoji = '✅';
        color = AppColors.success;
        if (s != null && s.isAlreadyGraded) {
          message = isHi
              ? 'यह प्रयास पहले ही शिक्षक द्वारा समीक्षित किया जा चुका है।'
              : 'This attempt has already been reviewed by your teacher.';
        } else if (s != null && s.attemptNumber != null) {
          final best = s.bestScorePercent;
          message = isHi
              ? 'असाइनमेंट जमा हो गया! प्रयास ${s.attemptNumber}${best != null ? ' · सर्वश्रेष्ठ स्कोर $best%' : ''}'
              : 'Assignment submitted! Attempt ${s.attemptNumber}${best != null ? ' · best score $best%' : ''}';
          if (s.isLateSubmission) {
            message += isHi ? ' (देरी से जमा)' : ' (submitted late)';
          }
        } else {
          message = isHi ? 'असाइनमेंट जमा हो गया!' : 'Assignment submitted!';
        }
        break;
      case AssignmentCompletionStatus.maxAttemptsReached:
        emoji = '🚫';
        color = AppColors.error;
        message = isHi
            ? 'आपने इस असाइनमेंट के लिए सभी अनुमत प्रयास इस्तेमाल कर लिए हैं।'
            : "You've used all the attempts allowed for this assignment.";
        break;
      case AssignmentCompletionStatus.submissionClosed:
        emoji = '🔒';
        color = AppColors.warning;
        message = isHi
            ? 'यह असाइनमेंट अब जमा स्वीकार नहीं करता (नियत तिथि निकल चुकी है)।'
            : 'This assignment no longer accepts submissions (past due).';
        break;
      case AssignmentCompletionStatus.error:
        emoji = '⚠️';
        color = AppColors.warning;
        message = isHi
            ? 'आपका स्कोर सुरक्षित है, लेकिन इसे असाइनमेंट से नहीं जोड़ा जा सका। बाद में फिर कोशिश करें।'
            : "Your score is saved, but we couldn't link it to the assignment. It'll sync on next refresh.";
        break;
    }

    return Container(
      margin: const EdgeInsets.only(bottom: 16),
      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.08),
        borderRadius: BorderRadius.circular(10),
        border: Border.all(color: color.withValues(alpha: 0.3)),
      ),
      child: Row(
        children: [
          Text(emoji, style: const TextStyle(fontSize: 16)),
          const SizedBox(width: 10),
          Expanded(
            child: Text(
              message,
              style: TextStyle(
                fontSize: 12.5,
                color: color,
                height: 1.4,
                fontWeight: FontWeight.w600,
              ),
            ),
          ),
        ],
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

/// Wave 2.5.2: shown when a quiz attempt was completed OFFLINE and queued for
/// later drain. No score is shown — grading is server-authoritative and happens
/// when connectivity returns and the queue drains. Bilingual (P7).
class _SavedOfflineScreen extends ConsumerWidget {
  final QuizState quiz;

  const _SavedOfflineScreen({required this.quiz});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final isHi = _isHindi(context);

    final title = isHi ? 'ऑफ़लाइन सहेजा गया' : 'Saved Offline';
    final body = isHi
        ? 'इंटरनेट न होने पर आपकी क्विज़ सहेज ली गई है। ऑनलाइन होते ही यह अपने-आप सिंक हो जाएगी और आपका स्कोर दिखेगा।'
        : "Saved offline — we'll sync this quiz and show your score when you're back online.";
    final cta = isHi ? 'एक और क्विज़ आज़माएँ' : 'Try Another Quiz';

    return Scaffold(
      backgroundColor: AppColors.background,
      body: SafeArea(
        child: Center(
          child: Padding(
            padding: const EdgeInsets.all(32),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                const Text('📡', style: TextStyle(fontSize: 52)),
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
                  onPressed: () => ref.read(quizProvider.notifier).reset(),
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
