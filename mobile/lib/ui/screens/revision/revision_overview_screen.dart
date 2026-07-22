import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../core/constants/app_colors.dart';
import '../../../data/models/revision_models.dart';
import '../../../providers/revision_provider.dart';
import '../../widgets/error_widget.dart';
import '../../widgets/loading_widget.dart';

const Map<String, String> _kSubjectHi = {
  'math': 'गणित',
  'mathematics': 'गणित',
  'science': 'विज्ञान',
  'physics': 'भौतिकी',
  'chemistry': 'रसायन',
  'biology': 'जीव विज्ञान',
  'english': 'अंग्रेज़ी',
  'hindi': 'हिंदी',
  'history': 'इतिहास',
  'geography': 'भूगोल',
  'civics': 'नागरिक शास्त्र',
};

String _subjectLabel(String code, bool isHi) {
  if (isHi && _kSubjectHi.containsKey(code.toLowerCase())) {
    return _kSubjectHi[code.toLowerCase()]!;
  }
  if (code.isEmpty) return code;
  return code[0].toUpperCase() + code.substring(1);
}

const Map<RevisionModality, (String en, String hi, String icon)> _kModalityLabels = {
  RevisionModality.read: ('Read the chapter', 'अध्याय पढ़ो', '📖'),
  RevisionModality.explainer: ('See an explainer', 'समझाओ', '💡'),
  RevisionModality.workedExample: (
    'Walk through a worked example',
    'हल किया उदाहरण देखो',
    '✏️',
  ),
};

/// Refresh overview — mobile parity for `apps/host/src/app/refresh/page.tsx`.
///
/// Shows an entry card into the Quick Recall flashcard flow
/// ([QuickRecallScreen], pushed at `/refresh/recall`), the Chapter Refresh
/// stack, and the Retention Tests list. Each section auto-hides when empty;
/// when all three are empty the screen shows a single nudge (mirrors the
/// web's `sectionACount === 0` all-empty state).
///
/// NOT ported from web: the client-side `computeMonthlyReportMetrics()`
/// scoring/mastery math used by `/reports` — unrelated to this screen. Every
/// value rendered here (`mastery`, `daysSinceLastTouch`,
/// `recommendedModality`, `predictedRetention`, and every SM-2 field on a
/// flashcard) is read verbatim from a server response; nothing is computed
/// client-side.
class RevisionOverviewScreen extends ConsumerWidget {
  const RevisionOverviewScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final isHi = Localizations.localeOf(context).languageCode == 'hi';
    final overviewAsync = ref.watch(revisionOverviewProvider);

    return Scaffold(
      backgroundColor: AppColors.background,
      appBar: AppBar(
        backgroundColor: AppColors.surface,
        foregroundColor: AppColors.textPrimary,
        elevation: 0,
        title: Text(isHi ? '🔁 ताज़ा करो' : '🔁 Refresh'),
      ),
      body: SafeArea(
        child: overviewAsync.when(
          loading: () => LoadingScreen(
            message: isHi ? 'लोड हो रहा है...' : 'Loading...',
          ),
          error: (e, _) => AppErrorWidget(
            message: isHi ? 'लोड नहीं हो सका' : 'Failed to load',
            onRetry: () => ref.read(revisionOverviewProvider.notifier).refresh(),
          ),
          data: (overview) => RefreshIndicator(
            color: AppColors.primary,
            onRefresh: () => ref.read(revisionOverviewProvider.notifier).refresh(),
            child: overview.isAllEmpty
                ? _AllEmptyNudge(isHi: isHi)
                : ListView(
                    padding: const EdgeInsets.fromLTRB(16, 16, 16, 32),
                    children: [
                      if (overview.quickRecallCount > 0) ...[
                        _QuickRecallEntryCard(
                          count: overview.quickRecallCount,
                          isHi: isHi,
                          onTap: () => context.push('/refresh/recall'),
                        ),
                        const SizedBox(height: 20),
                      ],
                      if (overview.reviseStack.isNotEmpty) ...[
                        _SectionHeader(
                          title: isHi ? '🔁 अध्याय दोहराओ' : '🔁 Chapter Refresh',
                        ),
                        const SizedBox(height: 10),
                        ...overview.reviseStack.map(
                          (item) => _ChapterRefreshCard(item: item, isHi: isHi),
                        ),
                        const SizedBox(height: 20),
                      ],
                      if (overview.retentionTests.isNotEmpty) ...[
                        _SectionHeader(
                          title: isHi ? '🧠 याददाश्त परीक्षा' : '🧠 Retention Tests',
                        ),
                        const SizedBox(height: 10),
                        _RetentionTestsCard(
                          tests: overview.retentionTests,
                          isHi: isHi,
                        ),
                      ],
                    ],
                  ),
          ),
        ),
      ),
    );
  }
}

class _SectionHeader extends StatelessWidget {
  final String title;
  const _SectionHeader({required this.title});

  @override
  Widget build(BuildContext context) {
    return Text(
      title,
      style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w700),
    );
  }
}

class _QuickRecallEntryCard extends StatelessWidget {
  final int count;
  final bool isHi;
  final VoidCallback onTap;

  const _QuickRecallEntryCard({
    required this.count,
    required this.isHi,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    return Material(
      color: Colors.transparent,
      borderRadius: BorderRadius.circular(18),
      child: InkWell(
        borderRadius: BorderRadius.circular(18),
        onTap: onTap,
        child: Container(
          padding: const EdgeInsets.all(18),
          decoration: BoxDecoration(
            gradient: LinearGradient(
              colors: [
                AppColors.accent.withValues(alpha: 0.08),
                AppColors.success.withValues(alpha: 0.06),
              ],
            ),
            borderRadius: BorderRadius.circular(18),
            border: Border.all(color: AppColors.accent.withValues(alpha: 0.2)),
          ),
          child: Row(
            children: [
              Container(
                width: 48,
                height: 48,
                decoration: BoxDecoration(
                  color: AppColors.accent.withValues(alpha: 0.12),
                  borderRadius: BorderRadius.circular(14),
                ),
                alignment: Alignment.center,
                child: const Text('⚡', style: TextStyle(fontSize: 22)),
              ),
              const SizedBox(width: 14),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      isHi ? '⚡ झटपट याद' : '⚡ Quick Recall',
                      style: const TextStyle(fontSize: 15, fontWeight: FontWeight.w700),
                    ),
                    const SizedBox(height: 3),
                    Text(
                      isHi ? '$count कार्ड तैयार हैं' : '$count cards ready for you',
                      style: const TextStyle(fontSize: 12, color: AppColors.textTertiary),
                    ),
                  ],
                ),
              ),
              const Icon(Icons.chevron_right_rounded, color: AppColors.textTertiary),
            ],
          ),
        ),
      ),
    );
  }
}

class _ChapterRefreshCard extends StatelessWidget {
  final RevisionStackItem item;
  final bool isHi;

  const _ChapterRefreshCard({required this.item, required this.isHi});

  @override
  Widget build(BuildContext context) {
    final labels = _kModalityLabels[item.recommendedModality]!;
    final tint = AppColors.subjectColor(item.subjectCode.toLowerCase());

    return Padding(
      padding: const EdgeInsets.only(bottom: 10),
      child: Container(
        padding: const EdgeInsets.all(14),
        decoration: BoxDecoration(
          color: AppColors.surface,
          borderRadius: BorderRadius.circular(16),
          border: Border.all(color: AppColors.border),
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Container(
                  width: 44,
                  height: 44,
                  decoration: BoxDecoration(
                    color: tint.withValues(alpha: 0.12),
                    borderRadius: BorderRadius.circular(12),
                  ),
                  alignment: Alignment.center,
                  child: Text(labels.$3, style: const TextStyle(fontSize: 20)),
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        '${_subjectLabel(item.subjectCode, isHi)} · ${isHi ? 'अध्याय ${item.chapterNumber}' : 'Chapter ${item.chapterNumber}'}',
                        style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w700),
                      ),
                      const SizedBox(height: 2),
                      Text(
                        isHi
                            ? '${item.daysSinceLastTouch} दिन — पिछली मास्ट्री ${(item.mastery * 100).round()}%'
                            : '${item.daysSinceLastTouch} days · was at ${(item.mastery * 100).round()}% mastery',
                        style: const TextStyle(fontSize: 11.5, color: AppColors.textTertiary),
                      ),
                    ],
                  ),
                ),
              ],
            ),
            const SizedBox(height: 10),
            SizedBox(
              width: double.infinity,
              child: ElevatedButton(
                onPressed: () {
                  // Deep-link gap (honest, not fabricated): the web's
                  // `revise-stack` item URL points at a specific
                  // `/learn/{subject}/{chapterNumber}` chapter. Mobile's
                  // `/learn/:subjectCode/:topicId` route keys off a topic
                  // UUID, not a chapter NUMBER, and this endpoint returns no
                  // topic id to resolve that mapping. Rather than guess a
                  // (subject, chapterNumber) → topicId lookup, this opens
                  // the subject's chapter LIST so the student picks the
                  // matching chapter themselves. See mobile agent report,
                  // Phase 6 sub-phase 4, for the escalation to
                  // architect/backend to add a topicId to this response.
                  context.push('/learn/${item.subjectCode}');
                },
                style: ElevatedButton.styleFrom(
                  backgroundColor: tint,
                  foregroundColor: Colors.white,
                ),
                child: Text('${labels.$3} ${isHi ? labels.$2 : labels.$1} →'),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _RetentionTestsCard extends StatelessWidget {
  final List<RevisionRetentionTest> tests;
  final bool isHi;

  const _RetentionTestsCard({required this.tests, required this.isHi});

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: AppColors.accent.withValues(alpha: 0.06),
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: AppColors.accent.withValues(alpha: 0.15)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          ...tests.map(
            (t) => Padding(
              padding: const EdgeInsets.only(bottom: 6),
              child: Row(
                children: [
                  Container(
                    width: 8,
                    height: 8,
                    margin: const EdgeInsets.only(right: 8),
                    decoration: BoxDecoration(
                      color: t.predictedRetention < 0.5
                          ? const Color(0xFFEF4444)
                          : const Color(0xFFF59E0B),
                      shape: BoxShape.circle,
                    ),
                  ),
                  Expanded(
                    child: Text(
                      t.topicTitle,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: const TextStyle(fontSize: 12.5, fontWeight: FontWeight.w600),
                    ),
                  ),
                  Text(
                    isHi
                        ? '${(t.predictedRetention * 100).round()}% याददाश्त'
                        : '${(t.predictedRetention * 100).round()}% retention',
                    style: const TextStyle(fontSize: 11, color: AppColors.textTertiary),
                  ),
                ],
              ),
            ),
          ),
          const SizedBox(height: 8),
          SizedBox(
            width: double.infinity,
            child: OutlinedButton(
              onPressed: () {
                // Web deep-links to `/quiz?mode=cognitive` (the cognitive
                // quiz variant). Mobile's quiz flow has no cognitive-mode
                // parameter today, so this opens the standard quiz screen —
                // an honest degrade, not a silent behaviour fabrication.
                context.push('/quiz');
              },
              style: OutlinedButton.styleFrom(
                foregroundColor: AppColors.accent,
                side: BorderSide(color: AppColors.accent.withValues(alpha: 0.3)),
              ),
              child: Text(isHi ? '🧠 रिटेंशन टेस्ट लो' : '🧠 Take Retention Test'),
            ),
          ),
        ],
      ),
    );
  }
}

class _AllEmptyNudge extends StatelessWidget {
  final bool isHi;
  const _AllEmptyNudge({required this.isHi});

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
                  const Text('✨', style: TextStyle(fontSize: 40)),
                  const SizedBox(height: 12),
                  Text(
                    isHi ? 'अभी कुछ ताज़ा करने को नहीं' : 'Nothing to refresh right now',
                    style: const TextStyle(fontSize: 15, fontWeight: FontWeight.w700),
                  ),
                  const SizedBox(height: 6),
                  Text(
                    isHi
                        ? 'क्विज़ खेलो — या नीचे अपना कार्ड जोड़ो।'
                        : 'Take a quiz — or add your own card below.',
                    textAlign: TextAlign.center,
                    style: const TextStyle(fontSize: 12, color: AppColors.textTertiary),
                  ),
                  const SizedBox(height: 20),
                  ElevatedButton(
                    onPressed: () => context.push('/quiz'),
                    style: ElevatedButton.styleFrom(
                      backgroundColor: AppColors.brand,
                      foregroundColor: Colors.white,
                    ),
                    child: Text(isHi ? '⚡ क्विज़ खेलो' : '⚡ Take a Quiz'),
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
