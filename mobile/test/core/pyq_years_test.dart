// Tests for the clock-derived PYQ board-year window (R8).
//
// The point of this module is that it does NOT decay, so the tests pin the
// behaviour that a hardcoded list cannot have: the window MOVES with the clock.
// Constants are asserted against `packages/lib/src/quiz/pyq-years.ts` so the
// two runtimes cannot silently drift apart and offer different papers.

import 'package:alfanumrik/core/constants/pyq_years.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  group('constants match the web module', () {
    test('count and floor mirror pyq-years.ts', () {
      // PYQ_YEAR_COUNT = 11, PYQ_MIN_YEAR = 2010 in packages/lib.
      expect(kPyqYearCount, 11);
      expect(kPyqMinYear, 2010);
    });
  });

  group('pyqMaxYear', () {
    test('is the current year, never the next one', () {
      // Boards for year Y are sat in Feb-Mar of Y, so Y is offerable within Y.
      // `+1` would promise a paper that has not been written.
      expect(pyqMaxYear(now: DateTime.utc(2026, 8, 11)), 2026);
      expect(pyqMaxYear(now: DateTime.utc(2026, 12, 31, 23, 59)), 2026);
    });

    test('reads UTC, matching the web getUTCFullYear()', () {
      // 1 Jan 2027 00:30 IST is still 31 Dec 2026 UTC. Web and mobile must
      // agree on which side of the boundary this is.
      final istNewYear = DateTime.utc(2026, 12, 31, 19, 0); // 00:30 IST, 1 Jan
      expect(pyqMaxYear(now: istNewYear), 2026);
    });
  });

  group('pyqYears', () {
    test('returns kPyqYearCount years, newest first', () {
      final years = pyqYears(now: DateTime.utc(2026, 6, 1));
      expect(years.length, kPyqYearCount);
      expect(years.first, 2026);
      expect(years.last, 2016);
      // Strictly descending, no gaps.
      for (var i = 1; i < years.length; i++) {
        expect(years[i], years[i - 1] - 1);
      }
    });

    test('WINDOW MOVES with the clock — the decay the literal had', () {
      // This is the whole reason the hardcoded `[2025 ... 2015]` list was
      // deleted: once the calendar passed its author's assumption it silently
      // stopped offering the newest board paper and nothing failed.
      final y2026 = pyqYears(now: DateTime.utc(2026, 1, 1));
      final y2031 = pyqYears(now: DateTime.utc(2031, 1, 1));
      expect(y2026.first, 2026);
      expect(y2031.first, 2031);
      expect(y2031.contains(2031), isTrue);
      expect(y2026.contains(2031), isFalse);
    });

    test('never offers a year below the floor', () {
      final years = pyqYears(now: DateTime.utc(2015, 1, 1));
      expect(years.every((y) => y >= kPyqMinYear), isTrue);
      expect(years.last, kPyqMinYear);
      expect(years.length, lessThan(kPyqYearCount));
    });

    test('is unmodifiable so a caller cannot mutate the shared window', () {
      expect(() => pyqYears().add(1999), throwsUnsupportedError);
    });
  });

  group('isPyqYear', () {
    final now = DateTime.utc(2026, 6, 1);

    test('accepts the full floor..max range, not just the visible window', () {
      // An older bookmarked deep link keeps working rather than quietly
      // degrading to a generic quiz.
      expect(isPyqYear(2026, now: now), isTrue);
      expect(isPyqYear(2016, now: now), isTrue);
      expect(isPyqYear(2010, now: now), isTrue); // outside pyqYears(), still ok
    });

    test('rejects junk and future papers', () {
      expect(isPyqYear(null, now: now), isFalse);
      expect(isPyqYear(3, now: now), isFalse);
      expect(isPyqYear(1970, now: now), isFalse);
      expect(isPyqYear(2009, now: now), isFalse);
      expect(isPyqYear(2027, now: now), isFalse);
    });
  });

  group('parsePyqYear (the deep-link boundary)', () {
    final now = DateTime.utc(2026, 6, 1);

    test('parses a valid ?year=', () {
      expect(parsePyqYear('2019', now: now), 2019);
      expect(parsePyqYear(' 2019 ', now: now), 2019);
    });

    test('returns null for hostile or absent input rather than throwing', () {
      // A hostile deep link must never reach a question filter, and must not
      // crash the route builder either — it degrades to a normal quiz.
      expect(parsePyqYear(null, now: now), isNull);
      expect(parsePyqYear('', now: now), isNull);
      expect(parsePyqYear('abc', now: now), isNull);
      expect(parsePyqYear('2019; DROP TABLE', now: now), isNull);
      expect(parsePyqYear('1970', now: now), isNull);
      expect(parsePyqYear('2099', now: now), isNull);
      expect(parsePyqYear('-2019', now: now), isNull);
    });
  });
}
