import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../core/constants/app_colors.dart';
import '../../../data/models/assignment_models.dart';
import '../../../providers/assignments_provider.dart';
import '../../widgets/error_widget.dart';
import '../../widgets/loading_widget.dart';

/// My Assignments — mobile parity for
/// `apps/host/src/app/(student)/assignments/page.tsx`. Lists every
/// assignment issued to this student's class(es), each with a status badge
/// (Not started / Submitted / Reviewed / Overdue) and best score once
/// attempted.
class AssignmentsListScreen extends ConsumerWidget {
  const AssignmentsListScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final isHi = Localizations.localeOf(context).languageCode == 'hi';
    final listAsync = ref.watch(assignmentsListProvider);

    return Scaffold(
      backgroundColor: AppColors.background,
      appBar: AppBar(
        backgroundColor: AppColors.surface,
        foregroundColor: AppColors.textPrimary,
        elevation: 0,
        title: Text(isHi ? '📋 मेरे असाइनमेंट' : '📋 My Assignments'),
      ),
      body: SafeArea(
        child: listAsync.when(
          loading: () => LoadingScreen(message: isHi ? 'लोड हो रहा है...' : 'Loading...'),
          error: (e, _) => AppErrorWidget(
            message: isHi ? 'असाइनमेंट लोड नहीं हो सके' : 'Failed to load assignments',
            onRetry: () => ref.read(assignmentsListProvider.notifier).refresh(),
          ),
          data: (items) => RefreshIndicator(
            color: AppColors.primary,
            onRefresh: () => ref.read(assignmentsListProvider.notifier).refresh(),
            child: items.isEmpty
                ? _EmptyState(isHi: isHi)
                : ListView.builder(
                    padding: const EdgeInsets.fromLTRB(16, 16, 16, 32),
                    itemCount: items.length,
                    itemBuilder: (context, i) => _AssignmentCard(item: items[i], isHi: isHi),
                  ),
          ),
        ),
      ),
    );
  }
}

class _EmptyState extends StatelessWidget {
  final bool isHi;
  const _EmptyState({required this.isHi});

  @override
  Widget build(BuildContext context) {
    return LayoutBuilder(
      builder: (context, constraints) => SingleChildScrollView(
        physics: const AlwaysScrollableScrollPhysics(),
        child: ConstrainedBox(
          constraints: BoxConstraints(minHeight: constraints.maxHeight),
          child: Center(
            child: Padding(
              padding: const EdgeInsets.all(32),
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  const Text('📋', style: TextStyle(fontSize: 44)),
                  const SizedBox(height: 12),
                  Text(
                    isHi ? 'अभी तक कोई असाइनमेंट नहीं' : 'No assignments yet',
                    style: const TextStyle(fontSize: 15, fontWeight: FontWeight.w700),
                  ),
                  const SizedBox(height: 6),
                  Text(
                    isHi
                        ? 'जब आपके शिक्षक कोई काम देंगे, यह यहाँ दिखेगा।'
                        : "When your teacher gives you work, it'll show up here.",
                    textAlign: TextAlign.center,
                    style: const TextStyle(fontSize: 12, color: AppColors.textTertiary),
                  ),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}

class _AssignmentCard extends StatelessWidget {
  final AssignmentListItem item;
  final bool isHi;
  const _AssignmentCard({required this.item, required this.isHi});

  @override
  Widget build(BuildContext context) {
    final a = item.assignment;
    final viewStatus = item.viewStatus;
    final dueBadge = deriveDueBadge(a.dueDateTime, DateTime.now());
    final topic = item.topic;
    final topicLabel = topic == null
        ? null
        : (isHi && topic.titleHi != null && topic.titleHi!.isNotEmpty ? topic.titleHi : topic.title);

    return Material(
      color: Colors.transparent,
      borderRadius: BorderRadius.circular(14),
      child: InkWell(
        borderRadius: BorderRadius.circular(14),
        onTap: () => context.push('/assignments/${a.id}'),
        child: Container(
          margin: const EdgeInsets.only(bottom: 12),
          padding: const EdgeInsets.all(16),
          decoration: BoxDecoration(
            color: AppColors.surface,
            borderRadius: BorderRadius.circular(14),
            border: Border.all(color: AppColors.border),
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Expanded(
                    child: Text(
                      a.title,
                      style: const TextStyle(fontSize: 15, fontWeight: FontWeight.w700),
                    ),
                  ),
                  const SizedBox(width: 8),
                  _StatusBadge(viewStatus: viewStatus, dueBadge: dueBadge, isHi: isHi),
                ],
              ),
              const SizedBox(height: 8),
              Wrap(
                spacing: 8,
                runSpacing: 4,
                children: [
                  if (a.subject != null && a.subject!.isNotEmpty)
                    Container(
                      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
                      decoration: BoxDecoration(
                        color: AppColors.subjectColor(a.subject!.toLowerCase()).withValues(alpha: 0.1),
                        borderRadius: BorderRadius.circular(4),
                      ),
                      child: Text(
                        a.subject!,
                        style: TextStyle(
                          fontSize: 11,
                          color: AppColors.subjectColor(a.subject!.toLowerCase()),
                          fontWeight: FontWeight.w600,
                        ),
                      ),
                    ),
                  if (topicLabel != null && topicLabel.isNotEmpty)
                    Text(topicLabel, style: const TextStyle(fontSize: 12, color: AppColors.textTertiary)),
                  if (a.questionCount != null)
                    Text(
                      isHi ? '· ${a.questionCount} प्रश्न' : '· ${a.questionCount} Qs',
                      style: const TextStyle(fontSize: 12, color: AppColors.textTertiary),
                    ),
                ],
              ),
              const SizedBox(height: 12),
              if (viewStatus == AssignmentViewStatus.notStarted)
                SizedBox(
                  width: double.infinity,
                  child: ElevatedButton(
                    onPressed: () => context.push('/assignments/${a.id}'),
                    style: ElevatedButton.styleFrom(
                      backgroundColor: AppColors.brand,
                      foregroundColor: Colors.white,
                      minimumSize: const Size.fromHeight(44),
                    ),
                    child: Text(isHi ? 'असाइनमेंट शुरू करें' : 'Start Assignment'),
                  ),
                )
              else
                Row(
                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                  children: [
                    Text(
                      '${isHi ? 'स्कोर' : 'Score'}: ',
                      style: const TextStyle(fontSize: 13, color: AppColors.textSecondary),
                    ),
                    Text(
                      item.bestScore != null ? '${item.bestScore}%' : '—',
                      style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w700),
                    ),
                  ],
                ),
            ],
          ),
        ),
      ),
    );
  }
}

class _StatusBadge extends StatelessWidget {
  final AssignmentViewStatus viewStatus;
  final AssignmentDueBadge dueBadge;
  final bool isHi;
  const _StatusBadge({required this.viewStatus, required this.dueBadge, required this.isHi});

  @override
  Widget build(BuildContext context) {
    String label;
    Color color;

    if (viewStatus == AssignmentViewStatus.graded) {
      label = isHi ? 'समीक्षा हो चुकी' : 'Reviewed';
      color = AppColors.success;
    } else if (viewStatus == AssignmentViewStatus.submitted) {
      label = isHi ? 'सबमिट किया' : 'Submitted';
      color = AppColors.brand;
    } else {
      switch (dueBadge) {
        case AssignmentDueBadge.overdue:
          label = isHi ? 'देरी हो चुकी' : 'Overdue';
          color = AppColors.error;
          break;
        case AssignmentDueBadge.dueToday:
          label = isHi ? 'आज देय' : 'Due today';
          color = AppColors.warning;
          break;
        case AssignmentDueBadge.dueSoon:
        case AssignmentDueBadge.none:
          return const SizedBox.shrink();
      }
    }

    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 9, vertical: 3),
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.12),
        borderRadius: BorderRadius.circular(20),
      ),
      child: Text(
        label,
        style: TextStyle(fontSize: 11, fontWeight: FontWeight.w600, color: color),
      ),
    );
  }
}
