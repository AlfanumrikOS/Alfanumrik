// "NO CROSS-SUBJECT SERVE" — the Learn content cache must never hand a student
// one subject's prose while claiming it is another's.
//
// THE BUG THIS PINS
// =================
// `getConceptV2` cached concept prose under `topic_$chapterId`, where
// `chapterId` is the chapter NUMBER (the v2 curriculum tree carries no row id,
// so `_fetchChaptersV2` sets `id: number.toString()`). Chapter numbers restart
// at 1 for every subject and grade, so math-8 ch3 and science-8 ch3 BOTH keyed
// `topic_3`.
//
// `_serveVersioned` then compared ONLY `cached.version == serverVersion`. That
// is not a scope check, and versions are NOT unique per scope: the curriculum
// watermark stamps the transaction's `now()` across every scope a bulk content
// operation touches, so two subjects sharing a version is the NORMAL state after
// a content op — not a rare coincidence. Result: open math ch3, then science
// ch3, and the student silently reads MATH prose under the science chapter, as
// `LearnServe.live`, with no chip and no error. Studying the wrong subject for
// an exam is the failure mode.
//
// TWO INDEPENDENT GUARDS (defense in depth) — each is tested in isolation:
//   (a) the cache key is scope-namespaced: `topic_<subject>_<grade>_<id>`.
//   (b) `_serveVersioned` additionally requires `cached.scope == scope`, so an
//       entry that lands on a key by any other route still cannot be served for
//       the wrong scope. This also disarms the overloaded `version: 0` sentinel
//       (a `_blindTtl` entry writes `scope: ''` / `version: 0`, which would
//       otherwise match a server `0` meaning "scope never had content").
//
// TEST SEAMS (mirroring learning_repository_serve_versioned_test.dart)
// ===================================================================
//  * `v2Client: null` makes any refetch throw `LearnFetchException` BEFORE any
//    network — so "did it serve the cache?" is decidable with zero I/O: reaching
//    a returned value proves a cache hit; a throw proves a cache miss.
//  * `_versions` is a subclass overriding `versionForScope` — the online/offline
//    seam.
//  * the SupabaseClient is a never-used stub (getConceptV2 never touches it on
//    these branches); it exists only to satisfy the constructor initialiser,
//    since `Supabase.instance` throws without a full app boot.
//  * cache entries are seeded straight into the Hive boxes so scope/version can
//    be controlled exactly (`putContent` always stamps `now`).
//
// Lane: CI `flutter test` (the REG-90 mobile gate).

import 'dart:convert';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:hive_flutter/hive_flutter.dart';
import 'package:supabase_flutter/supabase_flutter.dart' show SupabaseClient;

import 'package:alfanumrik/core/cache/cache_manager.dart';
import 'package:alfanumrik/data/models/chapter.dart' show Topic;
import 'package:alfanumrik/data/repositories/curriculum_version_repository.dart';
import 'package:alfanumrik/data/repositories/learning_repository.dart';

const String kPayloadBox = 'api_cache';
const String kContentMetaBox = 'content_cache_meta';

/// The colliding coordinate: the SAME chapter number in two different subjects
/// of the same grade.
const String kGrade = '8';
const String kChapter = '3';

/// The shared version. Two scopes carrying an EQUAL version is the normal state
/// after a bulk content operation — this is the case the old code got wrong.
const int kSharedVersion = 555;

/// Version poll stub reporting the SAME outcome for EVERY scope.
class _FlatVersionRepo extends CurriculumVersionRepository {
  _FlatVersionRepo(this.result);

  /// The common case: the poll succeeded with [version] for every scope.
  _FlatVersionRepo.known(int version) : result = VersionKnown(version);

  final VersionResult result;
  final List<String> scopesPolled = <String>[];

  @override
  Future<VersionResult> versionForScope(String scopeKey) async {
    scopesPolled.add(scopeKey);
    return result;
  }
}

/// Cached Topic payload, keyed exactly as `_topicToCacheJson` writes it.
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
    tempDir = await Directory.systemTemp.createTemp('learn_scope_collision_test');
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

  /// Seed a content entry with an exactly-controlled key, scope and version.
  Future<void> seed({
    required String key,
    required String scope,
    required int version,
    required String title,
  }) async {
    await Hive.box<String>(kPayloadBox).put(key, jsonEncode(topicJson(title)));
    await Hive.box<String>(kContentMetaBox).put(
      key,
      jsonEncode({
        'scope': scope,
        'version': version,
        'fetched_at': DateTime.now().millisecondsSinceEpoch,
      }),
    );
  }

  LearningRepository repoWith(_FlatVersionRepo versions) => LearningRepository(
        client: stubClient,
        cache: cache,
        versions: versions,
        // null → any refetch throws LearnFetchException before any network.
        v2Client: null,
      );

  Future<LearnData<Topic?>> serveConcept(
    LearningRepository repo, {
    required String subject,
  }) =>
      repo.getConceptV2(
        subjectCode: subject,
        grade: kGrade,
        chapterId: kChapter,
      );

  group('guard (a): the key itself — the collision, stated directly', () {
    // These assertions are format-INDEPENDENT: they say only "two scopes must
    // never collide", which is the actual invariant. Against the shipped
    // `topic_$chapterId` key every one of them fails, because both sides
    // evaluate to the identical string `topic_3`.

    test('two SUBJECTS never share a key for the same chapter number', () {
      expect(
        LearningRepository.contentCacheKeyForTest('math', kGrade, kChapter),
        isNot(LearningRepository.contentCacheKeyForTest(
            'science', kGrade, kChapter)),
        reason: 'math-8 ch3 and science-8 ch3 are different content',
      );
    });

    test('two GRADES never share a key for the same chapter number', () {
      expect(
        LearningRepository.contentCacheKeyForTest('math', '8', kChapter),
        isNot(LearningRepository.contentCacheKeyForTest('math', '9', kChapter)),
        reason: 'chapter numbers restart per grade as well as per subject',
      );
    });

    test('the key is stable for a given scope + chapter', () {
      expect(
        LearningRepository.contentCacheKeyForTest('math', kGrade, kChapter),
        LearningRepository.contentCacheKeyForTest('math', kGrade, kChapter),
      );
    });
  });

  group('guard (a): the cache key is scope-namespaced', () {
    test('math-8 ch3 and science-8 ch3 do NOT share a cache entry', () async {
      // Seed ONLY math's chapter 3, under the key the repository computes for
      // math-8. Pre-fix both subjects computed `topic_3` and this entry answered
      // for BOTH.
      await seed(
        key: 'topic_math_${kGrade}_$kChapter',
        scope: 'math-$kGrade',
        version: kSharedVersion,
        title: 'MATH_CH3',
      );

      final versions = _FlatVersionRepo.known(kSharedVersion);
      final repo = repoWith(versions);

      // Math reads its own entry: a cache hit (no fetch → no throw).
      final math = await serveConcept(repo, subject: 'math');
      expect(math.data, isNotNull);
      expect(math.data!.title, 'MATH_CH3');
      expect(math.serve, LearnServe.live);

      // Science, SAME chapter number, SAME version — must MISS and refetch.
      // With v2Client: null the refetch throws, which proves no serve happened.
      // Pre-fix this returned MATH_CH3 as live science content.
      await expectLater(
        serveConcept(repo, subject: 'science'),
        throwsA(isA<LearnFetchException>()),
        reason: 'science-8 ch3 must never be answered by math-8 ch3',
      );
    });

    test('the two subjects poll their own scopes', () async {
      final versions = _FlatVersionRepo.known(kSharedVersion);
      final repo = repoWith(versions);

      await seed(
        key: 'topic_math_${kGrade}_$kChapter',
        scope: 'math-$kGrade',
        version: kSharedVersion,
        title: 'MATH_CH3',
      );
      await serveConcept(repo, subject: 'math');

      expect(versions.scopesPolled, ['math-$kGrade']);
    });

    test('each subject serves its OWN prose once both are cached', () async {
      await seed(
        key: 'topic_math_${kGrade}_$kChapter',
        scope: 'math-$kGrade',
        version: kSharedVersion,
        title: 'MATH_CH3',
      );
      await seed(
        key: 'topic_science_${kGrade}_$kChapter',
        scope: 'science-$kGrade',
        version: kSharedVersion,
        title: 'SCIENCE_CH3',
      );

      final repo = repoWith(_FlatVersionRepo.known(kSharedVersion));

      expect((await serveConcept(repo, subject: 'math')).data!.title,
          'MATH_CH3');
      expect((await serveConcept(repo, subject: 'science')).data!.title,
          'SCIENCE_CH3',
          reason: 'equal versions across scopes must not blur the two entries');
    });

    test('the legacy UUID-keyed topic path is also scope-namespaced', () async {
      // `getTopicContent`'s id is a row UUID (already globally unique), but the
      // key must still carry the scope so it agrees with guard (b).
      const uuid = '11111111-2222-3333-4444-555555555555';
      await seed(
        key: 'topic_math_${kGrade}_$uuid',
        scope: 'math-$kGrade',
        version: kSharedVersion,
        title: 'LEGACY_TOPIC',
      );

      final res = await repoWith(_FlatVersionRepo.known(kSharedVersion))
          .getTopicContent(topicId: uuid, subjectCode: 'math', grade: kGrade);

      expect(res.data!.title, 'LEGACY_TOPIC');
      expect(res.serve, LearnServe.live);
    });
  });

  group('guard (b): _serveVersioned requires cached.scope == scope', () {
    test('an equal version under a DIFFERENT scope is not served', () async {
      // Independent of guard (a): seed the exact key science computes, but tag
      // it with math's scope. Version matches. Only the scope check can catch
      // this — and it must, because equal versions across scopes are normal.
      await seed(
        key: 'topic_science_${kGrade}_$kChapter',
        scope: 'math-$kGrade',
        version: kSharedVersion,
        title: 'MATH_CH3',
      );

      await expectLater(
        serveConcept(repoWith(_FlatVersionRepo.known(kSharedVersion)),
            subject: 'science'),
        throwsA(isA<LearnFetchException>()),
        reason: 'version equality alone must never authorise a serve — the '
            'entry must be proven to belong to THIS scope',
      );
    });

    test('the version-0 sentinel from a flag-OFF _blindTtl entry is not served',
        () async {
      // `_blindTtl` writes `scope: ''` / `version: 0`. The server reports 0 for
      // "this scope never had content". Without the scope check those two
      // unrelated zeroes compare equal and the blind-TTL entry is served as
      // version-anchored live content.
      await seed(
        key: 'topic_math_${kGrade}_$kChapter',
        scope: '',
        version: 0,
        title: 'BLIND_TTL_ENTRY',
      );

      await expectLater(
        serveConcept(repoWith(_FlatVersionRepo.known(0)), subject: 'math'),
        throwsA(isA<LearnFetchException>()),
        reason: 'the overloaded version-0 sentinel must not authorise a serve',
      );
    });

    test('a correctly-scoped version-0 entry IS still served', () async {
      // The mirror of the case above: 0 is a legitimate, KNOWN version. When the
      // scope agrees, the entry is current and must serve without a refetch.
      await seed(
        key: 'topic_math_${kGrade}_$kChapter',
        scope: 'math-$kGrade',
        version: 0,
        title: 'EMPTY_SCOPE_CONTENT',
      );

      final res = await serveConcept(repoWith(_FlatVersionRepo.known(0)),
          subject: 'math');

      expect(res.data!.title, 'EMPTY_SCOPE_CONTENT');
      expect(res.serve, LearnServe.live,
          reason: 'the scope check must not over-reach and force needless '
              'refetches on legitimately version-0 scopes');
    });
  });

  group('the OFFLINE branch relies on guard (a) for scope safety', () {
    // The offline branch deliberately does NOT check scope: with no version
    // evidence either way it serves on key identity + age alone. That is only
    // safe because the KEY is scope-namespaced — which makes guard (a)
    // load-bearing here, not merely belt-and-braces. (Adding a scope check here
    // would be actively wrong: the one non-matching scope reachable on a
    // namespaced key is `''`, written by the flag-OFF `_blindTtl` path, and that
    // entry IS this subject's own content — refusing it would strand offline
    // users who last read on a flag-OFF build.)

    test('offline: science does NOT pick up math ch3 as its own stale content',
        () async {
      // Pre-fix, both subjects keyed `topic_3`, so an offline science read
      // served MATH prose behind an honest-looking "as of {date}" chip — a
      // cross-subject serve the chip actively disguised.
      await seed(
        key: 'topic_math_${kGrade}_$kChapter',
        scope: 'math-$kGrade',
        version: kSharedVersion,
        title: 'MATH_CH3',
      );

      await expectLater(
        serveConcept(repoWith(_FlatVersionRepo(const VersionOffline())),
            subject: 'science'),
        throwsA(isA<LearnOfflineException>()),
        reason: 'refusing is correct: there is no SCIENCE content cached, and '
            'math ch3 is not a substitute for it',
      );
    });

    test('offline: a subject DOES serve its own cache with the "as of" chip',
        () async {
      await seed(
        key: 'topic_math_${kGrade}_$kChapter',
        scope: 'math-$kGrade',
        version: kSharedVersion,
        title: 'MATH_CH3',
      );

      final res = await serveConcept(
          repoWith(_FlatVersionRepo(const VersionOffline())),
          subject: 'math');

      expect(res.data!.title, 'MATH_CH3');
      expect(res.serve, LearnServe.staleOffline);
      expect(res.asOf, isNotNull, reason: 'the "as of {date}" chip must show');
    });

    test('offline with NO cache at all refuses', () async {
      await expectLater(
        serveConcept(repoWith(_FlatVersionRepo(const VersionOffline())),
            subject: 'science'),
        throwsA(isA<LearnOfflineException>()),
      );
    });
  });
}
