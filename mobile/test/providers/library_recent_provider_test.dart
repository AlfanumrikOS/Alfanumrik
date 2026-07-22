// Tests for the pure helpers in library_recent_provider.dart (Phase 6
// mobile — Library "recently explored" strip). These exercise
// decode/encode/upsert/visible logic without touching SharedPreferences.
library;

import 'package:flutter_test/flutter_test.dart';
import 'package:alfanumrik/providers/library_recent_provider.dart';

RecentLibraryChapter _chapter(
  String subjectCode,
  String chapterId, {
  int viewedAtMillis = 0,
}) =>
    RecentLibraryChapter(
      subjectCode: subjectCode,
      subjectName: subjectCode,
      chapterId: chapterId,
      chapterNumber: 1,
      chapterTitle: 'Chapter $chapterId',
      viewedAtMillis: viewedAtMillis,
    );

void main() {
  group('decode/encodeRecentChapters round-trip', () {
    test('encodes then decodes back to an equivalent list', () {
      final items = [
        _chapter('math', 'c1', viewedAtMillis: 100),
        _chapter('science', 'c2', viewedAtMillis: 200),
      ];
      final encoded = encodeRecentChapters(items);
      final decoded = decodeRecentChapters(encoded);

      expect(decoded, hasLength(2));
      expect(decoded[0].subjectCode, 'math');
      expect(decoded[0].chapterId, 'c1');
      expect(decoded[1].subjectCode, 'science');
    });

    test('null/empty input decodes to an empty list', () {
      expect(decodeRecentChapters(null), isEmpty);
      expect(decodeRecentChapters(''), isEmpty);
    });

    test('malformed JSON decodes to an empty list, never throws', () {
      expect(decodeRecentChapters('not-json{{{'), isEmpty);
      expect(decodeRecentChapters('"just a string"'), isEmpty);
    });
  });

  group('upsertRecentChapter', () {
    test('inserts a new entry at the front', () {
      final existing = [_chapter('math', 'c1', viewedAtMillis: 100)];
      final updated =
          upsertRecentChapter(existing, _chapter('science', 'c2', viewedAtMillis: 200));
      expect(updated.map((e) => e.chapterId), ['c2', 'c1']);
    });

    test('de-duplicates by (subjectCode, chapterId), moving it to front', () {
      final existing = [
        _chapter('science', 'c2', viewedAtMillis: 200),
        _chapter('math', 'c1', viewedAtMillis: 100),
      ];
      final updated =
          upsertRecentChapter(existing, _chapter('math', 'c1', viewedAtMillis: 999));
      expect(updated, hasLength(2));
      expect(updated.first.chapterId, 'c1');
      expect(updated.first.viewedAtMillis, 999);
    });

    test('caps stored entries at 10', () {
      final existing = List.generate(
        10,
        (i) => _chapter('math', 'c$i', viewedAtMillis: i),
      );
      final updated = upsertRecentChapter(existing, _chapter('science', 'new', viewedAtMillis: 999));
      expect(updated, hasLength(10));
      expect(updated.first.chapterId, 'new');
    });
  });

  group('visibleRecentChapters', () {
    final now = DateTime.utc(2026, 7, 20);

    test('sorts newest-first', () {
      // Both timestamps must sit INSIDE the 14-day visibility window,
      // otherwise visibleRecentChapters() correctly drops them and this test
      // would assert on an empty list. (Raw small epoch values like 100/200
      // are 1970 — ~56 years stale relative to `now`.)
      final stored = [
        _chapter('math', 'old',
            viewedAtMillis:
                now.subtract(const Duration(days: 2)).millisecondsSinceEpoch),
        _chapter('science', 'new',
            viewedAtMillis:
                now.subtract(const Duration(hours: 1)).millisecondsSinceEpoch),
      ];
      final visible = visibleRecentChapters(stored, now: now);
      expect(visible.map((e) => e.chapterId), ['new', 'old']);
    });

    test('drops entries older than 14 days', () {
      final fresh = _chapter('math', 'fresh',
          viewedAtMillis: now.subtract(const Duration(days: 1)).millisecondsSinceEpoch);
      final stale = _chapter('science', 'stale',
          viewedAtMillis: now.subtract(const Duration(days: 20)).millisecondsSinceEpoch);
      final visible = visibleRecentChapters([fresh, stale], now: now);
      expect(visible.map((e) => e.chapterId), ['fresh']);
    });

    test('caps the visible list at 5 even if more are stored', () {
      final stored = List.generate(
        8,
        (i) => _chapter('math', 'c$i',
            viewedAtMillis: now.subtract(Duration(hours: i)).millisecondsSinceEpoch),
      );
      final visible = visibleRecentChapters(stored, now: now);
      expect(visible, hasLength(5));
      // Newest (smallest hour offset) first.
      expect(visible.first.chapterId, 'c0');
    });

    test('empty input yields empty output', () {
      expect(visibleRecentChapters(const [], now: now), isEmpty);
    });
  });
}
