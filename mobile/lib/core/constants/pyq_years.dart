/// ALFANUMRIK — Previous-Year-Question (PYQ) board-paper years (mobile twin).
///
/// Dart mirror of `packages/lib/src/quiz/pyq-years.ts`. ONE definition of
/// "which board years may a student pick" and ONE validator, on each runtime:
/// the `/pyq` launcher renders [pyqYears]; the `/quiz` deep-link parser
/// validates `?year=` with [isPyqYear] before the value reaches any question
/// filter. Both must agree or a year the picker offers would be silently
/// dropped on arrival.
///
/// ## Why this is not a literal array
///
/// The retired mobile PYQ runtime hardcoded
/// `[2025, 2024, … 2015]`. That list decays: it silently stops offering the
/// newest board paper the moment the calendar rolls past its author's
/// assumption, and nothing fails — students simply never see the most recent
/// year. Deriving the window from the clock removes the decay; `now` is
/// injectable so tests stay deterministic.
///
/// ## Parity contract with web
///
/// The constants and the arithmetic MUST match `pyq-years.ts` exactly, because
/// a mobile student and a web student picking "the oldest year offered" must
/// get the same paper. The web reads `Date.getUTCFullYear()`, so this reads
/// `DateTime.toUtc().year` — NOT local time, which would flip the window a few
/// hours early or late for IST devices around the new year.
///
/// P5 note: these are CALENDAR years and are `int`s. They are not grades — the
/// grade contract (strings "6".."12") is unaffected by anything in this file.
library;

/// How many board years the picker offers, newest first.
/// Mirrors `PYQ_YEAR_COUNT` in `pyq-years.ts`.
const int kPyqYearCount = 11;

/// Oldest selectable paper year. A floor rather than a curated start date: its
/// only job is to reject junk (`?year=3`, `?year=1970`) before it reaches a
/// database filter. A year in range with no tagged rows is not an error — the
/// quiz assembler fills from the normal pool.
/// Mirrors `PYQ_MIN_YEAR` in `pyq-years.ts`.
const int kPyqMinYear = 2010;

/// Newest selectable paper year.
///
/// CBSE board papers for year Y are sat in Feb-Mar of Y, so Y is offerable
/// within Y itself. `+ 1` is deliberately NOT added: offering a paper that has
/// not been written yet is a promise the content pipeline cannot keep.
int pyqMaxYear({DateTime? now}) => (now ?? DateTime.now()).toUtc().year;

/// Selectable board years, newest first.
List<int> pyqYears({DateTime? now}) {
  final max = pyqMaxYear(now: now);
  final years = <int>[];
  for (var y = max; y > max - kPyqYearCount && y >= kPyqMinYear; y--) {
    years.add(y);
  }
  return List<int>.unmodifiable(years);
}

/// Whether an untrusted value is a board year we will act on.
///
/// Accepts the full `[kPyqMinYear, pyqMaxYear()]` range, not just the
/// [pyqYears] window, so an older bookmarked/deep link keeps working instead of
/// quietly degrading to a generic quiz.
bool isPyqYear(int? value, {DateTime? now}) {
  if (value == null) return false;
  return value >= kPyqMinYear && value <= pyqMaxYear(now: now);
}

/// Parse-and-validate an untrusted `?year=` query string in one step.
///
/// Returns `null` for absent, non-numeric, or out-of-range input so a hostile
/// deep link can never reach a question filter. Used by the `/quiz` route
/// builder — the single place a `year` enters the mobile app from outside.
int? parsePyqYear(String? raw, {DateTime? now}) {
  if (raw == null || raw.isEmpty) return null;
  final parsed = int.tryParse(raw.trim());
  return isPyqYear(parsed, now: now) ? parsed : null;
}
