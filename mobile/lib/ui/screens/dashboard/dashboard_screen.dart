import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:shimmer/shimmer.dart';

import '../../../core/constants/app_colors.dart';
import '../../../core/services/subjects_provider.dart';
import '../../../providers/chat_provider.dart';
import '../../../providers/auth_provider.dart';
import '../../../providers/dashboard_provider.dart';
import '../../widgets/foxy_panel.dart';
import '../../widgets/loading_widget.dart';
import '../../widgets/error_widget.dart';
import '../../../data/models/student.dart';

/// Student dashboard — mobile-first layout with Foxy embedded as the main action.
///
/// Layout (top → bottom):
///   1. Compact header strip — greeting + plan badge + primary stats inline.
///   2. FoxyPanel — expandable chat surface, the main CTA on the screen.
///      Shares [ChatNotifier] state with the full `/chat` screen so session/subject/mode
///      stay coherent. The whole collapsed card is tappable to expand/collapse.
///   3. Subject grid — compact 2-col, thumb-friendly tap cards.
///   4. Quick-action chips — Quiz, STEM Lab, Lab Notebook, More (thumb-friendly).
///   5. Upgrade prompt — free users only.
///
/// Stats strip uses Performance Score (0-100) when the backend returns it,
/// otherwise falls back to legacy XP/level — same dual-path as before (see
/// DashboardData.performanceScore / .xpTotal).
class DashboardScreen extends ConsumerWidget {
  const DashboardScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final studentAsync = ref.watch(studentProvider);
    final dashAsync = ref.watch(dashboardProvider);

    return Scaffold(
      backgroundColor: AppColors.background,
      body: SafeArea(
        child: studentAsync.when(
          loading: () => const LoadingScreen(message: 'Loading...'),
          error: (e, _) => AppErrorWidget(
            message: e.toString(),
            onRetry: () => ref.invalidate(studentProvider),
          ),
          data: (student) {
            if (student == null) return const SizedBox.shrink();

            return RefreshIndicator(
              color: AppColors.primary,
              onRefresh: () async {
                ref.read(dashboardProvider.notifier).refresh();
                await Future.delayed(const Duration(milliseconds: 500));
              },
              child: CustomScrollView(
                physics: const AlwaysScrollableScrollPhysics(),
                slivers: [
                  // ── 1. Compact header strip ────────────────────────────────────
                  SliverToBoxAdapter(
                    child: _HeaderStrip(student: student, dash: dashAsync),
                  ),

                  // ── 2. Foxy panel (embedded, main CTA) ────────────────────────
                  const SliverToBoxAdapter(
                    child: Padding(
                      padding: EdgeInsets.fromLTRB(16, 14, 16, 0),
                      child: FoxyPanel(),
                    ),
                  ),

                  // ── 3. Subjects grid ────────────────────────────────────────────
                  const SliverToBoxAdapter(
                    child: Padding(
                      padding: EdgeInsets.fromLTRB(20, 20, 20, 12),
                      child: Text(
                        'Your Subjects',
                        style: TextStyle(
                          fontSize: 16,
                          fontWeight: FontWeight.w700,
                          color: AppColors.textPrimary,
                        ),
                      ),
                    ),
                  ),
                  SliverPadding(
                    padding: const EdgeInsets.symmetric(horizontal: 16),
                    sliver: Consumer(
                      builder: (context, ref, _) {
                        final subjectsAsync = ref.watch(subjectsProvider);
                        return subjectsAsync.when(
                          loading: () => const SliverToBoxAdapter(
                            child: Padding(
                              padding: EdgeInsets.symmetric(vertical: 12),
                              child: ShimmerList(count: 2, itemHeight: 68),
                            ),
                          ),
                          error: (e, _) => SliverToBoxAdapter(
                            child: ErrorBanner(message: e.toString()),
                          ),
                          data: (subjects) => SliverGrid(
                            gridDelegate:
                                const SliverGridDelegateWithFixedCrossAxisCount(
                              crossAxisCount: 2,
                              mainAxisSpacing: 12,
                              crossAxisSpacing: 12,
                              childAspectRatio: 1.5,
                            ),
                            delegate: SliverChildBuilderDelegate(
                              (context, index) {
                                if (index >= subjects.length) return null;
                                final subj = subjects[index];
                                return _SubjectCard(
                                  name: subj.name,
                                  emoji: subj.icon,
                                  code: subj.code,
                                  isLocked: subj.isLocked,
                                  onTap: () => subj.isLocked
                                      ? context.push('/plans')
                                      : context.go('/learn/${subj.code}'),
                                );
                              },
                              childCount: subjects.length,
                            ),
                          ),
                        );
                      },
                    ),
                  ),

                  // ── 4. Quick-action chips (thumb-friendly) ──────────────────────
                  SliverToBoxAdapter(
                    child: Padding(
                      padding: const EdgeInsets.fromLTRB(16, 20, 16, 10),
                      child: _QuickActionsRow(),
                    ),
                  ),

                  // ── 5. Upgrade prompt (free only) ──────────────────────────────
                  if (!student.isPremium)
                    SliverToBoxAdapter(
                      child: Padding(
                        padding: const EdgeInsets.fromLTRB(16, 0, 16, 16),
                        child: _UpgradeCard(onTap: () => context.push('/plans')),
                      ),
                    ),

                  // Bottom padding so the last item isn't flush against the nav bar
                  const SliverToBoxAdapter(child: SizedBox(height: 8)),
                ],
              ),
            );
          },
        ),
      ),
    );
  }
}

/// Compact header: greeting on the left, plan badge + primary stats inline on
/// the right. Stats sit beside the header for a clean single-column mobile layout.
class _HeaderStrip extends StatelessWidget {
  final dynamic student;
  final AsyncValue dashAsync;

  const _HeaderStrip({required this.student, required this.dashAsync});

  @override
  Widget build(BuildContext context) {
    final s = student as Student?;
    final isHi = Localizations.localeOf(context).languageCode == 'hi';
    return Padding(
      padding: const EdgeInsets.fromLTRB(20, 16, 20, 0),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          // Greeting (left)
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  'Hi, ${s?.name.split(' ').first ?? ''}!',
                  style: const TextStyle(
                    fontSize: 20,
                    fontWeight: FontWeight.w700,
                    color: AppColors.textPrimary,
                  ),
                ),
                const SizedBox(height: 2),
                Text(
                  isHi
                      ? 'कक्षा ${s?.gradeNumber ?? ''} · ${s?.board ?? ''}'
                      : 'Class ${s?.gradeNumber ?? ''} · ${s?.board ?? ''}',
                  style: const TextStyle(
                    fontSize: 12,
                    color: AppColors.textTertiary,
                  ),
                ),
              ],
            ),
          ),
          const SizedBox(width: 12),

          // Plan badge
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
            decoration: BoxDecoration(
              color: s?.isPremium == true
                  ? AppColors.planPro.withValues(alpha: 0.1)
                  : AppColors.planFree.withValues(alpha: 0.1),
              borderRadius: BorderRadius.circular(16),
              border: Border.all(
                color: s?.isPremium == true
                    ? AppColors.planPro.withValues(alpha: 0.3)
                    : AppColors.planFree.withValues(alpha: 0.3),
              ),
            ),
            child: Text(
              s?.planDisplayName ?? '',
              style: TextStyle(
                fontSize: 10,
                fontWeight: FontWeight.w600,
                color: s?.isPremium == true
                    ? AppColors.planPro
                    : AppColors.planFree,
              ),
            ),
          ),

          // Primary stats column (score/XP, streak, coins)
          const SizedBox(width: 10),
          Expanded(
            child: _PrimaryStatsColumn(dashAsync: dashAsync),
          ),
        ],
      ),
    );
  }
}

/// Three inline stat chips stacked vertically: Score/XP, Streak, Foxy Coins.
class _PrimaryStatsColumn extends StatelessWidget {
  final AsyncValue dashAsync;

  const _PrimaryStatsColumn({required this.dashAsync});

  @override
  Widget build(BuildContext context) {
    return dashAsync.when(
      loading: () => const Padding(
        padding: EdgeInsets.symmetric(vertical: 4),
        child: ShimmerList(count: 1, itemHeight: 52),
      ),
      error: (e, _) => ErrorBanner(message: e.toString()),
      data: (dash) => Padding(
        padding: const EdgeInsets.only(top: 4),
        child: Column(
          children: [
            _StatChip(
              emoji: dash.performanceScore > 0 ? '📊' : '⭐',
              value: dash.performanceScore > 0
                  ? '${dash.performanceScore.round()}'
                  : '${dash.xpTotal}',
              label: dash.performanceScore > 0 ? 'Score' : 'XP',
              color: AppColors.xpGold,
            ),
            const SizedBox(height: 6),
            _StatChip(
              emoji: '🔥',
              value: '${dash.streakDays}',
              label: 'Streak',
              color: AppColors.error,
            ),
            const SizedBox(height: 6),
            _StatChip(
              emoji: '🪙',
              value: '${dash.foxyCoins}',
              label: 'Coins',
              color: AppColors.foxyCoins,
            ),
          ],
        ),
      ),
    );
  }
}

class _StatChip extends StatelessWidget {
  final String emoji;
  final String value;
  final String label;
  final Color color;

  const _StatChip({
    required this.emoji,
    required this.value,
    required this.label,
    required this.color,
  });

  @override
  Widget build(BuildContext context) {
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        Text(emoji, style: const TextStyle(fontSize: 14)),
        const SizedBox(width: 4),
        Text(
          value,
          style: TextStyle(
            fontSize: 13,
            fontWeight: FontWeight.w700,
            color: color,
          ),
        ),
        const SizedBox(width: 4),
        Text(
          label,
          style: const TextStyle(fontSize: 11, color: AppColors.textTertiary),
        ),
      ],
    );
  }
}

/// 2-column compact subject card — thumb-friendly (14pt padding).
class _SubjectCard extends StatelessWidget {
  final String name;
  final String emoji;
  final String code;
  final bool isLocked;
  final VoidCallback onTap;

  const _SubjectCard({
    required this.name,
    required this.emoji,
    required this.code,
    required this.isLocked,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    final color = AppColors.subjectColor(code);
    return GestureDetector(
      onTap: onTap,
      child: Container(
        padding: const EdgeInsets.all(14),
        decoration: BoxDecoration(
          color: AppColors.surface,
          borderRadius: BorderRadius.circular(14),
          border: Border.all(color: color.withValues(alpha: 0.15)),
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                Text(emoji, style: const TextStyle(fontSize: 22)),
                if (isLocked)
                  Icon(
                    Icons.lock_outline_rounded,
                    size: 12,
                    color: color.withValues(alpha: 0.6),
                  ),
              ],
            ),
            const SizedBox(height: 4),
            Text(
              name,
              style: TextStyle(
                fontSize: 12,
                fontWeight: FontWeight.w600,
                color: color,
              ),
            ),
          ],
        ),
      ),
    );
  }
}

/// Quick-action chips: Quiz, STEM Lab, Lab Notebook, More.
/// Thumb-friendly: 13pt font, 14pt horizontal + 10pt vertical padding, 18pt emoji.
class _QuickActionsRow extends StatelessWidget {
  @override
  Widget build(BuildContext context) {
    final isHi = Localizations.localeOf(context).languageCode == 'hi';
    return Wrap(
      spacing: 10,
      runSpacing: 10,
      children: [
        _ActionChip(
          emoji: '📝',
          label: isHi ? 'Quick Quiz' : 'Quick Quiz',
          color: AppColors.mathColor,
          onTap: () => context.go('/quiz'),
        ),
        _ActionChip(
          emoji: '🔬',
          label: isHi ? 'STEM लैब' : 'STEM Lab',
          color: AppColors.scienceColor,
          onTap: () => context.push('/stem-lab'),
        ),
        _ActionChip(
          emoji: '📓',
          label: isHi ? 'लैब नोटबुक' : 'Lab Notebook',
          color: AppColors.chemistryColor,
          onTap: () => context.push('/lab-notebook'),
        ),
        _ActionChip(
          emoji: '➕',
          label: isHi ? 'और देखो' : 'More',
          color: AppColors.accent,
          onTap: () => context.push('/progress'),
        ),
      ],
    );
  }
}

class _ActionChip extends StatelessWidget {
  final String emoji;
  final String label;
  final Color color;
  final VoidCallback onTap;

  const _ActionChip({
    required this.emoji,
    required this.label,
    required this.color,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      onTap: onTap,
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
        decoration: BoxDecoration(
          color: color.withValues(alpha: 0.06),
          borderRadius: BorderRadius.circular(20),
          border: Border.all(color: color.withValues(alpha: 0.18)),
        ),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            Text(emoji, style: const TextStyle(fontSize: 18)),
            const SizedBox(width: 6),
            Text(
              label,
              style: TextStyle(
                fontSize: 13,
                fontWeight: FontWeight.w600,
                color: color,
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _UpgradeCard extends StatelessWidget {
  final VoidCallback onTap;
  const _UpgradeCard({required this.onTap});

  @override
  Widget build(BuildContext context) {
    final isHi = Localizations.localeOf(context).languageCode == 'hi';
    return GestureDetector(
      onTap: onTap,
      child: Container(
        padding: const EdgeInsets.all(14),
        decoration: BoxDecoration(
          gradient: LinearGradient(
            colors: [
              AppColors.primary.withValues(alpha: 0.08),
              AppColors.accent.withValues(alpha: 0.06),
            ],
          ),
          borderRadius: BorderRadius.circular(14),
          border: Border.all(color: AppColors.primary.withValues(alpha: 0.15)),
        ),
        child: Row(
          children: [
            Icon(
              Icons.lock_open_rounded,
              size: 18,
              color: AppColors.primary,
            ),
            const SizedBox(width: 10),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    isHi ? 'पूरा सीखना अनलॉक करो' : 'Unlock full learning',
                    style: const TextStyle(
                      fontSize: 13,
                      fontWeight: FontWeight.w600,
                      color: AppColors.textPrimary,
                    ),
                  ),
                  Text(
                    isHi
                        ? 'अधिक चैट, क्विज़ और सिमुलेशन'
                        : 'More chats, quizzes & simulations',
                    style: const TextStyle(
                      fontSize: 11,
                      color: AppColors.textTertiary,
                    ),
                  ),
                ],
              ),
            ),
            Icon(
              Icons.arrow_forward_ios_rounded,
              size: 12,
              color: AppColors.primary,
            ),
          ],
        ),
      ),
    );
  }
}
