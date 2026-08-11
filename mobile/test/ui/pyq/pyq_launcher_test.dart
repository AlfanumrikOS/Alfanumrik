// R8 — PYQ is a LAUNCHER, and must never become a quiz runtime again.
//
// Until 2026-08-11 `/pyq` on mobile was a second, independent quiz runtime that
// graded on the device by reading `correct_answer_index` straight out of
// `question_bank`, and recorded NOTHING — no session, no responses, no XP, no
// mastery. These are static source assertions rather than widget-interaction
// tests because the defect being pinned is structural: the question is not
// "does the screen behave" but "does this file contain a grader at all".
//
// Comments are stripped before asserting, so the header comment in
// pyq_screen.dart can keep explaining what was removed (and why) without the
// test going vacuous. Because a too-aggressive stripper would silently pass
// everything, the stripper is itself tested below — that is the load-bearing
// part of this file.

import 'dart:io';

import 'package:flutter_test/flutter_test.dart';

/// Remove `//`/`///` line comments and `/* */` block comments, while leaving
/// string literals intact (so a `'//'` inside a string is NOT treated as a
/// comment and cannot be used to smuggle code past the assertions).
String stripDartComments(String source) {
  final out = StringBuffer();
  var i = 0;
  while (i < source.length) {
    final c = source[i];
    final next = i + 1 < source.length ? source[i + 1] : '';

    // Line comment.
    if (c == '/' && next == '/') {
      while (i < source.length && source[i] != '\n') {
        i++;
      }
      continue;
    }
    // Block comment.
    if (c == '/' && next == '*') {
      i += 2;
      while (i < source.length &&
          !(source[i] == '*' && i + 1 < source.length && source[i + 1] == '/')) {
        i++;
      }
      i += 2;
      continue;
    }
    // String literal — copy verbatim, honouring backslash escapes.
    if (c == "'" || c == '"') {
      final quote = c;
      out.write(c);
      i++;
      while (i < source.length) {
        if (source[i] == r'\') {
          out.write(source[i]);
          if (i + 1 < source.length) out.write(source[i + 1]);
          i += 2;
          continue;
        }
        out.write(source[i]);
        if (source[i] == quote) {
          i++;
          break;
        }
        i++;
      }
      continue;
    }

    out.write(c);
    i++;
  }
  return out.toString();
}

String _read(String relativePath) {
  final file = File(relativePath);
  expect(file.existsSync(), isTrue,
      reason: '$relativePath must exist for this contract test to mean anything');
  return file.readAsStringSync();
}

void main() {
  group('stripDartComments is honest (guards the assertions below)', () {
    test('removes line and block comments', () {
      expect(stripDartComments('var a = 1; // correct_answer_index\n'),
          isNot(contains('correct_answer_index')));
      expect(stripDartComments('/// correct_answer_index\nvar a = 1;'),
          isNot(contains('correct_answer_index')));
      expect(stripDartComments('/* correct_answer_index */ var a = 1;'),
          isNot(contains('correct_answer_index')));
    });

    test('KEEPS code — it does not just return empty', () {
      const src = '// a comment\nfinal x = doThing();\n';
      final stripped = stripDartComments(src);
      expect(stripped, contains('final x = doThing();'));
      expect(stripped, isNot(contains('a comment')));
    });

    test('KEEPS string literals, so code cannot hide inside one', () {
      // If the stripper treated the `//` in a URL or a query string as a
      // comment it would delete real code and pass this file vacuously.
      const src = "final u = 'https://x.test/a?b=1'; // trailing\n";
      final stripped = stripDartComments(src);
      expect(stripped, contains("'https://x.test/a?b=1'"));
      expect(stripped, isNot(contains('trailing')));
    });

    test('a violation inside real code SURVIVES stripping', () {
      // The proof that a reintroduced grader would actually be caught.
      const src = '/// harmless mention of correct_answer_index\n'
          'final bad = q.correctAnswerIndex;\n';
      expect(stripDartComments(src), contains('correctAnswerIndex'));
    });
  });

  group('pyq_screen.dart contains no grader', () {
    late String code;

    setUpAll(() {
      code = stripDartComments(_read('lib/ui/screens/pyq/pyq_screen.dart'));
    });

    test('sanity: the stripped source is still real code', () {
      // Without this, every assertion below could pass on an empty string.
      expect(code, contains('class PyqScreen'));
      expect(code, contains('Widget build'));
    });

    test('never reads an answer key', () {
      expect(code, isNot(contains('correct_answer_index')));
      expect(code, isNot(contains('correctAnswerIndex')));
      expect(code, isNot(contains('correctIndex')));
    });

    test('never reads question_bank or any question source directly', () {
      expect(code, isNot(contains('question_bank')));
      expect(code, isNot(contains('PyqRepository')));
      expect(code, isNot(contains('Supabase')));
    });

    test('keeps no local score/correctness state', () {
      expect(code, isNot(contains('correctCount')));
      expect(code, isNot(contains('isCorrect')));
      expect(code, isNot(contains('showExplanation')));
      expect(code, isNot(contains('scorePercent')));
    });

    test('hands off to the canonical /quiz engine with the year', () {
      expect(code, contains("'/quiz?subject="));
      expect(code, contains('year='));
      expect(code, contains('mode=practice'));
      expect(code, contains('count='));
    });

    test('derives years from the shared module, not a literal list', () {
      expect(code, contains('pyqYears()'));
      // The decaying literal that used to live here.
      expect(code, isNot(contains('2025,')));
      expect(code, isNot(contains('2015,')));
    });

    test('is bilingual (P7) on its launch copy', () {
      expect(code, contains('isHi'));
      // Devanagari present for the CTA and the honesty note.
      expect(RegExp(r'[ऀ-ॿ]').hasMatch(code), isTrue);
    });
  });

  group('the retired PYQ runtime is gone, not merely unreferenced', () {
    test('provider, repository and models are deleted', () {
      // These three files existed ONLY to serve the on-device grader. Leaving
      // them behind would leave a working answer-key reader one import away.
      expect(File('lib/providers/pyq_provider.dart').existsSync(), isFalse);
      expect(File('lib/data/repositories/pyq_repository.dart').existsSync(),
          isFalse);
      expect(File('lib/data/models/pyq_models.dart').existsSync(), isFalse);
    });
  });

  group('the legacy quiz candidate fetch does not pull the answer key', () {
    // Release-coordination pin: an architect migration REVOKEs
    // `question_bank.correct_answer_index` from `authenticated`. A bare
    // `SELECT *` fails for the entire row under a column-level REVOKE, so the
    // wildcard that used to be here would have taken the whole legacy quiz
    // path down. This asserts it stays an explicit, answer-key-free list.
    late String code;

    setUpAll(() {
      code = stripDartComments(
          _read('lib/data/repositories/quiz_repository.dart'));
    });

    test('sanity: the stripped source is still real code', () {
      expect(code, contains('class QuizRepository'));
      expect(code, contains('getQuestions'));
    });

    test('selects named columns, never a wildcard', () {
      expect(code, contains('_questionColumns'));
      expect(code, isNot(contains('.select()')));
    });

    test('the column list excludes correct_answer_index', () {
      expect(code, contains('question_bank'));
      expect(code, isNot(contains('correct_answer_index')));
    });
  });
}
