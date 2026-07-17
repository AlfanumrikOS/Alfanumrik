// ENVELOPE PARSE — GET /api/v2/curriculum-version.
//
// THE BUG THIS PINS
// =================
// The route returns its payload through `v2Success(...)`, so the wire body is
//   { "success": true, "data": { "as_of": "...", "scopes": { "math-8": 123 } } }
// while `ApiClient.get` hands back the RAW Dio response body — it does NOT
// unwrap the envelope the way the generated `V2ApiClient` does for its callers.
//
// The original code read `body['scopes']`, which on the REAL envelope is null.
// `versionForScope` therefore returned null UNCONDITIONALLY, which the Learn
// cache maps onto its "version unknown" branch — i.e. offline. On a fully
// ONLINE device with no cache that is `LearnOfflineException` on every chapters
// / concept read: the Learn tab bricked for every user, with the feature flag
// defaulting ON.
//
// The parse is therefore not a detail — it is the entire online path. These
// tests drive the REAL envelope shape byte-for-byte (see
// apps/host/src/app/api/v2/curriculum-version/route.ts + the `v2Success` helper
// in apps/host/src/lib/api/v2/envelope.ts).
//
// TEST SEAMS
// ==========
//  * `fetchBody` replaces the raw `GET`, so no Dio/network is constructed.
//  * `connectivity` replaces `hasConnection()`, which calls the connectivity_plus
//    PLATFORM PLUGIN and would throw MissingPluginException in a unit test.
// Both are optional named params; production still uses the zero-arg form.
//
// Lane: CI `flutter test` (the REG-90 mobile gate).

import 'package:flutter_test/flutter_test.dart';

import 'package:alfanumrik/data/repositories/curriculum_version_repository.dart';

/// The REAL success body of GET /api/v2/curriculum-version: the RPC jsonb
/// (`{ as_of, scopes }`) returned VERBATIM inside the `/v2` envelope.
Map<String, dynamic> realEnvelope(Map<String, dynamic> scopes) => {
      'success': true,
      'data': {
        'as_of': '2026-07-17T10:00:00.000Z',
        'scopes': scopes,
      },
    };

CurriculumVersionRepository repoServing(
  dynamic body, {
  bool online = true,
}) =>
    CurriculumVersionRepository(
      fetchBody: () async => body,
      connectivity: () async => online,
    );

void main() {
  group('parseScopesEnvelope — the REAL /v2 envelope', () {
    test('reads scopes from body["data"]["scopes"], NOT body["scopes"]', () {
      // THE REGRESSION. Against the pre-fix code this map came back null.
      final parsed = CurriculumVersionRepository.parseScopesEnvelope(
        realEnvelope({'math-8': 123, 'science-8': 456}),
      );

      expect(parsed, isNotNull,
          reason: 'the enveloped body is the contract — it MUST parse');
      expect(parsed, {'math-8': 123, 'science-8': 456});
    });

    test('coerces numeric-string and double scope values to int', () {
      final parsed = CurriculumVersionRepository.parseScopesEnvelope(
        realEnvelope({'math-8': '123', 'science-8': 456.0}),
      );
      expect(parsed, {'math-8': 123, 'science-8': 456});
    });

    test('drops unparseable scope values rather than failing the whole poll',
        () {
      final parsed = CurriculumVersionRepository.parseScopesEnvelope(
        realEnvelope({'math-8': 123, 'junk-8': 'not-a-number'}),
      );
      expect(parsed, {'math-8': 123});
    });

    test('parses the degraded-but-successful body (empty scopes)', () {
      // The route NEVER 5xxs a version poll: a missing grade / RPC failure
      // degrades to `{ as_of, scopes: {} }` at HTTP 200. That is a SUCCESSFUL
      // poll reporting "no scopes", not a failure.
      final parsed =
          CurriculumVersionRepository.parseScopesEnvelope(realEnvelope({}));
      expect(parsed, isNotNull);
      expect(parsed, isEmpty);
    });

    test('tolerates a bare {scopes:...} body defensively', () {
      // The envelope is the contract, but an unwrapped/proxied body must not
      // brick Learn.
      final parsed = CurriculumVersionRepository.parseScopesEnvelope({
        'as_of': '2026-07-17T10:00:00.000Z',
        'scopes': {'math-8': 123},
      });
      expect(parsed, {'math-8': 123});
    });

    group('returns null (= poll failed → offline branch) for', () {
      test('an explicit success:false error envelope', () {
        expect(
          CurriculumVersionRepository.parseScopesEnvelope({
            'success': false,
            'error': 'Forbidden',
            'code': 'PERMISSION_DENIED',
          }),
          isNull,
        );
      });

      test('success:false even if a scopes map is somehow present', () {
        // An error envelope must never be mined for data.
        expect(
          CurriculumVersionRepository.parseScopesEnvelope({
            'success': false,
            'error': 'boom',
            'data': {
              'scopes': {'math-8': 123}
            },
          }),
          isNull,
        );
      });

      test('a success envelope with no data key', () {
        expect(
          CurriculumVersionRepository.parseScopesEnvelope({'success': true}),
          isNull,
        );
      });

      test('a success envelope whose data has no scopes key', () {
        expect(
          CurriculumVersionRepository.parseScopesEnvelope({
            'success': true,
            'data': {'as_of': '2026-07-17T10:00:00.000Z'},
          }),
          isNull,
        );
      });

      test('a non-Map body (HTML error page, plain string, null)', () {
        expect(CurriculumVersionRepository.parseScopesEnvelope(null), isNull);
        expect(CurriculumVersionRepository.parseScopesEnvelope('<html>502</html>'),
            isNull);
        expect(CurriculumVersionRepository.parseScopesEnvelope(const [1, 2]),
            isNull);
      });

      test('scopes present but not a Map', () {
        expect(
          CurriculumVersionRepository.parseScopesEnvelope({
            'success': true,
            'data': {'scopes': 'nope'},
          }),
          isNull,
        );
      });
    });
  });

  group('versionForScope — end to end over the real envelope', () {
    test('returns the scope version from the enveloped body', () async {
      // THE HEADLINE REGRESSION: pre-fix this was null, not 123.
      final repo = repoServing(realEnvelope({'math-8': 123, 'science-8': 456}));

      expect(await repo.versionForScope('math-8'), 123);
      expect(await repo.versionForScope('science-8'), 456);
    });

    test('an absent scope is 0 ("never had content"), NOT null', () async {
      // The distinction matters: 0 is a KNOWN version (online, no content), null
      // means UNKNOWN (offline / failed) and routes to the refuse branch.
      final repo = repoServing(realEnvelope({'math-8': 123}));
      expect(await repo.versionForScope('history-8'), 0);
    });

    test('every scope is 0 on the degraded empty-scopes body', () async {
      final repo = repoServing(realEnvelope({}));
      expect(await repo.versionForScope('math-8'), 0);
    });

    test('offline → null WITHOUT issuing a request', () async {
      var fetched = false;
      final repo = CurriculumVersionRepository(
        fetchBody: () async {
          fetched = true;
          return realEnvelope({'math-8': 123});
        },
        connectivity: () async => false,
      );

      expect(await repo.versionForScope('math-8'), isNull);
      expect(fetched, isFalse,
          reason: 'offline short-circuits BEFORE the request so the fallback '
              'is instant (no Dio retry/backoff wait)');
    });

    test('success:false envelope → null', () async {
      final repo = repoServing({'success': false, 'error': 'Unauthorized'});
      expect(await repo.versionForScope('math-8'), isNull);
    });

    test('missing data → null', () async {
      final repo = repoServing({'success': true});
      expect(await repo.versionForScope('math-8'), isNull);
    });

    test('a throwing transport → null rather than an escaping exception',
        () async {
      // A version poll must never surface an error to the caller; null routes to
      // the STALE_TTL grace path.
      final repo = CurriculumVersionRepository(
        fetchBody: () async => throw Exception('timeout'),
        connectivity: () async => true,
      );
      expect(await repo.versionForScope('math-8'), isNull);
    });
  });

  group('poll memoisation', () {
    test('a successful poll is reused across reads (one request per session)',
        () async {
      var calls = 0;
      final repo = CurriculumVersionRepository(
        fetchBody: () async {
          calls++;
          return realEnvelope({'math-8': 123, 'science-8': 123});
        },
        connectivity: () async => true,
      );

      await repo.versionForScope('math-8');
      await repo.versionForScope('science-8');
      await repo.versionForScope('math-8');

      expect(calls, 1, reason: 'the <1 KB poll is memoised for the session TTL');
    });

    test('a FAILED poll is not memoised — the next read re-polls and self-heals',
        () async {
      var calls = 0;
      final repo = CurriculumVersionRepository(
        fetchBody: () async {
          calls++;
          // First call: a garbled body. Second: the real thing.
          return calls == 1 ? {'success': true} : realEnvelope({'math-8': 123});
        },
        connectivity: () async => true,
      );

      expect(await repo.versionForScope('math-8'), isNull);
      expect(await repo.versionForScope('math-8'), 123,
          reason: 'a transient blip must not poison the whole session');
      expect(calls, 2);
    });

    test('invalidate() forces a re-poll', () async {
      var calls = 0;
      final repo = CurriculumVersionRepository(
        fetchBody: () async {
          calls++;
          return realEnvelope({'math-8': calls == 1 ? 123 : 999});
        },
        connectivity: () async => true,
      );

      expect(await repo.versionForScope('math-8'), 123);
      repo.invalidate();
      expect(await repo.versionForScope('math-8'), 999);
      expect(calls, 2);
    });
  });
}
