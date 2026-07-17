// "A CACHE MUST DEGRADE TO NO CACHE, NEVER TO NO CONTENT" — a failed version
// poll on an ONLINE device must not render the Offline state on Learn.
//
// THE BUG THIS PINS
// =================
// `versionForScope` returned `null` for BOTH "offline" AND "the poll failed",
// and `_serveVersioned` treated the two identically:
//
//     final serverVersion = await _versions.versionForScope(scope);
//     if (serverVersion != null) { ...serve-or-fetch... }
//     if (cachedWithinStaleTtl) { ...chip... }
//     throw const LearnOfflineException();   // ← both unknowns land here
//
// So a transient 500 / timeout / malformed body from the version endpoint — on a
// FULLY ONLINE device with a working network and no cache — threw
// LearnOfflineException and the student was shown "You're offline". They were
// not offline. The content was one reachable HTTP call away.
//
// WHY FETCHING IS THE CORRECT FAILURE DIRECTION (and why this is a plain bug,
// not a policy change): `serverVersion` is NEVER a freshness gate — it is only a
// cache stamp. The known-version branch serves whatever `fetchFresh()` returns
// and never validates that payload against `serverVersion`. The version's ONLY
// question is "can I skip the network?". When the answer is unknown, the correct
// fail direction is DON'T SKIP THE NETWORK → fetch. Fetching fresh cannot
// violate "no silent stale serve": you cannot serve stale content by declining
// to serve the cache. Offline is the one unknown a fetch cannot fix — there is
// no network — so it alone still refuses, and it must NOT call fetchFresh(),
// which would reintroduce the very Dio retry/backoff wait the connectivity
// short-circuit exists to eliminate.
//
// WHAT IS DELIBERATELY UNCHANGED
// ==============================
// Cache inside STALE_TTL still serves with the "as of {date}" chip for BOTH
// unknowns — the invariant explicitly blesses the chipped serve on poll-failure
// too. Only the no-servable-cache tail splits.
//
// THE -1 STAMP
// ============
// The poll-failed fetch is written with `version: kVersionUnverified` (-1) via
// putContent. Server scope values are unix-epoch seconds floored by
// `GREATEST(..., 0)`, so no server value is EVER negative → `cached.version ==
// serverVersion` can never match a -1 entry → the next successful poll is always
// forced to re-validate it. That is what stops an unverified write from later
// being served as version-confirmed `live`. `putContent` (not `replaceScope`) is
// used because purging a scope's siblings needs version evidence to justify, and
// a failed poll has none.
//
// TEST SEAMS
// ==========
//  * `serveVersionedForTest` drives the decision core directly with an injected
//    `fetchFresh`, so a SUCCEEDING fetch is expressible (with `v2Client: null`
//    every real fetch throws, which can only ever prove a refusal).
//  * `_FixedVersionRepo` overrides `versionForScope` — the three-way poll seam.
//  * the SupabaseClient is a never-used stub; it exists only to satisfy the
//    constructor initialiser, since `Supabase.instance` throws without an app
//    boot.
//  * cache entries are seeded straight into the Hive boxes so scope / version /
//    fetchedAt are controlled exactly (`putContent` always stamps `now`).
//
// Lane: CI `flutter test` (the REG-90 mobile gate).

import 'dart:convert';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:hive_flutter/hive_flutter.dart';
import 'package:supabase_flutter/supabase_flutter.dart' show SupabaseClient;

import 'package:alfanumrik/core/cache/cache_manager.dart';
import 'package:alfanumrik/core/constants/api_constants.dart';
import 'package:alfanumrik/data/models/chapter.dart' show Topic;
import 'package:alfanumrik/data/repositories/curriculum_version_repository.dart';
import 'package:alfanumrik/data/repositories/learning_repository.dart';

const String kPayloadBox = 'api_cache';
const String kContentMetaBox = 'content_cache_meta';

const String kSubject = 'math';
const String kGrade = '8';
const String kChapter = '3';
const String kScope = '$kSubject-$kGrade';
const String kKey = 'topic_${kSubject}_${kGrade}_$kChapter';

/// Version poll stub returning one fixed outcome for every scope.
class _FixedVersionRepo extends CurriculumVersionRepository {
  _FixedVersionRepo(this.result);

  final VersionResult result;

  @override
  Future<VersionResult> versionForScope(String scopeKey) async => result;
}

/// Drives the decision core with a counting, injectable fetch, so that a
/// SUCCEEDING fetch is expressible and "did it hit the network?" is decidable.
class _Driver {
  _Driver({
    required this.repo,
    required this.freshTitle,
    this.fetchThrows = false,
    this.key = kKey,
  });

  final LearningRepository repo;
  final String freshTitle;
  final bool fetchThrows;
  final String key;

  /// How many times `fetchFresh` was invoked. `0` proves the network was never
  /// touched — the load-bearing assertion on the offline branch.
  int calls = 0;

  Future<LearnData<Topic?>> serve() => repo.serveVersionedForTest<Topic?>(
        scope: kScope,
        cacheKey: key,
        decodeCache: (dynamic d) => Topic.fromJson(d as Map<String, dynamic>),
        fetchFresh: () async {
          calls++;
          if (fetchThrows) {
            throw const LearnFetchException('Failed to load content: boom');
          }
          final json = topicJson(freshTitle);
          return (Topic.fromJson(json), json);
        },
      );
}

Map<String, dynamic> topicJson(String title) => {
      'id': kChapter,
      'chapter_id': kChapter,
      'title': title,
      'title_hi': null,
      'topic_order': 3,
      'concept_text': '$title concept body',
      'concept_text_hi': null,
      'is_completed': false,
    };

void main() {
  late Directory tempDir;
  late CacheManager cache;
  late SupabaseClient stubClient;

  setUpAll(() async {
    tempDir = await Directory.systemTemp.createTemp('learn_poll_failure_test');
    Hive.init(tempDir.path);
    cache = CacheManager();
    await cache.init();
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

  /// Seed a content entry with an exactly-controlled key, scope, version and age.
  Future<void> seed({
    required String key,
    required String scope,
    required int version,
    required String title,
    Duration age = Duration.zero,
  }) async {
    await Hive.box<String>(kPayloadBox).put(key, jsonEncode(topicJson(title)));
    await Hive.box<String>(kContentMetaBox).put(
      key,
      jsonEncode({
        'scope': scope,
        'version': version,
        'fetched_at':
            DateTime.now().subtract(age).millisecondsSinceEpoch,
      }),
    );
  }

  Map<String, dynamic>? metaFor(String key) {
    final raw = Hive.box<String>(kContentMetaBox).get(key);
    if (raw == null) return null;
    return jsonDecode(raw) as Map<String, dynamic>;
  }

  LearningRepository repoWith(VersionResult result) => LearningRepository(
        client: stubClient,
        cache: cache,
        versions: _FixedVersionRepo(result),
        v2Client: null,
      );

  _Driver driver(
    VersionResult result, {
    required String freshTitle,
    bool fetchThrows = false,
  }) =>
      _Driver(
        repo: repoWith(result),
        freshTitle: freshTitle,
        fetchThrows: fetchThrows,
      );

  group('online + poll failed + NO cache → FETCH, never the Offline state', () {
    test('serves the freshly fetched content as live', () async {
      // THE HEADLINE REGRESSION. Pre-fix: versionForScope returned null for a
      // failed poll exactly as it did for offline, the null tail refused, and
      // this threw LearnOfflineException on a device with a working network.
      final d = driver(const VersionUnknownOnline(), freshTitle: 'FRESH');

      final res = await d.serve();

      expect(res.data, isNotNull);
      expect(res.data!.title, 'FRESH');
      expect(d.calls, 1,
          reason: 'the version is unknown, so the network must NOT be skipped');
    });

    test('the serve is live with NO chip — it is not stale', () async {
      // It came off the wire this instant. Chipping it "as of {date}" would be a
      // lie, and staleOffline is what paints the offline affordance.
      final d = driver(const VersionUnknownOnline(), freshTitle: 'FRESH');

      final res = await d.serve();

      expect(res.serve, LearnServe.live);
      expect(res.isStaleOffline, isFalse);
      expect(res.asOf, isNull, reason: 'no chip: the content is not stale');
    });

    test('the write is stamped kVersionUnverified and scoped to this scope',
        () async {
      await driver(const VersionUnknownOnline(), freshTitle: 'FRESH').serve();

      final meta = metaFor(kKey);
      expect(meta, isNotNull, reason: 'the fetch must be cached');
      expect(meta!['version'], kVersionUnverified,
          reason: 'no version evidence → the entry must be marked unverified');
      expect(meta['scope'], kScope,
          reason: 'scopeKey keeps the scope guard and the offline branch sound');
    });

    test('uses putContent, NOT replaceScope — siblings in the scope survive',
        () async {
      // replaceScope purges every OTHER entry in the scope. Purging is an act
      // that needs version evidence to justify, and a failed poll has none: a
      // server blip must not be able to destroy a user's offline cache.
      await seed(
        key: 'topic_${kSubject}_${kGrade}_9',
        scope: kScope,
        version: 555,
        title: 'SIBLING_CH9',
      );

      await driver(const VersionUnknownOnline(), freshTitle: 'FRESH').serve();

      expect(metaFor('topic_${kSubject}_${kGrade}_9'), isNotNull,
          reason: 'a failed poll must never purge the scope');
      expect(
        Hive.box<String>(kPayloadBox).get('topic_${kSubject}_${kGrade}_9'),
        isNotNull,
        reason: 'the sibling payload must survive too',
      );
    });
  });

  group('online + poll failed + EXPIRED cache → the fetch wins', () {
    test('content older than STALE_TTL is refetched, not chipped', () async {
      // Outside the grace window the cache is not servable, so the same rule
      // applies as with no cache at all: fetch rather than refuse.
      await seed(
        key: kKey,
        scope: kScope,
        version: 555,
        title: 'ANCIENT',
        age: ApiConstants.learnCacheStaleTtl + const Duration(days: 1),
      );

      final d = driver(const VersionUnknownOnline(), freshTitle: 'FRESH');
      final res = await d.serve();

      expect(res.data!.title, 'FRESH', reason: 'the fetch must win');
      expect(res.serve, LearnServe.live);
      expect(d.calls, 1);
    });

    test('cache INSIDE STALE_TTL still wins with the chip (unchanged)', () async {
      // The deliberately-unchanged half: a chipped serve of this scope's own
      // recent content is the honest answer when there is no version evidence,
      // and the invariant blesses it on poll-failure too. No fetch.
      await seed(
        key: kKey,
        scope: kScope,
        version: 555,
        title: 'RECENT',
        age: const Duration(hours: 1),
      );

      final d = driver(const VersionUnknownOnline(), freshTitle: 'FRESH');
      final res = await d.serve();

      expect(res.data!.title, 'RECENT');
      expect(res.serve, LearnServe.staleOffline);
      expect(res.asOf, isNotNull, reason: 'the "as of {date}" chip must show');
      expect(d.calls, 0, reason: 'a servable cache still spends zero data');
    });
  });

  group('the fetch ALSO fails → Error state, never the Offline state', () {
    test('LearnFetchException propagates — not LearnOfflineException', () async {
      // The user gets a real message in the Error state. Claiming "offline" on a
      // device that is online is the lie this whole change removes.
      final d = driver(const VersionUnknownOnline(),
          freshTitle: 'never', fetchThrows: true);

      Object? thrown;
      try {
        await d.serve();
      } catch (e) {
        thrown = e;
      }

      expect(thrown, isA<LearnFetchException>());
      expect(thrown, isNot(isA<LearnOfflineException>()),
          reason: 'the network was reachable and was tried — the failure is an '
              'Error with a real message, not an Offline state');
      expect(d.calls, 1, reason: 'the fetch must actually have been attempted');
    });

    test('via the PUBLIC api with a REAL failing poll on an ONLINE device',
        () async {
      // The end-to-end statement of the defect, driven through getConceptV2 with
      // a real CurriculumVersionRepository whose transport throws (a 500 /
      // timeout) while connectivity reports ONLINE. v2Client: null makes the
      // subsequent fetch throw LearnFetchException.
      //
      // This is the one assertion that is expressible against the pre-fix code
      // WITHOUT the new types, and against it this test goes RED: the poll's
      // null collapsed into the offline tail and LearnOfflineException was
      // thrown instead — the Offline screen, on a working network.
      final repo = LearningRepository(
        client: stubClient,
        cache: cache,
        versions: CurriculumVersionRepository(
          fetchBody: () async => throw Exception('500 Internal Server Error'),
          connectivity: () async => true,
        ),
        v2Client: null,
      );

      await expectLater(
        repo.getConceptV2(
          subjectCode: kSubject,
          grade: kGrade,
          chapterId: kChapter,
        ),
        throwsA(isA<LearnFetchException>()),
        reason: 'an online device whose version poll 500s must attempt the '
            'content fetch and report a real error — never claim to be offline',
      );
    });
  });

  group('OFFLINE + no servable cache → still refuses (unchanged)', () {
    test('throws LearnOfflineException AND never invokes fetchFresh', () async {
      // The refusal must be INSTANT. Calling fetchFresh() here would drag the
      // user through Dio's retry/backoff before failing anyway — exactly the
      // wait the connectivity short-circuit exists to eliminate. This is why
      // VersionOffline is a distinct outcome and not just "unknown".
      final d = driver(const VersionOffline(), freshTitle: 'FRESH');

      await expectLater(d.serve(), throwsA(isA<LearnOfflineException>()));
      expect(d.calls, 0,
          reason: 'offline must short-circuit BEFORE any network attempt');
    });

    test('cache older than STALE_TTL is also refused, with no fetch', () async {
      await seed(
        key: kKey,
        scope: kScope,
        version: 555,
        title: 'ANCIENT',
        age: ApiConstants.learnCacheStaleTtl + const Duration(days: 1),
      );

      final d = driver(const VersionOffline(), freshTitle: 'FRESH');

      await expectLater(d.serve(), throwsA(isA<LearnOfflineException>()));
      expect(d.calls, 0);
    });
  });

  group('the kVersionUnverified (-1) stamp is self-limiting', () {
    test('kVersionUnverified is negative — the whole safety rests on this', () {
      // Server scope values are unix-epoch seconds floored by GREATEST(..., 0),
      // so no server value is ever negative. A negative stamp is therefore
      // unmatchable by construction. If this ever became >= 0 it could collide
      // with a real server version and an unverified entry would be served as
      // version-confirmed live content.
      expect(kVersionUnverified, lessThan(0));
    });

    test('a -1 entry NEVER serves as live on a later successful poll', () async {
      // The re-validation guarantee. Poll with 0 — the LOWEST value the server
      // can ever report — and the -1 entry must still lose.
      await seed(
        key: kKey,
        scope: kScope,
        version: kVersionUnverified,
        title: 'UNVERIFIED',
      );

      final d = driver(const VersionKnown(0), freshTitle: 'REVALIDATED');
      final res = await d.serve();

      expect(res.data!.title, 'REVALIDATED',
          reason: 'an unverified entry must be re-validated, never served as '
              'version-confirmed content');
      expect(d.calls, 1);
      expect(res.serve, LearnServe.live);
    });

    test('a -1 entry loses to a normal (epoch) server version too', () async {
      await seed(
        key: kKey,
        scope: kScope,
        version: kVersionUnverified,
        title: 'UNVERIFIED',
      );

      final d = driver(const VersionKnown(1784000000), freshTitle: 'REVALIDATED');
      final res = await d.serve();

      expect(res.data!.title, 'REVALIDATED');
      expect(d.calls, 1);
    });

    test('re-validation REPLACES the -1 stamp with the real server version',
        () async {
      // Once evidence exists, the entry becomes a normal version-anchored entry
      // and can serve instantly thereafter — the unverified state is transient.
      await seed(
        key: kKey,
        scope: kScope,
        version: kVersionUnverified,
        title: 'UNVERIFIED',
      );

      await driver(const VersionKnown(1784000000), freshTitle: 'REVALIDATED')
          .serve();

      expect(metaFor(kKey)!['version'], 1784000000);
    });

    test('a -1 entry IS still served offline within STALE_TTL, with the chip',
        () async {
      // The mirror of the rule above. The offline branch decides on age + key
      // identity, not version equality — and an unverified entry is still this
      // scope's own real content. Refusing it offline would strand the user for
      // no benefit, which is the opposite of what this change is for.
      await seed(
        key: kKey,
        scope: kScope,
        version: kVersionUnverified,
        title: 'UNVERIFIED',
        age: const Duration(hours: 2),
      );

      final d = driver(const VersionOffline(), freshTitle: 'FRESH');
      final res = await d.serve();

      expect(res.data!.title, 'UNVERIFIED');
      expect(res.serve, LearnServe.staleOffline);
      expect(res.asOf, isNotNull, reason: 'the "as of {date}" chip must show');
      expect(d.calls, 0);
    });

    test('a -1 entry is likewise served on a LATER failed poll within TTL',
        () async {
      await seed(
        key: kKey,
        scope: kScope,
        version: kVersionUnverified,
        title: 'UNVERIFIED',
        age: const Duration(hours: 2),
      );

      final d = driver(const VersionUnknownOnline(), freshTitle: 'FRESH');
      final res = await d.serve();

      expect(res.data!.title, 'UNVERIFIED');
      expect(res.serve, LearnServe.staleOffline);
      expect(d.calls, 0, reason: 'a servable cache still spends zero data');
    });
  });
}
