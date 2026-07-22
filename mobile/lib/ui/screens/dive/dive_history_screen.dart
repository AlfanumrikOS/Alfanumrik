/// Dive journal — mobile parity for
/// `apps/host/src/app/dive/history/page.tsx`.
///
/// Reads `GET /api/dive/history?limit=60`. Mirrors the web page's three
/// terminal states exactly:
///   * 404 (flag off)      → soft "not available for you yet" fallback
///   * empty / fetch error → the EMPTY journal with a CTA into `/dive`
///                           (the web deliberately degrades a non-404 failure
///                           to empty rather than an error wall)
///   * rows                → reverse-chronological artifact list
///
/// Owner: mobile · Reviewers: quality (UX)
library;

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../core/constants/app_colors.dart';
import '../../../data/models/dive_models.dart';
import '../../../providers/dive_provider.dart';
import '../../widgets/error_widget.dart';
import '../../widgets/loading_widget.dart';

const Map<DivePickerOption, (String en, String hi)> _kPickerLabels = {
  DivePickerOption.phenomenon: ('Phenomenon', 'सिलसिला'),
  DivePickerOption.weakTopic: ('Weak topic', 'कमज़ोर विषय'),
  DivePickerOption.ownTopic: ('Own topic', 'अपना विषय'),
};

class DiveHistoryScreen extends ConsumerWidget {
  const DiveHistoryScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final isHi = Localizations.localeOf(context).languageCode == 'hi';
    final historyAsync = ref.watch(diveHistoryProvider);

    return Scaffold(
      backgroundColor: AppColors.background,
      appBar: AppBar(
        backgroundColor: AppColors.surface,
        foregroundColor: AppColors.textPrimary,
        elevation: 0,
        title: Text(isHi ? '📔 मेरी डाइव डायरी' : '📔 My dive journal'),
      ),
      body: SafeArea(
        child: historyAsync.when(
          loading: () =>
              LoadingScreen(message: isHi ? 'लोड हो रहा है...' : 'Loading...'),
          // The notifier already degrades a fetch failure to the EMPTY phase
          // (matching the web); this branch only fires on an unexpected throw.
          error: (_, __) => AppErrorWidget(
            message: isHi ? 'लोड नहीं हो सका' : 'Failed to load',
            onRetry: () => ref.read(diveHistoryProvider.notifier).refresh(),
          ),
          data: (history) => RefreshIndicator(
            color: AppColors.primary,
            onRefresh: () => ref.read(diveHistoryProvider.notifier).refresh(),
            child: switch (history.phase) {
              DiveHistoryPhase.unavailable => _Centered(
                  emoji: '🤿',
                  title: isHi
                      ? 'यह सुविधा अभी आपके लिए उपलब्ध नहीं है।'
                      : 'This feature is not available for you yet.',
                ),
              DiveHistoryPhase.empty => _Centered(
                  emoji: '📔',
                  title: isHi
                      ? 'अभी कोई आर्टिफ़ैक्ट नहीं है।'
                      : 'No artifacts yet.',
                  subtitle: isHi
                      ? 'इस सप्ताह की डाइव शुरू करो।'
                      : "Start this week's dive.",
                  action: ElevatedButton(
                    onPressed: () => context.push('/dive'),
                    style: ElevatedButton.styleFrom(
                      backgroundColor: AppColors.brand,
                      foregroundColor: Colors.white,
                    ),
                    child: Text(isHi ? 'डाइव खोलो →' : 'Open dive →'),
                  ),
                ),
              DiveHistoryPhase.list => ListView.builder(
                  padding: const EdgeInsets.fromLTRB(16, 16, 16, 32),
                  itemCount: history.items.length + 1,
                  itemBuilder: (context, index) {
                    if (index == 0) {
                      return Padding(
                        padding: const EdgeInsets.only(bottom: 12),
                        child: Text(
                          isHi
                              ? '${history.items.length} आर्टिफ़ैक्ट'
                              : '${history.items.length} artifact'
                                  '${history.items.length == 1 ? '' : 's'}',
                          style: const TextStyle(
                            fontSize: 12,
                            color: AppColors.textTertiary,
                          ),
                        ),
                      );
                    }
                    return _ArtifactCard(
                      item: history.items[index - 1],
                      isHi: isHi,
                    );
                  },
                ),
            },
          ),
        ),
      ),
    );
  }
}

class _ArtifactCard extends StatelessWidget {
  final DiveHistoryItem item;
  final bool isHi;

  const _ArtifactCard({required this.item, required this.isHi});

  @override
  Widget build(BuildContext context) {
    final labels = _kPickerLabels[item.pickerOption]!;
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
                Expanded(
                  child: Text(
                    // `isoWeek` is a server-produced label — displayed
                    // verbatim, never parsed or recomputed here.
                    '${item.isoWeek} · ${isHi ? labels.$2 : labels.$1}',
                    style: const TextStyle(
                      fontSize: 10.5,
                      fontWeight: FontWeight.w800,
                      letterSpacing: 0.6,
                      color: AppColors.accent,
                    ),
                  ),
                ),
                Text(
                  _shortDate(item.createdAt),
                  style: const TextStyle(
                    fontSize: 10.5,
                    color: AppColors.textTertiary,
                  ),
                ),
              ],
            ),
            const SizedBox(height: 6),
            Text(
              item.title,
              style: const TextStyle(fontSize: 14, fontWeight: FontWeight.w700),
            ),
            const SizedBox(height: 3),
            Text(
              item.diveSubjects.isNotEmpty
                  ? item.diveSubjects.join(' · ')
                  : (isHi ? 'खुली खोज' : 'Open exploration'),
              style: const TextStyle(
                fontSize: 11.5,
                color: AppColors.textTertiary,
              ),
            ),
          ],
        ),
      ),
    );
  }

  /// `createdAt` is an ISO timestamp string from the server. Formatted for
  /// display only; a malformed value renders as the leading date substring
  /// rather than throwing.
  static String _shortDate(String iso) {
    final parsed = DateTime.tryParse(iso);
    if (parsed == null) return iso.split('T').first;
    final local = parsed.toLocal();
    const months = [
      'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
      'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
    ];
    return '${local.day} ${months[local.month - 1]} ${local.year}';
  }
}

class _Centered extends StatelessWidget {
  final String emoji;
  final String title;
  final String? subtitle;
  final Widget? action;

  const _Centered({
    required this.emoji,
    required this.title,
    this.subtitle,
    this.action,
  });

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
                  Text(emoji, style: const TextStyle(fontSize: 40)),
                  const SizedBox(height: 12),
                  Text(
                    title,
                    textAlign: TextAlign.center,
                    style: const TextStyle(
                      fontSize: 15,
                      fontWeight: FontWeight.w700,
                    ),
                  ),
                  if (subtitle != null) ...[
                    const SizedBox(height: 6),
                    Text(
                      subtitle!,
                      textAlign: TextAlign.center,
                      style: const TextStyle(
                        fontSize: 12,
                        color: AppColors.textTertiary,
                      ),
                    ),
                  ],
                  if (action != null) ...[
                    const SizedBox(height: 20),
                    action!,
                  ],
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}
