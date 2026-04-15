import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../core/constants/app_colors.dart';
import '../../../core/services/subjects_provider.dart';
import '../../../providers/auth_provider.dart';
import '../../widgets/loading_widget.dart';
import '../../widgets/error_widget.dart';

class SubjectsScreen extends ConsumerWidget {
  const SubjectsScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final student = ref.watch(studentProvider).valueOrNull;
    if (student == null) return const SizedBox.shrink();

    final subjectsAsync = ref.watch(subjectsProvider);

    return Scaffold(
      backgroundColor: AppColors.background,
      appBar: AppBar(title: const Text('Subjects')),
      body: subjectsAsync.when(
        loading: () => const LoadingScreen(message: 'Loading subjects...'),
        error: (e, _) => AppErrorWidget(
          message: e.toString(),
          onRetry: () => ref.invalidate(subjectsProvider),
        ),
        data: (subjects) => ListView.separated(
          padding: const EdgeInsets.all(16),
          itemCount: subjects.length,
          separatorBuilder: (_, __) => const SizedBox(height: 10),
          itemBuilder: (context, index) {
            final subj = subjects[index];
            final color = AppColors.subjectColor(subj.code);
            return GestureDetector(
              onTap: subj.isLocked
                  ? () => context.push('/plans')
                  : () => context.go('/learn/${subj.code}'),
              child: Container(
                padding: const EdgeInsets.all(16),
                decoration: BoxDecoration(
                  color: AppColors.surface,
                  borderRadius: BorderRadius.circular(14),
                  border: Border.all(color: color.withValues(alpha: 0.15)),
                ),
                child: Row(
                  children: [
                    Container(
                      width: 44,
                      height: 44,
                      decoration: BoxDecoration(
                        color: color.withValues(alpha: 0.1),
                        borderRadius: BorderRadius.circular(12),
                      ),
                      alignment: Alignment.center,
                      child: Text(subj.icon, style: const TextStyle(fontSize: 22)),
                    ),
                    const SizedBox(width: 14),
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            subj.name,
                            style: const TextStyle(
                              fontSize: 15,
                              fontWeight: FontWeight.w600,
                              color: AppColors.textPrimary,
                            ),
                          ),
                          Text(
                            'Class ${student.gradeNumber}',
                            style: const TextStyle(
                              fontSize: 12,
                              color: AppColors.textTertiary,
                            ),
                          ),
                        ],
                      ),
                    ),
                    if (subj.isLocked)
                      Icon(Icons.lock_outline_rounded,
                          size: 16, color: color.withValues(alpha: 0.6))
                    else
                      Icon(Icons.arrow_forward_ios_rounded,
                          size: 14, color: color.withValues(alpha: 0.5)),
                  ],
                ),
              ),
            );
          },
        ),
      ),
    );
  }
}
