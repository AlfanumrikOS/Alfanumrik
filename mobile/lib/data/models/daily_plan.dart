/// Goal-Adaptive Daily Plan — Dart twin (Phase 6).
///
/// Mirrors src/lib/goals/daily-plan.ts (web). Decodes the response from
/// GET /api/student/daily-plan into a strongly-typed DailyPlan.
///
/// Founder constraint: ships dormant. The UI widget that consumes this
/// model is built but not yet mounted into existing screens.

library;

import 'goal_profile.dart';

enum DailyPlanItemKind {
  pyq('pyq'),
  concept('concept'),
  practice('practice'),
  challenge('challenge'),
  review('review'),
  reflection('reflection');

  final String value;
  const DailyPlanItemKind(this.value);

  static DailyPlanItemKind? fromString(String? s) {
    if (s == null) return null;
    for (final k in DailyPlanItemKind.values) {
      if (k.value == s) return k;
    }
    return null;
  }
}

class DailyPlanItem {
  final DailyPlanItemKind kind;
  final String titleEn;
  final String titleHi;
  final int estimatedMinutes;
  final String rationale;

  const DailyPlanItem({
    required this.kind,
    required this.titleEn,
    required this.titleHi,
    required this.estimatedMinutes,
    required this.rationale,
  });

  factory DailyPlanItem.fromJson(Map<String, dynamic> json) {
    final kindStr = json['kind'] as String?;
    final kind = DailyPlanItemKind.fromString(kindStr);
    if (kind == null) {
      throw ArgumentError('Unknown DailyPlanItemKind: ' + (kindStr ?? 'null'));
    }
    return DailyPlanItem(
      kind: kind,
      titleEn: (json['titleEn'] as String?) ?? '',
      titleHi: (json['titleHi'] as String?) ?? '',
      estimatedMinutes: (json['estimatedMinutes'] as num?)?.toInt() ?? 0,
      rationale: (json['rationale'] as String?) ?? '',
    );
  }
}

class DailyPlan {
  /// null when student has no goal or flag is OFF (server returns empty plan).
  final GoalCode? goal;
  final int totalMinutes;
  final List<DailyPlanItem> items;
  final DateTime generatedAt;

  const DailyPlan({
    required this.goal,
    required this.totalMinutes,
    required this.items,
    required this.generatedAt,
  });

  /// Empty-plan factory: matches the server's empty-plan shape.
  factory DailyPlan.empty({DateTime? now}) {
    return DailyPlan(
      goal: null,
      totalMinutes: 0,
      items: const [],
      generatedAt: now ?? DateTime.now().toUtc(),
    );
  }

  /// Decode the `data` field of the server response
  /// `{ success, data: DailyPlan, flagEnabled }`.
  factory DailyPlan.fromJson(Map<String, dynamic> json) {
    final goal = GoalCode.fromCode(json['goal'] as String?);
    final itemsRaw = (json['items'] as List?) ?? const [];
    final items = itemsRaw
        .whereType<Map<String, dynamic>>()
        .map(DailyPlanItem.fromJson)
        .toList(growable: false);
    final ts = json['generatedAt'] as String?;
    return DailyPlan(
      goal: goal,
      totalMinutes: (json['totalMinutes'] as num?)?.toInt() ?? 0,
      items: items,
      generatedAt: ts != null ? DateTime.parse(ts).toUtc() : DateTime.now().toUtc(),
    );
  }

  bool get isEmpty => items.isEmpty;
}

/// Wrapper for the full server response.
class DailyPlanResponse {
  final bool success;
  final DailyPlan data;
  final bool flagEnabled;

  const DailyPlanResponse({
    required this.success,
    required this.data,
    required this.flagEnabled,
  });

  factory DailyPlanResponse.fromJson(Map<String, dynamic> json) {
    return DailyPlanResponse(
      success: (json['success'] as bool?) ?? false,
      flagEnabled: (json['flagEnabled'] as bool?) ?? false,
      data: DailyPlan.fromJson((json['data'] as Map<String, dynamic>?) ?? const {}),
    );
  }
}
