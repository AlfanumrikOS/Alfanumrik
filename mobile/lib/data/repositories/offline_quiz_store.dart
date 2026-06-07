import 'dart:convert';

import 'package:hive_flutter/hive_flutter.dart';

import '../models/offline_quiz_models.dart';

/// Hive-backed persistence for the Wave 2.5.2 offline quiz path.
///
/// Two boxes, both storing JSON-encoded strings (reusing the project's
/// existing Hive-JSON convention from `CacheManager` — no typed
/// `hive_generator` adapter, so the records stay pure-Dart testable):
///
///   * **bundle box** (`offline_quiz_bundles`) — the prefetched today bundle,
///     keyed by `subject`. Overwritten on each successful online prefetch so a
///     student always has the freshest attemptable session for that subject.
///
///   * **queue box** (`offline_quiz_queue`) — the FIFO submission queue, keyed
///     by `QueuedQuizAttempt.localId`. FIFO order is the box's natural
///     insertion order ([Box.values] preserves it for a non-deleted-key box;
///     we never re-insert an existing key, only delete on success/discard).
///
/// All methods are synchronous reads / async writes mirroring Hive's API. The
/// store does NO networking and NO grading — it is a dumb persistent buffer.
/// Drain orchestration + the discard-vs-retry matrix live in
/// [OfflineDrainService].
class OfflineQuizStore {
  static const String bundleBoxName = 'offline_quiz_bundles';
  static const String queueBoxName = 'offline_quiz_queue';

  final Box<String> _bundleBox;
  final Box<String> _queueBox;

  OfflineQuizStore({
    required Box<String> bundleBox,
    required Box<String> queueBox,
  })  : _bundleBox = bundleBox,
        _queueBox = queueBox;

  /// Open the two boxes and construct the store. Call once at app start (after
  /// `Hive.initFlutter()` in `main.dart`).
  static Future<OfflineQuizStore> open() async {
    final bundleBox = await Hive.openBox<String>(bundleBoxName);
    final queueBox = await Hive.openBox<String>(queueBoxName);
    return OfflineQuizStore(bundleBox: bundleBox, queueBox: queueBox);
  }

  // ── Today bundle ─────────────────────────────────────────────────────────

  /// Cache (or overwrite) the today bundle for [bundle].subject.
  Future<void> putBundle(OfflineTodayBundle bundle) async {
    await _bundleBox.put(bundle.subject, jsonEncode(bundle.toJson()));
  }

  /// Read the cached bundle for [subject], or null if none / malformed.
  OfflineTodayBundle? getBundle(String subject) {
    final raw = _bundleBox.get(subject);
    if (raw == null) return null;
    try {
      final json = jsonDecode(raw) as Map<String, dynamic>;
      return OfflineTodayBundle.fromJson(json);
    } catch (_) {
      // Corrupt entry — drop it so a fresh prefetch can repopulate.
      _bundleBox.delete(subject);
      return null;
    }
  }

  /// All cached bundles (for any subject). Skips malformed entries.
  List<OfflineTodayBundle> allBundles() {
    final out = <OfflineTodayBundle>[];
    for (final raw in _bundleBox.values) {
      try {
        out.add(OfflineTodayBundle.fromJson(
            jsonDecode(raw) as Map<String, dynamic>));
      } catch (_) {
        // skip
      }
    }
    return out;
  }

  Future<void> clearBundles() => _bundleBox.clear();

  // ── Submission queue ─────────────────────────────────────────────────────

  /// Enqueue a completed-offline attempt. Keyed by its [localId]; FIFO order
  /// follows insertion. Idempotent on [localId] — re-enqueuing the same id
  /// overwrites in place (it must never duplicate a queued attempt).
  Future<void> enqueue(QueuedQuizAttempt attempt) async {
    await _queueBox.put(attempt.localId, jsonEncode(attempt.toJson()));
  }

  /// The queue in FIFO order. Malformed entries are skipped (and their raw
  /// key dropped so they don't wedge the drain).
  List<QueuedQuizAttempt> queue() {
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

  int get queueLength => _queueBox.length;

  /// Replace a queued attempt in place (e.g. to persist a bumped
  /// `drainAttempt`). Keyed by [localId] so order is preserved.
  Future<void> update(QueuedQuizAttempt attempt) async {
    await _queueBox.put(attempt.localId, jsonEncode(attempt.toJson()));
  }

  /// Remove a drained / discarded attempt from the queue by its [localId].
  Future<void> remove(String localId) async {
    await _queueBox.delete(localId);
  }

  Future<void> clearQueue() => _queueBox.clear();
}
