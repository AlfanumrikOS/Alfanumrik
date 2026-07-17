import '../../core/constants/api_constants.dart';
import '../../core/network/api_client.dart';
import '../../core/network/network_info.dart';

/// Client for the frozen curriculum-version contract:
///
///   GET /api/v2/curriculum-version →
///     { "as_of": "<ISO8601>",
///       "scopes": { "<subject_code>-<grade>": <unix_epoch_int>, ... } }
///
/// A higher int means newer content for that subject+grade scope; `0` (or an
/// absent scope) means the scope has never had content. The Learn cache uses
/// this stamp to decide, per scope, whether its cached content is still current
/// (see [LearningRepository]). The payload is <1 KB, so it is polled at the
/// start of a learn session and cached briefly in memory for the rest of it.
///
/// Poll semantics:
///   * SUCCESS  → the scope→version map is returned (and memoised for the
///                session TTL).
///   * OFFLINE  → detected via connectivity BEFORE any request, so the offline
///                fallback is instant (no waiting on Dio retry/backoff).
///   * FAILURE  → any error (server 5xx, timeout, malformed body) returns null,
///                which callers treat identically to offline: serve cache within
///                the STALE_TTL grace window, otherwise refuse.
class CurriculumVersionRepository {
  final ApiClient _api;

  /// How long a successful poll is reused before re-polling. Keeps a browsing
  /// session from re-hitting the endpoint on every content read while still
  /// re-checking at the start of a fresh session.
  static const Duration _sessionTtl = Duration(minutes: 5);

  Map<String, int>? _scopes;
  DateTime? _polledAt;

  CurriculumVersionRepository({ApiClient? api}) : _api = api ?? ApiClient();

  /// Server content version for [scopeKey] (`<subject_code>-<grade>`).
  ///
  /// Returns:
  ///   * a non-negative int when the poll succeeded (absent scope → `0`,
  ///     meaning "never had content"),
  ///   * `null` when the version could not be determined (offline / poll
  ///     failed) — the caller must then fall back to the STALE_TTL grace path.
  Future<int?> versionForScope(String scopeKey) async {
    final map = await _ensureScopes();
    if (map == null) return null; // unknown → offline/refuse branch
    return map[scopeKey] ?? 0; // absent scope == never had content
  }

  /// Force the next [versionForScope] to re-poll (e.g. on explicit refresh).
  void invalidate() {
    _scopes = null;
    _polledAt = null;
  }

  Future<Map<String, int>?> _ensureScopes() async {
    final now = DateTime.now();
    final cached = _scopes;
    final polledAt = _polledAt;
    if (cached != null &&
        polledAt != null &&
        now.difference(polledAt) < _sessionTtl) {
      return cached;
    }

    // Offline short-circuit: skip the request entirely so the offline fallback
    // is instant rather than blocked behind Dio's retry/backoff.
    if (!await hasConnection()) return null;

    try {
      final resp = await _api.get(ApiConstants.curriculumVersion);
      final body = resp.data;
      if (body is! Map) return null;

      final rawScopes = body['scopes'];
      if (rawScopes is! Map) return null;

      final parsed = <String, int>{};
      rawScopes.forEach((key, value) {
        final v = value is num ? value.toInt() : int.tryParse('$value');
        if (v != null) parsed['$key'] = v;
      });

      _scopes = parsed;
      _polledAt = now;
      return parsed;
    } catch (_) {
      // Server error / timeout / malformed body → treat as unknown. Do NOT
      // memoise the failure, so a transient blip self-heals on the next read.
      return null;
    }
  }
}
