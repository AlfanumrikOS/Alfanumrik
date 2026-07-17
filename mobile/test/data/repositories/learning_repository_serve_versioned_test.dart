// "NO SILENT STALE SERVE" — the LearningRepository._serveVersioned decision
// matrix, exercised through the public getConceptV2() entry point.
//
// THE INVARIANT
// =============
// Learn content may be served to a student in exactly two states, and the state
// must always be HONEST:
//   * LearnServe.live        — fresh off the wire, or cache the server CONFIRMED
//                              is current.
//   * LearnServe.staleOffline — cache served while the version is UNKNOWN
//                               (offline OR poll failed) and still inside the
//                               7-day grace window. The UI shows an "as of {date}"
//                               chip.
// Otherwise the app must REFUSE (LearnOfflineException — genuinely offline, no
// servable cache) or SURFACE THE ERROR (LearnFetchException). The one outcome
// that must never happen is serving content the app has POSITIVE EVIDENCE is out
// of date, with no chip and no error — a silent stale serve. That is how retired
// syllabus reaches a student who then studies the wrong chapter for an exam.
//
// The sharpest edge — and this file's core subject — is the "known-newer server
// + failed refetch" case: the app KNOWS its cache is stale (server version >
// stored version) and the network then fails. It is tempting to fall back to the
// cache. It must not — that is a known-stale serve, and it is materially
// different from the offline case, where the app has NO evidence either way and
// the chip tells the truth.
//
// WHAT THIS FILE DOES *NOT* OWN (deliberate — see the dedupe note below)
// ======================================================================
// Two sibling suites landed with the fixes that reshaped this area, and they own
// their ground outright. This file does not restate it:
//   * learning_repository_poll_failure_test.dart — the poll-failed-vs-offline
//     SPLIT (online + poll failed + no servable cache → FETCH, served live, no
//     chip, stamped kVersionUnverified), the offline refusal incl. "fetchFresh is
//     never invoked", and the -1 stamp's self-limiting re-validation. It drives
//     `serveVersionedForTest` with an INJECTED fetch, so a SUCCEEDING fetch is
//     expressible there and is not attempted here.
//   * learning_repository_scope_collision_test.dart — the scope-key contract
//     (which scopes get polled), scope namespacing, and the `cached.scope ==
//     scope` guard.
// What remains here is what neither covers: the KNOWN-newer-server + FAILED
// refetch branch, "version, not age, decides", the exact-`asOf` chip honesty
// pin, the STALE_TTL boundary (±1 minute either side of 7 days) including the
// point where the two unknowns diverge, and the two config guards that keep all
// three suites honest.
//
// TEST SEAMS (deliberate)
// =======================
//  * fetch failure is induced with ZERO network by constructing the repository
//    with `v2Client: null`: `_fetchConceptV2` short-circuits to
//    `LearnFetchException('Concept v2 client unavailable')` before touching any
//    client. This makes every "refetch fails" branch deterministic and offline,
//    and it is what lets the branches below be driven through the PUBLIC api.
//  * `_FakeVersionRepo` overrides `versionForScope`, which is the whole poll
//    seam. It returns a sealed `VersionResult`: `VersionKnown(int)` (the poll
//    answered), `VersionOffline` (no network — the only outcome that may refuse),
//    or `VersionUnknownOnline` (online, poll failed — must still fetch).
//  * the SupabaseClient is a never-used stub: `getConceptV2` never touches
//    `_client` on ANY branch asserted here. It exists only because the
//    LearningRepository constructor initialiser requires a non-null client
//    (`client ?? Supabase.instance.client`) and `Supabase.instance` throws
//    without a full app boot.
//  * cache entries are seeded straight into the Hive boxes when a specific
//    `fetchedAt` is needed — `putContent` always stamps `now`, and the grace
//    window branch is precisely about age.
//
// The SUCCESSFUL refetch+replace branch is not reachable through this file's
// `v2Client: null` seam (every fetch throws by construction). It is pinned via
// the `serveVersionedForTest` injected-fetch seam in
// learning_repository_poll_failure_test.dart, and its cache half — the atomic
// purge+replace — in test/core/cache/cache_manager_test.dart.
//
// Lane: CI `flutter test` (.github/workflows/mobile-ci.yml — the REG-90 mobile
// gate).

import 'dart:convert';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:hive_flutter/hive_flutter.dart';
import 'package:supabase_flutter/supabase_flutter.dart' show SupabaseClient;

import 'package:alfanumrik/core/cache/cache_manager.dart';
import 'package:alfanumrik/core/constants/api_constants.dart';
// `Topic` is declared alongside `Chapter`; learning_repository.dart imports but
// does not re-export it, so the model import is needed for the LearnData<Topic?>
// return type below.
import 'package:alfanumrik/data/models/chapter.dart' show Topic;
import 'package:alfanumrik/data/repositories/curriculum_version_repository.dart';
import 'package:alfanumrik/data/repositories/learning_repository.dart';

const String kPayloadBox = 'api_cache';
const String kContentMetaBox = 'content_cache_meta';

const String kSubject = 'math';
const String kGrade = '9';
const String kScope = '$kSubject-$kGrade'; // must mirror the server's scope key
const String kChapterId = '3';

/// Must mirror `LearningRepository._contentCacheKey`, which is scope-namespaced:
/// `chapterId` is a chapter NUMBER and chapter numbers restart at 1 for every
/// subject+grade, so a bare `topic_<id>` key collided across scopes. The key
/// FORMAT itself is pinned (format-independently) in
/// learning_repository_scope_collision_test.dart via `contentCacheKeyForTest`;
/// here it only has to agree so the seeded entry is the one the repository reads.
const String kCacheKey = 'topic_${kSubject}_${kGrade}_$kChapterId';

/// Version poll stub. Returns one fixed [VersionResult] for every scope.
///
/// The three outcomes are NOT interchangeable: `VersionOffline` is the only one
/// permitted to refuse, and `VersionUnknownOnline` must still fetch. Collapsing
/// them (the pre-fix `int?`) was a live defect — a transient 500 rendered the
/// Offline state on a working network.
class _FakeVersionRepo extends CurriculumVersionRepository {
  _FakeVersionRepo(this.result);

  final VersionResult result;
  int calls = 0;

  @override
  Future<VersionResult> versionForScope(String scopeKey) async {
    calls++;
    return result;
  }
}

/// Cached Topic payload, keyed exactly as `_topicToCacheJson` writes it.
Map<String, dynamic> topicJson(String title) => {
      'id': kChapterId,
      'chapter_id': kChapterId,
      'title': title,
      'title_hi': null,
      'topic_order': 3,
      'concept_text': '$title body',
      'concept_text_hi': null,
      'is_completed': false,
    };

void main() {
  late Directory tempDir;
  late CacheManager cache;
  late SupabaseClient stubClient;

  setUpAll(() async {
    tempDir =
        await Directory.systemTemp.createTemp('learning_repo_versioned_test');
    Hive.init(tempDir.path);
    cache = CacheManager();
    await cache.init();

    // Never used by any branch under test (see the TEST SEAMS note above) — only
    // required to satisfy the constructor initialiser. No request is ever issued.
    stubClient = SupabaseClient('https://stub.invalid', 'stub-anon-key');
  });

  setUp(() async {
    await cache.clearAll();
  });

  tearDownAll(() async {
    await Hive.close();
    if (tempDir.existsSync()) {
      await tempDir.delete(recursive: true);
    }
  });

  /// Seed a content entry with a precisely-controlled version and fetchedAt.
  Future<void> seedCache({
    required int version,
    required String title,
    required DateTime fetchedAt,
  }) async {
    await Hive.box<String>(kPayloadBox)
        .put(kCacheKey, jsonEncode(topicJson(title)));
    await Hive.box<String>(kContentMetaBox).put(
      kCacheKey,
      jsonEncode({
        'scope': kScope,
        'version': version,
        'fetched_at': fetchedAt.millisecondsSinceEpoch,
      }),
    );
  }

  LearningRepository repoWith(_FakeVersionRepo versions) => LearningRepository(
        client: stubClient,
        cache: cache,
        versions: versions,
        // null → `_fetchConceptV2` throws LearnFetchException before any network.
        v2Client: null,
      );

  Future<LearnData<Topic?>> serve(LearningRepository repo) => repo.getConceptV2(
        subjectCode: kSubject,
        grade: kGrade,
        chapterId: kChapterId,
      );

  // The two UNKNOWN poll outcomes. They share the grace-window branch (both
  // serve a recent cache with the chip) and diverge only once there is no
  // servable cache — which is exactly what the boundary group below pins.
  const unknowns = <VersionResult>[VersionOffline(), VersionUnknownOnline()];
  String labelFor(VersionResult r) =>
      r is VersionOffline ? 'offline' : 'poll failed while online';

  group('config guards', () {
    test('version-anchored cache flag is ON by default — the matrix below tests '
        'the real path, not blind TTL', () {
      // If this ever defaults OFF, every test in this file (and in the two
      // sibling suites) silently exercises `_blindTtl` instead of
      // `_serveVersioned` and the invariant goes untested.
      // Revert switch: --dart-define=VERSION_ANCHORED_LEARN_CACHE=false.
      expect(ApiConstants.versionAnchoredLearnCache, isTrue);
    });

    test('offline grace window is 7 days', () {
      expect(ApiConstants.learnCacheStaleTtl, const Duration(days: 7));
    });
  });

  group('server version KNOWN', () {
    test('server == stored → serves the cache as live even when it is ancient '
        '(version, not age, decides)', () async {
      // The whole point of version-anchoring: near-static syllabus a year old is
      // still CURRENT if the server says the scope has not moved. The 7-day TTL
      // is an OFFLINE-only concept and must not leak into this branch.
      final versions = _FakeVersionRepo(const VersionKnown(200));
      await seedCache(
        version: 200,
        title: 'CACHED',
        fetchedAt: DateTime.now().subtract(const Duration(days: 365)),
      );

      final res = await serve(repoWith(versions));

      // Reaching this line at all proves no fetch was attempted: the repository
      // is built with v2Client: null, so any fetch throws.
      expect(res.data, isNotNull);
      expect(res.data!.title, 'CACHED');
      expect(res.serve, LearnServe.live);
      expect(res.isStaleOffline, isFalse);
      expect(res.asOf, isNull,
          reason: 'a confirmed-current cache is LIVE — no "as of" chip, however '
              'old it is');
      expect(versions.calls, 1, reason: 'exactly one version poll per read');
    });

    test('server > stored AND the refetch FAILS → throws, and does NOT serve the '
        'known-stale cache', () async {
      final versions = _FakeVersionRepo(const VersionKnown(200));
      await seedCache(version: 100, title: 'STALE', fetchedAt: DateTime.now());

      // THE CORE INVARIANT. The app has POSITIVE EVIDENCE the cache is out of
      // date (100 < 200). Falling back to it here would be a silent stale serve:
      // no chip, no error, wrong syllabus.
      await expectLater(
        serve(repoWith(versions)),
        throwsA(isA<LearnFetchException>()),
      );
    });

    test('server > stored AND the refetch FAILS → surfaces the ERROR state, not '
        'the OFFLINE state', () async {
      // The distinction is user-visible: LearnOfflineException renders the
      // dedicated Offline screen ("you're offline, here's what we have"), which
      // would be a lie — the device is online and the server has newer content.
      final versions = _FakeVersionRepo(const VersionKnown(200));
      await seedCache(version: 100, title: 'STALE', fetchedAt: DateTime.now());

      Object? thrown;
      try {
        await serve(repoWith(versions));
      } catch (e) {
        thrown = e;
      }

      expect(thrown, isNotNull,
          reason: 'a failed refetch against a known-newer server must throw, '
              'never quietly return the stale cache');
      expect(thrown, isA<LearnFetchException>());
      expect(
        thrown,
        isNot(isA<LearnOfflineException>()),
        reason: 'the device is ONLINE and the server has newer content — routing '
            'this to the Offline state would misreport why the content is missing',
      );
    });

    test('server > stored AND the refetch FAILS → the stale cache is NOT purged',
        () async {
      // Purge is atomic with a SUCCESSFUL fetch (replaceScope). Purging on
      // failure would strand an offline-bound device with nothing, losing the
      // grace-window serve it is entitled to.
      final versions = _FakeVersionRepo(const VersionKnown(200));
      await seedCache(version: 100, title: 'STALE', fetchedAt: DateTime.now());

      try {
        await serve(repoWith(versions));
        fail('expected the failed refetch to throw');
      } on LearnFetchException {
        // expected
      }

      final still = await cache.getContent<Map<String, dynamic>>(
        kCacheKey,
        (d) => d as Map<String, dynamic>,
      );
      expect(still, isNotNull,
          reason: 'a failed fetch must not destroy the cache');
      expect(still!.version, 100,
          reason: 'and must not re-stamp it as current');
    });

    test('no cache at all AND the fetch FAILS → throws the fetch error, not '
        'offline', () async {
      // The known-version twin of the poll-failed case owned by
      // learning_repository_poll_failure_test.dart: a KNOWN version with nothing
      // cached must also report a real error, never claim to be offline.
      final versions = _FakeVersionRepo(const VersionKnown(200));

      await expectLater(
        serve(repoWith(versions)),
        throwsA(isA<LearnFetchException>()),
      );
    });
  });

  group('server version UNKNOWN → the chip branch is shared by BOTH unknowns',
      () {
    for (final unknown in unknowns) {
      test('within the grace window → serves the cache with the staleOffline '
          'chip and an accurate asOf (${labelFor(unknown)})', () async {
        final fetchedAt = DateTime.now().subtract(const Duration(days: 2));
        final versions = _FakeVersionRepo(unknown);
        await seedCache(version: 100, title: 'CACHED', fetchedAt: fetchedAt);

        final res = await serve(repoWith(versions));

        expect(res.data, isNotNull);
        expect(res.data!.title, 'CACHED');
        expect(res.serve, LearnServe.staleOffline);
        expect(res.isStaleOffline, isTrue);
        expect(
          res.asOf!.millisecondsSinceEpoch,
          fetchedAt.millisecondsSinceEpoch,
          reason: 'the "content as of {date}" chip must show when the content was '
              'actually fetched — this is what makes the stale serve HONEST',
        );
      });
    }
  });

  group('the STALE_TTL boundary — and where the two unknowns diverge', () {
    // The grace window is compared with `<=`, so ±1 minute around exactly 7 days
    // is the off-by-one. Past the window the cache is no longer servable, and
    // THAT is the point at which offline and poll-failed stop agreeing: offline
    // has no network to fall back to and refuses; online merely lost the ability
    // to SKIP the network, so it must fetch. A cache degrades to NO CACHE, never
    // to NO CONTENT.

    for (final unknown in unknowns) {
      test('just INSIDE the grace window → still served with the chip '
          '(${labelFor(unknown)})', () async {
        final versions = _FakeVersionRepo(unknown);
        await seedCache(
          version: 100,
          title: 'CACHED',
          fetchedAt: DateTime.now()
              .subtract(const Duration(days: 7))
              .add(const Duration(minutes: 1)),
        );

        final res = await serve(repoWith(versions));
        expect(res.serve, LearnServe.staleOffline);
        expect(res.data!.title, 'CACHED');
      });
    }

    test('just PAST the grace window + OFFLINE → REFUSES with '
        'LearnOfflineException', () async {
      final versions = _FakeVersionRepo(const VersionOffline());
      await seedCache(
        version: 100,
        title: 'TOO OLD',
        fetchedAt: DateTime.now()
            .subtract(const Duration(days: 7))
            .subtract(const Duration(minutes: 1)),
      );

      // Genuinely offline: past the window the app refuses rather than serving
      // content it can no longer vouch for — never a silent stale serve, never a
      // static fallback. There is no network to fetch from.
      await expectLater(
        serve(repoWith(versions)),
        throwsA(isA<LearnOfflineException>()),
      );
    });

    test('just PAST the grace window + ONLINE-poll-failed → FETCHES instead of '
        'refusing', () async {
      // Same age, same unservable cache, ONE difference: the device is online.
      // The pre-split code refused here (poll failure was conflated with being
      // offline) and showed "You're offline" on a working network. Now the
      // unservable cache means the same thing as no cache: fetch.
      //
      // The fetch is what throws (v2Client: null), which is precisely the proof
      // that the fetch was ATTEMPTED rather than short-circuited into a refusal.
      final versions = _FakeVersionRepo(const VersionUnknownOnline());
      await seedCache(
        version: 100,
        title: 'TOO OLD',
        fetchedAt: DateTime.now()
            .subtract(const Duration(days: 7))
            .subtract(const Duration(minutes: 1)),
      );

      Object? thrown;
      try {
        await serve(repoWith(versions));
      } catch (e) {
        thrown = e;
      }

      expect(thrown, isA<LearnFetchException>(),
          reason: 'an online device with an expired cache must attempt the '
              'content fetch and report a real error');
      expect(
        thrown,
        isNot(isA<LearnOfflineException>()),
        reason: 'the poll failing is not the device being offline — refusing '
            'here would show the Offline state on a working network',
      );
    });
  });
}
