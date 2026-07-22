import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../core/constants/app_colors.dart';
import '../../../providers/exam_provider.dart';
import '../../widgets/loading_widget.dart';
import '../../widgets/quiz_question_widgets.dart';

/// Bilingual CBSE section labels — mirrors the web's `SECTION_LABELS`.
String examSectionLabel(String key, bool isHi) {
  switch (key) {
    case 'A':
      return isHi ? 'खंड अ' : 'Section A';
    case 'B':
      return isHi ? 'खंड ब' : 'Section B';
    case 'C':
      return isHi ? 'खंड स' : 'Section C';
    case 'D':
      return isHi ? 'खंड द' : 'Section D';
    case 'E':
      return isHi ? 'खंड ई (केस-आधारित)' : 'Section E (Case-based)';
    case '':
      return isHi ? 'सभी प्रश्न' : 'All questions';
    default:
      return isHi ? 'खंड $key' : 'Section $key';
  }
}

/// mm:ss / h:mm:ss formatting for the countdown. Presentation only.
String formatExamClock(int totalSeconds) {
  final s = totalSeconds < 0 ? 0 : totalSeconds;
  final h = s ~/ 3600;
  final m = (s % 3600) ~/ 60;
  final sec = s % 60;
  final mm = m.toString().padLeft(2, '0');
  final ss = sec.toString().padLeft(2, '0');
  return h > 0 ? '$h:$mm:$ss' : '$mm:$ss';
}

/// Mock exam runner — mobile parity for
/// `apps/host/src/app/(student)/exams/mock/[paperId]/page.tsx` +
/// `packages/ui/src/exams/MockTestRunner.tsx`.
///
/// Lifecycle: load paper metadata → (cbse_board) start a dynamically
/// assembled attempt → "Exam Structure" confirm card → countdown + answer →
/// submit → results route.
///
/// ── Safety notes (P1/P3) ────────────────────────────────────────────────
/// * Nothing on this screen scores anything. The submit response is handed
///   to the results screen untouched.
/// * The countdown is seeded from `paper.durationMinutes` (server). If the
///   server did not supply one, the screen shows a blocking "duration
///   unavailable" state rather than assuming 180 minutes.
/// * On expiry the provider submits whatever the student answered through
///   the normal submit path — no client-side invalidation.
class MockExamScreen extends ConsumerStatefulWidget {
  final String paperId;
  const MockExamScreen({super.key, required this.paperId});

  @override
  ConsumerState<MockExamScreen> createState() => _MockExamScreenState();
}

class _MockExamScreenState extends ConsumerState<MockExamScreen> {
  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) {
      ref.read(examAttemptProvider.notifier).load(widget.paperId);
    });
  }

  @override
  Widget build(BuildContext context) {
    final isHi = Localizations.localeOf(context).languageCode == 'hi';
    final state = ref.watch(examAttemptProvider);

    // Route to results the moment the server's scorecard lands.
    ref.listen<ExamAttemptState>(examAttemptProvider, (prev, next) {
      if (prev?.phase != ExamAttemptPhase.submitted &&
          next.phase == ExamAttemptPhase.submitted &&
          next.submitResult != null) {
        context.push('/exams/mock/${widget.paperId}/results');
      }
    });

    return PopScope(
      canPop: state.phase != ExamAttemptPhase.running,
      onPopInvokedWithResult: (didPop, _) async {
        if (didPop) return;
        final leave = await _confirmExit(context, isHi);
        if (leave == true && context.mounted) {
          ref.read(examAttemptProvider.notifier).reset();
          context.pop();
        }
      },
      child: Scaffold(
        backgroundColor: AppColors.background,
        appBar: AppBar(
          backgroundColor: AppColors.surface,
          foregroundColor: AppColors.textPrimary,
          elevation: 0,
          title: Text(state.paper?.paperCode ?? (isHi ? 'मॉक टेस्ट' : 'Mock Test')),
          actions: [
            if (state.phase == ExamAttemptPhase.running ||
                state.phase == ExamAttemptPhase.submitting)
              _CountdownPill(remaining: state.remainingSeconds, isHi: isHi),
            const SizedBox(width: 12),
          ],
        ),
        body: SafeArea(child: _body(context, state, isHi)),
      ),
    );
  }

  Widget _body(BuildContext context, ExamAttemptState state, bool isHi) {
    switch (state.phase) {
      case ExamAttemptPhase.idle:
      case ExamAttemptPhase.loading:
        return LoadingScreen(message: isHi ? 'पेपर तैयार हो रहा है…' : 'Preparing your paper…');
      case ExamAttemptPhase.notReady:
        return _NotReadyCard(isHi: isHi);
      case ExamAttemptPhase.upgradeRequired:
        return _UpgradeCard(isHi: isHi);
      case ExamAttemptPhase.notFound:
        return _MessageCard(
          emoji: '🔍',
          title: isHi ? 'पेपर नहीं मिला' : 'Paper not found',
          body: isHi
              ? 'यह पेपर अब उपलब्ध नहीं है।'
              : 'This paper is no longer available.',
          actionLabel: isHi ? 'कैटलॉग पर वापस' : 'Back to catalog',
          onAction: () => context.pop(),
        );
      case ExamAttemptPhase.error:
        final durationMissing = state.errorMessage == 'exam_duration_unavailable';
        return _MessageCard(
          emoji: '⚠️',
          title: durationMissing
              ? (isHi ? 'समय-सीमा उपलब्ध नहीं' : 'Exam duration unavailable')
              : (isHi ? 'पेपर शुरू नहीं हो सका' : 'Could not start this paper'),
          body: durationMissing
              ? (isHi
                  ? 'सर्वर ने इस पेपर की अवधि नहीं भेजी, इसलिए टाइमर शुरू नहीं किया जा सकता।'
                  : 'The server did not send a duration for this paper, so the timer cannot start.')
              : (state.errorMessage ??
                  (isHi ? 'कृपया पुनः प्रयास करें।' : 'Please try again.')),
          actionLabel: isHi ? 'पुनः प्रयास करें' : 'Retry',
          onAction: () => ref.read(examAttemptProvider.notifier).load(widget.paperId),
        );
      case ExamAttemptPhase.structure:
        return _StructureCard(state: state, isHi: isHi);
      case ExamAttemptPhase.running:
      case ExamAttemptPhase.submitting:
        return _Runner(state: state, isHi: isHi);
      case ExamAttemptPhase.submitted:
        return LoadingScreen(message: isHi ? 'परिणाम खुल रहा है…' : 'Opening results…');
    }
  }

  Future<bool?> _confirmExit(BuildContext context, bool isHi) {
    return showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: Text(isHi ? 'परीक्षा छोड़ें?' : 'Leave the exam?'),
        content: Text(
          isHi
              ? 'आपके उत्तर सेव नहीं होंगे और यह प्रयास जमा नहीं होगा।'
              : 'Your answers will not be saved and this attempt will not be submitted.',
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(ctx).pop(false),
            child: Text(isHi ? 'रुकें' : 'Stay'),
          ),
          TextButton(
            onPressed: () => Navigator.of(ctx).pop(true),
            child: Text(isHi ? 'छोड़ें' : 'Leave'),
          ),
        ],
      ),
    );
  }
}

// ── Countdown ──────────────────────────────────────────────────────────────

class _CountdownPill extends StatelessWidget {
  final int remaining;
  final bool isHi;
  const _CountdownPill({required this.remaining, required this.isHi});

  @override
  Widget build(BuildContext context) {
    final urgent = remaining <= 300;
    final color = urgent ? AppColors.error : AppColors.textPrimary;
    return Semantics(
      liveRegion: urgent,
      label: isHi ? 'शेष समय' : 'Time remaining',
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
        decoration: BoxDecoration(
          color: (urgent ? AppColors.error : AppColors.borderLight)
              .withValues(alpha: urgent ? 0.10 : 0.6),
          borderRadius: BorderRadius.circular(20),
        ),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(Icons.timer_outlined, size: 14, color: color),
            const SizedBox(width: 6),
            Text(
              formatExamClock(remaining),
              style: TextStyle(
                fontSize: 13,
                fontWeight: FontWeight.w700,
                color: color,
              ),
            ),
          ],
        ),
      ),
    );
  }
}

// ── Pre-exam structure card ────────────────────────────────────────────────

class _StructureCard extends ConsumerWidget {
  final ExamAttemptState state;
  final bool isHi;
  const _StructureCard({required this.state, required this.isHi});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final paper = state.paper!;
    final sections = state.sections;

    return ListView(
      padding: const EdgeInsets.all(20),
      children: [
        Text(
          isHi ? 'परीक्षा संरचना' : 'Exam Structure',
          style: const TextStyle(
            fontSize: 20,
            fontWeight: FontWeight.w800,
            color: AppColors.textPrimary,
          ),
        ),
        const SizedBox(height: 4),
        Text(
          paper.paperCode,
          style: const TextStyle(fontSize: 12, color: AppColors.textTertiary),
        ),
        const SizedBox(height: 18),
        Container(
          padding: const EdgeInsets.all(16),
          decoration: BoxDecoration(
            color: AppColors.surface,
            borderRadius: BorderRadius.circular(14),
            border: Border.all(color: AppColors.borderLight),
          ),
          child: Column(
            children: [
              for (final sec in sections)
                Padding(
                  padding: const EdgeInsets.only(bottom: 10),
                  child: Row(
                    mainAxisAlignment: MainAxisAlignment.spaceBetween,
                    children: [
                      Text(
                        examSectionLabel(sec.key, isHi),
                        style: const TextStyle(
                          fontSize: 13,
                          fontWeight: FontWeight.w600,
                          color: AppColors.textSecondary,
                        ),
                      ),
                      Text(
                        isHi
                            ? '${sec.count} प्रश्न · ${sec.marks} अंक'
                            : '${sec.count} Q · ${sec.marks} marks',
                        style: const TextStyle(
                          fontSize: 12.5,
                          fontWeight: FontWeight.w700,
                          color: AppColors.textPrimary,
                        ),
                      ),
                    ],
                  ),
                ),
              const Divider(height: 18, color: AppColors.borderLight),
              Row(
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                children: [
                  Text(
                    isHi ? 'कुल' : 'Total',
                    style: const TextStyle(
                      fontSize: 13,
                      fontWeight: FontWeight.w700,
                      color: AppColors.textPrimary,
                    ),
                  ),
                  Text(
                    isHi
                        ? '${state.questions.length} प्रश्न · ${state.availableMarks} अंक'
                        : '${state.questions.length} Q · ${state.availableMarks} marks',
                    style: const TextStyle(
                      fontSize: 13,
                      fontWeight: FontWeight.w800,
                      color: AppColors.brand,
                    ),
                  ),
                ],
              ),
            ],
          ),
        ),
        const SizedBox(height: 14),
        Container(
          padding: const EdgeInsets.all(14),
          decoration: BoxDecoration(
            color: AppColors.brand.withValues(alpha: 0.06),
            borderRadius: BorderRadius.circular(12),
            border: Border.all(color: AppColors.brand.withValues(alpha: 0.25)),
          ),
          child: Row(
            children: [
              const Icon(Icons.timer_outlined, size: 18, color: AppColors.brand),
              const SizedBox(width: 10),
              Expanded(
                child: Text(
                  // Server-supplied duration, shown verbatim.
                  isHi
                      ? 'समय: ${paper.durationMinutes} मिनट। समय समाप्त होते ही आपका पेपर अपने-आप जमा हो जाएगा।'
                      : 'Time: ${paper.durationMinutes} minutes. Your paper is submitted automatically when the timer ends.',
                  style: const TextStyle(
                    fontSize: 12.5,
                    color: AppColors.textSecondary,
                    height: 1.5,
                  ),
                ),
              ),
            ],
          ),
        ),
        const SizedBox(height: 24),
        ElevatedButton(
          onPressed: () => ref.read(examAttemptProvider.notifier).beginExam(),
          style: ElevatedButton.styleFrom(
            backgroundColor: AppColors.brand,
            foregroundColor: Colors.white,
            minimumSize: const Size.fromHeight(48),
          ),
          child: Text(isHi ? 'परीक्षा शुरू करें' : 'Start Exam'),
        ),
      ],
    );
  }
}

// ── Runner ─────────────────────────────────────────────────────────────────

class _Runner extends ConsumerWidget {
  final ExamAttemptState state;
  final bool isHi;
  const _Runner({required this.state, required this.isHi});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final notifier = ref.read(examAttemptProvider.notifier);
    final q = state.currentQuestion;
    if (q == null) return const SizedBox.shrink();
    final total = state.questions.length;
    final response = state.currentResponse;
    final submitting = state.phase == ExamAttemptPhase.submitting;

    return Column(
      children: [
        Padding(
          padding: const EdgeInsets.fromLTRB(16, 8, 16, 4),
          child: Row(
            children: [
              Expanded(
                child: Text(
                  isHi
                      ? 'प्रश्न ${state.cursor + 1} / $total'
                      : 'Question ${state.cursor + 1} of $total',
                  style: const TextStyle(
                    fontSize: 13,
                    fontWeight: FontWeight.w700,
                    color: AppColors.textSecondary,
                  ),
                ),
              ),
              TextButton.icon(
                onPressed: () => _openNavigator(context, ref, isHi),
                icon: const Icon(Icons.grid_view_rounded, size: 16),
                label: Text(
                  isHi ? 'सभी प्रश्न' : 'All questions',
                  style: const TextStyle(fontSize: 12),
                ),
              ),
            ],
          ),
        ),
        LinearProgressIndicator(
          value: total == 0 ? 0 : (state.cursor + 1) / total,
          minHeight: 3,
          backgroundColor: AppColors.borderLight,
          valueColor: const AlwaysStoppedAnimation(AppColors.brand),
        ),
        Expanded(
          child: SingleChildScrollView(
            padding: const EdgeInsets.all(16),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  children: [
                    if (q.section != null)
                      _Tag(
                        text: examSectionLabel(q.section!, isHi),
                        color: AppColors.accent,
                      ),
                    if (q.section != null) const SizedBox(width: 8),
                    // Per-question marks, from the server's snapshot.
                    _Tag(
                      text: isHi ? '${q.marks} अंक' : '${q.marks} marks',
                      color: AppColors.brand,
                    ),
                  ],
                ),
                const SizedBox(height: 12),
                Container(
                  width: double.infinity,
                  padding: const EdgeInsets.all(16),
                  decoration: BoxDecoration(
                    color: AppColors.surface,
                    borderRadius: BorderRadius.circular(14),
                    border: Border.all(color: AppColors.borderLight),
                  ),
                  child: Text(
                    q.displayText(isHi),
                    style: const TextStyle(
                      fontSize: 15,
                      fontWeight: FontWeight.w600,
                      color: AppColors.textPrimary,
                      height: 1.5,
                    ),
                  ),
                ),
                const SizedBox(height: 16),
                // Reuses the shared quiz option tiles. `showResult` is false
                // throughout: an exam NEVER reveals correctness mid-paper —
                // the device does not even know the correct index (P1).
                QuestionOptionsList(
                  options: q.options,
                  selectedIndex: response.selectedIndex,
                  onSelect: submitting ? null : notifier.selectOption,
                ),
                Row(
                  children: [
                    TextButton.icon(
                      onPressed: submitting ? null : notifier.toggleMarked,
                      icon: Icon(
                        response.marked
                            ? Icons.bookmark_rounded
                            : Icons.bookmark_border_rounded,
                        size: 16,
                      ),
                      label: Text(
                        response.marked
                            ? (isHi ? 'चिह्न हटाएं' : 'Unmark')
                            : (isHi ? 'समीक्षा हेतु चिह्नित करें' : 'Mark for review'),
                        style: const TextStyle(fontSize: 12),
                      ),
                    ),
                    const Spacer(),
                    if (response.selectedIndex != null)
                      TextButton(
                        onPressed: submitting ? null : notifier.clearAnswer,
                        child: Text(
                          isHi ? 'उत्तर हटाएं' : 'Clear',
                          style: const TextStyle(fontSize: 12),
                        ),
                      ),
                  ],
                ),
                if (state.errorMessage != null &&
                    state.errorMessage != 'exam_duration_unavailable') ...[
                  const SizedBox(height: 8),
                  Container(
                    padding: const EdgeInsets.all(12),
                    decoration: BoxDecoration(
                      color: AppColors.error.withValues(alpha: 0.08),
                      borderRadius: BorderRadius.circular(10),
                    ),
                    child: Row(
                      children: [
                        Expanded(
                          child: Text(
                            state.errorMessage!,
                            style: const TextStyle(
                              fontSize: 12,
                              color: AppColors.error,
                              fontWeight: FontWeight.w600,
                            ),
                          ),
                        ),
                        TextButton(
                          onPressed: submitting ? null : notifier.retrySubmit,
                          child: Text(isHi ? 'पुनः जमा करें' : 'Retry'),
                        ),
                      ],
                    ),
                  ),
                ],
              ],
            ),
          ),
        ),
        _BottomBar(state: state, isHi: isHi),
      ],
    );
  }

  void _openNavigator(BuildContext context, WidgetRef ref, bool isHi) {
    showModalBottomSheet<void>(
      context: context,
      backgroundColor: AppColors.surface,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(18)),
      ),
      builder: (ctx) => _QuestionNavigator(isHi: isHi),
    );
  }
}

class _Tag extends StatelessWidget {
  final String text;
  final Color color;
  const _Tag({required this.text, required this.color});

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 5),
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.08),
        borderRadius: BorderRadius.circular(20),
        border: Border.all(color: color.withValues(alpha: 0.25)),
      ),
      child: Text(
        text,
        style: TextStyle(fontSize: 11, fontWeight: FontWeight.w700, color: color),
      ),
    );
  }
}

class _BottomBar extends ConsumerWidget {
  final ExamAttemptState state;
  final bool isHi;
  const _BottomBar({required this.state, required this.isHi});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final notifier = ref.read(examAttemptProvider.notifier);
    final submitting = state.phase == ExamAttemptPhase.submitting;
    final isLast = state.cursor >= state.questions.length - 1;

    return Container(
      padding: const EdgeInsets.fromLTRB(16, 10, 16, 14),
      decoration: const BoxDecoration(
        color: AppColors.surface,
        border: Border(top: BorderSide(color: AppColors.borderLight)),
      ),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          Text(
            isHi
                ? '${state.answeredCount} / ${state.questions.length} उत्तर दिए'
                : '${state.answeredCount} of ${state.questions.length} answered',
            style: const TextStyle(fontSize: 11.5, color: AppColors.textTertiary),
          ),
          const SizedBox(height: 8),
          Row(
            children: [
              Expanded(
                child: OutlinedButton(
                  onPressed:
                      submitting || state.cursor == 0 ? null : notifier.previous,
                  style: OutlinedButton.styleFrom(minimumSize: const Size.fromHeight(46)),
                  child: Text(isHi ? 'पिछला' : 'Previous'),
                ),
              ),
              const SizedBox(width: 10),
              Expanded(
                child: isLast
                    ? ElevatedButton(
                        onPressed: submitting
                            ? null
                            : () => _confirmSubmit(context, notifier, isHi),
                        style: ElevatedButton.styleFrom(
                          backgroundColor: AppColors.brand,
                          foregroundColor: Colors.white,
                          minimumSize: const Size.fromHeight(46),
                        ),
                        child: Text(
                          submitting
                              ? (isHi ? 'जमा हो रहा है…' : 'Submitting…')
                              : (isHi ? 'पेपर जमा करें' : 'Submit Paper'),
                        ),
                      )
                    : ElevatedButton(
                        onPressed: submitting ? null : notifier.next,
                        style: ElevatedButton.styleFrom(
                          backgroundColor: AppColors.brand,
                          foregroundColor: Colors.white,
                          minimumSize: const Size.fromHeight(46),
                        ),
                        child: Text(isHi ? 'अगला' : 'Next'),
                      ),
              ),
            ],
          ),
          if (!isLast) ...[
            const SizedBox(height: 6),
            TextButton(
              onPressed: submitting ? null : () => _confirmSubmit(context, notifier, isHi),
              child: Text(
                isHi ? 'अभी जमा करें' : 'Submit now',
                style: const TextStyle(fontSize: 12),
              ),
            ),
          ],
        ],
      ),
    );
  }

  Future<void> _confirmSubmit(
    BuildContext context,
    ExamAttemptNotifier notifier,
    bool isHi,
  ) async {
    final unanswered = state.questions.length - state.answeredCount;
    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: Text(isHi ? 'पेपर जमा करें?' : 'Submit paper?'),
        content: Text(
          unanswered > 0
              ? (isHi
                  ? '$unanswered प्रश्न अभी बाकी हैं। जमा करने के बाद बदलाव नहीं हो सकता।'
                  : '$unanswered questions are still unanswered. You cannot change answers after submitting.')
              : (isHi
                  ? 'जमा करने के बाद बदलाव नहीं हो सकता।'
                  : 'You cannot change answers after submitting.'),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(ctx).pop(false),
            child: Text(isHi ? 'रुकें' : 'Cancel'),
          ),
          TextButton(
            onPressed: () => Navigator.of(ctx).pop(true),
            child: Text(isHi ? 'जमा करें' : 'Submit'),
          ),
        ],
      ),
    );
    if (ok == true) await notifier.submit();
  }
}

// ── Question navigator ─────────────────────────────────────────────────────

class _QuestionNavigator extends ConsumerWidget {
  final bool isHi;
  const _QuestionNavigator({required this.isHi});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final state = ref.watch(examAttemptProvider);
    final notifier = ref.read(examAttemptProvider.notifier);

    // Group by section, preserving the server's `order`.
    final bySection = <String, List<int>>{};
    for (var i = 0; i < state.questions.length; i++) {
      final key = state.questions[i].section ?? '';
      bySection.putIfAbsent(key, () => <int>[]).add(i);
    }
    final keys = bySection.keys.toList()..sort();

    return SafeArea(
      child: ListView(
        shrinkWrap: true,
        padding: const EdgeInsets.all(20),
        children: [
          Text(
            isHi ? 'प्रश्न सूची' : 'Question navigator',
            style: const TextStyle(
              fontSize: 15,
              fontWeight: FontWeight.w800,
              color: AppColors.textPrimary,
            ),
          ),
          const SizedBox(height: 12),
          for (final key in keys) ...[
            Text(
              examSectionLabel(key, isHi),
              style: const TextStyle(
                fontSize: 12,
                fontWeight: FontWeight.w700,
                color: AppColors.textTertiary,
              ),
            ),
            const SizedBox(height: 8),
            Wrap(
              spacing: 8,
              runSpacing: 8,
              children: bySection[key]!.map((i) {
                final status = deriveExamStatus(
                  i < state.responses.length
                      ? state.responses[i]
                      : const ExamResponseEntry(),
                );
                final (bg, fg) = switch (status) {
                  ExamQuestionStatus.attempted => (AppColors.success, Colors.white),
                  ExamQuestionStatus.marked => (AppColors.warning, Colors.white),
                  ExamQuestionStatus.skipped => (AppColors.error, Colors.white),
                  ExamQuestionStatus.unattempted =>
                    (AppColors.borderLight, AppColors.textSecondary),
                };
                return GestureDetector(
                  onTap: () {
                    notifier.navigateTo(i);
                    Navigator.of(context).pop();
                  },
                  child: Container(
                    width: 38,
                    height: 38,
                    decoration: BoxDecoration(
                      color: bg,
                      borderRadius: BorderRadius.circular(10),
                      border: Border.all(
                        color: state.cursor == i ? AppColors.brand : Colors.transparent,
                        width: 2,
                      ),
                    ),
                    alignment: Alignment.center,
                    child: Text(
                      '${i + 1}',
                      style: TextStyle(
                        fontSize: 12.5,
                        fontWeight: FontWeight.w700,
                        color: fg,
                      ),
                    ),
                  ),
                );
              }).toList(growable: false),
            ),
            const SizedBox(height: 14),
          ],
          const Divider(color: AppColors.borderLight),
          const SizedBox(height: 6),
          Wrap(
            spacing: 12,
            runSpacing: 6,
            children: [
              _LegendDot(color: AppColors.success, label: isHi ? 'उत्तर दिया' : 'Answered'),
              _LegendDot(color: AppColors.warning, label: isHi ? 'चिह्नित' : 'Marked'),
              _LegendDot(color: AppColors.error, label: isHi ? 'छोड़ा' : 'Skipped'),
              _LegendDot(
                color: AppColors.borderLight,
                label: isHi ? 'देखा नहीं' : 'Not visited',
              ),
            ],
          ),
        ],
      ),
    );
  }
}

class _LegendDot extends StatelessWidget {
  final Color color;
  final String label;
  const _LegendDot({required this.color, required this.label});

  @override
  Widget build(BuildContext context) {
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        Container(
          width: 10,
          height: 10,
          decoration: BoxDecoration(color: color, borderRadius: BorderRadius.circular(3)),
        ),
        const SizedBox(width: 5),
        Text(label, style: const TextStyle(fontSize: 11, color: AppColors.textTertiary)),
      ],
    );
  }
}

// ── Terminal state cards ───────────────────────────────────────────────────

/// The `content_insufficient` state. Phase 2.2's assessment sign-off expects
/// 5 of the 51 CBSE papers to land here legitimately until more board-tagged
/// content is authored — so this is a calm "coming soon", NOT an error wall.
class _NotReadyCard extends StatelessWidget {
  final bool isHi;
  const _NotReadyCard({required this.isHi});

  @override
  Widget build(BuildContext context) {
    return _MessageCard(
      emoji: '📭',
      title: isHi ? 'यह पेपर अभी तैयार नहीं है' : 'This paper is not ready yet',
      body: isHi
          ? 'हम इस विषय के लिए और प्रश्न जोड़ रहे हैं। तब तक कोई और पेपर आज़माएँ।'
          : "We're still adding questions for this subject. Try another paper in the meantime.",
      actionLabel: isHi ? 'दूसरा पेपर चुनें' : 'Browse other papers',
      onAction: () => context.pop(),
    );
  }
}

class _UpgradeCard extends StatelessWidget {
  final bool isHi;
  const _UpgradeCard({required this.isHi});

  @override
  Widget build(BuildContext context) {
    return _MessageCard(
      emoji: '🔒',
      title: isHi ? 'प्रतियोगिता प्लान आवश्यक' : 'Competition plan required',
      body: isHi
          ? 'JEE, NEET और ओलंपियाड पेपर्स प्रतियोगिता प्लान के साथ अनलॉक होते हैं।'
          : 'JEE, NEET, and Olympiad papers unlock with the Competition plan.',
      actionLabel: isHi ? 'प्लान देखें' : 'View plans',
      onAction: () => context.push('/plans'),
    );
  }
}

class _MessageCard extends StatelessWidget {
  final String emoji;
  final String title;
  final String body;
  final String actionLabel;
  final VoidCallback onAction;

  const _MessageCard({
    required this.emoji,
    required this.title,
    required this.body,
    required this.actionLabel,
    required this.onAction,
  });

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(28),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Text(emoji, style: const TextStyle(fontSize: 44)),
            const SizedBox(height: 14),
            Text(
              title,
              textAlign: TextAlign.center,
              style: const TextStyle(
                fontSize: 17,
                fontWeight: FontWeight.w800,
                color: AppColors.textPrimary,
              ),
            ),
            const SizedBox(height: 8),
            Text(
              body,
              textAlign: TextAlign.center,
              style: const TextStyle(
                fontSize: 13,
                color: AppColors.textSecondary,
                height: 1.5,
              ),
            ),
            const SizedBox(height: 22),
            ElevatedButton(
              onPressed: onAction,
              style: ElevatedButton.styleFrom(
                backgroundColor: AppColors.brand,
                foregroundColor: Colors.white,
                minimumSize: const Size(200, 46),
              ),
              child: Text(actionLabel),
            ),
          ],
        ),
      ),
    );
  }
}
