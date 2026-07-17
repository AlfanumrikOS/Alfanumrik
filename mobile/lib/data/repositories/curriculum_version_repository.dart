import '../../core/constants/api_constants.dart';
import '../../core/network/api_client.dart';
import '../../core/network/network_info.dart';

/// Client for the frozen curriculum-version contract:
///
///   GET /api/v2/curriculum-version →
///     { "success": true,
///       "data": { "as_of": "<ISO8601>",
///                 "scopes": { "<subject_code>-<grade>": <unix_epoch_int>, ... } } }
///
/// NOTE the envelope. The route returns its payload through `v2Success(...)`,
/// which wraps it as `{ success: true, data: <payload> }` (and errors as
/// `{ success: false, error, code? }`). [ApiClient.get] hands back the RAW Dio
/// response body WITHOUT unwrapping — unlike the generated `V2ApiClient`, which
/// unwraps for its own callers. The scopes map therefore lives at
/// `body['data']['scopes']`, NOT `body['scopes']`. Reading the wrong path makes
/// every poll return null, which strands the Learn cache on its offline/refuse
/// branch for ONLINE users. See [parseScopesEnvelope].
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
///   * FAILURE  → any error (server 5xx, timeout, malformed body, an explicit
///                `success: false` envelope) returns null, which callers treat
///                identically to offline: serve cache within the STALE_TTL grace
///                window, otherwise refuse. A failed poll is never memoised, so
///                a transient blip self-heals on the next read.
class CurriculumVersionRepository {
  /// Injected only by tests that need a real [ApiClient]; production resolves
  /// the singleton lazily in [_rawBody] so merely constructing this repository
  /// never builds a Dio stack.
  final ApiClient? _api;

  /// Test seam: returns the raw decoded response body for the version endpoint.
  /// Null in production → [_rawBody] performs the real `GET`.
  final Future<dynamic> Function()? _fetchBody;

  /// Test seam: connectivity probe. Null in production → the real
  /// [hasConnection], which calls a platform plugin (unavailable in unit tests).
  final Future<bool> Function()? _connectivity;

  /// How long a successful poll is reused before re-polling. Keeps a browsing
  /// session from re-hitting the endpoint on every content read while still
  /// re-checking at the start of a fresh session.
  static const Duration _sessionTtl = Duration(minutes: 5);

  Map<String, int>? _scopes;
  DateTime? _polledAt;

  /// All parameters are optional test seams — the zero-arg form is the
  /// production constructor (see `curriculumVersionRepositoryProvider`).
  CurriculumVersionRepository({
    ApiClient? api,
    Future<dynamic> Function()? fetchBody,
    Future<bool> Function()? connectivity,
  })  : _api = api,
        _fetchBody = fetchBody,
        _connectivity = connectivity;

  /// Extract the `scope → version` map from a curriculum-version response body.
  ///
  /// The `/v2` envelope is the contract:
  ///   `{ "success": true, "data": { "as_of": ..., "scopes": {...} } }`
  /// A bare `{ "scopes": {...} }` body is also tolerated defensively, so an
  /// unwrapped or proxied response still parses rather than bricking Learn.
  ///
  /// Returns null — meaning "poll failed", which the caller treats exactly like
  /// offline — for a non-Map body, an explicit `success: false` error envelope,
  /// a missing/non-Map `data`, or a missing/non-Map `scopes`. Never throws.
  static Map<String, int>? parseScopesEnvelope(dynamic body) {
    if (body is! Map) return null;

    // Explicit error envelope (`{ success: false, error, code? }`) → poll
    // failed. Checked before `data` so an error body can never be mined for a
    // stray scopes map.
    if (body['success'] == false) return null;

    final data = body['data'];
    final rawScopes = data is Map ? data['scopes'] : body['scopes'];
    if (rawScopes is! Map) return null;

    final parsed = <String, int>{};
    rawScopes.forEach((key, value) {
      final v = value is num ? value.toInt() : int.tryParse('$value');
      if (v != null) parsed['$key'] = v;
    });
    return parsed;
  }

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
    if (!await _hasConnection()) return null;

    try {
      final parsed = parseScopesEnvelope(await _rawBody());
      // Malformed / error envelope → unknown. Do NOT memoise, so a transient
      // blip self-heals on the next read.
      if (parsed == null) return null;

      _scopes = parsed;
      _polledAt = now;
      return parsed;
    } catch (_) {
      // Server error / timeout / transport failure → treat as unknown. Do NOT
      // memoise the failure, so a transient blip self-heals on the next read.
      return null;
    }
  }

  /// Raw decoded body of `GET /api/v2/curriculum-version`. The [ApiClient]
  /// singleton is resolved lazily so tests injecting [_fetchBody] never build a
  /// Dio stack.
  Future<dynamic> _rawBody() async {
    final fetch = _fetchBody;
    if (fetch != null) return fetch();
    final resp = await (_api ?? ApiClient()).get(ApiConstants.curriculumVersion);
    return resp.data;
  }

  Future<bool> _hasConnection() => (_connectivity ?? hasConnection)();
}
