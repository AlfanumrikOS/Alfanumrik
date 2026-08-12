import 'dart:convert';

import 'package:hive_flutter/hive_flutter.dart';

import '../models/offline_quiz_models.dart';

/// Hive-backed persistence for the Wave 2.5.2 offline quiz-submission queue.
///
/// One box storing JSON-encoded strings (reusing the project's existing
/// Hive-JSON convention from `CacheManager` — no typed `hive_generator`
/// adapter, so the records stay pure-Dart testable):
///
///   * **queue box** (`offline_quiz_queue`) — the FIFO submission queue, keyed
///     by `QueuedQuizAttempt.localId`. FIFO order is the box's natural
///     insertion order ([Box.values] preserves it for a non-deleted-key box;
///     we never re-insert an existing key, only delete on success/discard).
///
/// The SAME box also holds TERMINAL ("needs attention") records — attempts the
/// drain has permanently stopped re-sending, marked by a non-null
/// `failureCode`. They are kept rather than deleted because a completed quiz is
/// student work; [queue] excludes them (so they are never re-sent and never
/// inflate the "N waiting to sync" badge) and [failed] lists them.
///
/// ## What a terminal record can actually do (state of play)
/// Three operations exist on a terminal record, all at THIS data layer:
///   * [failed] — list it (id, reason code, captured timings; no PII);
///   * [requeue] / [requeueAllFailed] — return it to the drainable queue with
///     its idempotency key, answers and `capturedAt` UNCHANGED (the inverse of
///     `QueuedQuizAttempt.withFailure`);
///   * [remove] / [clearFailed] — dismiss it (delete).
///
/// ⚠️ **No widget consumes any of this yet.** `offlineFailedCountProvider`,
/// `offlineQueueCountProvider` and `offlineSyncNoticeProvider` in
/// `lib/providers/offline_quiz_provider.dart` currently have ZERO widget
/// consumers, so a quarantined attempt is retained and recoverable but is NOT
/// yet shown to the student. Do not describe it as "surfaced" until a UI
/// surface lands (a separate product/frontend decision). This paragraph exists
/// because the earlier docs claimed quarantined work was "surfaced, never
/// silently dropped" when only the second half was true.
///
/// All methods are synchronous reads / async writes mirroring Hive's API. The
/// store does NO networking and NO grading — it is a dumb persistent buffer.
/// Drain orchestration + the discard-vs-retry matrix live in
/// [OfflineDrainService].
class OfflineQuizStore {
  static const String queueBoxName = 'offline_quiz_queue';

  final Box<String> _queueBox;

  OfflineQuizStore({
    required Box<String> queueBox,
    // Accepted-and-ignored. The dormant prefetch-bundle box was removed; this
    // optional param is retained ONLY so the existing offline-drain-service
    // test's store construction keeps compiling unchanged. Production `open()`
    // never passes it and no bundle box is ever opened.
    Box<String>? bundleBox,
  }) : _queueBox = queueBox;

  /// Open the queue box and construct the store. Call once at app start (after
  /// `Hive.initFlutter()` in `main.dart`).
  static Future<OfflineQuizStore> open() async {
    final queueBox = await Hive.openBox<String>(queueBoxName);
    return OfflineQuizStore(queueBox: queueBox);
  }

  // ── Submission queue ─────────────────────────────────────────────────────

  /// Enqueue a completed-offline attempt. Keyed by its [localId]; FIFO order
  /// follows insertion. Idempotent on [localId] — re-enqueuing the same id
  /// overwrites in place (it must never duplicate a queued attempt).
  Future<void> enqueue(QueuedQuizAttempt attempt) async {
    await _queueBox.put(attempt.localId, jsonEncode(attempt.toJson()));
  }

  /// Every stored record (pending AND terminal) in FIFO order. Malformed
  /// entries are skipped (and their raw key dropped so they don't wedge the
  /// drain).
  List<QueuedQuizAttempt> all() {
    final out = <QueuedQuizAttempt>[];
    final corruptKeys = <dynamic>[];
    for (final key in _queueBox.keys) {
      final raw = _queueBox.get(key);
      if (raw == null) continue;
      try {
        out.add(QueuedQuizAttempt.fromJson(
            jsonDecode(raw) as Map<String, dynamic>));
      } catch (_) {
        corruptKeys.add(key);
      }
    }
    for (final k in corruptKeys) {
      _queueBox.delete(k);
    }
    return out;
  }

  /// The DRAINABLE queue in FIFO order — terminal ("needs attention") records
  /// are excluded, so the drain can never re-send one.
  List<QueuedQuizAttempt> queue() =>
      all().where((a) => !a.isTerminal).toList(growable: false);

  /// Terminal records awaiting attention, in FIFO order. These are kept
  /// on-device deliberately: a completed quiz is student work and is never
  /// silently dropped. Recoverable via [requeue]; dismissible via [remove] /
  /// [clearFailed]. (No UI reads this yet — see the class doc.)
  List<QueuedQuizAttempt> failed() =>
      all().where((a) => a.isTerminal).toList(growable: false);

  /// Look up a single stored record (pending OR terminal) by [localId].
  /// Returns null when absent. Needed so a caller can inspect a terminal
  /// record's `failureCode` before deciding to [requeue] it.
  QueuedQuizAttempt? byId(String localId) {
    for (final a in all()) {
      if (a.localId == localId) return a;
    }
    return null;
  }

  /// Number of attempts still waiting to sync (terminal records excluded, so
  /// the "N quizzes waiting to sync" badge stays honest).
  int get queueLength => queue().length;

  /// Number of terminal, needs-attention attempts.
  int get failedLength => failed().length;

  /// Replace a queued attempt in place (e.g. to persist a bumped
  /// `drainAttempt`). Keyed by [localId] so order is preserved.
  Future<void> update(QueuedQuizAttempt attempt) async {
    await _queueBox.put(attempt.localId, jsonEncode(attempt.toJson()));
  }

  /// Remove a drained / discarded attempt from the queue by its [localId].
  /// Also the dismissal path for a terminal record the student has been shown.
  Future<void> remove(String localId) async {
    await _queueBox.delete(localId);
  }

  /// Drop every terminal ("needs attention") record — the bulk dismissal path.
  /// Pending attempts are untouched.
  Future<void> clearFailed() async {
    for (final a in failed()) {
      await _queueBox.delete(a.localId);
    }
  }

  /// Return ONE terminal record to the drainable queue — the inverse of the
  /// drain's `withFailure` quarantine, and the reason "kept, never dropped" is
  /// a real guarantee rather than a slower delete.
  ///
  /// Delegates to [QueuedQuizAttempt.requeued], so the record comes back with
  /// its **Idempotency-Key, answers, per-question timings and `capturedAt`
  /// unchanged** and only its retry-budget counters (`drainAttempt`,
  /// `lastAttemptAt`) reset. That is what makes requeue double-score-safe: the
  /// re-send carries the SAME key, so a server that already committed the
  /// original replays its cached result instead of grading twice (P2).
  ///
  /// Writes back under the SAME [localId] key, so the record keeps its FIFO
  /// position rather than jumping to the back of the queue.
  ///
  /// Returns true if a terminal record was found and re-queued; false if the
  /// id is unknown OR already pending (requeue is idempotent — calling it twice
  /// must not zero the retry counter of an attempt that is mid-backoff).
  Future<bool> requeue(String localId) async {
    final existing = byId(localId);
    if (existing == null || !existing.isTerminal) return false;
    await _queueBox.put(localId, jsonEncode(existing.requeued().toJson()));
    return true;
  }

  /// Bulk inverse of [clearFailed]: re-queue EVERY terminal record. Returns how
  /// many were re-queued. Pending attempts are untouched.
  ///
  /// Intended for a deliberate "retry all" action (e.g. after the operator has
  /// confirmed a server-side outage is over). It must NOT be wired to run
  /// automatically on drain/foreground — that would reconstitute the unbounded
  /// retry loop `OfflineDrainService`'s retry budget exists to bound.
  Future<int> requeueAllFailed() async {
    var n = 0;
    for (final a in failed()) {
      await _queueBox.put(a.localId, jsonEncode(a.requeued().toJson()));
      n++;
    }
    return n;
  }

  Future<void> clearQueue() => _queueBox.clear();
}
