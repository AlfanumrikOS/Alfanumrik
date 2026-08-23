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
///     optional shuffle maps, a `drainAttempt` counter, the `lastAttemptAt`
///     backoff stamp, and the terminal `failureCode`.
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
  /// incremented to N on the Nth drain. Telemetry + retry-budget input only —
  /// never affects grading.
  final int drainAttempt;

  /// Device wall-clock (ISO-8601 UTC) of the LAST drain that actually SENT this
  /// attempt to the server. Null until the first send. Drives the drain's
  /// exponential backoff only — it is NEVER sent to the server, never used to
  /// derive attempt duration (P3), and never affects grading.
  final String? lastAttemptAt;

  /// Non-null ⇒ this attempt is TERMINAL ("needs attention"): the drain has
  /// stopped re-sending it, either because the server declared the failure
  /// permanent (`retryable: false`) or because the local retry budget
  /// (max attempts / max age) was exhausted.
  ///
  /// The record is deliberately KEPT on-device rather than deleted — it is a
  /// student's completed quiz. It stays listable (`OfflineQuizStore.failed()`)
  /// and RECOVERABLE: [requeued] / `OfflineQuizStore.requeue()` returns it to
  /// the drainable queue with its key, answers and `capturedAt` unchanged.
  ///
  /// ⚠️ Kept and recoverable is NOT the same as *shown*: no widget consumes the
  /// failed-count / sync-notice providers yet, so this state does not currently
  /// reach the student's screen. (This doc previously said "quarantined and
  /// surfaced" — only the first half was true.)
  ///
  /// Short code string only (e.g. `MAX_DRAIN_ATTEMPTS`) — never PII (P13).
  final String? failureCode;

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
    this.lastAttemptAt,
    this.failureCode,
  });

  /// True when this attempt has reached a terminal, needs-attention state and
  /// must never be re-sent. See [failureCode].
  bool get isTerminal => failureCode != null;

  /// Returns a copy with [drainAttempt] bumped to the given value and (when
  /// supplied) the [lastAttemptAt] backoff stamp refreshed. The idempotency
  /// key, capturedAt, responses and timings are carried through UNCHANGED —
  /// only the retry counter and the backoff stamp move.
  QueuedQuizAttempt withDrainAttempt(int next, {String? lastAttemptAt}) =>
      QueuedQuizAttempt(
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
        lastAttemptAt: lastAttemptAt ?? this.lastAttemptAt,
        failureCode: failureCode,
      );

  /// Returns a TERMINAL copy stamped with [code]. The attempt stays on-device
  /// (student work is never silently dropped) but the drain will never re-send
  /// it. As with [withDrainAttempt], the idempotency key and every captured
  /// field are carried through UNCHANGED — so if the record is ever re-queued
  /// via [requeued] it replays with the SAME key and cannot double-score (P2).
  QueuedQuizAttempt withFailure(String code) => QueuedQuizAttempt(
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
        drainAttempt: drainAttempt,
        lastAttemptAt: lastAttemptAt,
        failureCode: code,
      );

  /// The EXACT INVERSE of [withFailure]: clears the terminal marker and returns
  /// the record to the drainable queue with a fresh retry budget.
  ///
  /// Without this, a quarantined attempt had exactly one reachable end state —
  /// deletion (`remove` / `clearFailed`) — which made "kept, never silently
  /// dropped" a hollow claim: the work was retained but unrecoverable.
  ///
  /// ## What changes (retry-budget counters ONLY)
  ///   * `failureCode` → null  (drainable again; `isTerminal` false)
  ///   * `drainAttempt` → 0    (the `MAX_DRAIN_ATTEMPTS` gate would otherwise
  ///                            re-fire on the very next drain pass)
  ///   * `lastAttemptAt` → null (no stale backoff window blocking the first
  ///                            re-send)
  ///
  /// ## What does NOT change — and why it must not (P2)
  /// [idempotencyKey], [capturedAt], [responses], [totalTimeSeconds],
  /// [sessionId], [shuffleMaps] and the per-question timings all survive
  /// VERBATIM. The key surviving is the whole double-score safety argument: on
  /// re-send the drain stamps the SAME `Idempotency-Key` header, so if the
  /// original send had in fact committed server-side, the server's
  /// `(student_id, idempotency_key)` uniqueness short-circuit returns the
  /// CACHED result (`idempotent_replay: true`) instead of grading a second
  /// time. Requeue can therefore never double-grant XP. Regenerating the key —
  /// or "refreshing" `capturedAt` to dodge the staleness gate — would break
  /// exactly that, which is why neither is offered.
  ///
  /// ## Honest limits
  ///   * Because `capturedAt` is preserved, a record quarantined as
  ///     `REPLAY_WINDOW_EXPIRED` (older than the server's 168 h replay window)
  ///     will be re-quarantined on the next drain WITHOUT spending a request.
  ///     That is correct: the server would only answer 422 `REPLAY_TOO_STALE`.
  ///     Requeue restores re-sendability, not server acceptance.
  ///   * `drainAttempt` is per-requeue-cycle after this call, so the value the
  ///     server sees in the request body restarts at 1. It is telemetry only
  ///     and has never fed grading.
  ///   * This must stay a DELIBERATE (user- or operator-initiated) action. An
  ///     automatic requeue-on-failure would reconstitute the unbounded retry
  ///     loop the retry budget exists to bound.
  QueuedQuizAttempt requeued() => QueuedQuizAttempt(
        localId: localId,
        sessionId: sessionId,
        studentId: studentId,
        subject: subject,
        grade: grade,
        topic: topic,
        chapter: chapter,
        responses: responses,
        totalTimeSeconds: totalTimeSeconds,
        // Captured ONCE at completion — never refreshed. See "Honest limits".
        capturedAt: capturedAt,
        // P2: the grading token is reused VERBATIM. Never regenerated.
        idempotencyKey: idempotencyKey,
        shuffleMaps: shuffleMaps,
        drainAttempt: 0,
        lastAttemptAt: null,
        failureCode: null,
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
        'last_attempt_at': lastAttemptAt,
        'failure_code': failureCode,
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
      // Both fields are ADDITIVE: records written before they existed decode
      // with null (never attempted-stamped / not terminal), so an app upgrade
      // never strands an already-queued attempt.
      lastAttemptAt: json['last_attempt_at'] as String?,
      failureCode: json['failure_code'] as String?,
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
        lastAttemptAt,
        failureCode,
      ];
}
