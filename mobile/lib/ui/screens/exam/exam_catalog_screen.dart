import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../core/constants/app_colors.dart';
import '../../../data/models/exam_models.dart';
import '../../../providers/exam_provider.dart';
import '../../widgets/error_widget.dart';
import '../../widgets/loading_widget.dart';

/// Exam catalog — mobile parity for the web mock-test picker
/// (`packages/ui/src/exams/MockTestCatalog.tsx` + `PaperCard.tsx`).
///
/// Filters map 1:1 to the server's `GET /api/exams/papers` query params
/// (`exam_family`, `subject`, `grade`). Non-`cbse_board` papers render with
/// a lock badge when `flag_enabled` is false — display only; the detail /
/// start / submit routes are the real 402 boundary.
///
/// P7: fully bilingual off the active locale.
class ExamCatalogScreen extends ConsumerStatefulWidget {
  const ExamCatalogScreen({super.key});

  @override
  ConsumerState<ExamCatalogScreen> createState() => _ExamCatalogScreenState();
}

class _ExamCatalogScreenState extends ConsumerState<ExamCatalogScreen> {
  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) {
      ref.read(examCatalogProvider.notifier).load();
    });
  }

  @override
  Widget build(BuildContext context) {
    final isHi = Localizations.localeOf(context).languageCode == 'hi';
    final state = ref.watch(examCatalogProvider);
    final notifier = ref.read(examCatalogProvider.notifier);

    return Scaffold(
      backgroundColor: AppColors.background,
      appBar: AppBar(
        backgroundColor: AppColors.surface,
        foregroundColor: AppColors.textPrimary,
        elevation: 0,
        title: Text(isHi ? '📝 मॉक टेस्ट' : '📝 Mock Tests'),
      ),
      body: SafeArea(
        child: Column(
          children: [
            _Filters(state: state, isHi: isHi),
            const Divider(height: 1, color: AppColors.borderLight),
            Expanded(
              child: Builder(
                builder: (_) {
                  if (state.loading && state.catalog == null) {
                    return LoadingScreen(
                      message: isHi ? 'पेपर लोड हो रहे हैं…' : 'Loading papers…',
                    );
                  }
                  if (state.error != null) {
                    return AppErrorWidget(
                      message: state.error!,
                      onRetry: notifier.load,
                    );
                  }
                  if (state.isEmpty) {
                    return _EmptyState(isHi: isHi);
                  }
                  return RefreshIndicator(
                    onRefresh: notifier.load,
                    child: ListView.builder(
                      padding: const EdgeInsets.fromLTRB(16, 12, 16, 24),
                      itemCount: state.papers.length,
                      itemBuilder: (context, i) {
                        final paper = state.papers[i];
                        return _PaperCard(
                          paper: paper,
                          locked: state.isLocked(paper),
                          isHi: isHi,
                          onTap: () => context.push('/exams/mock/${paper.id}'),
                        );
                      },
                    ),
                  );
                },
              ),
            ),
          ],
        ),
      ),
    );
  }
}

// ── Filters ────────────────────────────────────────────────────────────────

class _Filters extends ConsumerWidget {
  final ExamCatalogState state;
  final bool isHi;
  const _Filters({required this.state, required this.isHi});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final notifier = ref.read(examCatalogProvider.notifier);
    final isCbse = state.examFamily == 'cbse_board';

    return Container(
      color: AppColors.surface,
      padding: const EdgeInsets.fromLTRB(12, 10, 12, 12),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          _FilterLabel(isHi ? 'परीक्षा' : 'Exam'),
          SingleChildScrollView(
            scrollDirection: Axis.horizontal,
            child: Row(
              children: [
                _Chip(
                  label: isHi ? 'सभी' : 'All',
                  selected: state.examFamily == null,
                  onTap: () => notifier.setExamFamily(null),
                ),
                ...kExamFamilies.map(
                  (f) => _Chip(
                    label: isHi ? f.labelHi : f.label,
                    selected: state.examFamily == f.code,
                    onTap: () => notifier.setExamFamily(f.code),
                  ),
                ),
              ],
            ),
          ),
          if (isCbse) ...[
            const SizedBox(height: 10),
            _FilterLabel(isHi ? 'कक्षा' : 'Grade'),
            SingleChildScrollView(
              scrollDirection: Axis.horizontal,
              child: Row(
                children: [
                  _Chip(
                    label: isHi ? 'सभी' : 'All',
                    selected: state.grade == null,
                    onTap: () => notifier.setGrade(null),
                  ),
                  ...kExamGrades.map(
                    (g) => _Chip(
                      // P5: grade is a string everywhere.
                      label: isHi ? 'कक्षा $g' : 'Grade $g',
                      selected: state.grade == g,
                      onTap: () => notifier.setGrade(g),
                    ),
                  ),
                ],
              ),
            ),
          ],
          const SizedBox(height: 10),
          _FilterLabel(isHi ? 'विषय' : 'Subject'),
          SingleChildScrollView(
            scrollDirection: Axis.horizontal,
            child: Row(
              children: [
                _Chip(
                  label: isHi ? 'सभी' : 'All',
                  selected: state.subject == null,
                  onTap: () => notifier.setSubject(null),
                ),
                ...kExamSubjects.map(
                  (s) => _Chip(
                    label: isHi ? s.labelHi : s.label,
                    selected: state.subject == s.code,
                    onTap: () => notifier.setSubject(s.code),
                  ),
                ),
              ],
            ),
          ),
          if (state.loading && state.catalog != null) ...[
            const SizedBox(height: 8),
            const LinearProgressIndicator(
              minHeight: 2,
              backgroundColor: AppColors.borderLight,
              valueColor: AlwaysStoppedAnimation(AppColors.brand),
            ),
          ],
        ],
      ),
    );
  }
}

class _FilterLabel extends StatelessWidget {
  final String text;
  const _FilterLabel(this.text);

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 6, left: 2),
      child: Text(
        text,
        style: const TextStyle(
          fontSize: 11,
          fontWeight: FontWeight.w700,
          color: AppColors.textTertiary,
          letterSpacing: 0.3,
        ),
      ),
    );
  }
}

class _Chip extends StatelessWidget {
  final String label;
  final bool selected;
  final VoidCallback onTap;
  const _Chip({required this.label, required this.selected, required this.onTap});

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(right: 8),
      child: GestureDetector(
        onTap: onTap,
        child: Container(
          padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 8),
          decoration: BoxDecoration(
            color: selected ? AppColors.brand : AppColors.background,
            borderRadius: BorderRadius.circular(20),
            border: Border.all(color: selected ? AppColors.brand : AppColors.borderLight),
          ),
          child: Text(
            label,
            style: TextStyle(
              fontSize: 12,
              fontWeight: FontWeight.w600,
              color: selected ? Colors.white : AppColors.textSecondary,
            ),
          ),
        ),
      ),
    );
  }
}

// ── Paper card ─────────────────────────────────────────────────────────────

/// Resolves a subject code to its bilingual label, falling back to the raw
/// code so an unrecognised (future) code still renders something meaningful.
String? _subjectLabel(String? code, bool isHi) {
  if (code == null || code.isEmpty) return null;
  for (final s in kExamSubjects) {
    if (s.code == code) return isHi ? s.labelHi : s.label;
  }
  return code;
}

class _PaperCard extends StatelessWidget {
  final ExamPaper paper;
  final bool locked;
  final bool isHi;
  final VoidCallback onTap;

  const _PaperCard({
    required this.paper,
    required this.locked,
    required this.isHi,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    final subjectLabel = _subjectLabel(paper.primarySubject, isHi);

    return Padding(
      padding: const EdgeInsets.only(bottom: 12),
      child: GestureDetector(
        onTap: onTap,
        child: Container(
          padding: const EdgeInsets.all(16),
          decoration: BoxDecoration(
            color: AppColors.surface,
            borderRadius: BorderRadius.circular(14),
            border: Border.all(color: AppColors.borderLight),
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                children: [
                  Expanded(
                    child: Text(
                      paper.paperCode,
                      style: const TextStyle(
                        fontSize: 15,
                        fontWeight: FontWeight.w700,
                        color: AppColors.textPrimary,
                      ),
                    ),
                  ),
                  if (locked)
                    Container(
                      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                      decoration: BoxDecoration(
                        color: AppColors.warning.withValues(alpha: 0.1),
                        borderRadius: BorderRadius.circular(20),
                      ),
                      child: Row(
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          const Icon(Icons.lock_outline_rounded,
                              size: 12, color: AppColors.warning),
                          const SizedBox(width: 4),
                          Text(
                            isHi ? 'लॉक' : 'Locked',
                            style: const TextStyle(
                              fontSize: 10,
                              fontWeight: FontWeight.w700,
                              color: AppColors.warning,
                            ),
                          ),
                        ],
                      ),
                    ),
                ],
              ),
              const SizedBox(height: 8),
              Wrap(
                spacing: 8,
                runSpacing: 6,
                children: [
                  if (subjectLabel != null) _MetaPill(text: subjectLabel),
                  if (paper.grade != null)
                    _MetaPill(
                      text: isHi ? 'कक्षा ${paper.grade}' : 'Grade ${paper.grade}',
                    ),
                  if (paper.totalQuestions > 0)
                    _MetaPill(
                      text: isHi
                          ? '${paper.totalQuestions} प्रश्न'
                          : '${paper.totalQuestions} questions',
                    ),
                  if (paper.totalMarks > 0)
                    _MetaPill(
                      text: isHi ? '${paper.totalMarks} अंक' : '${paper.totalMarks} marks',
                    ),
                  // Duration is the SERVER's value — displayed, never invented.
                  if (paper.hasServerDuration)
                    _MetaPill(
                      text: isHi
                          ? '${paper.durationMinutes} मिनट'
                          : '${paper.durationMinutes} min',
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

class _MetaPill extends StatelessWidget {
  final String text;
  const _MetaPill({required this.text});

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 5),
      decoration: BoxDecoration(
        color: AppColors.background,
        borderRadius: BorderRadius.circular(20),
        border: Border.all(color: AppColors.borderLight),
      ),
      child: Text(
        text,
        style: const TextStyle(
          fontSize: 11,
          fontWeight: FontWeight.w600,
          color: AppColors.textSecondary,
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
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(32),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            const Text('📭', style: TextStyle(fontSize: 40)),
            const SizedBox(height: 12),
            Text(
              isHi ? 'इन फ़िल्टर के लिए कोई पेपर नहीं' : 'No papers for these filters',
              style: const TextStyle(
                fontSize: 15,
                fontWeight: FontWeight.w700,
                color: AppColors.textPrimary,
              ),
            ),
            const SizedBox(height: 6),
            Text(
              isHi
                  ? 'कोई और कक्षा या विषय चुनकर देखें।'
                  : 'Try a different grade or subject.',
              textAlign: TextAlign.center,
              style: const TextStyle(fontSize: 12.5, color: AppColors.textTertiary),
            ),
          ],
        ),
      ),
    );
  }
}
