// Unit tests for CacheManager's VERSION-ANCHORED content surface — the
// substrate the "no silent stale serve" invariant rests on.
//
// WHY THIS MATTERS
// ================
// LearningRepository decides "serve cache vs refetch" by comparing the server's
// per-scope curriculum version against the version STAMPED on the cached entry.
// That decision is only sound if the stamp never lies. `replaceScope` is where
// it could: it writes a fresh entry and purges the scope's stale siblings, and a
// process kill can land between those two steps. The invariant is:
//
//   at NO point during (or after) replaceScope may an entry carry the NEW
//   version while holding OLD-version content.
//
// If that ever broke, a device would compare stamp == server, conclude "my cache
// is current", and serve retired syllabus with NO network and NO offline chip —
// a silent stale serve. The ordering (write-new FIRST, purge-siblings SECOND) is
// what guarantees it: siblings are only ever DELETED, never re-stamped, so any
// survivor of a kill still carries its OLD version and re-triggers its own
// refetch on the next read.
//
// Uses a temp-dir Hive so the real box behaviour (persistence, delete, watch
// ordering) is exercised without a Flutter binding — same idiom as
// offline_quiz_store_test.dart. No Supabase, no network.
//
// Lane: CI `flutter test` (.github/workflows/mobile-ci.yml — the REG-90 mobile
// gate).

import 'dart:convert';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:hive_flutter/hive_flutter.dart';

import 'package:alfanumrik/core/cache/cache_manager.dart';

/// Box names mirrored from CacheManager's private constants. They are part of
/// the on-disk contract (renaming one silently orphans every existing install's
/// cache), so pinning the literals here is deliberate.
const String kPayloadBox = 'api_cache';
const String kContentMetaBox = 'content_cache_meta';

const String kScope = 'math-9';
const String kOtherScope = 'science-9';

/// Decoders for the two payload shapes the content surface stores.
List<dynamic> _asList(dynamic d) => d as List<dynamic>;
Map<String, dynamic> _asMap(dynamic d) => d as Map<String, dynamic>;

void main() {
  late Directory tempDir;
  late CacheManager cache;

  setUpAll(() async {
    tempDir = await Directory.systemTemp.createTemp('cache_manager_test');
    Hive.init(tempDir.path);
    // CacheManager is a singleton holding its Box handles, so the boxes are
    // opened ONCE here and the data is reset per-test via clearAll(). Calling
    // Hive.deleteFromDisk() between tests would close the boxes underneath the
    // still-live singleton and every later write would throw.
    cache = CacheManager();
    await cache.init();
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

  group('CacheManager.putContent / getContent (version stamp round-trip)', () {
    test('round-trips the payload, scope and version', () async {
      await cache.putContent(
        key: 'chapters_math_9',
        scopeKey: kScope,
        data: const [
          {'id': '1', 'title': 'Number Systems'}
        ],
        version: 1752750000,
      );

      final entry = await cache.getContent<List<dynamic>>('chapters_math_9', _asList);

      expect(entry, isNotNull);
      expect(entry!.scope, kScope);
      expect(entry.version, 1752750000);
      expect(entry.data, hasLength(1));
      expect((entry.data.first as Map)['title'], 'Number Systems');
    });

    test('stamps fetchedAt at write time so the caller can apply the offline TTL',
        () async {
      final before = DateTime.now();
      await cache.putContent(
        key: 'topic_1',
        scopeKey: kScope,
        data: const {'id': '1'},
        version: 5,
      );
      final after = DateTime.now();

      final entry = await cache.getContent<Map<String, dynamic>>('topic_1', _asMap);

      expect(entry, isNotNull);
      // Truncated to milliseconds on the way through Hive, so compare inclusively
      // against a 1ms-tolerant window rather than asserting strict ordering.
      expect(
        entry!.fetchedAt.millisecondsSinceEpoch,
        greaterThanOrEqualTo(before.millisecondsSinceEpoch - 1),
      );
      expect(
        entry.fetchedAt.millisecondsSinceEpoch,
        lessThanOrEqualTo(after.millisecondsSinceEpoch + 1),
      );
    });

    test('applies NO TTL — freshness is the caller\'s policy, not the cache\'s',
        () async {
      // The volatile surface expires after 5 minutes; the content surface must
      // NOT, or a cold-start device past the TTL would lose content it is
      // entitled to serve within the 7-day offline grace window.
      final meta = Hive.box<String>(kContentMetaBox);
      await Hive.box<String>(kPayloadBox).put('topic_old', jsonEncode({'id': 'old'}));
      await meta.put(
        'topic_old',
        jsonEncode({
          'scope': kScope,
          'version': 7,
          'fetched_at': DateTime.now()
              .subtract(const Duration(days: 365))
              .millisecondsSinceEpoch,
        }),
      );

      final entry = await cache.getContent<Map<String, dynamic>>('topic_old', _asMap);

      expect(entry, isNotNull, reason: 'the content surface must not self-expire');
      expect(entry!.version, 7);
    });

    test('returns null for a missing key', () async {
      expect(await cache.getContent<Map<String, dynamic>>('nope', _asMap), isNull);
    });

    test('drops a corrupt entry and returns null so a fresh fetch repopulates',
        () async {
      await Hive.box<String>(kPayloadBox).put('topic_bad', 'not-json{{{');
      await Hive.box<String>(kContentMetaBox).put(
        'topic_bad',
        jsonEncode({'scope': kScope, 'version': 1, 'fetched_at': 0}),
      );

      expect(await cache.getContent<Map<String, dynamic>>('topic_bad', _asMap), isNull);
      // Both halves dropped — a half-dead entry must not linger.
      expect(Hive.box<String>(kPayloadBox).get('topic_bad'), isNull);
      expect(Hive.box<String>(kContentMetaBox).get('topic_bad'), isNull);
    });
  });

  group('CacheManager.replaceScope (atomic purge+replace)', () {
    /// Seed a scope holding two entries at [version].
    Future<void> seedScope({int version = 100}) async {
      await cache.putContent(
        key: 'chapters_math_9',
        scopeKey: kScope,
        data: const [
          {'id': '1', 'title': 'OLD chapter'}
        ],
        version: version,
      );
      await cache.putContent(
        key: 'topic_5',
        scopeKey: kScope,
        data: const {'id': '5', 'title': 'OLD topic'},
        version: version,
      );
      await cache.putContent(
        key: 'topic_6',
        scopeKey: kScope,
        data: const {'id': '6', 'title': 'OLD topic'},
        version: version,
      );
    }

    test('writes the fresh entry and purges every stale sibling in the scope',
        () async {
      await seedScope();

      await cache.replaceScope(
        scopeKey: kScope,
        key: 'chapters_math_9',
        data: const [
          {'id': '1', 'title': 'NEW chapter'}
        ],
        version: 200,
      );

      final fresh = await cache.getContent<List<dynamic>>('chapters_math_9', _asList);
      expect(fresh, isNotNull);
      expect(fresh!.version, 200);
      expect((fresh.data.first as Map)['title'], 'NEW chapter');

      // Stale siblings from the OLD version are gone — not left behind to be
      // mixed with the new syllabus.
      expect(await cache.getContent<Map<String, dynamic>>('topic_5', _asMap), isNull);
      expect(await cache.getContent<Map<String, dynamic>>('topic_6', _asMap), isNull);
    });

    test('leaves entries in OTHER scopes untouched', () async {
      await seedScope();
      await cache.putContent(
        key: 'chapters_science_9',
        scopeKey: kOtherScope,
        data: const [
          {'id': '9', 'title': 'Science'}
        ],
        version: 100,
      );

      await cache.replaceScope(
        scopeKey: kScope,
        key: 'chapters_math_9',
        data: const [
          {'id': '1', 'title': 'NEW chapter'}
        ],
        version: 200,
      );

      final other = await cache.getContent<List<dynamic>>('chapters_science_9', _asList);
      expect(other, isNotNull, reason: 'purge is scoped — science-9 is a different scope');
      expect(other!.version, 100);
    });

    test('ORDER: writes the new entry BEFORE deleting any sibling', () async {
      await seedScope();

      // Observe the real write ordering through Hive's box event stream. This is
      // the mechanism that makes a kill mid-batch safe: content for `key` is
      // never absent, and siblings are only ever removed AFTER the fresh entry
      // is durable.
      final box = Hive.box<String>(kPayloadBox);
      final events = <String>[];
      final sub = box.watch().listen((e) {
        events.add('${e.deleted ? 'del' : 'put'}:${e.key}');
      });

      await cache.replaceScope(
        scopeKey: kScope,
        key: 'chapters_math_9',
        data: const [
          {'id': '1', 'title': 'NEW chapter'}
        ],
        version: 200,
      );

      // Let the broadcast stream drain before asserting.
      await Future<void>.delayed(const Duration(milliseconds: 50));
      await sub.cancel();

      expect(events, isNotEmpty);
      expect(
        events.first,
        'put:chapters_math_9',
        reason: 'the fresh entry must be established FIRST — a purge-first '
            'implementation can be killed leaving the scope with no content at all',
      );
      expect(
        events.sublist(1),
        everyElement(startsWith('del:')),
        reason: 'after the write, replaceScope may only DELETE siblings — '
            're-stamping a sibling is how old content starts masquerading as current',
      );
      expect(events.sublist(1), containsAll(<String>['del:topic_5', 'del:topic_6']));
      expect(
        events.where((e) => e == 'del:chapters_math_9'),
        isEmpty,
        reason: 'replaceScope must never delete the entry it just wrote',
      );
    });

    test('KILL MID-BATCH: a surviving sibling still carries the OLD version '
        '(never masquerades as current)', () async {
      await seedScope(version: 100);

      // Reproduce the exact on-disk state at the instant a kill lands between
      // replaceScope's step 1 (write fresh entry) and step 2 (purge siblings):
      // the fresh entry is durable, the siblings have not been touched yet.
      await cache.putContent(
        key: 'chapters_math_9',
        scopeKey: kScope,
        data: const [
          {'id': '1', 'title': 'NEW chapter'}
        ],
        version: 200,
      );

      // THE INVARIANT: the un-purged siblings still hold version 100. On the next
      // read the repository compares 100 != server's 200 → it refetches that
      // sibling. It does NOT serve the old topic as if it were current.
      for (final key in const ['topic_5', 'topic_6']) {
        final sibling = await cache.getContent<Map<String, dynamic>>(key, _asMap);
        expect(sibling, isNotNull, reason: 'a kill must not lose the sibling silently');
        expect(
          sibling!.version,
          100,
          reason: '$key survived the kill still stamped with the OLD version — '
              'that is what forces its own refetch',
        );
        expect(
          sibling.version,
          isNot(200),
          reason: '$key must NEVER carry the new version while holding old content '
              '(a silent stale serve)',
        );
        expect((sibling.data)['title'], 'OLD topic');
      }
    });

    test('after replaceScope, the ONLY entry stamped with the new version is the '
        'one whose payload was rewritten', () async {
      await seedScope(version: 100);

      await cache.replaceScope(
        scopeKey: kScope,
        key: 'chapters_math_9',
        data: const [
          {'id': '1', 'title': 'NEW chapter'}
        ],
        version: 200,
      );

      // Sweep the whole metadata box: no entry anywhere may claim version 200
      // except the one we actually rewrote.
      final meta = Hive.box<String>(kContentMetaBox);
      final stampedNew = <String>[];
      for (final k in meta.keys) {
        final raw = meta.get(k);
        if (raw == null) continue;
        final m = jsonDecode(raw) as Map<String, dynamic>;
        if ((m['version'] as num?)?.toInt() == 200) stampedNew.add('$k');
      }

      expect(stampedNew, equals(<String>['chapters_math_9']));
    });

    test('works on an empty scope (first-ever fetch just writes)', () async {
      await cache.replaceScope(
        scopeKey: kScope,
        key: 'chapters_math_9',
        data: const [
          {'id': '1', 'title': 'First'}
        ],
        version: 200,
      );

      final fresh = await cache.getContent<List<dynamic>>('chapters_math_9', _asList);
      expect(fresh, isNotNull);
      expect(fresh!.version, 200);
    });
  });

  group('CacheManager.purgeScope', () {
    test('removes every entry tagged with the scope, payload and metadata', () async {
      await cache.putContent(
          key: 'chapters_math_9', scopeKey: kScope, data: const [], version: 1);
      await cache.putContent(
          key: 'topic_5', scopeKey: kScope, data: const {'id': '5'}, version: 1);
      await cache.putContent(
          key: 'chapters_science_9', scopeKey: kOtherScope, data: const [], version: 1);

      await cache.purgeScope(kScope);

      expect(Hive.box<String>(kPayloadBox).get('chapters_math_9'), isNull);
      expect(Hive.box<String>(kContentMetaBox).get('chapters_math_9'), isNull);
      expect(Hive.box<String>(kPayloadBox).get('topic_5'), isNull);
      expect(Hive.box<String>(kContentMetaBox).get('topic_5'), isNull);
      // Other scope untouched.
      expect(Hive.box<String>(kPayloadBox).get('chapters_science_9'), isNotNull);
    });

    test('sweeps entries whose metadata is corrupt (fail-safe cleanup)', () async {
      await Hive.box<String>(kPayloadBox).put('topic_corrupt', jsonEncode({'id': 'x'}));
      await Hive.box<String>(kContentMetaBox).put('topic_corrupt', 'not-json{{{');

      await cache.purgeScope(kScope);

      // Corrupt metadata can't be attributed to a scope, so it is dropped rather
      // than left to rot with an unknowable version.
      expect(Hive.box<String>(kPayloadBox).get('topic_corrupt'), isNull);
      expect(Hive.box<String>(kContentMetaBox).get('topic_corrupt'), isNull);
    });
  });
}
