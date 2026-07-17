import 'dart:convert';
import 'package:hive_flutter/hive_flutter.dart';
import '../constants/api_constants.dart';

/// A versioned, scope-tagged content cache entry.
///
/// Unlike the volatile TTL cache, a content entry carries the per-scope
/// `version` (the server's `<subject>-<grade>` unix-epoch stamp) and its own
/// `fetchedAt`, so the repository can make the version-anchored decision
/// (serve / refetch / offline-refuse) at read time. No TTL is applied inside
/// the cache — the caller owns the freshness policy.
class CachedContent<T> {
  final T data;

  /// `<subject_code>-<grade>` scope this entry belongs to. Purge-by-scope
  /// removes every entry sharing this key in one atomic batch.
  final String scope;

  /// Server content version for [scope] at write time. Compared against a fresh
  /// version poll to decide staleness.
  final int version;

  /// When this entry was written (used for the offline STALE_TTL grace check).
  final DateTime fetchedAt;

  const CachedContent(
    this.data, {
    required this.scope,
    required this.version,
    required this.fetchedAt,
  });
}

/// Lightweight key-value cache backed by Hive.
///
/// Two independent surfaces share the same payload box:
///   * **Volatile TTL cache** ([get] / [getList] / [put]) — per-student state
///     (dashboard / quiz usage / auth) expiring after [ApiConstants.cacheMaxAge].
///     Freshness is timestamp-only.
///   * **Version-anchored content cache** ([getContent] / [putContent] /
///     [replaceScope] / [purgeScope]) — near-static Learn curriculum content.
///     Each entry is tagged with its scope + server version + fetchedAt; the
///     repository decides when to serve vs refetch vs refuse. This surface uses
///     a SEPARATE metadata box, so content is never subject to the 5-minute TTL.
///
/// The Hive boxes are opened lazily and idempotently on first use, so the cache
/// is robust whether or not an explicit [init] is wired at app start.
class CacheManager {
  static const String _boxName = 'api_cache';
  static const String _metaBoxName = 'cache_meta';
  static const String _contentMetaBoxName = 'content_cache_meta';

  static CacheManager? _instance;

  // Nullable + lazily opened: accessing a Hive box before `openBox` throws, so
  // every write path funnels through [_ensureOpen] first. Sync readers treat a
  // not-yet-open box as a cache miss (correct on cold start — the first async
  // write opens the boxes and persisted data is read on the next access).
  Box<String>? _box;
  Box<int>? _metaBox;
  Box<String>? _contentMetaBox;

  CacheManager._();

  factory CacheManager() => _instance ??= CacheManager._();

  /// Explicit initialisation (kept for backward compatibility). Idempotent —
  /// safe to call multiple times, and safe to never call (boxes open lazily).
  Future<void> init() => _ensureOpen();

  bool get _isOpen =>
      _box != null && _metaBox != null && _contentMetaBox != null;

  Future<void> _ensureOpen() async {
    if (_isOpen) return;
    _box ??= await Hive.openBox<String>(_boxName);
    _metaBox ??= await Hive.openBox<int>(_metaBoxName);
    _contentMetaBox ??= await Hive.openBox<String>(_contentMetaBoxName);
  }

  // ── Volatile TTL cache (per-student state) ─────────────────────────────────

  /// Get cached JSON, returns null if expired or missing.
  T? get<T>(String key, T Function(Map<String, dynamic>) fromJson) {
    final box = _box, metaBox = _metaBox;
    if (box == null || metaBox == null) return null; // not open yet → miss

    final timestamp = metaBox.get(key);
    if (timestamp == null) return null;

    final age = DateTime.now().millisecondsSinceEpoch - timestamp;
    if (age > ApiConstants.cacheMaxAge.inMilliseconds) {
      // Expired — clean up
      box.delete(key);
      metaBox.delete(key);
      return null;
    }

    final raw = box.get(key);
    if (raw == null) return null;

    try {
      final json = jsonDecode(raw) as Map<String, dynamic>;
      return fromJson(json);
    } catch (_) {
      box.delete(key);
      return null;
    }
  }

  /// Get cached list of JSON objects.
  List<T>? getList<T>(String key, T Function(Map<String, dynamic>) fromJson) {
    final box = _box, metaBox = _metaBox;
    if (box == null || metaBox == null) return null; // not open yet → miss

    final timestamp = metaBox.get(key);
    if (timestamp == null) return null;

    final age = DateTime.now().millisecondsSinceEpoch - timestamp;
    if (age > ApiConstants.cacheMaxAge.inMilliseconds) {
      box.delete(key);
      metaBox.delete(key);
      return null;
    }

    final raw = box.get(key);
    if (raw == null) return null;

    try {
      final list = jsonDecode(raw) as List<dynamic>;
      return list
          .cast<Map<String, dynamic>>()
          .map(fromJson)
          .toList(growable: false);
    } catch (_) {
      box.delete(key);
      return null;
    }
  }

  /// Store JSON with timestamp (volatile TTL surface).
  Future<void> put(String key, dynamic data) async {
    await _ensureOpen();
    await _box!.put(key, jsonEncode(data));
    await _metaBox!.put(key, DateTime.now().millisecondsSinceEpoch);
  }

  // ── Version-anchored content cache (Learn curriculum) ──────────────────────

  /// Read a versioned content entry. Returns null if missing or corrupt. NO TTL
  /// is applied here — the caller applies the version-anchored decision using
  /// [CachedContent.version] and [CachedContent.fetchedAt].
  ///
  /// [decode] receives the raw JSON-decoded payload (a `Map` or a `List`) so the
  /// same method serves both single-object and list content.
  Future<CachedContent<T>?> getContent<T>(
    String key,
    T Function(dynamic decoded) decode,
  ) async {
    await _ensureOpen();
    final rawMeta = _contentMetaBox!.get(key);
    final raw = _box!.get(key);
    if (rawMeta == null || raw == null) return null;

    try {
      final meta = jsonDecode(rawMeta) as Map<String, dynamic>;
      final data = decode(jsonDecode(raw));
      return CachedContent<T>(
        data,
        scope: meta['scope'] as String? ?? '',
        version: (meta['version'] as num?)?.toInt() ?? 0,
        fetchedAt: DateTime.fromMillisecondsSinceEpoch(
          (meta['fetched_at'] as num?)?.toInt() ?? 0,
        ),
      );
    } catch (_) {
      // Corrupt entry — drop both halves so a fresh fetch can repopulate.
      await _box!.delete(key);
      await _contentMetaBox!.delete(key);
      return null;
    }
  }

  /// Write a single content entry tagged with [scopeKey] + [version] + now.
  /// Does NOT touch sibling entries — used by the blind-TTL fallback and as the
  /// primitive under [replaceScope].
  Future<void> putContent({
    required String key,
    required String scopeKey,
    required dynamic data,
    required int version,
  }) async {
    await _ensureOpen();
    await _box!.put(key, jsonEncode(data));
    await _contentMetaBox!.put(
      key,
      jsonEncode({
        'scope': scopeKey,
        'version': version,
        'fetched_at': DateTime.now().millisecondsSinceEpoch,
      }),
    );
  }

  /// Atomically replace an entire scope: write the fresh [key] entry, then purge
  /// every OTHER content entry tagged with [scopeKey].
  ///
  /// All-or-nothing from the serving perspective. The new entry is written
  /// FIRST (content for [key] is never absent), then stale siblings from the old
  /// version are deleted. If the process is killed mid-batch, any surviving
  /// sibling still carries the OLD version, so the next read of that sibling
  /// re-triggers its own refetch — a partial purge can NEVER resurface
  /// old-syllabus content as if it were current.
  Future<void> replaceScope({
    required String scopeKey,
    required String key,
    required dynamic data,
    required int version,
  }) async {
    await _ensureOpen();
    final siblings = _keysForScope(scopeKey);

    // 1. Establish the fresh entry (new version) before removing anything.
    await putContent(key: key, scopeKey: scopeKey, data: data, version: version);

    // 2. Purge every stale sibling in the scope.
    for (final k in siblings) {
      if (k == key) continue;
      await _box!.delete(k);
      await _contentMetaBox!.delete(k);
    }
  }

  /// Purge every content entry tagged with [scopeKey] (payload + metadata).
  Future<void> purgeScope(String scopeKey) async {
    await _ensureOpen();
    for (final k in _keysForScope(scopeKey)) {
      await _box!.delete(k);
      await _contentMetaBox!.delete(k);
    }
  }

  /// All content keys currently tagged with [scopeKey]. Corrupt metadata is
  /// treated as belonging to the scope so it gets cleaned up.
  List<String> _keysForScope(String scopeKey) {
    final meta = _contentMetaBox;
    if (meta == null) return const [];
    final out = <String>[];
    for (final k in meta.keys) {
      if (k is! String) continue;
      final rawMeta = meta.get(k);
      if (rawMeta == null) continue;
      try {
        final m = jsonDecode(rawMeta) as Map<String, dynamic>;
        if (m['scope'] == scopeKey) out.add(k);
      } catch (_) {
        out.add(k); // corrupt → drop with the scope
      }
    }
    return out;
  }

  // ── Housekeeping ───────────────────────────────────────────────────────────

  /// Remove specific cache entry (both surfaces).
  Future<void> remove(String key) async {
    await _ensureOpen();
    await _box!.delete(key);
    await _metaBox!.delete(key);
    await _contentMetaBox!.delete(key);
  }

  /// Clear all cache (e.g., on logout).
  Future<void> clearAll() async {
    await _ensureOpen();
    await _box!.clear();
    await _metaBox!.clear();
    await _contentMetaBox!.clear();
  }
}
