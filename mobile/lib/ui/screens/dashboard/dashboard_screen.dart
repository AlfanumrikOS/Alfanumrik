import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../core/constants/app_colors.dart';
import '../../../core/constants/grade_subjects.dart';
import '../../../providers/auth_provider.dart';
import '../../../providers/dashboard_provider.dart';
import '../../widgets/loading_widget.dart';
import '../../widgets/error_widget.dart';

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
                  // Header
                  SliverToBoxAdapter(
                    child: Padding(
                      padding: const EdgeInsets.fromLTRB(20, 16, 20, 0),
                      child: Row(
                        children: [
                          Expanded(
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                Text(
                                  'Hi, ${student.name.split(' ').first}!',
                                  style: const TextStyle(
                                    fontSize: 22,
                                    fontWeight: FontWeight.w700,
                                    color: AppColors.textPrimary,
                                  ),
                                ),
                                const SizedBox(height: 2),
                                Text(
                                  'Class ${student.gradeNumber} · ${student.board}',
                                  style: const TextStyle(
                                    fontSize: 13,
                                    color: AppColors.textTertiary,
                                  ),
                                ),
                              ],
                            ),
                          ),
                          // Plan badge
                          Container(
                            padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 5),
                            decoration: BoxDecoration(
                              color: student.isPremium
                                  ? AppColors.planPro.withOpacity( 0.1)
                                  : AppColors.planFree.withOpacity( 0.1),
                              borderRadius: BorderRadius.circular(20),
                              border: Border.all(
                                color: student.isPremium
                                    ? AppColors.planPro.withOpacity( 0.3)
                                    : AppColors.planFree.withOpacity( 0.3),
                              ),
                            ),
                            child: Text(
                              student.planDisplayName,
                              style: TextStyle(
                                fontSize: 11,
                                fontWeight: FontWeight.w600,
                                color: student.isPremium
                                    ? AppColors.planPro
                                    : AppColors.planFree,
                              ),
                            ),
                          ),
                        ],
                      ),
                    ),
                  ),

                  // Stats cards
                  SliverToBoxAdapter(
                    child: dashAsync.when(
                      loading: () => const Padding(
                        padding: EdgeInsets.all(20),
                        child: ShimmerList(count: 2, itemHeight: 70),
                      ),
                      error: (e, _) => ErrorBanner(message: e.toString()),
                      data: (dash) => Padding(
                        padding: const EdgeInsets.all(16),
                        child: Column(
                          children: [
                            // XP + Level + Streak row
                            Row(
                              children: [
                                _StatCard(
                                  emoji: '⭐',
                                  value: '${dash.xpTotal}',
                                  label: 'XP',
                                  color: AppColors.xpGold,
                                ),
                                const SizedBox(width: 10),
                                _StatCard(
                                  emoji: '🏆',
                                  value: 'Lv ${dash.level}',
                                  label: dash.levelName,
                                  color: AppColors.accent,
                                ),
                                const SizedBox(width: 10),
                                _StatCard(
                                  emoji: '🔥',
                                  value: '${dash.streakDays}',
                                  label: 'Day Streak',
                                  color: AppColors.error,
                                ),
                              ],
                            ),
                            const SizedBox(height: 10),
                            // Level progress bar
                            Container(
                              padding: const EdgeInsets.all(12),
                              decoration: BoxDecoration(
                                color: AppColors.surface,
                                borderRadius: BorderRadius.circular(12),
                                border: Border.all(color: AppColors.borderLight),
                              ),
                              child: Column(
                                crossAxisAlignment: CrossAxisAlignment.start,
                                children: [
                                  Row(
                                    mainAxisAlignment: MainAxisAlignment.spaceBetween,
                                    children: [
                                      Text(
                                        'Level ${dash.level} Progress',
                                        style: const TextStyle(
                                          fontSize: 12,
                                          fontWeight: FontWeight.w600,
                                          color: AppColors.textSecondary,
                                        ),
                                      ),
                                      Text(
                                        '${(dash.levelProgress * 100).toInt()}%',
                                        style: const TextStyle(
                                          fontSize: 12,
                                          fontWeight: FontWeight.w700,
                                          color: AppColors.accent,
                                        ),
                                      ),
                                    ],
                                  ),
                                  const SizedBox(height: 6),
                                  ClipRRect(
                                    borderRadius: BorderRadius.circular(4),
                                    child: LinearProgressIndicator(
                                      value: dash.levelProgress,
                                      minHeight: 6,
                                      backgroundColor: AppColors.borderLight,
                                      valueColor: const AlwaysStoppedAnimation(AppColors.accent),
                                    ),
                                  ),
                                ],
                              ),
                            ),
                            // Daily usage limits
                            const SizedBox(height: 10),
                            Row(
                              children: [
                                Expanded(
                                  child: _UsageBar(
                                    icon: Icons.chat_bubble_outline_rounded,
                                    label: 'Foxy Chats',
                                    used: dash.usage.foxyChatsUsed,
                                    limit: dash.usage.foxyChatsLimit,
                                    color: AppColors.accent,
                                  ),
                                ),
                                const SizedBox(width: 10),
                                Expanded(
                                  child: _UsageBar(
                                    icon: Icons.quiz_outlined,
                                    label: 'Quizzes',
                                    used: dash.usage.quizzesUsed,
                                    limit: dash.usage.quizzesLimit,
                                    color: AppColors.mathColor,
                                  ),
                                ),
                              ],
                            ),
                          ],
                        ),
                      ),
                    ),
                  ),

                  // Subjects header
                  const SliverToBoxAdapter(
                    child: Padding(
                      padding: EdgeInsets.fromLTRB(20, 8, 20, 10),
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

                  // Subject grid
                  SliverPadding(
                    padding: const EdgeInsets.symmetric(horizontal: 16),
                    sliver: SliverGrid(
                      gridDelegate: const SliverGridDelegateWithFixedCrossAxisCount(
                        crossAxisCount: 2,
                        mainAxisSpacing: 10,
                        crossAxisSpacing: 10,
                        childAspectRatio: 1.6,
                      ),
                      delegate: SliverChildBuilderDelegate(
                        (context, index) {
                          final subjects = GradeSubjects.forGrade(student.gradeNumber);
                          if (index >= subjects.length) return null;
                          final subj = subjects[index];
                          return _SubjectCard(
                            name: subj.name,
                            emoji: subj.emoji,
                            code: subj.code,
                            onTap: () => context.go('/learn/${subj.code}'),
                          );
                        },
                        childCount: GradeSubjects.forGrade(student.gradeNumber).length,
                      ),
                    ),
                  ),

                  // Quick actions
                  SliverToBoxAdapter(
                    child: Padding(
                      padding: const EdgeInsets.all(16),
                      child: Row(
                        children: [
                          Expanded(
                            child: _ActionCard(
                              emoji: '🦊',
                              label: 'Ask Foxy',
                              color: AppColors.accent,
                              onTap: () => context.go('/chat'),
                            ),
                          ),
                          const SizedBox(width: 10),
                          Expanded(
                            child: _ActionCard(
                              emoji: '📝',
                              label: 'Quick Quiz',
                              color: AppColors.mathColor,
                              onTap: () => context.go('/quiz'),
                            ),
                          ),
                        ],
                      ),
                    ),
                  ),

                  // Upgrade prompt (free users only)
                  if (!student.isPremium)
                    SliverToBoxAdapter(
                      child: Padding(
                        padding: const EdgeInsets.fromLTRB(16, 0, 16, 16),
                        child: GestureDetector(
                          onTap: () => context.push('/plans'),
                          child: Container(
                            padding: const EdgeInsets.all(16),
                            decoration: BoxDecoration(
                              gradient: LinearGradient(
                                colors: [
                                  AppColors.primary.withOpacity( 0.08),
                                  AppColors.accent.withOpacity( 0.06),
                                ],
                              ),
                              borderRadius: BorderRadius.circular(14),
                              border: Border.all(color: AppColors.primary.withOpacity( 0.15)),
                            ),
                            child: const Row(
                              children: [
                                Text('⚡', style: TextStyle(fontSize: 24)),
                                SizedBox(width: 12),
                                Expanded(
                                  child: Column(
                                    crossAxisAlignment: CrossAxisAlignment.start,
                                    children: [
                                      Text(
                                        'Unlock full learning',
                                        style: TextStyle(
                                          fontSize: 14,
                                          fontWeight: FontWeight.w600,
                                          color: AppColors.textPrimary,
                                        ),
                                      ),
                                      Text(
                                        'More chats, quizzes & simulations',
                                        style: TextStyle(
                                          fontSize: 11,
                                          color: AppColors.textTertiary,
                                        ),
                                      ),
                                    ],
                                  ),
                                ),
                                Icon(Icons.arrow_forward_ios_rounded,
                                    size: 14, color: AppColors.primary),
                              ],
                            ),
                          ),
                        ),
                      ),
                    ),

                  const SliverToBoxAdapter(child: SizedBox(height: 16)),
                ],
              ),
            );
          },
        ),
      ),
    );
  }
}

class _StatCard extends StatelessWidget {
  final String emoji;
  final String value;
  final String label;
  final Color color;

  const _StatCard({
    required this.emoji,
    required this.value,
    required this.label,
    required this.color,
  });

  @override
  Widget build(BuildContext context) {
    return Expanded(
      child: Container(
        padding: const EdgeInsets.symmetric(vertical: 12, horizontal: 10),
        decoration: BoxDecoration(
          color: color.withOpacity( 0.06),
          borderRadius: BorderRadius.circular(12),
          border: Border.all(color: color.withOpacity( 0.15)),
        ),
        child: Column(
          children: [
            Text(emoji, style: const TextStyle(fontSize: 18)),
            const SizedBox(height: 4),
            Text(
              value,
              style: TextStyle(
                fontSize: 16,
                fontWeight: FontWeight.w700,
                color: color,
              ),
            ),
            Text(
              label,
              style: const TextStyle(fontSize: 10, color: AppColors.textTertiary),
              overflow: TextOverflow.ellipsis,
            ),
          ],
        ),
      ),
    );
  }
}

class _SubjectCard extends StatelessWidget {
  final String name;
  final String emoji;
  final String code;
  final VoidCallback onTap;

  const _SubjectCard({
    required this.name,
    required this.emoji,
    required this.code,
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
          border: Border.all(color: color.withOpacity( 0.15)),
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Text(emoji, style: const TextStyle(fontSize: 24)),
            const SizedBox(height: 6),
            Text(
              name,
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

class _UsageBar extends StatelessWidget {
  final IconData icon;
  final String label;
  final int used;
  final int limit;
  final Color color;

  const _UsageBar({
    required this.icon,
    required this.label,
    required this.used,
    required this.limit,
    required this.color,
  });

  @override
  Widget build(BuildContext context) {
    final ratio = limit > 0 ? (used / limit).clamp(0.0, 1.0) : 0.0;
    final isAtLimit = used >= limit;

    return Container(
      padding: const EdgeInsets.all(10),
      decoration: BoxDecoration(
        color: AppColors.surface,
        borderRadius: BorderRadius.circular(10),
        border: Border.all(color: AppColors.borderLight),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Icon(icon, size: 14, color: isAtLimit ? AppColors.error : color),
              const SizedBox(width: 6),
              Expanded(
                child: Text(
                  label,
                  style: const TextStyle(
                    fontSize: 11,
                    fontWeight: FontWeight.w500,
                    color: AppColors.textSecondary,
                  ),
                ),
              ),
              Text(
                '$used/$limit',
                style: TextStyle(
                  fontSize: 11,
                  fontWeight: FontWeight.w600,
                  color: isAtLimit ? AppColors.error : color,
                ),
              ),
            ],
          ),
          const SizedBox(height: 6),
          ClipRRect(
            borderRadius: BorderRadius.circular(3),
            child: LinearProgressIndicator(
              value: ratio,
              minHeight: 4,
              backgroundColor: AppColors.borderLight,
              valueColor: AlwaysStoppedAnimation(
                isAtLimit ? AppColors.error : color,
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class _ActionCard extends StatelessWidget {
  final String emoji;
  final String label;
  final Color color;
  final VoidCallback onTap;

  const _ActionCard({
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
        padding: const EdgeInsets.symmetric(vertical: 16, horizontal: 14),
        decoration: BoxDecoration(
          color: color.withOpacity( 0.06),
          borderRadius: BorderRadius.circular(14),
          border: Border.all(color: color.withOpacity( 0.15)),
        ),
        child: Row(
          children: [
            Text(emoji, style: const TextStyle(fontSize: 22)),
            const SizedBox(width: 10),
            Text(
              label,
              style: TextStyle(
                fontSize: 14,
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
