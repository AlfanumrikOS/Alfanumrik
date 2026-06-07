import 'package:alfanumrik_api_v2/alfanumrik_api_v2.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/constants/app_colors.dart';
import '../../../providers/leaderboard_provider.dart';
import '../../widgets/error_widget.dart';
import '../../widgets/loading_widget.dart';

/// Leaderboard screen (Wave 2.3b) — renders `GET /v2/student/leaderboard`
/// (`StudentApi`) via the generated dart-dio client, with a weekly / monthly /
/// all period selector.
///
/// Loading / empty / error states. Bilingual (P7) via the device-locale
/// `_isHindi` convention used elsewhere in mobile.
///
/// P13: surfaces ONLY what the endpoint returns (rank, name, grade, total XP,
/// streak, school) — no extra PII is requested, derived, or logged.
///
/// Reached ONLY when `ApiConstants.useV2` is on — the flag-OFF app never mounts
/// this screen.
class LeaderboardScreen extends ConsumerWidget {
  const LeaderboardScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final isHi = _isHindi(context);
    final boardAsync = ref.watch(leaderboardProvider);
    final period = ref.watch(leaderboardPeriodProvider);

    return Scaffold(
      backgroundColor: AppColors.background,
      appBar: AppBar(title: Text(isHi ? 'लीडरबोर्ड' : 'Leaderboard')),
      body: SafeArea(
        child: Column(
          children: [
            _PeriodSelector(
              selected: period,
              isHi: isHi,
              onSelect: (p) =>
                  ref.read(leaderboardPeriodProvider.notifier).state = p,
            ),
            Expanded(
              child: RefreshIndicator(
                color: AppColors.primary,
                onRefresh: () =>
                    ref.read(leaderboardProvider.notifier).refresh(),
                child: boardAsync.when(
                  loading: () => ListView(
                    physics: const AlwaysScrollableScrollPhysics(),
                    padding: const EdgeInsets.fromLTRB(20, 16, 20, 32),
                    children: const [ShimmerList(count: 8, itemHeight: 60)],
                  ),
                  error: (e, _) => ListView(
                    physics: const AlwaysScrollableScrollPhysics(),
                    children: [
                      SizedBox(
                          height: MediaQuery.of(context).size.height * 0.22),
                      AppErrorWidget(
                        message: isHi
                            ? 'लीडरबोर्ड लोड नहीं हो सका। दोबारा खींचें।'
                            : "Couldn't load the leaderboard. Pull to retry.",
                        onRetry: () =>
                            ref.read(leaderboardProvider.notifier).refresh(),
                      ),
                    ],
                  ),
                  data: (board) => _BoardBody(board: board, isHi: isHi),
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

/// Device-locale Hindi detection — matches today_screen / quiz_screen.
bool _isHindi(BuildContext context) {
  return Localizations.localeOf(context).languageCode == 'hi';
}

class _PeriodSelector extends StatelessWidget {
  final LeaderboardPeriod selected;
  final bool isHi;
  final ValueChanged<LeaderboardPeriod> onSelect;

  const _PeriodSelector({
    required this.selected,
    required this.isHi,
    required this.onSelect,
  });

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(16, 12, 16, 4),
      child: Row(
        children: LeaderboardPeriod.values.map((p) {
          final isActive = p == selected;
          return Expanded(
            child: GestureDetector(
              onTap: () => onSelect(p),
              behavior: HitTestBehavior.opaque,
              child: Container(
                margin: const EdgeInsets.symmetric(horizontal: 4),
                padding: const EdgeInsets.symmetric(vertical: 10),
                decoration: BoxDecoration(
                  color: isActive ? AppColors.primary : AppColors.surface,
                  borderRadius: BorderRadius.circular(10),
                  border: Border.all(
                    color: isActive ? AppColors.primary : AppColors.borderLight,
                  ),
                ),
                alignment: Alignment.center,
                child: Text(
                  _periodLabel(p, isHi),
                  style: TextStyle(
                    fontSize: 12.5,
                    fontWeight: FontWeight.w600,
                    color: isActive ? Colors.white : AppColors.textSecondary,
                  ),
                ),
              ),
            ),
          );
        }).toList(),
      ),
    );
  }
}

class _BoardBody extends StatelessWidget {
  final LeaderboardResponse board;
  final bool isHi;

  const _BoardBody({required this.board, required this.isHi});

  @override
  Widget build(BuildContext context) {
    final entries = board.entries.toList();
    if (entries.isEmpty) {
      return ListView(
        physics: const AlwaysScrollableScrollPhysics(),
        padding: const EdgeInsets.fromLTRB(20, 24, 20, 32),
        children: [
          Container(
            width: double.infinity,
            padding: const EdgeInsets.all(16),
            decoration: BoxDecoration(
              color: AppColors.surfaceAlt,
              borderRadius: BorderRadius.circular(14),
            ),
            child: Text(
              isHi
                  ? 'इस अवधि के लिए अभी कोई रैंकिंग नहीं है। XP कमाएँ और शीर्ष पर पहुँचें!'
                  : 'No rankings for this period yet. Earn XP to climb the board!',
              textAlign: TextAlign.center,
              style: const TextStyle(
                fontSize: 13,
                color: AppColors.textSecondary,
                height: 1.4,
              ),
            ),
          ),
        ],
      );
    }

    return ListView.separated(
      physics: const AlwaysScrollableScrollPhysics(),
      padding: const EdgeInsets.fromLTRB(16, 12, 16, 32),
      itemCount: entries.length,
      separatorBuilder: (_, __) => const SizedBox(height: 8),
      itemBuilder: (context, i) => _EntryRow(entry: entries[i], isHi: isHi),
    );
  }
}

class _EntryRow extends StatelessWidget {
  final LeaderboardEntry entry;
  final bool isHi;

  const _EntryRow({required this.entry, required this.isHi});

  @override
  Widget build(BuildContext context) {
    final rankColor = switch (entry.rank) {
      1 => AppColors.xpGold,
      2 => AppColors.textTertiary,
      3 => AppColors.xpBronze,
      _ => AppColors.textSecondary,
    };
    final name = (entry.name == null || entry.name!.trim().isEmpty)
        ? (isHi ? 'विद्यार्थी' : 'Student')
        : entry.name!.trim();

    // P13: grade + school are the only context shown beyond name + XP, and
    // only when the endpoint provided them.
    final contextBits = <String>[];
    if (entry.grade != null && entry.grade!.isNotEmpty) {
      contextBits.add(isHi ? 'कक्षा ${entry.grade}' : 'Class ${entry.grade}');
    }
    if (entry.school != null && entry.school!.trim().isNotEmpty) {
      contextBits.add(entry.school!.trim());
    }

    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
      decoration: BoxDecoration(
        color: AppColors.surface,
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: AppColors.borderLight),
      ),
      child: Row(
        children: [
          // Rank badge
          Container(
            width: 32,
            height: 32,
            decoration: BoxDecoration(
              color: rankColor.withValues(alpha: 0.14),
              borderRadius: BorderRadius.circular(8),
            ),
            alignment: Alignment.center,
            child: Text(
              '${entry.rank}',
              style: TextStyle(
                fontSize: 13,
                fontWeight: FontWeight.w700,
                color: rankColor,
              ),
            ),
          ),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  name,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(
                    fontSize: 14,
                    fontWeight: FontWeight.w600,
                    color: AppColors.textPrimary,
                  ),
                ),
                if (contextBits.isNotEmpty) ...[
                  const SizedBox(height: 2),
                  Text(
                    contextBits.join(' · '),
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: const TextStyle(
                      fontSize: 11,
                      color: AppColors.textTertiary,
                    ),
                  ),
                ],
              ],
            ),
          ),
          const SizedBox(width: 10),
          Column(
            crossAxisAlignment: CrossAxisAlignment.end,
            children: [
              Text(
                '${entry.totalXp} XP',
                style: const TextStyle(
                  fontSize: 14,
                  fontWeight: FontWeight.w700,
                  color: AppColors.xpGold,
                ),
              ),
              if (entry.streak > 0) ...[
                const SizedBox(height: 2),
                Text(
                  isHi ? '🔥 ${entry.streak} दिन' : '🔥 ${entry.streak}d',
                  style: const TextStyle(
                    fontSize: 11,
                    color: AppColors.textTertiary,
                  ),
                ),
              ],
            ],
          ),
        ],
      ),
    );
  }
}

String _periodLabel(LeaderboardPeriod p, bool isHi) {
  switch (p) {
    case LeaderboardPeriod.weekly:
      return isHi ? 'साप्ताहिक' : 'Weekly';
    case LeaderboardPeriod.monthly:
      return isHi ? 'मासिक' : 'Monthly';
    case LeaderboardPeriod.all:
      return isHi ? 'सर्वकालिक' : 'All-time';
  }
}
