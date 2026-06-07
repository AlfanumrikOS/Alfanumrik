import 'package:equatable/equatable.dart';

import 'quiz_question.dart';

/// ────────────────────────────────────────────────────────────────────────
/// Wave 2.5.2 — OFFLINE quiz capability data models.
///
/// Two pure-Dart, JSON-serializable value types power the offline path. They
/// are deliberately storage-agnostic (encoded to/from `Map<String, dynamic>`
/// so the existing Hive-JSON convention in `CacheManager` is reused — no
/// `hive_generator` typed adapter is needed, and the records stay trivially
/// unit-testable without a Hive runtime):
///
///   * [OfflineTodayBundle] — the day's quiz the student can ATTEMPT offline:
///     a server-shuffled session (`sessionId` + display-ordered questions with
///     `correctIndex == -1`, since grading is server-authoritative) plus the
///     subject/grade scope and an optional per-question shuffle snapshot.
///
///   * [QueuedQuizAttempt] — a completed-OFFLINE attempt awaiting drain. Carries
///     the responses, the on-device per-question + total timings, the
///     **immutable** `idempotencyKey` (generated EXACTLY ONCE at completion and
///     reused verbatim on every drain), the device-wall-clock `capturedAt`, the
///     optional shuffle maps, and a `drainAttempt` counter.
///
/// ## P-invariant guard-rails encoded here
///   * P2: NO score / XP fields live on either type. The device never grades.
///   * P3: per-question + total timings are stored verbatim from the live
///     attempt and are NEVER recomputed at drain time.
///   * P6: questions carry `correctIndex == -1` (server owns correctness).
///   * P13: NO PII — only ids, indices, counts, and option TEXT the student
///     already saw (option text is required to render the offline quiz). Answer
///     *choices* are stored as indices; nothing here is logged.
/// ────────────────────────────────────────────────────────────────────────

/// A single response captured during the offline attempt.
///
/// [selectedDisplayedIndex] is the position (0..3) the student tapped in the
/// server-shuffled display order; `-1` means skipped/unanswered. [timeSpent]
/// is the on-device measured duration (seconds) for that question — forwarded
/// verbatim to the server (P3); never recomputed.
class OfflineResponse extends Equatable {
  final String questionId;
  final int selectedDisplayedIndex;
  final int timeSpent;

  const OfflineResponse({
    required this.questionId,
    required this.selectedDisplayedIndex,
    required this.timeSpent,
  });

  Map<String, dynamic> toJson() => {
        'question_id': questionId,
        'selected_displayed_index': selectedDisplayedIndex,
        'time_spent': timeSpent,
      };

  factory OfflineResponse.fromJson(Map<String, dynamic> json) => OfflineResponse(
        questionId: json['question_id'] as String,
        selectedDisplayedIndex:
            (json['selected_displayed_index'] as num?)?.toInt() ?? -1,
        timeSpent: (json['time_spent'] as num?)?.toInt() ?? 0,
      );

  @override
  List<Object?> get props => [questionId, selectedDisplayedIndex, timeSpent];
}

/// The prefetched today bundle a student can attempt offline.
///
/// Cached (while online) by [OfflineQuizStore] keyed by subject so a student
/// who lost connectivity can still take the day's quiz. Grading is deferred to
/// the server on drain — the cached questions carry NO correct answer.
class OfflineTodayBundle extends Equatable {
  /// Server-issued quiz session id (from `start_quiz_session` / `POST
  /// /v2/quiz/start`). Required to drain via `submit_quiz_results_v2` so the
  /// server re-derives correctness against its per-session snapshot. A bundle
  /// without a session id is unusable offline (the server-authoritative submit
  /// requires it), so [isAttemptable] is false in that case.
  final String? sessionId;
  final String subject;
  final String grade;

  /// Display-ordered, server-shuffled questions. `correctIndex == -1` for all
  /// (P6 — server owns correctness).
  final List<QuizQuestion> questions;

  /// Optional per-question displayed→canonical shuffle maps the UI rendered.
  /// Keyed by `questionId`; each value is a 4-int permutation of {0,1,2,3}
  /// where `map[displayedIndex] = canonicalIndex`. The mobile client only
  /// receives this when a server surface chooses to expose it; the current
  /// `/v2/quiz/start` keeps the shuffle map server-side (P6), so this is
  /// usually EMPTY and the drain omits `shuffleMapsClientGradedAgainst`
  /// (the server then verifies integrity via its own snapshot). When present,
  /// it is threaded verbatim into the queued attempt and on to the server.
  final Map<String, List<int>> shuffleMaps;

  /// Device epoch-millis when this bundle was cached. Drives staleness display.
  final int cachedAtMillis;

  const OfflineTodayBundle({
    required this.sessionId,
    required this.subject,
    required this.grade,
    required this.questions,
    this.shuffleMaps = const {},
    required this.cachedAtMillis,
  });

  /// A bundle is attemptable offline only if it has a server session id and at
  /// least one question. Without the session id the server-authoritative
  /// submit cannot grade it, so we never let the student start it offline.
  bool get isAttemptable =>
      sessionId != null && sessionId!.isNotEmpty && questions.isNotEmpty;

  Map<String, dynamic> toJson() => {
        'session_id': sessionId,
        'subject': subject,
        'grade': grade,
        'questions': questions.map(_questionToJson).toList(growable: false),
        'shuffle_maps':
            shuffleMaps.map((k, v) => MapEntry(k, List<int>.from(v))),
        'cached_at_millis': cachedAtMillis,
      };

  factory OfflineTodayBundle.fromJson(Map<String, dynamic> json) {
    final rawQuestions = json['questions'];
    final questions = <QuizQuestion>[];
    if (rawQuestions is List) {
      for (final q in rawQuestions) {
        if (q is Map) {
          questions.add(_questionFromJson(Map<String, dynamic>.from(q)));
        }
      }
    }

    final rawMaps = json['shuffle_maps'];
    final maps = <String, List<int>>{};
    if (rawMaps is Map) {
      rawMaps.forEach((k, v) {
        if (v is List) {
          maps[k as String] =
              v.map((e) => (e as num).toInt()).toList(growable: false);
        }
      });
    }

    return OfflineTodayBundle(
      sessionId: json['session_id'] as String?,
      subject: json['subject'] as String? ?? '',
      grade: json['grade'] as String? ?? '',
      questions: questions,
      shuffleMaps: maps,
      cachedAtMillis: (json['cached_at_millis'] as num?)?.toInt() ?? 0,
    );
  }

  /// Encode a [QuizQuestion] for the offline bundle. Only the fields the UI
  /// needs to RENDER the question are persisted; `correctIndex` is intentionally
  /// re-pinned to `-1` on read (server owns correctness — P6) regardless of
  /// what was stored.
  static Map<String, dynamic> _questionToJson(QuizQuestion q) => {
        'id': q.id,
        'question_text': q.questionText,
        'question_text_hi': q.questionTextHi,
        'options': q.options,
        'explanation': q.explanation,
        'explanation_hi': q.explanationHi,
        'subject': q.subject,
        'grade': q.grade,
        'chapter_title': q.chapterTitle,
        'difficulty': q.difficulty,
        'bloom_level': q.bloomLevel,
      };

  static QuizQuestion _questionFromJson(Map<String, dynamic> j) {
    final rawOpts = j['options'];
    final opts = <String>[];
    if (rawOpts is List) {
      for (final o in rawOpts) {
        if (o is String) opts.add(o);
      }
    }
    return QuizQuestion(
      id: j['id'] as String,
      questionText: j['question_text'] as String? ?? '',
      questionTextHi: j['question_text_hi'] as String?,
      options: opts,
      // P6: never trust a stored correct index — server is authoritative.
      correctIndex: -1,
      explanation: j['explanation'] as String?,
      explanationHi: j['explanation_hi'] as String?,
      subject: j['subject'] as String? ?? '',
      grade: j['grade'] as String? ?? '',
      chapterTitle: j['chapter_title'] as String?,
      difficulty: (j['difficulty'] as num?)?.toInt() ?? 1,
      bloomLevel: j['bloom_level'] as String? ?? 'remember',
    );
  }

  @override
  List<Object?> get props =>
      [sessionId, subject, grade, questions, shuffleMaps, cachedAtMillis];
}

/// A completed-OFFLINE quiz attempt awaiting drain to `POST /v2/quiz/submit`.
///
/// CRITICAL (P2): [idempotencyKey] is generated EXACTLY ONCE — at attempt
/// completion, before enqueue — and is stored IMMUTABLY. Every drain retry
/// reuses it VERBATIM via the `Idempotency-Key` header. Regenerating it would
/// double-grant XP on the server's replay short-circuit. Nothing in the drain
/// path is permitted to mutate it; only [drainAttempt] is bumped on retry.
class QueuedQuizAttempt extends Equatable {
  /// Stable local queue id (a UUID, distinct from [idempotencyKey]) used to
  /// address this record in the Hive queue box. Generating a separate id keeps
  /// the idempotency key purely a server-grading token.
  final String localId;

  final String sessionId;
  final String studentId;
  final String subject;
  final String grade;
  final String? topic;
  final int? chapter;

  final List<OfflineResponse> responses;

  /// Device-summed total attempt duration (seconds). MUST equal the sum the
  /// client also sends as `clientCapturedTotalSeconds` and `totalTimeSeconds`
  /// (server cross-checks; mismatch → 400 OFFLINE_TIME_INCONSISTENT).
  final int totalTimeSeconds;

  /// Device wall-clock at attempt COMPLETION, captured ONCE (P-obligation 2).
  /// ISO-8601 with offset (UTC `Z`). Used by the server for clock-skew +
  /// staleness gates only — never to derive duration (P3).
  final String capturedAt;

  /// IMMUTABLE per-attempt grading token. See class doc. NEVER regenerated.
  final String idempotencyKey;

  /// Optional displayed→canonical shuffle maps the UI graded against, keyed by
  /// questionId. Usually empty (the server keeps the shuffle map server-side —
  /// P6); when non-empty it is sent so the server can verify integrity.
  final Map<String, List<int>> shuffleMaps;

  /// 1-based drain counter. Starts at 0 in the queue (never drained yet) and is
  /// incremented to N on the Nth drain. Telemetry only — never affects grading.
  final int drainAttempt;

  const QueuedQuizAttempt({
    required this.localId,
    required this.sessionId,
    required this.studentId,
    required this.subject,
    required this.grade,
    this.topic,
    this.chapter,
    required this.responses,
    required this.totalTimeSeconds,
    required this.capturedAt,
    required this.idempotencyKey,
    this.shuffleMaps = const {},
    this.drainAttempt = 0,
  });

  /// Returns a copy with [drainAttempt] bumped to the given value. The
  /// idempotency key, capturedAt, responses and timings are carried through
  /// UNCHANGED — only the retry counter moves.
  QueuedQuizAttempt withDrainAttempt(int next) => QueuedQuizAttempt(
        localId: localId,
        sessionId: sessionId,
        studentId: studentId,
        subject: subject,
        grade: grade,
        topic: topic,
        chapter: chapter,
        responses: responses,
        totalTimeSeconds: totalTimeSeconds,
        capturedAt: capturedAt,
        idempotencyKey: idempotencyKey,
        shuffleMaps: shuffleMaps,
        drainAttempt: next,
      );

  Map<String, dynamic> toJson() => {
        'local_id': localId,
        'session_id': sessionId,
        'student_id': studentId,
        'subject': subject,
        'grade': grade,
        'topic': topic,
        'chapter': chapter,
        'responses': responses.map((r) => r.toJson()).toList(growable: false),
        'total_time_seconds': totalTimeSeconds,
        'captured_at': capturedAt,
        'idempotency_key': idempotencyKey,
        'shuffle_maps':
            shuffleMaps.map((k, v) => MapEntry(k, List<int>.from(v))),
        'drain_attempt': drainAttempt,
      };

  factory QueuedQuizAttempt.fromJson(Map<String, dynamic> json) {
    final rawResponses = json['responses'];
    final responses = <OfflineResponse>[];
    if (rawResponses is List) {
      for (final r in rawResponses) {
        if (r is Map) {
          responses.add(OfflineResponse.fromJson(Map<String, dynamic>.from(r)));
        }
      }
    }

    final rawMaps = json['shuffle_maps'];
    final maps = <String, List<int>>{};
    if (rawMaps is Map) {
      rawMaps.forEach((k, v) {
        if (v is List) {
          maps[k as String] =
              v.map((e) => (e as num).toInt()).toList(growable: false);
        }
      });
    }

    return QueuedQuizAttempt(
      localId: json['local_id'] as String,
      sessionId: json['session_id'] as String,
      studentId: json['student_id'] as String,
      subject: json['subject'] as String? ?? '',
      grade: json['grade'] as String? ?? '',
      topic: json['topic'] as String?,
      chapter: (json['chapter'] as num?)?.toInt(),
      responses: responses,
      totalTimeSeconds: (json['total_time_seconds'] as num?)?.toInt() ?? 0,
      capturedAt: json['captured_at'] as String,
      idempotencyKey: json['idempotency_key'] as String,
      shuffleMaps: maps,
      drainAttempt: (json['drain_attempt'] as num?)?.toInt() ?? 0,
    );
  }

  @override
  List<Object?> get props => [
        localId,
        sessionId,
        studentId,
        subject,
        grade,
        topic,
        chapter,
        responses,
        totalTimeSeconds,
        capturedAt,
        idempotencyKey,
        shuffleMaps,
        drainAttempt,
      ];
}
