/// Weekly Curiosity Dive (Pedagogy v2 Wave 2) — mobile parity models for
/// `apps/host/src/app/dive/page.tsx` + `apps/host/src/app/dive/history/page.tsx`.
///
/// Verified against the ACTUAL route files on 2026-07-22:
///   * `GET  /api/dive/state`    → apps/host/src/app/api/dive/state/route.ts
///   * `POST /api/dive/start`    → apps/host/src/app/api/dive/start/route.ts
///   * `POST /api/dive/artifact` → apps/host/src/app/api/dive/artifact/route.ts
///   * `GET  /api/dive/history`  → apps/host/src/app/api/dive/history/route.ts
///
/// SHAPE NOTE (do not "normalise" this): `/api/dive/state` returns the
/// phenomenon rows in RAW SNAKE_CASE straight off the `phenomena` table
/// (`title_en`, `title_hi`, `summary_en`, `summary_hi`), while EVERY other
/// field in the same response — and every field of `/api/dive/history` — is
/// camelCase (`weeklyStreakCount`, `isoWeek`, `diveTopic`, …). That mixed
/// casing is the server's real contract, not a typo on this side; the
/// decoders below mirror it exactly. See [DivePhenomenon.fromJson].
///
/// NO CLIENT-SIDE DERIVATION: `weeklyStreakCount` is computed server-side by
/// `computeWeeklyStreakFromHistory()` and `currentIsoWeek` by `isoWeekOf()`
/// (both in `packages/lib/src/learn/weekly-dive-orchestrator.ts` /
/// `weekly-streak.ts`). Nothing here recomputes an ISO week or a streak — the
/// same house rule that keeps SM-2 math server-only in `revision_models.dart`.
library;

import 'package:equatable/equatable.dart';

/// The three dive entry points. Wire values match the server's
/// `DivePickerOption` union exactly (`'phenomenon' | 'weak_topic' | 'own_topic'`).
enum DivePickerOption {
  phenomenon('phenomenon'),
  weakTopic('weak_topic'),
  ownTopic('own_topic');

  final String value;
  const DivePickerOption(this.value);

  /// Unknown/absent values fall back to [ownTopic] — the one option the
  /// server ALWAYS shows (`showOwnTopicOption` is unconditionally true in
  /// `planWeeklyDive`), so a fallback here can never leave the picker with
  /// nothing selectable.
  static DivePickerOption fromString(String? s) {
    for (final o in DivePickerOption.values) {
      if (o.value == s) return o;
    }
    return DivePickerOption.ownTopic;
  }
}

/// One curated phenomenon from the `phenomena` table.
///
/// Snake_case keys are intentional — see the SHAPE NOTE in the library doc.
class DivePhenomenon extends Equatable {
  final String id;
  final String slug;
  final String titleEn;
  final String titleHi;
  final String summaryEn;
  final String summaryHi;
  final List<String> subjects;

  const DivePhenomenon({
    required this.id,
    required this.slug,
    required this.titleEn,
    required this.titleHi,
    required this.summaryEn,
    required this.summaryHi,
    required this.subjects,
  });

  factory DivePhenomenon.fromJson(Map<String, dynamic> json) {
    return DivePhenomenon(
      id: json['id'] as String? ?? '',
      slug: json['slug'] as String? ?? '',
      titleEn: json['title_en'] as String? ?? '',
      titleHi: json['title_hi'] as String? ?? '',
      summaryEn: json['summary_en'] as String? ?? '',
      summaryHi: json['summary_hi'] as String? ?? '',
      subjects: (json['subjects'] as List?)
              ?.whereType<String>()
              .toList(growable: false) ??
          const <String>[],
    );
  }

  /// Hindi falls back to English when the curated Hindi column is blank —
  /// never render an empty card title (P7: bilingual, but never a blank UI).
  String title(bool isHi) =>
      isHi && titleHi.isNotEmpty ? titleHi : titleEn;

  String summary(bool isHi) =>
      isHi && summaryHi.isNotEmpty ? summaryHi : summaryEn;

  @override
  List<Object?> get props => [id, slug, titleEn, titleHi, subjects];
}

/// One weak topic candidate, sourced from the `get_due_reviews` RPC by the
/// server. `masteryProbability` is server-computed and DISPLAY-ONLY.
class DiveWeakTopic extends Equatable {
  final String topicId;
  final String title;
  final String? titleHi;
  final double masteryProbability;

  const DiveWeakTopic({
    required this.topicId,
    required this.title,
    this.titleHi,
    required this.masteryProbability,
  });

  factory DiveWeakTopic.fromJson(Map<String, dynamic> json) {
    return DiveWeakTopic(
      topicId: json['topicId'] as String? ?? '',
      title: json['title'] as String? ?? '',
      titleHi: json['titleHi'] as String?,
      masteryProbability:
          (json['masteryProbability'] as num?)?.toDouble() ?? 0.0,
    );
  }

  String label(bool isHi) =>
      isHi && (titleHi?.isNotEmpty ?? false) ? titleHi! : title;

  @override
  List<Object?> get props => [topicId, title, titleHi, masteryProbability];
}

/// Full `GET /api/dive/state` body.
class DiveState extends Equatable {
  /// `'open'` or `'completed'` — server-decided (is there already a
  /// `dive_artifacts` row for `currentIsoWeek`?). Never inferred here.
  final bool isCompleted;
  final String currentIsoWeek;
  final String? lastCompletedIsoWeek;
  final int weeklyStreakCount;
  final DivePickerOption defaultPicker;
  final bool showPhenomenonOption;
  final bool showWeakTopicOption;
  final bool showOwnTopicOption;
  final List<DivePhenomenon> eligiblePhenomena;
  final List<DiveWeakTopic> weakTopics;

  const DiveState({
    required this.isCompleted,
    required this.currentIsoWeek,
    this.lastCompletedIsoWeek,
    required this.weeklyStreakCount,
    required this.defaultPicker,
    required this.showPhenomenonOption,
    required this.showWeakTopicOption,
    required this.showOwnTopicOption,
    required this.eligiblePhenomena,
    required this.weakTopics,
  });

  factory DiveState.fromJson(Map<String, dynamic> json) {
    return DiveState(
      isCompleted: json['state'] == 'completed',
      currentIsoWeek: json['currentIsoWeek'] as String? ?? '',
      lastCompletedIsoWeek: json['lastCompletedIsoWeek'] as String?,
      weeklyStreakCount: (json['weeklyStreakCount'] as num?)?.toInt() ?? 0,
      defaultPicker:
          DivePickerOption.fromString(json['defaultPicker'] as String?),
      showPhenomenonOption: json['showPhenomenonOption'] == true,
      showWeakTopicOption: json['showWeakTopicOption'] == true,
      // `showOwnTopicOption` is unconditionally true server-side. Default to
      // TRUE (not false) on a malformed body so the student is never left
      // with a picker that has zero selectable options.
      showOwnTopicOption: json['showOwnTopicOption'] != false,
      eligiblePhenomena: (json['eligiblePhenomena'] as List?)
              ?.whereType<Map>()
              .map((e) => DivePhenomenon.fromJson(Map<String, dynamic>.from(e)))
              .toList(growable: false) ??
          const <DivePhenomenon>[],
      weakTopics: (json['weakTopics'] as List?)
              ?.whereType<Map>()
              .map((e) => DiveWeakTopic.fromJson(Map<String, dynamic>.from(e)))
              .toList(growable: false) ??
          const <DiveWeakTopic>[],
    );
  }

  @override
  List<Object?> get props => [
        isCompleted,
        currentIsoWeek,
        lastCompletedIsoWeek,
        weeklyStreakCount,
        defaultPicker,
        showPhenomenonOption,
        showWeakTopicOption,
        showOwnTopicOption,
        eligiblePhenomena,
        weakTopics,
      ];
}

/// `POST /api/dive/start` response. The route resolves the picker choice into
/// the concrete topic; it writes NOTHING (the dive is only persisted when the
/// artifact is saved).
class ResolvedDive extends Equatable {
  final DivePickerOption pickerOption;
  final String diveTopic;
  final List<String> diveSubjects;
  final String? phenomenonSlug;

  const ResolvedDive({
    required this.pickerOption,
    required this.diveTopic,
    required this.diveSubjects,
    this.phenomenonSlug,
  });

  /// [pickerOption] is NOT in the response body — the server omits it because
  /// the client already knows what it submitted (see the `ResolvedDive`
  /// interface in `apps/host/src/app/dive/page.tsx`, which re-attaches it the
  /// same way). The caller therefore threads it back in here.
  factory ResolvedDive.fromJson(
    Map<String, dynamic> json, {
    required DivePickerOption pickerOption,
  }) {
    return ResolvedDive(
      pickerOption: pickerOption,
      diveTopic: json['diveTopic'] as String? ?? '',
      diveSubjects: (json['diveSubjects'] as List?)
              ?.whereType<String>()
              .toList(growable: false) ??
          const <String>[],
      phenomenonSlug: json['phenomenonSlug'] as String?,
    );
  }

  @override
  List<Object?> get props =>
      [pickerOption, diveTopic, diveSubjects, phenomenonSlug];
}

/// `POST /api/dive/artifact` 200 body.
class DiveArtifactSaveResult extends Equatable {
  final String artifactId;

  /// Server-recomputed from the durable `dive_artifacts` history using the
  /// SAME algorithm `/api/dive/state` uses. Never derived on this side.
  final int weeklyStreakCount;
  final String isoWeek;

  const DiveArtifactSaveResult({
    required this.artifactId,
    required this.weeklyStreakCount,
    required this.isoWeek,
  });

  factory DiveArtifactSaveResult.fromJson(Map<String, dynamic> json) {
    return DiveArtifactSaveResult(
      artifactId: json['artifactId'] as String? ?? '',
      weeklyStreakCount: (json['weeklyStreakCount'] as num?)?.toInt() ?? 0,
      isoWeek: json['isoWeek'] as String? ?? '',
    );
  }

  @override
  List<Object?> get props => [artifactId, weeklyStreakCount, isoWeek];
}

/// One row of `GET /api/dive/history`. Fully camelCase (the route maps the
/// snake_case columns itself).
class DiveHistoryItem extends Equatable {
  final String id;
  final String isoWeek;
  final DivePickerOption pickerOption;
  final String diveTopic;
  final List<String> diveSubjects;
  final String? phenomenonSlug;
  final String title;
  final String createdAt;

  const DiveHistoryItem({
    required this.id,
    required this.isoWeek,
    required this.pickerOption,
    required this.diveTopic,
    required this.diveSubjects,
    this.phenomenonSlug,
    required this.title,
    required this.createdAt,
  });

  factory DiveHistoryItem.fromJson(Map<String, dynamic> json) {
    return DiveHistoryItem(
      id: json['id'] as String? ?? '',
      isoWeek: json['isoWeek'] as String? ?? '',
      pickerOption:
          DivePickerOption.fromString(json['pickerOption'] as String?),
      diveTopic: json['diveTopic'] as String? ?? '',
      diveSubjects: (json['diveSubjects'] as List?)
              ?.whereType<String>()
              .toList(growable: false) ??
          const <String>[],
      phenomenonSlug: json['phenomenonSlug'] as String?,
      title: json['title'] as String? ?? '',
      createdAt: json['createdAt'] as String? ?? '',
    );
  }

  @override
  List<Object?> get props =>
      [id, isoWeek, pickerOption, diveTopic, diveSubjects, title, createdAt];
}

// ─── Artifact-save outcomes ──────────────────────────────────────────────────
//
// `POST /api/dive/artifact` has FIVE materially different outcomes that the UI
// must treat differently, and three of them are non-2xx. Collapsing them into
// a single `ApiFailure(message)` would make "you already saved this week"
// (a SUCCESS from the student's point of view — the dive IS done) look like a
// crash. Modeled explicitly, in the same spirit as
// `AssignmentCompletionOutcome` in `assignments_repository.dart`.

sealed class DiveArtifactOutcome {
  const DiveArtifactOutcome();
}

/// 200 — the artifact row was created.
class DiveArtifactSaved extends DiveArtifactOutcome {
  final DiveArtifactSaveResult result;
  const DiveArtifactSaved(this.result);
}

/// 409 `already_saved_this_week` — the UNIQUE(student_id, iso_week) constraint
/// fired. The dive IS complete; the UI transitions to the completed state
/// rather than showing an error.
class DiveArtifactAlreadySaved extends DiveArtifactOutcome {
  const DiveArtifactAlreadySaved();
}

/// 404 — either the `ff_pedagogy_v2_weekly_dive` flag is off (`not_found`) or
/// the student has no profile row (`student_profile_not_found`). Both mean
/// "this surface is not available", never "you did something wrong".
class DiveArtifactUnavailable extends DiveArtifactOutcome {
  const DiveArtifactUnavailable();
}

/// 400 — server-side validation rejected the payload. [errorCode] is the
/// route's machine-readable code (`missing_title`, `missing_student_voice`,
/// `invalid_picker_option`, `invalid_body`, `invalid_json`).
class DiveArtifactInvalid extends DiveArtifactOutcome {
  final String errorCode;
  const DiveArtifactInvalid(this.errorCode);
}

/// 500 / transport failure. Retriable.
class DiveArtifactFailure extends DiveArtifactOutcome {
  final String message;
  const DiveArtifactFailure(this.message);
}
