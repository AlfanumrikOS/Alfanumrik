import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../core/constants/app_colors.dart';
import '../../../data/models/assignment_models.dart';
import '../../../providers/assignments_provider.dart';
import '../../widgets/error_widget.dart';
import '../../widgets/loading_widget.dart';

/// Assignment detail — shows the assignment brief, every attempt so far
/// (attempt history, once `attemptNumber > 1` exists), and the
/// "Start"/"Retry" CTA that deep-links into the EXISTING mobile quiz screen
/// via `/quiz?subject=&count=&chapter=&from=assignment&assignmentId=<id>`
/// (mirrors the web's query-param deep link into `/quiz`).
///
/// No fixed question set exists per assignment (matches web) — "Start"
/// assembles questions from `question_bank` exactly like a normal practice
/// quiz, reusing the full P1/P2/P3/P4/P6 pipeline.
class AssignmentDetailScreen extends ConsumerWidget {
  final String assignmentId;
  const AssignmentDetailScreen({super.key, required this.assignmentId});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final isHi = Localizations.localeOf(context).languageCode == 'hi';
    final detailAsync = ref.watch(assignmentDetailProvider(assignmentId));

    return Scaffold(
      backgroundColor: AppColors.background,
      appBar: AppBar(
        backgroundColor: AppColors.surface,
        foregroundColor: AppColors.textPrimary,
        elevation: 0,
        title: Text(isHi ? 'असाइनमेंट' : 'Assignment'),
      ),
      body: SafeArea(
        child: detailAsync.when(
          loading: () => LoadingScreen(message: isHi ? 'लोड हो रहा है...' : 'Loading...'),
          error: (e, _) => AppErrorWidget(
            message: isHi ? 'लोड नहीं हो सका' : 'Failed to load assignment',
            onRetry: () => ref.invalidate(assignmentDetailProvider(assignmentId)),
          ),
          data: (item) => item == null
              ? AppErrorWidget(
                  message: isHi ? 'असाइनमेंट नहीं मिला' : 'Assignment not found',
                  onRetry: () => ref.invalidate(assignmentDetailProvider(assignmentId)),
                )
              : _DetailBody(item: item, isHi: isHi),
        ),
      ),
    );
  }
}

class _DetailBody extends ConsumerWidget {
  final AssignmentListItem item;
  final bool isHi;
  const _DetailBody({required this.item, required this.isHi});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final a = item.assignment;
    final topic = item.topic;
    final topicLabel = topic == null
        ? null
        : (isHi && topic.titleHi != null && topic.titleHi!.isNotEmpty ? topic.titleHi : topic.title);
    final canAttempt = item.canAttempt();
    final attemptsUsed = item.attempts.length;

    return ListView(
      padding: const EdgeInsets.fromLTRB(16, 16, 16, 32),
      children: [
        Text(a.title, style: const TextStyle(fontSize: 20, fontWeight: FontWeight.w700)),
        if (a.description != null && a.description!.isNotEmpty) ...[
          const SizedBox(height: 8),
          Text(
            a.description!,
            style: const TextStyle(fontSize: 13.5, color: AppColors.textSecondary, height: 1.5),
          ),
        ],
        const SizedBox(height: 14),
        Wrap(
          spacing: 8,
          runSpacing: 6,
          children: [
            if (a.subject != null && a.subject!.isNotEmpty)
              _Chip(label: a.subject!, color: AppColors.subjectColor(a.subject!.toLowerCase())),
            if (topicLabel != null && topicLabel.isNotEmpty)
              _Chip(label: topicLabel, color: AppColors.textTertiary),
            if (a.questionCount != null)
              _Chip(
                label: isHi ? '${a.questionCount} प्रश्न' : '${a.questionCount} questions',
                color: AppColors.textTertiary,
              ),
            _Chip(
              label: isHi
                  ? 'प्रयास $attemptsUsed/${a.maxAttempts}'
                  : 'Attempts $attemptsUsed/${a.maxAttempts}',
              color: AppColors.accent,
            ),
          ],
        ),
        if (a.dueDateTime != null) ...[
          const SizedBox(height: 10),
          Text(
            isHi
                ? 'नियत तिथि: ${_formatDate(a.dueDateTime!)}'
                : 'Due: ${_formatDate(a.dueDateTime!)}',
            style: const TextStyle(fontSize: 12.5, color: AppColors.textTertiary),
          ),
        ],
        const SizedBox(height: 20),
        SizedBox(
          width: double.infinity,
          child: ElevatedButton(
            onPressed: canAttempt
                ? () => _startAssignmentQuiz(context, a, topic)
                : null,
            style: ElevatedButton.styleFrom(
              backgroundColor: AppColors.brand,
              foregroundColor: Colors.white,
              disabledBackgroundColor: AppColors.borderLight,
              minimumSize: const Size.fromHeight(48),
            ),
            child: Text(
              item.attempts.isEmpty
                  ? (isHi ? 'असाइनमेंट शुरू करें' : 'Start Assignment')
                  : (isHi ? 'फिर से प्रयास करें' : 'Retry Assignment'),
            ),
          ),
        ),
        if (!canAttempt) ...[
          const SizedBox(height: 10),
          _LockedReasonBanner(item: item, isHi: isHi),
        ],
        if (item.attempts.isNotEmpty) ...[
          const SizedBox(height: 24),
          Text(
            isHi ? 'प्रयास इतिहास' : 'Attempt History',
            style: const TextStyle(fontSize: 15, fontWeight: FontWeight.w700),
          ),
          const SizedBox(height: 10),
          ...item.attempts.reversed.map((attempt) => _AttemptCard(attempt: attempt, isHi: isHi)),
        ],
      ],
    );
  }

  void _startAssignmentQuiz(BuildContext context, Assignment a, AssignmentTopic? topic) {
    final params = <String, String>{
      if (a.subject != null && a.subject!.isNotEmpty) 'subject': a.subject!,
      if (a.questionCount != null) 'count': a.questionCount.toString(),
      // Deep-link gap (honest, not fabricated — same pattern already
      // flagged in revision_overview_screen.dart): the quiz repository's
      // `chapterTitle` param is parsed as a chapter NUMBER on the /v2 path
      // but matched as a literal `chapter_title` string on the legacy v1
      // path. We forward the topic's chapter NUMBER (matching what the web
      // deep link sends) — this only resolves correctly end-to-end on the
      // /v2 path; the v1 path silently ignores the filter if no exact
      // string match exists (falls back to subject+grade scope, not a
      // fabricated wrong chapter).
      if (topic?.chapterNumber != null) 'chapter': topic!.chapterNumber.toString(),
      'from': 'assignment',
      'assignmentId': a.id,
    };
    final uri = Uri(path: '/quiz', queryParameters: params);
    context.push(uri.toString());
  }
}

class _LockedReasonBanner extends StatelessWidget {
  final AssignmentListItem item;
  final bool isHi;
  const _LockedReasonBanner({required this.item, required this.isHi});

  @override
  Widget build(BuildContext context) {
    final a = item.assignment;
    final isMaxAttempts = item.attempts.length >= a.maxAttempts;
    final message = isMaxAttempts
        ? (isHi
            ? 'आपने इस असाइनमेंट के लिए सभी ${a.maxAttempts} अनुमत प्रयास इस्तेमाल कर लिए हैं।'
            : "You've used all ${a.maxAttempts} attempts allowed for this assignment.")
        : (isHi
            ? 'नियत तिथि निकल चुकी है और यह असाइनमेंट अब देर से जमा स्वीकार नहीं करता।'
            : 'The due date has passed and this assignment no longer accepts late submissions.');

    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
      decoration: BoxDecoration(
        color: (isMaxAttempts ? AppColors.error : AppColors.warning).withValues(alpha: 0.08),
        borderRadius: BorderRadius.circular(10),
        border: Border.all(
          color: (isMaxAttempts ? AppColors.error : AppColors.warning).withValues(alpha: 0.3),
        ),
      ),
      child: Text(
        message,
        style: TextStyle(
          fontSize: 12,
          color: isMaxAttempts ? AppColors.error : AppColors.warning,
          fontWeight: FontWeight.w600,
        ),
      ),
    );
  }
}

class _AttemptCard extends StatelessWidget {
  final AssignmentSubmission attempt;
  final bool isHi;
  const _AttemptCard({required this.attempt, required this.isHi});

  @override
  Widget build(BuildContext context) {
    final status = deriveAssignmentViewStatus(attempt);
    final isGraded = status == AssignmentViewStatus.graded;
    // P7 language-aware pick: Hindi variant when the student prefers Hindi and
    // one exists, else the English feedback (never a blank when only English
    // was entered).
    final feedbackText = attempt.feedbackFor(isHi);

    return Container(
      margin: const EdgeInsets.only(bottom: 10),
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: AppColors.surface,
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: AppColors.border),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              Text(
                isHi ? 'प्रयास ${attempt.attemptNumber}' : 'Attempt ${attempt.attemptNumber}',
                style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w700),
              ),
              Text(
                attempt.score != null ? '${attempt.score}%' : '—',
                style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w700, color: AppColors.accent),
              ),
            ],
          ),
          const SizedBox(height: 4),
          Text(
            isGraded
                ? (isHi ? 'शिक्षक द्वारा समीक्षित' : 'Reviewed by teacher')
                : (isHi ? 'सबमिट किया गया' : 'Submitted'),
            style: const TextStyle(fontSize: 11.5, color: AppColors.textTertiary),
          ),
          if (isGraded && feedbackText != null) ...[
            const SizedBox(height: 8),
            Text(
              '"$feedbackText"',
              style: const TextStyle(fontSize: 12, color: AppColors.textSecondary, fontStyle: FontStyle.italic),
            ),
          ],
        ],
      ),
    );
  }
}

class _Chip extends StatelessWidget {
  final String label;
  final Color color;
  const _Chip({required this.label, required this.color});

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 9, vertical: 4),
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.1),
        borderRadius: BorderRadius.circular(20),
      ),
      child: Text(label, style: TextStyle(fontSize: 11.5, color: color, fontWeight: FontWeight.w600)),
    );
  }
}

String _formatDate(DateTime dt) {
  const months = [
    'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
    'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
  ];
  return '${dt.day} ${months[dt.month - 1]} ${dt.year}';
}
