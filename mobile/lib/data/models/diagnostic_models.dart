// Data models for the Diagnostic Assessment flow — mobile parity for
// `apps/host/src/app/diagnostic/page.tsx` and its two-call REST lifecycle:
// `POST /api/diagnostic/start` → `POST /api/diagnostic/complete`.
library;

import 'dart:convert';

import 'package:equatable/equatable.dart';

/// A `{ en, hi }` pair. The diagnostic API returns student-facing copy in this
/// shape on every new state (P7 — the SERVER is the source of truth for these
/// strings; `DiagnosticCopy` only supplies offline fallbacks).
class DiagnosticBilingual extends Equatable {
  final String en;
  final String hi;

  const DiagnosticBilingual({required this.en, required this.hi});

  /// Tolerant parse. Returns null when [raw] is absent or not a `{en, hi}`
  /// object, so a caller can fall back to local copy rather than render "null".
  static DiagnosticBilingual? tryParse(dynamic raw) {
    if (raw is Map) {
      final en = raw['en'];
      final hi = raw['hi'];
      if (en is String && en.isNotEmpty) {
        return DiagnosticBilingual(en: en, hi: (hi is String && hi.isNotEmpty) ? hi : en);
      }
    }
    // A plain string (older/degraded payload) is better shown than dropped.
    if (raw is String && raw.isNotEmpty) return DiagnosticBilingual(en: raw, hi: raw);
    return null;
  }

  String text(bool isHi) => isHi ? hi : en;

  /// Mirror of the web's `fillCopy()` — substitutes `{token}` in BOTH
  /// languages. Unknown tokens are left untouched so a missing value is
  /// visible, not silent.
  DiagnosticBilingual fill(Map<String, String> values) {
    String apply(String s) => s.replaceAllMapped(
          RegExp(r'\{(\w+)\}'),
          (m) => values[m.group(1)] ?? m.group(0)!,
        );
    return DiagnosticBilingual(en: apply(en), hi: apply(hi));
  }

  @override
  List<Object?> get props => [en, hi];
}

/// One entry in the insufficient-content `alternatives` array. The server
/// guarantees at least one (the unconditional Foxy CTA), so this list is never
/// empty and the student is never handed a dead end.
class DiagnosticAlternative extends Equatable {
  /// `other_subject` | `guided_lesson` | `foxy` (unknown kinds are tolerated).
  final String kind;
  final DiagnosticBilingual label;

  /// The WEB href, verbatim from the server. Mobile translates it to a
  /// GoRouter location — see `diagnostic_alternative_route.dart`.
  final String href;

  const DiagnosticAlternative({
    required this.kind,
    required this.label,
    required this.href,
  });

  static DiagnosticAlternative? tryParse(dynamic raw) {
    if (raw is! Map) return null;
    final label = DiagnosticBilingual.tryParse(raw['label']);
    final href = raw['href'];
    if (label == null || href is! String || href.isEmpty) return null;
    return DiagnosticAlternative(
      kind: raw['kind'] as String? ?? 'unknown',
      label: label,
      href: href,
    );
  }

  static List<DiagnosticAlternative> parseList(dynamic raw) {
    if (raw is! List) return const [];
    return raw
        .map(DiagnosticAlternative.tryParse)
        .whereType<DiagnosticAlternative>()
        .toList(growable: false);
  }

  @override
  List<Object?> get props => [kind, label, href];
}

class DiagnosticQuestion extends Equatable {
  final String id;
  final String questionText;
  final String? questionHi;
  final String questionType;
  final List<String> options;

  /// The route still returns `correct_answer_index` inline (verified against
  /// `apps/host/src/app/api/diagnostic/start/route.ts` — `CLIENT_QUESTION_FIELDS`
  /// includes it; no shuffle-snapshot system backs this flow), so the client
  /// can render local feedback.
  ///
  /// IMPORTANT (2026-07-29 contract change): the client-computed `is_correct`
  /// sent to `/complete` is now DECORATIVE. `/api/diagnostic/complete` §C1
  /// re-derives correctness server-side from
  /// `question_bank.correct_answer_index` and never reads the client's claim.
  /// We keep sending it purely for wire-compat with the documented request
  /// contract (the route's `DiagnosticResponseItem.is_correct` is explicitly
  /// "ACCEPTED FOR WIRE-COMPAT, NEVER READ"). Never treat the local value as
  /// authoritative — the score shown comes from the server response (P1).
  final int correctAnswerIndex;
  final String? explanation;
  final String? explanationHi;
  final int difficulty;
  final String bloomLevel;
  final int? chapterNumber;
  final String? topicId;

  const DiagnosticQuestion({
    required this.id,
    required this.questionText,
    this.questionHi,
    this.questionType = 'mcq',
    required this.options,
    required this.correctAnswerIndex,
    this.explanation,
    this.explanationHi,
    this.difficulty = 1,
    this.bloomLevel = 'remember',
    this.chapterNumber,
    this.topicId,
  });

  factory DiagnosticQuestion.fromJson(Map<String, dynamic> json) {
    return DiagnosticQuestion(
      id: json['id'] as String? ?? '',
      questionText: json['question_text'] as String? ?? '',
      questionHi: json['question_hi'] as String?,
      questionType: json['question_type'] as String? ?? 'mcq',
      options: _parseOptions(json['options']),
      correctAnswerIndex: (json['correct_answer_index'] as num?)?.toInt() ?? 0,
      explanation: json['explanation'] as String?,
      explanationHi: json['explanation_hi'] as String?,
      difficulty: (json['difficulty'] as num?)?.toInt() ?? 1,
      bloomLevel: json['bloom_level'] as String? ?? 'remember',
      chapterNumber: (json['chapter_number'] as num?)?.toInt(),
      topicId: json['topic_id'] as String?,
    );
  }

  static List<String> _parseOptions(dynamic raw) {
    if (raw is List) return raw.map((e) => e.toString()).toList(growable: false);
    if (raw is String) {
      try {
        final decoded = jsonDecode(raw);
        if (decoded is List) {
          return decoded.map((e) => e.toString()).toList(growable: false);
        }
      } catch (_) {
        // Fall through to empty.
      }
    }
    return const [];
  }

  String displayText(bool isHi) =>
      (isHi && questionHi != null && questionHi!.isNotEmpty) ? questionHi! : questionText;

  @override
  List<Object?> get props => [id, questionText, correctAnswerIndex];
}

/// Result of `POST /api/diagnostic/start`.
///
/// The route has THREE non-error HTTP 200 outcomes (all `success: true`,
/// `ok: true`) — verified against
/// `apps/host/src/app/api/diagnostic/start/route.ts`:
///
///  1. a form was assembled           → [DiagnosticFormReady]
///  2. `insufficientContent: true`    → [DiagnosticInsufficientContent]
///     (`diagnostic: null`, Rung 4, NO assessment row created)
///  3. `streamRequired: true`         → [DiagnosticStreamRequired]
///     (`diagnostic: null`, grade 11/12 with NULL stream AND zero unlocked
///      subjects — the route does NOT emit this for every streamless senior)
///
/// Sealed so `switch` over it is exhaustiveness-checked: a future fourth state
/// becomes a compile error here rather than a blank screen on a student's
/// phone.
sealed class DiagnosticStartResult extends Equatable {
  const DiagnosticStartResult();
}

/// Outcome 1 — a real form. `session_id` + `questions` are inside `data`.
class DiagnosticFormReady extends DiagnosticStartResult {
  final String sessionId;
  final List<DiagnosticQuestion> questions;

  /// §5 ladder rung actually used (0-3). Top-level AND mirrored in `data`.
  final int? rung;

  /// `full` | `short_form` | (`insufficient` never reaches this variant).
  final String? qualityTier;

  /// True when `data.short_form` is set — fewer than 15 items were available.
  final bool shortForm;

  /// Pre-substituted bilingual banner for the short-form case.
  final DiagnosticBilingual? shortFormMessage;

  /// §7.5c setup reassurance, sent on every successful start.
  final DiagnosticBilingual? setupReassurance;

  const DiagnosticFormReady({
    required this.sessionId,
    required this.questions,
    this.rung,
    this.qualityTier,
    this.shortForm = false,
    this.shortFormMessage,
    this.setupReassurance,
  });

  @override
  List<Object?> get props =>
      [sessionId, questions, rung, qualityTier, shortForm, shortFormMessage, setupReassurance];
}

/// Outcome 2 — honest content-gap stop. Never a spinner, never a dead end:
/// [alternatives] is server-guaranteed non-empty.
class DiagnosticInsufficientContent extends DiagnosticStartResult {
  final DiagnosticBilingual headline;
  final DiagnosticBilingual message;

  /// Top-level frozen contract value is `'INSUFFICIENT_POOL'`; the spec-shaped
  /// `data.reason` enum is finer-grained (`too_few_items`, `no_hard_items`,
  /// `no_hots_items`, `too_few_chapters`). Diagnostics only — not shown raw.
  final String reason;
  final String? detailReason;
  final List<DiagnosticAlternative> alternatives;

  const DiagnosticInsufficientContent({
    required this.headline,
    required this.message,
    required this.reason,
    required this.alternatives,
    this.detailReason,
  });

  @override
  List<Object?> get props => [headline, message, reason, detailReason, alternatives];
}

/// Outcome 3 — the student must pick a stream before subjects can resolve.
/// The API deliberately does NOT send an href for the stream picker (spec
/// §7.4), so mobile routes this to its own settings/plan surface.
class DiagnosticStreamRequired extends DiagnosticStartResult {
  final DiagnosticBilingual headline;
  final DiagnosticBilingual message;
  final DiagnosticBilingual cta;

  /// `['science', 'commerce', 'humanities']` as sent by the route.
  final List<String> streamOptions;

  const DiagnosticStreamRequired({
    required this.headline,
    required this.message,
    required this.cta,
    required this.streamOptions,
  });

  @override
  List<Object?> get props => [headline, message, cta, streamOptions];
}

/// One entry in the `responses` array sent to `POST /api/diagnostic/complete`.
/// Field names/shape match the route's request contract EXACTLY.
///
/// `is_correct` is still sent for wire-compat (the route's request interface
/// still declares it), but as of the 2026-07-29 correctness change §C1 the
/// server IGNORES it and re-derives correctness from
/// `question_bank.correct_answer_index`. Removing it from the payload would
/// also be valid; we keep it so a rollback to an older route build does not
/// silently zero every student's score.
class DiagnosticResponseItem extends Equatable {
  final String questionId;
  final int selectedAnswerIndex;

  /// DECORATIVE on the wire — see the class doc. Used locally only.
  final bool isCorrect;
  final int timeTakenSeconds;
  final String? topic;
  final int difficulty;
  final String bloomLevel;

  const DiagnosticResponseItem({
    required this.questionId,
    required this.selectedAnswerIndex,
    required this.isCorrect,
    required this.timeTakenSeconds,
    required this.topic,
    required this.difficulty,
    required this.bloomLevel,
  });

  Map<String, dynamic> toJson() => {
        'question_id': questionId,
        'selected_answer_index': selectedAnswerIndex,
        'is_correct': isCorrect,
        'time_taken_seconds': timeTakenSeconds,
        'topic': topic,
        'difficulty': difficulty,
        'bloom_level': bloomLevel,
      };

  @override
  List<Object?> get props =>
      [questionId, selectedAnswerIndex, isCorrect, timeTakenSeconds, topic, difficulty, bloomLevel];
}

/// Result of `POST /api/diagnostic/complete`.
class DiagnosticSummary extends Equatable {
  final String sessionId;
  final int scorePercent;
  final int correctAnswers;
  final int totalQuestions;
  final List<String> weakTopics;
  final List<String> strongTopics;

  /// 'easy' | 'medium' | 'hard'. Server-derived; thresholds moved to 50 / 80
  /// on 2026-07-29 (`DIAGNOSTIC_PLACEMENT_THRESHOLDS`). Mobile must NOT
  /// re-derive this from [scorePercent] — it is read verbatim.
  final String recommendedDifficulty;

  /// 'normal' | 'low'. `low` means the student answered faster than 3s/question
  /// on average, so the server forced `recommendedDifficulty` to 'medium' and
  /// the placement should not be presented as a firm result (§C2). This is a
  /// placement-validity signal, NOT an anti-cheat verdict — the diagnostic is
  /// XP-neutral and P3's three checks live on the XP-bearing quiz path.
  final String placementConfidence;

  const DiagnosticSummary({
    required this.sessionId,
    required this.scorePercent,
    required this.correctAnswers,
    required this.totalQuestions,
    required this.weakTopics,
    required this.strongTopics,
    required this.recommendedDifficulty,
    this.placementConfidence = 'normal',
  });

  factory DiagnosticSummary.fromJson(Map<String, dynamic> json) {
    List<String> parseTopics(dynamic raw) => raw is List
        ? raw.map((e) => e.toString()).toList(growable: false)
        : const [];
    return DiagnosticSummary(
      sessionId: json['session_id'] as String? ?? '',
      scorePercent: (json['score_percent'] as num?)?.toInt() ?? 0,
      correctAnswers: (json['correct_answers'] as num?)?.toInt() ?? 0,
      totalQuestions: (json['total_questions'] as num?)?.toInt() ?? 0,
      weakTopics: parseTopics(json['weak_topics']),
      strongTopics: parseTopics(json['strong_topics']),
      recommendedDifficulty: json['recommended_difficulty'] as String? ?? 'medium',
      placementConfidence: json['placement_confidence'] as String? ?? 'normal',
    );
  }

  @override
  List<Object?> get props => [
        sessionId,
        scorePercent,
        correctAnswers,
        totalQuestions,
        weakTopics,
        strongTopics,
        recommendedDifficulty,
        placementConfidence,
      ];
}
