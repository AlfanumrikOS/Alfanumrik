/// Revision / Refresh — mobile parity models for
/// `apps/host/src/app/refresh/page.tsx`'s three auto-hiding sections
/// (Quick Recall, Chapter Refresh, Retention Tests).
///
/// SAFETY BOUNDARY (do not weaken): every SM-2 spaced-repetition scheduling
/// value modelled here (ease_factor, interval_days, streak, next_review_date)
/// is DISPLAY-ONLY. It is computed exclusively server-side by `applySm2()`
/// in `apps/host/src/app/api/learner/review/grade/helpers.ts`. Nothing in
/// this file, [RevisionRepository], or [RevisionNotifier]/[QuickRecallNotifier]
/// may recompute, approximate, or port that formula — this mirrors the
/// house rule that scoring/mastery-adjacent math (P1/P2-adjacent) lives in
/// exactly one place. See `mobile/lib/data/repositories/revision_repository.dart`
/// for the verified server contract this was built against (2026-07-21).
library;

import 'package:equatable/equatable.dart';

/// Recommended follow-up modality for a decayed chapter — mirrors
/// `recommendedModality` in the `GET /api/learner/revise-stack` response
/// (`packages/lib/src/state/learner-loop/revise-stack-modality.ts`).
enum RevisionModality {
  read('read'),
  explainer('explainer'),
  workedExample('worked-example');

  final String value;
  const RevisionModality(this.value);

  static RevisionModality fromString(String? s) {
    for (final m in RevisionModality.values) {
      if (m.value == s) return m;
    }
    return RevisionModality.read;
  }
}

/// One SM-2 flashcard due for recall — mirrors the `ReviewCard` interface in
/// `packages/ui/src/refresh/QuickRecallSection.tsx`. Source: the
/// `spaced_repetition_cards` table (read via RPC `get_review_cards`, falling
/// back to a direct table select — see
/// `RevisionRepository.getQuickRecallCards`).
class RevisionCard extends Equatable {
  final String id;
  final String subject;
  final String topic;
  final String chapterTitle;
  final String frontText;
  final String backText;
  final String hint;
  final String? source;
  final double easeFactor;
  final int intervalDays;
  final int streak;
  final int repetitionCount;
  final int totalReviews;
  final int correctReviews;
  final String? lastReviewDate;

  const RevisionCard({
    required this.id,
    required this.subject,
    required this.topic,
    required this.chapterTitle,
    required this.frontText,
    required this.backText,
    required this.hint,
    this.source,
    required this.easeFactor,
    required this.intervalDays,
    required this.streak,
    required this.repetitionCount,
    required this.totalReviews,
    required this.correctReviews,
    this.lastReviewDate,
  });

  factory RevisionCard.fromJson(Map<String, dynamic> json) {
    return RevisionCard(
      id: json['id'] as String? ?? '',
      subject: json['subject'] as String? ?? '',
      topic: json['topic'] as String? ?? '',
      chapterTitle: json['chapter_title'] as String? ?? '',
      frontText: json['front_text'] as String? ?? '',
      backText: json['back_text'] as String? ?? '',
      hint: json['hint'] as String? ?? '',
      source: json['source'] as String?,
      easeFactor: (json['ease_factor'] as num?)?.toDouble() ?? 2.5,
      intervalDays: (json['interval_days'] as num?)?.toInt() ?? 0,
      streak: (json['streak'] as num?)?.toInt() ?? 0,
      repetitionCount: (json['repetition_count'] as num?)?.toInt() ?? 0,
      totalReviews: (json['total_reviews'] as num?)?.toInt() ?? 0,
      correctReviews: (json['correct_reviews'] as num?)?.toInt() ?? 0,
      lastReviewDate: json['last_review_date'] as String?,
    );
  }

  /// Display label for the card's chapter/topic chip. Quiz-review cards
  /// write `topic` as a machine composite dedupe key
  /// (`subject:chapter:question_id`); `chapterTitle` is the human label when
  /// present. Mirrors `humaneCardLabel()`'s fallback order in
  /// `QuickRecallSection.tsx` without porting its full parsing logic (that
  /// helper is presentation-only string formatting, not a scoring formula).
  String get displayLabel => chapterTitle.isNotEmpty ? chapterTitle : topic;

  @override
  List<Object?> get props => [id, subject, chapterTitle, frontText, backText, source];
}

/// Server-computed SM-2 outcome returned by
/// `POST /api/learner/review/grade`. Every field was computed SERVER-SIDE
/// (`applySm2()`) — never derive these locally.
class RevisionGradeResult extends Equatable {
  final String id;
  final double easeFactor;
  final int intervalDays;
  final int streak;
  final int repetitionCount;
  final String nextReviewDate;
  final String lastReviewDate;
  final int lastQuality;
  final int totalReviews;
  final int correctReviews;

  const RevisionGradeResult({
    required this.id,
    required this.easeFactor,
    required this.intervalDays,
    required this.streak,
    required this.repetitionCount,
    required this.nextReviewDate,
    required this.lastReviewDate,
    required this.lastQuality,
    required this.totalReviews,
    required this.correctReviews,
  });

  factory RevisionGradeResult.fromJson(Map<String, dynamic> json) {
    return RevisionGradeResult(
      id: json['id'] as String? ?? '',
      easeFactor: (json['ease_factor'] as num?)?.toDouble() ?? 2.5,
      intervalDays: (json['interval_days'] as num?)?.toInt() ?? 0,
      streak: (json['streak'] as num?)?.toInt() ?? 0,
      repetitionCount: (json['repetition_count'] as num?)?.toInt() ?? 0,
      nextReviewDate: json['next_review_date'] as String? ?? '',
      lastReviewDate: json['last_review_date'] as String? ?? '',
      lastQuality: (json['last_quality'] as num?)?.toInt() ?? 0,
      totalReviews: (json['total_reviews'] as num?)?.toInt() ?? 0,
      correctReviews: (json['correct_reviews'] as num?)?.toInt() ?? 0,
    );
  }

  @override
  List<Object?> get props => [
        id,
        easeFactor,
        intervalDays,
        streak,
        repetitionCount,
        nextReviewDate,
        lastReviewDate,
        lastQuality,
      ];
}

/// One decayed-chapter entry from `GET /api/learner/revise-stack` — mirrors
/// `ReviseStackItem` in `packages/ui/src/refresh/ChapterRefreshSection.tsx`.
/// `mastery` and `daysSinceLastTouch` are server-computed; this model only
/// decodes them for display.
class RevisionStackItem extends Equatable {
  final String subjectCode;
  final int chapterNumber;
  final double mastery;
  final int daysSinceLastTouch;
  final RevisionModality recommendedModality;
  final String url;

  const RevisionStackItem({
    required this.subjectCode,
    required this.chapterNumber,
    required this.mastery,
    required this.daysSinceLastTouch,
    required this.recommendedModality,
    required this.url,
  });

  factory RevisionStackItem.fromJson(Map<String, dynamic> json) {
    return RevisionStackItem(
      subjectCode: json['subjectCode'] as String? ?? '',
      chapterNumber: (json['chapterNumber'] as num?)?.toInt() ?? 0,
      mastery: (json['mastery'] as num?)?.toDouble() ?? 0.0,
      daysSinceLastTouch: (json['daysSinceLastTouch'] as num?)?.toInt() ?? 0,
      recommendedModality:
          RevisionModality.fromString(json['recommendedModality'] as String?),
      url: json['url'] as String? ?? '',
    );
  }

  @override
  List<Object?> get props =>
      [subjectCode, chapterNumber, mastery, daysSinceLastTouch, recommendedModality];
}

/// One pending retention quiz from the `retention_tests` table — mirrors
/// `RetentionTest` in `packages/ui/src/refresh/RetentionTestsSection.tsx`.
/// `predictedRetention` is a stored column written elsewhere by the
/// cognitive engine; this model only decodes it for display.
class RevisionRetentionTest extends Equatable {
  final String id;
  final String topicTitle;
  final String subject;
  final double predictedRetention;
  final String scheduledDate;

  const RevisionRetentionTest({
    required this.id,
    required this.topicTitle,
    required this.subject,
    required this.predictedRetention,
    required this.scheduledDate,
  });

  factory RevisionRetentionTest.fromJson(Map<String, dynamic> json) {
    return RevisionRetentionTest(
      id: json['id'] as String? ?? '',
      topicTitle: json['topic_title'] as String? ?? '',
      subject: json['subject'] as String? ?? '',
      predictedRetention: (json['predicted_retention'] as num?)?.toDouble() ?? 0.0,
      scheduledDate: json['scheduled_date'] as String? ?? '',
    );
  }

  @override
  List<Object?> get props => [id, topicTitle, subject, predictedRetention, scheduledDate];
}
