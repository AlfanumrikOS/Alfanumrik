/// Daily Plan Card widget (Phase 6 mobile).
///
/// Mirrors src/components/dashboard/DailyPlanCard.tsx (web). Renders a
/// goal-aware daily plan card. Returns a SizedBox.shrink() (renders
/// nothing) when the server reports flag-off OR the student has no
/// goal OR the plan has zero items - this preserves byte-identical
/// default behavior for any caller that mounts this conditionally.
///
/// Owner: mobile
/// Reviewers: assessment (item rendering matches DailyPlan), quality (UX)

library;

import 'package:flutter/material.dart';

import '../../core/network/api_result.dart';
import '../../data/models/daily_plan.dart';
import '../../data/models/goal_profile.dart';
import '../../data/repositories/daily_plan_repository.dart';

class DailyPlanCard extends StatefulWidget {
  /// When true, renders en strings; when false renders hi strings.
  /// Caller derives this from the app-wide locale provider.
  final bool isEn;

  /// Repository override for testing. Defaults to DailyPlanRepository().
  final DailyPlanRepository? repository;

  const DailyPlanCard({super.key, required this.isEn, this.repository});

  @override
  State<DailyPlanCard> createState() => _DailyPlanCardState();
}

class _DailyPlanCardState extends State<DailyPlanCard> {
  late final DailyPlanRepository _repo;
  bool _loading = true;
  String? _error;
  DailyPlanResponse? _response;

  @override
  void initState() {
    super.initState();
    _repo = widget.repository ?? DailyPlanRepository();
    _load();
  }

  Future<void> _load() async {
    final result = await _repo.fetch();
    if (!mounted) return;
    setState(() {
      _loading = false;
      result.when(
        success: (data) {
          _response = data;
          _error = null;
        },
        failure: (msg) {
          _error = msg;
          _response = null;
        },
      );
    });
  }

  @override
  Widget build(BuildContext context) {
    if (_loading) return const _Skeleton();
    if (_error != null) return _ErrorBlock(isEn: widget.isEn);

    final r = _response;
    if (r == null) return const SizedBox.shrink();
    if (!r.flagEnabled) return const SizedBox.shrink();
    if (r.data.isEmpty) return const SizedBox.shrink();
    if (r.data.goal == null) return const SizedBox.shrink();

    final profile = goalProfiles[r.data.goal!];
    if (profile == null) return const SizedBox.shrink();

    final isEn = widget.isEn;
    final totalLabel = isEn
        ? '${r.data.totalMinutes} minutes'
        : '${r.data.totalMinutes} मिनट';

    return Card(
      key: const ValueKey('daily-plan-card'),
      margin: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        isEn ? "Today's plan" : 'आज की योजना',
                        style: Theme.of(context).textTheme.titleMedium,
                      ),
                      const SizedBox(height: 2),
                      Text(
                        totalLabel,
                        style: Theme.of(context).textTheme.bodySmall,
                      ),
                    ],
                  ),
                ),
                _GoalBadge(profile: profile, isEn: isEn),
              ],
            ),
            const SizedBox(height: 12),
            ...r.data.items.map((it) => _PlanItemRow(item: it, isEn: isEn)),
          ],
        ),
      ),
    );
  }
}

class _Skeleton extends StatelessWidget {
  const _Skeleton();
  @override
  Widget build(BuildContext context) {
    return Card(
      key: const ValueKey('daily-plan-card-skeleton'),
      margin: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: List.generate(3, (i) => const Padding(
            padding: EdgeInsets.symmetric(vertical: 4),
            child: SizedBox(height: 12, width: 200, child: ColoredBox(color: Color(0xFFEEEEEE))),
          )),
        ),
      ),
    );
  }
}

class _ErrorBlock extends StatelessWidget {
  final bool isEn;
  const _ErrorBlock({required this.isEn});
  @override
  Widget build(BuildContext context) {
    return Card(
      key: const ValueKey('daily-plan-card-error'),
      color: const Color(0xFFFAFAFA),
      margin: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Text(
          isEn ? "Couldn't load today's plan" : 'आज की योजना लोड नहीं हो सकी',
          style: Theme.of(context).textTheme.bodyMedium,
        ),
      ),
    );
  }
}

class _GoalBadge extends StatelessWidget {
  final GoalProfile profile;
  final bool isEn;
  const _GoalBadge({required this.profile, required this.isEn});

  Color get _toneColor {
    switch (profile.scorecardTone) {
      case ScorecardTone.encouraging: return const Color(0xFFE6F4EA);
      case ScorecardTone.analytical:  return const Color(0xFFE3F0FF);
      case ScorecardTone.examiner:    return const Color(0xFFFFF4E0);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
      decoration: BoxDecoration(
        color: _toneColor,
        borderRadius: BorderRadius.circular(999),
      ),
      child: Text(
        isEn ? profile.labelEn : profile.labelHi,
        style: Theme.of(context).textTheme.bodySmall,
      ),
    );
  }
}

const _kindIcon = {
  DailyPlanItemKind.pyq: '📋',
  DailyPlanItemKind.concept: '📖',
  DailyPlanItemKind.practice: '✍️',
  DailyPlanItemKind.challenge: '🧩',
  DailyPlanItemKind.review: '🔁',
  DailyPlanItemKind.reflection: '💭',
};

class _PlanItemRow extends StatelessWidget {
  final DailyPlanItem item;
  final bool isEn;
  const _PlanItemRow({required this.item, required this.isEn});
  @override
  Widget build(BuildContext context) {
    final icon = _kindIcon[item.kind] ?? '•';
    final title = isEn ? item.titleEn : item.titleHi;
    final mins = isEn ? '${item.estimatedMinutes} min' : '${item.estimatedMinutes} मिनट';
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 6),
      child: Row(
        children: [
          Text(icon, style: const TextStyle(fontSize: 20)),
          const SizedBox(width: 12),
          Expanded(
            child: Text(
              title,
              maxLines: 2,
              overflow: TextOverflow.ellipsis,
              style: Theme.of(context).textTheme.bodyMedium,
            ),
          ),
          const SizedBox(width: 8),
          Text(
            mins,
            style: Theme.of(context).textTheme.bodySmall,
          ),
        ],
      ),
    );
  }
}
