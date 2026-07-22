/// Monthly Synthesis (Pedagogy v2 Wave 3) — mobile parity models for
/// `apps/host/src/app/synthesis/page.tsx`.
///
/// Verified against the CURRENT route files on 2026-07-22 (post the 2026-07-21
/// Phase 4 fabrication-oracle work, NOT the pre-Phase-4 shape):
///   * `GET  /api/synthesis/state`        → apps/host/src/app/api/synthesis/state/route.ts
///   * `POST /api/synthesis/parent-share` → apps/host/src/app/api/synthesis/parent-share/route.ts
///
/// The `bundle` object mirrors `SynthesisBundle` in
/// `packages/lib/src/learn/monthly-synthesis-orchestrator.ts` exactly.
///
/// NO CLIENT-SIDE DERIVATION: `topicsMastered` / `topicsImproved` /
/// `topicsRegressed` / `targetDifficulty` are all composed server-side by the
/// monthly-synthesis-builder Edge Function. The bilingual `summaryText*` is
/// Claude-generated server-side and passes the item-4.2 fabrication oracle
/// BEFORE it is ever persisted — mobile renders it verbatim and must never
/// summarise, re-word, or re-compute any figure inside it.
library;

import 'package:equatable/equatable.dart';

/// Delivery state of the WhatsApp parent share.
///
/// The full CURRENT vocabulary (6 values). `flagged` was added 2026-07-21 by
/// migration `20260722098000_monthly_synthesis_flagged_status.sql`: the
/// pre-send fabrication gate in `/api/synthesis/parent-share` writes it when a
/// summary fails an independent fabrication re-check. It means **held for
/// human review**, NOT a failure and NOT a silent drop — the UI must say so.
enum ParentShareStatus {
  pending('pending'),
  sent('sent'),
  optedOut('opted_out'),
  failed('failed'),
  suppressed('suppressed'),
  flagged('flagged');

  final String value;
  const ParentShareStatus(this.value);

  /// Unknown/absent values fall back to [pending] — the neutral state. A
  /// future server-side status this build doesn't know about must never
  /// render as "sent" (an unearned reassurance) or "failed" (a false alarm).
  static ParentShareStatus fromString(String? s) {
    for (final v in ParentShareStatus.values) {
      if (v.value == s) return v;
    }
    return ParentShareStatus.pending;
  }

  /// True when the share CTA should be disabled. Mirrors
  /// `ParentShareCard.tsx`'s `disabled=` predicate, plus `flagged` — a
  /// held-for-review summary must not be re-sendable from the student's
  /// device (the server would just re-flag it).
  bool get blocksSending =>
      this == ParentShareStatus.sent ||
      this == ParentShareStatus.optedOut ||
      this == ParentShareStatus.flagged;
}

class SynthesisMasteryDelta extends Equatable {
  final List<String> chaptersTouched;
  final int topicsMastered;
  final int topicsImproved;
  final int topicsRegressed;

  const SynthesisMasteryDelta({
    required this.chaptersTouched,
    required this.topicsMastered,
    required this.topicsImproved,
    required this.topicsRegressed,
  });

  factory SynthesisMasteryDelta.fromJson(Map<String, dynamic> json) {
    return SynthesisMasteryDelta(
      chaptersTouched: (json['chaptersTouched'] as List?)
              ?.whereType<String>()
              .toList(growable: false) ??
          const <String>[],
      topicsMastered: (json['topicsMastered'] as num?)?.toInt() ?? 0,
      topicsImproved: (json['topicsImproved'] as num?)?.toInt() ?? 0,
      topicsRegressed: (json['topicsRegressed'] as num?)?.toInt() ?? 0,
    );
  }

  @override
  List<Object?> get props =>
      [chaptersTouched, topicsMastered, topicsImproved, topicsRegressed];
}

class SynthesisChapterMock extends Equatable {
  final List<String> chapters;
  final int totalQuestions;

  /// 0..1 sigmoid-mapped target difficulty. Server-computed; display-only.
  final double targetDifficulty;

  const SynthesisChapterMock({
    required this.chapters,
    required this.totalQuestions,
    required this.targetDifficulty,
  });

  factory SynthesisChapterMock.fromJson(Map<String, dynamic> json) {
    return SynthesisChapterMock(
      chapters: (json['chapters'] as List?)
              ?.whereType<String>()
              .toList(growable: false) ??
          const <String>[],
      totalQuestions: (json['totalQuestions'] as num?)?.toInt() ?? 0,
      targetDifficulty: (json['targetDifficulty'] as num?)?.toDouble() ?? 0.0,
    );
  }

  @override
  List<Object?> get props => [chapters, totalQuestions, targetDifficulty];
}

class SynthesisBundle extends Equatable {
  final String monthLabel;
  final List<String> weeklyArtifactIds;
  final SynthesisMasteryDelta masteryDelta;
  final SynthesisChapterMock? chapterMockSummary;

  const SynthesisBundle({
    required this.monthLabel,
    required this.weeklyArtifactIds,
    required this.masteryDelta,
    this.chapterMockSummary,
  });

  factory SynthesisBundle.fromJson(Map<String, dynamic> json) {
    final mock = json['chapterMockSummary'];
    return SynthesisBundle(
      monthLabel: json['monthLabel'] as String? ?? '',
      weeklyArtifactIds: (json['weeklyArtifactIds'] as List?)
              ?.whereType<String>()
              .toList(growable: false) ??
          const <String>[],
      masteryDelta: SynthesisMasteryDelta.fromJson(
        json['masteryDelta'] is Map
            ? Map<String, dynamic>.from(json['masteryDelta'] as Map)
            : const <String, dynamic>{},
      ),
      chapterMockSummary: mock is Map
          ? SynthesisChapterMock.fromJson(Map<String, dynamic>.from(mock))
          : null,
    );
  }

  @override
  List<Object?> get props =>
      [monthLabel, weeklyArtifactIds, masteryDelta, chapterMockSummary];
}

/// The `row` payload of `GET /api/synthesis/state` when `state == 'ready'`.
class SynthesisRow extends Equatable {
  final String id;
  final String synthesisMonth;
  final SynthesisBundle bundle;

  /// Claude-generated, oracle-validated, server-persisted. May be empty on a
  /// row whose lazy-fill has not run yet — the UI then shows the "generating"
  /// hint rather than a blank block (mirrors `SynthesisRitual.tsx`).
  final String summaryTextEn;
  final String summaryTextHi;

  final ParentShareStatus parentShareStatus;
  final String? parentShareSentAt;
  final String createdAt;

  const SynthesisRow({
    required this.id,
    required this.synthesisMonth,
    required this.bundle,
    required this.summaryTextEn,
    required this.summaryTextHi,
    required this.parentShareStatus,
    this.parentShareSentAt,
    required this.createdAt,
  });

  factory SynthesisRow.fromJson(Map<String, dynamic> json) {
    return SynthesisRow(
      id: json['id'] as String? ?? '',
      synthesisMonth: json['synthesisMonth'] as String? ?? '',
      bundle: SynthesisBundle.fromJson(
        json['bundle'] is Map
            ? Map<String, dynamic>.from(json['bundle'] as Map)
            : const <String, dynamic>{},
      ),
      summaryTextEn: json['summaryTextEn'] as String? ?? '',
      summaryTextHi: json['summaryTextHi'] as String? ?? '',
      parentShareStatus:
          ParentShareStatus.fromString(json['parentShareStatus'] as String?),
      parentShareSentAt: json['parentShareSentAt'] as String?,
      createdAt: json['createdAt'] as String? ?? '',
    );
  }

  /// Hindi falls back to English when the Hindi column is blank — matches
  /// `SynthesisRitual.tsx`'s `isHi ? (hi || en) : en`.
  String summary(bool isHi) =>
      isHi && summaryTextHi.trim().isNotEmpty ? summaryTextHi : summaryTextEn;

  SynthesisRow copyWith({
    ParentShareStatus? parentShareStatus,
    String? parentShareSentAt,
  }) {
    return SynthesisRow(
      id: id,
      synthesisMonth: synthesisMonth,
      bundle: bundle,
      summaryTextEn: summaryTextEn,
      summaryTextHi: summaryTextHi,
      parentShareStatus: parentShareStatus ?? this.parentShareStatus,
      parentShareSentAt: parentShareSentAt ?? this.parentShareSentAt,
      createdAt: createdAt,
    );
  }

  @override
  List<Object?> get props => [
        id,
        synthesisMonth,
        bundle,
        summaryTextEn,
        summaryTextHi,
        parentShareStatus,
        parentShareSentAt,
        createdAt,
      ];
}

// ─── /api/synthesis/state outcomes ──────────────────────────────────────────

sealed class SynthesisStateResult {
  const SynthesisStateResult();
}

/// 404. Covers BOTH `not_found` (the `ff_pedagogy_v2_monthly_synthesis` flag
/// is off — still the case in production as of 2026-07-22) and
/// `no_student_profile`. The web renders the same soft fallback for both.
class SynthesisUnavailable extends SynthesisStateResult {
  const SynthesisUnavailable();
}

/// 200 `{ state: 'no_synthesis_yet' }` — the student is enrolled but the
/// month hasn't produced a synthesis row yet. A friendly wait state, NOT an
/// error and NOT the same thing as [SynthesisUnavailable].
class SynthesisNotYet extends SynthesisStateResult {
  const SynthesisNotYet();
}

/// 200 `{ state: 'ready', row }`.
class SynthesisReady extends SynthesisStateResult {
  final SynthesisRow row;
  const SynthesisReady(this.row);
}

/// 5xx / transport failure. Retriable.
class SynthesisStateFailure extends SynthesisStateResult {
  final String message;
  const SynthesisStateFailure(this.message);
}

// ─── /api/synthesis/parent-share outcomes ───────────────────────────────────
//
// This route has NINE distinct failure codes spread across FIVE status codes,
// and several share a status (404 covers flag-off / row-not-found /
// no-linked-guardian / guardian-not-found; 422 covers phone-missing AND
// flagged-for-review). They are NOT interchangeable to a student — "your
// parent isn't linked yet" and "this summary is being reviewed" need
// completely different copy — so the repository reads the machine-readable
// `error` code rather than the status alone.

sealed class ParentShareOutcome {
  const ParentShareOutcome();
}

/// 200 `{ ok: true, sentAt, waId }`.
class ParentShareSent extends ParentShareOutcome {
  final String? sentAt;
  const ParentShareSent(this.sentAt);
}

/// 200 `{ ok: true, alreadySent: true }` — the row was already `sent`.
class ParentShareAlreadySent extends ParentShareOutcome {
  const ParentShareAlreadySent();
}

/// 403 `guardian_opted_out` — the guardian has
/// `monthly_synthesis_optin = false`. The server ALSO writes the row's status
/// to `opted_out` on this branch, so the UI can reflect it immediately.
class ParentShareOptedOut extends ParentShareOutcome {
  const ParentShareOptedOut();
}

/// 422 `flagged_for_review` — the pre-send fabrication gate held the summary
/// for a human. The server writes the row's status to `flagged`. This is NOT
/// an error the student caused and NOT a permanent failure; the copy must say
/// "being checked", never "failed".
class ParentShareFlagged extends ParentShareOutcome {
  const ParentShareFlagged();
}

/// 404 `no_linked_guardian` / `guardian_not_found` — nobody to send to.
class ParentShareNoGuardian extends ParentShareOutcome {
  const ParentShareNoGuardian();
}

/// 422 `guardian_phone_missing`.
class ParentSharePhoneMissing extends ParentShareOutcome {
  const ParentSharePhoneMissing();
}

/// 404 `not_found` — the monthly-synthesis feature flag is off.
class ParentShareUnavailable extends ParentShareOutcome {
  const ParentShareUnavailable();
}

/// 502 `whatsapp_delivery_failed` — the row's status becomes `failed`.
/// Retriable.
class ParentShareDeliveryFailed extends ParentShareOutcome {
  const ParentShareDeliveryFailed();
}

/// Anything else (RBAC 403 from `authorizeRequest`, 400, 500, transport).
class ParentShareFailure extends ParentShareOutcome {
  final String message;
  const ParentShareFailure(this.message);
}
