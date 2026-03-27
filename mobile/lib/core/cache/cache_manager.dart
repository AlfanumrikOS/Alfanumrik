import 'dart:convert';
import 'package:hive_flutter/hive_flutter.dart';
import '../constants/api_constants.dart';

/// Lightweight key-value cache backed by Hive.
/// TTL-based expiry, JSON serialization, max 5MB per box.
class CacheManager {
  static const String _boxName = 'api_cache';
  static const String _metaBoxName = 'cache_meta';

  static CacheManager? _instance;
  late Box<String> _box;
  late Box<int> _metaBox;

  CacheManager._();

  factory CacheManager() => _instance ??= CacheManager._();

  Future<void> init() async {
    _box = await Hive.openBox<String>(_boxName);
    _metaBox = await Hive.openBox<int>(_metaBoxName);
  }

  /// Get cached JSON, returns null if expired or missing.
  T? get<T>(String key, T Function(Map<String, dynamic>) fromJson) {
    final timestamp = _metaBox.get(key);
    if (timestamp == null) return null;

    final age = DateTime.now().millisecondsSinceEpoch - timestamp;
    if (age > ApiConstants.cacheMaxAge.inMilliseconds) {
      // Expired — clean up
      _box.delete(key);
      _metaBox.delete(key);
      return null;
    }

    final raw = _box.get(key);
    if (raw == null) return null;

    try {
      final json = jsonDecode(raw) as Map<String, dynamic>;
      return fromJson(json);
    } catch (_) {
      _box.delete(key);
      return null;
    }
  }

  /// Get cached list of JSON objects.
  List<T>? getList<T>(String key, T Function(Map<String, dynamic>) fromJson) {
    final timestamp = _metaBox.get(key);
    if (timestamp == null) return null;

    final age = DateTime.now().millisecondsSinceEpoch - timestamp;
    if (age > ApiConstants.cacheMaxAge.inMilliseconds) {
      _box.delete(key);
      _metaBox.delete(key);
      return null;
    }

    final raw = _box.get(key);
    if (raw == null) return null;

    try {
      final list = jsonDecode(raw) as List<dynamic>;
      return list
          .cast<Map<String, dynamic>>()
          .map(fromJson)
          .toList(growable: false);
    } catch (_) {
      _box.delete(key);
      return null;
    }
  }

  /// Store JSON with timestamp.
  Future<void> put(String key, dynamic data) async {
    await _box.put(key, jsonEncode(data));
    await _metaBox.put(key, DateTime.now().millisecondsSinceEpoch);
  }

  /// Remove specific cache entry.
  Future<void> remove(String key) async {
    await _box.delete(key);
    await _metaBox.delete(key);
  }

  /// Clear all cache (e.g., on logout).
  Future<void> clearAll() async {
    await _box.clear();
    await _metaBox.clear();
  }
}
