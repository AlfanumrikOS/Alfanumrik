import '../../core/constants/api_constants.dart';
import '../../core/network/api_client.dart';
import '../../core/network/network_info.dart';

/// Outcome of a version poll for ONE scope.
///
/// Deliberately three-way rather than `int?`. "Offline" and "the poll failed"
/// are different facts, and collapsing both into `null` was a live defect: a
/// transient 500/timeout on a FULLY ONLINE device with no cache rendered the
/// Offline state on Learn.
///
/// WHY THE TWO UNKNOWNS DIVERGE (the reasoning this type exists to encode):
/// `serverVersion` is never a freshness gate — it is only a cache stamp. The
/// online branch serves whatever `fetchFresh()` returns and never validates that
/// payload against the version. The version's ONLY question is "can I skip the
/// network?". So when the version is unknown, the correct fail direction is
/// DON'T SKIP THE NETWORK → fetch. A cache layer must degrade to **no cache**,
/// never to **no content**. Fetching fresh cannot violate "no silent stale
/// serve": you cannot serve stale content by declining to serve the cache.
///
/// The one thing that fetch CANNOT fix is being offline — there is no network to
/// fall back to, and the connectivity short-circuit exists precisely to avoid
/// the Dio retry/backoff wait. Hence [VersionOffline] still refuses.
sealed class VersionResult {
  const VersionResult();
}

/// The poll answered for this scope. [version] is non-negative: `0` means the
/// scope has never had content (an absent scope is reported as `0`, not as an
/// unknown). A KNOWN version is the only thing that can authorise skipping the
/// network.
final class VersionKnown extends VersionResult {
  final int version;

  const VersionKnown(this.version);

  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      (other is VersionKnown && other.version == version);

  @override
  int get hashCode => version.hashCode;

  @override
  String toString() => 'VersionKnown($version)';
}

/// The device is offline — detected BEFORE any request was issued, so no Dio
/// retry/backoff was waited on. There is no network to fall back to.
final class VersionOffline extends VersionResult {
  const VersionOffline();

  @override
  String toString() => 'VersionOffline()';
}

/// The device is ONLINE but the poll did not yield a version (5xx, timeout,
/// malformed body, `success: false`). The network is reachable — the caller can
/// and must still fetch content.
final class VersionUnknownOnline extends VersionResult {
  const VersionUnknownOnline();

  @override
  String toString() => 'VersionUnknownOnline()';
}

/// Internal outcome of the scope-map poll. Mirrors [VersionResult] one level
/// down so [CurriculumVersionRepository._ensureScopes] stops discarding the
/// offline-vs-failed distinction it already knows.
sealed class _ScopesOutcome {
  const _ScopesOutcome();
}

final class _ScopesLoaded extends _ScopesOutcome {
  final Map<String, int> scopes;
  const _ScopesLoaded(this.scopes);
}

final class _ScopesOffline extends _ScopesOutcome {
  const _ScopesOffline();
}

final class _ScopesUnknown extends _ScopesOutcome {
  const _ScopesUnknown();
}

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
/// every poll fail — which now costs the network-skip (every Learn read refetches
/// instead of serving cache) rather than bricking Learn, but is still a bug worth
/// not reintroducing. See [parseScopesEnvelope].
///
/// A higher int means newer content for that subject+grade scope; `0` (or an
/// absent scope) means the scope has never had content. The Learn cache uses
/// this stamp to decide, per scope, whether its cached content is still current
/// (see [LearningRepository]). The payload is <1 KB, so it is polled at the
/// start of a learn session and cached briefly in memory for the rest of it.
///
/// Poll semantics — THREE outcomes, not two (see [VersionResult]):
///   * SUCCESS  → [VersionKnown]: the scope's version (and the map is memoised
///                for the session TTL).
///   * OFFLINE  → [VersionOffline]: detected via connectivity BEFORE any
///                request, so the offline fallback is instant (no waiting on
///                Dio retry/backoff).
///   * FAILURE  → [VersionUnknownOnline]: any error (server 5xx, timeout,
///                malformed body, an explicit `success: false` envelope) while
///                the device IS online. A failed poll is never memoised, so a
///                transient blip self-heals on the next read.
///
/// OFFLINE and FAILURE were once conflated into a single `null`, which stranded
/// ONLINE users on the offline/refuse branch whenever the poll blipped. They are
/// different facts and the caller acts on them differently — see
/// [VersionResult].
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
  /// Returns null — meaning "the poll did not yield a version" — for a non-Map
  /// body, an explicit `success: false` error envelope, a missing/non-Map
  /// `data`, or a missing/non-Map `scopes`. Never throws.
  ///
  /// A null here is NOT "offline": reaching a body at all proves the device is
  /// online, so [_ensureScopes] maps it to [_ScopesUnknown] → [VersionUnknownOnline],
  /// and the caller still fetches content. Only the connectivity probe can
  /// produce [VersionOffline].
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
  /// Returns one of three outcomes — see [VersionResult]:
  ///   * [VersionKnown] — the poll succeeded (absent scope → `0`, meaning
  ///     "never had content"). Only this can authorise skipping the network.
  ///   * [VersionOffline] — no connectivity; there is nothing to fetch.
  ///   * [VersionUnknownOnline] — online but the poll failed; the caller should
  ///     still fetch (it just cannot skip the network).
  Future<VersionResult> versionForScope(String scopeKey) async {
    final outcome = await _ensureScopes();
    return switch (outcome) {
      // Absent scope == never had content == a KNOWN version of 0.
      _ScopesLoaded(scopes: final scopes) =>
        VersionKnown(scopes[scopeKey] ?? 0),
      _ScopesOffline() => const VersionOffline(),
      _ScopesUnknown() => const VersionUnknownOnline(),
    };
  }

  /// Force the next [versionForScope] to re-poll (e.g. on explicit refresh).
  void invalidate() {
    _scopes = null;
    _polledAt = null;
  }

  Future<_ScopesOutcome> _ensureScopes() async {
    final now = DateTime.now();
    final cached = _scopes;
    final polledAt = _polledAt;
    if (cached != null &&
        polledAt != null &&
        now.difference(polledAt) < _sessionTtl) {
      return _ScopesLoaded(cached);
    }

    // Offline short-circuit: skip the request entirely so the offline fallback
    // is instant rather than blocked behind Dio's retry/backoff. This branch is
    // the ONLY source of _ScopesOffline — it is a positive statement that there
    // is no network, not merely an absence of an answer.
    if (!await _hasConnection()) return const _ScopesOffline();

    try {
      final parsed = parseScopesEnvelope(await _rawBody());
      // Malformed / error envelope → unknown, but we are demonstrably ONLINE
      // (we got far enough to receive a body). Do NOT memoise, so a transient
      // blip self-heals on the next read.
      if (parsed == null) return const _ScopesUnknown();

      _scopes = parsed;
      _polledAt = now;
      return _ScopesLoaded(parsed);
    } catch (_) {
      // Server error / timeout / transport failure while online → unknown. Do
      // NOT memoise the failure, so a transient blip self-heals on the next
      // read. NOT offline: connectivity said yes, so the caller can still fetch.
      return const _ScopesUnknown();
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
