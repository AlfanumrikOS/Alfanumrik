import 'package:equatable/equatable.dart';

/// ────────────────────────────────────────────────────────────────────────
/// Wave 2.5.2 — OFFLINE quiz-submission data models.
///
/// Pure-Dart, JSON-serializable value types powering the offline SUBMISSION
/// queue (a completed-offline attempt is buffered on-device and drained to the
/// server when connectivity returns). They are deliberately storage-agnostic
/// (encoded to/from `Map<String, dynamic>` so the existing Hive-JSON convention
/// in `CacheManager` is reused — no `hive_generator` typed adapter is needed,
/// and the records stay trivially unit-testable without a Hive runtime):
///
///   * [OfflineResponse] — a single captured answer (displayed index + on-device
///     time spent) inside a queued attempt.
///
///   * [QueuedQuizAttempt] — a completed-OFFLINE attempt awaiting drain. Carries
///     the responses, the on-device per-question + total timings, the
///     **immutable** `idempotencyKey` (generated EXACTLY ONCE at completion and
///     reused verbatim on every drain), the device-wall-clock `capturedAt`, the
///     optional shuffle maps, and a `drainAttempt` counter.
///
/// ## P-invariant guard-rails encoded here
///   * P2: NO score / XP fields live on any type. The device never grades.
///   * P3: per-question + total timings are stored verbatim from the live
///     attempt and are NEVER recomputed at drain time.
///   * P13: NO PII — only ids, indices, and counts; nothing here is logged.
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
