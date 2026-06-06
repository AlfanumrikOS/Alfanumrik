import 'package:alfanumrik_api_v2/alfanumrik_api_v2.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../core/constants/app_colors.dart';
import '../../../core/services/subjects_provider.dart';
import '../../../data/models/subject.dart';
import '../../../providers/auth_provider.dart';
import '../../../providers/today_provider.dart';
import '../../widgets/error_widget.dart';
import '../../widgets/loading_widget.dart';
import 'today_copy.dart';
import 'today_deeplink.dart';

/// The adaptive "Today" home — the centerpiece of the `/v2` surface (Wave 2.3).
///
/// Renders the server-resolved queue from `TodayApi.getToday()`:
///   • a greeting,
///   • a "Today's focus" primary card (the rank-1 item), and
///   • the remaining queue as tappable rows.
///
/// All user-facing copy is bilingual (P7) via [todayCopy] / [resolveItemCopy],
/// driven by the device-locale `_isHindi` convention already used elsewhere in
/// mobile (e.g. quiz_screen.dart). Tapping any item navigates to its
/// translated mobile deep-link route.
///
/// Reached ONLY when `ApiConstants.useV2` is on — the flag-OFF app never
/// mounts this screen.
class TodayScreen extends ConsumerWidget {
  const TodayScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final isHi = _isHindi(context);
    final todayAsync = ref.watch(todayProvider);
    final student = ref.watch(studentProvider).valueOrNull;
    // Subjects power bilingual `{subject}` interpolation; an empty list while
    // loading just yields the graceful generic fallback inside resolveItemCopy.
    final subjects = ref.watch(subjectsProvider).valueOrNull ?? const <Subject>[];

    return Scaffold(
      backgroundColor: AppColors.background,
      body: SafeArea(
        child: RefreshIndicator(
          color: AppColors.primary,
          onRefresh: () => ref.read(todayProvider.notifier).refresh(),
          child: todayAsync.when(
            loading: () => _LoadingState(isHi: isHi, studentName: student?.name),
            error: (e, _) => ListView(
              physics: const AlwaysScrollableScrollPhysics(),
              children: [
                SizedBox(height: MediaQuery.of(context).size.height * 0.28),
                AppErrorWidget(
                  message: isHi
                      ? 'आज की योजना लोड नहीं हो सकी।'
                      : "Couldn't load your day. Pull to retry.",
                  onRetry: () => ref.read(todayProvider.notifier).refresh(),
                ),
              ],
            ),
            data: (today) => _TodayBody(
              today: today,
              subjects: subjects,
              isHi: isHi,
              studentName: student?.name,
            ),
          ),
        ),
      ),
    );
  }
}

/// Lightweight Hindi-detection helper. Mobile has no app-wide language toggle
/// yet; until one ships we honour the device locale — matching the `_isHindi`
/// helper used in quiz_screen.dart and the `_hi` data-field convention.
bool _isHindi(BuildContext context) {
  return Localizations.localeOf(context).languageCode == 'hi';
}

String _greeting(bool isHi, String? name) {
  final first = (name == null || name.trim().isEmpty)
      ? null
      : name.trim().split(' ').first;
  if (isHi) return first == null ? 'नमस्ते!' : 'नमस्ते, $first!';
  return first == null ? 'Hi!' : 'Hi, $first!';
}

class _TodayBody extends StatelessWidget {
  final TodayResponse today;
  final List<Subject> subjects;
  final bool isHi;
  final String? studentName;

  const _TodayBody({
    required this.today,
    required this.subjects,
    required this.isHi,
    required this.studentName,
  });

  @override
  Widget build(BuildContext context) {
    // The queue includes the primary item (rank 1). Render the primary as the
    // focus card and the REST as rows, so we don't duplicate it.
    final queue = today.queue.toList();
    final secondary =
        queue.where((i) => i.rank != today.primary.rank).toList(growable: false);

    return ListView(
      physics: const AlwaysScrollableScrollPhysics(),
      padding: const EdgeInsets.fromLTRB(20, 16, 20, 32),
      children: [
        Text(
          _greeting(isHi, studentName),
          style: const TextStyle(
            fontSize: 22,
            fontWeight: FontWeight.w700,
            color: AppColors.textPrimary,
          ),
        ),
        const SizedBox(height: 4),
        Text(
          todayCopy('today.heading', isHi),
          style: const TextStyle(
            fontSize: 13,
            color: AppColors.textTertiary,
          ),
        ),
        const SizedBox(height: 20),

        // ── Today's focus (primary) ────────────────────────────────
        Text(
          todayCopy('today.focus', isHi),
          style: const TextStyle(
            fontSize: 13,
            fontWeight: FontWeight.w600,
            color: AppColors.textTertiary,
          ),
        ),
        const SizedBox(height: 10),
        _FocusCard(item: today.primary, subjects: subjects, isHi: isHi),

        if (secondary.isNotEmpty) ...[
          const SizedBox(height: 24),
          ...secondary.map(
            (item) => Padding(
              padding: const EdgeInsets.only(bottom: 10),
              child: _QueueRow(item: item, subjects: subjects, isHi: isHi),
            ),
          ),
        ] else ...[
          const SizedBox(height: 24),
          _EmptyQueueHint(isHi: isHi),
        ],
      ],
    );
  }
}

/// Navigate to an item's translated mobile deep-link route.
void _go(BuildContext context, TodayQueueItem item) {
  context.go(resolveMobileRoute(item.deepLink));
}

/// The big primary "Today's focus" card (rank-1 item).
class _FocusCard extends StatelessWidget {
  final TodayQueueItem item;
  final List<Subject> subjects;
  final bool isHi;

  const _FocusCard({
    required this.item,
    required this.subjects,
    required this.isHi,
  });

  @override
  Widget build(BuildContext context) {
    final copy = resolveItemCopy(item, subjects, isHi);

    return GestureDetector(
      onTap: () => _go(context, item),
      behavior: HitTestBehavior.opaque,
      child: Container(
        padding: const EdgeInsets.all(18),
        decoration: BoxDecoration(
          gradient: const LinearGradient(
            colors: [AppColors.primary, AppColors.primaryDark],
            begin: Alignment.topLeft,
            end: Alignment.bottomRight,
          ),
          borderRadius: BorderRadius.circular(18),
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Text(copy.icon, style: const TextStyle(fontSize: 26)),
                const Spacer(),
                _MinutesBadge(label: copy.minutesBadge, onDark: true),
              ],
            ),
            const SizedBox(height: 14),
            Text(
              copy.label,
              style: const TextStyle(
                fontSize: 19,
                fontWeight: FontWeight.w700,
                color: Colors.white,
                height: 1.25,
              ),
            ),
            const SizedBox(height: 6),
            Text(
              copy.subtitle,
              style: TextStyle(
                fontSize: 13,
                color: Colors.white.withValues(alpha: 0.85),
                height: 1.4,
              ),
            ),
            const SizedBox(height: 16),
            Row(
              children: [
                Text(
                  isHi ? 'शुरू करें' : 'Start',
                  style: const TextStyle(
                    fontSize: 14,
                    fontWeight: FontWeight.w600,
                    color: Colors.white,
                  ),
                ),
                const SizedBox(width: 4),
                const Icon(Icons.arrow_forward_rounded,
                    size: 16, color: Colors.white),
              ],
            ),
          ],
        ),
      ),
    );
  }
}

/// A secondary queue row.
class _QueueRow extends StatelessWidget {
  final TodayQueueItem item;
  final List<Subject> subjects;
  final bool isHi;

  const _QueueRow({
    required this.item,
    required this.subjects,
    required this.isHi,
  });

  @override
  Widget build(BuildContext context) {
    final copy = resolveItemCopy(item, subjects, isHi);

    return GestureDetector(
      onTap: () => _go(context, item),
      behavior: HitTestBehavior.opaque,
      child: Container(
        padding: const EdgeInsets.all(14),
        decoration: BoxDecoration(
          color: AppColors.surface,
          borderRadius: BorderRadius.circular(14),
          border: Border.all(color: AppColors.borderLight),
        ),
        child: Row(
          children: [
            Text(copy.icon, style: const TextStyle(fontSize: 22)),
            const SizedBox(width: 14),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    copy.label,
                    style: const TextStyle(
                      fontSize: 14,
                      fontWeight: FontWeight.w600,
                      color: AppColors.textPrimary,
                    ),
                  ),
                  const SizedBox(height: 3),
                  Text(
                    copy.subtitle,
                    style: const TextStyle(
                      fontSize: 12,
                      color: AppColors.textTertiary,
                      height: 1.35,
                    ),
                  ),
                ],
              ),
            ),
            const SizedBox(width: 10),
            _MinutesBadge(label: copy.minutesBadge, onDark: false),
          ],
        ),
      ),
    );
  }
}

/// The "~N min" pill.
class _MinutesBadge extends StatelessWidget {
  final String label;
  final bool onDark;

  const _MinutesBadge({required this.label, required this.onDark});

  @override
  Widget build(BuildContext context) {
    final bg = onDark
        ? Colors.white.withValues(alpha: 0.18)
        : AppColors.surfaceAlt;
    final fg = onDark ? Colors.white : AppColors.textSecondary;
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
      decoration: BoxDecoration(
        color: bg,
        borderRadius: BorderRadius.circular(8),
      ),
      child: Text(
        label,
        style: TextStyle(
          fontSize: 11,
          fontWeight: FontWeight.w600,
          color: fg,
        ),
      ),
    );
  }
}

/// Shown when the queue has no items beyond the focus card.
class _EmptyQueueHint extends StatelessWidget {
  final bool isHi;

  const _EmptyQueueHint({required this.isHi});

  @override
  Widget build(BuildContext context) {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: AppColors.surfaceAlt,
        borderRadius: BorderRadius.circular(14),
      ),
      child: Text(
        todayCopy('today.empty', isHi),
        textAlign: TextAlign.center,
        style: const TextStyle(
          fontSize: 13,
          color: AppColors.textSecondary,
          height: 1.4,
        ),
      ),
    );
  }
}

/// Loading skeleton — greeting (if we already have the student) + shimmer.
class _LoadingState extends StatelessWidget {
  final bool isHi;
  final String? studentName;

  const _LoadingState({required this.isHi, required this.studentName});

  @override
  Widget build(BuildContext context) {
    return ListView(
      physics: const AlwaysScrollableScrollPhysics(),
      padding: const EdgeInsets.fromLTRB(20, 16, 20, 32),
      children: [
        Text(
          _greeting(isHi, studentName),
          style: const TextStyle(
            fontSize: 22,
            fontWeight: FontWeight.w700,
            color: AppColors.textPrimary,
          ),
        ),
        const SizedBox(height: 20),
        const ShimmerCard(height: 150),
        const SizedBox(height: 24),
        const ShimmerList(count: 3, itemHeight: 72),
      ],
    );
  }
}
