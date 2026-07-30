// Pins DiagnosticRepository.parseStartResponse against the THREE non-error
// HTTP 200 shapes `apps/host/src/app/api/diagnostic/start/route.ts` emits.
//
// The bodies below are transcribed from the route's own return statements, not
// paraphrased. The regression this file exists to prevent: before 2026-07-29
// the mobile parser assumed `data.data` always existed, so the `streamRequired`
// branch (which has NO `data` key) threw and surfaced a misleading
// "Connection error", and the `insufficientContent` branch silently produced an
// empty quiz screen.
library;

import 'package:flutter_test/flutter_test.dart';

import 'package:alfanumrik/data/models/diagnostic_models.dart';
import 'package:alfanumrik/data/repositories/diagnostic_repository.dart';

DiagnosticStartResult parse(Map<String, dynamic> body) =>
    DiagnosticRepository.parseStartResponse(body, grade: '9', subject: 'science');

void main() {
  group('outcome (a) — form assembled', () {
    final body = <String, dynamic>{
      'success': true,
      'ok': true,
      'rung': 1,
      'blueprint': {'easy': 5, 'medium': 6, 'hard': 4},
      'data': {
        'session_id': 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
        'questions': [
          {
            'id': 'q1',
            'question_text': 'What is 2 + 2?',
            'question_hi': '2 + 2 कितना है?',
            'question_type': 'mcq',
            'options': ['3', '4', '5', '6'],
            'correct_answer_index': 1,
            'explanation': 'Because.',
            'difficulty': 1,
            'bloom_level': 'remember',
            'chapter_number': 1,
            'topic_id': null,
          }
        ],
        'rung': 1,
        'quality_tier': 'full',
        'grade': '9',
        'subject': 'science',
        'total_questions': 1,
        'setup_reassurance': {'en': 'Some of these are meant to be hard', 'hi': 'कुछ कठिन हैं'},
        'short_form': false,
        'short_form_message': null,
      },
    };

    test('parses to DiagnosticFormReady with the session and questions', () {
      final r = parse(body);
      expect(r, isA<DiagnosticFormReady>());
      final ready = r as DiagnosticFormReady;
      expect(ready.sessionId, 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee');
      expect(ready.questions, hasLength(1));
      expect(ready.questions.single.correctAnswerIndex, 1);
      expect(ready.rung, 1);
      expect(ready.qualityTier, 'full');
      expect(ready.shortForm, isFalse);
      expect(ready.setupReassurance?.hi, 'कुछ कठिन हैं');
    });

    test('short_form carries the bilingual banner', () {
      final shortBody = Map<String, dynamic>.from(body);
      shortBody['data'] = {
        ...body['data'] as Map<String, dynamic>,
        'quality_tier': 'short_form',
        'short_form': true,
        'short_form_message': {
          'en': 'We could only find 11 good questions',
          'hi': 'हमें केवल 11 अच्छे प्रश्न मिले',
        },
      };
      final ready = parse(shortBody) as DiagnosticFormReady;
      expect(ready.shortForm, isTrue);
      expect(ready.shortFormMessage!.en, contains('11'));
      expect(ready.shortFormMessage!.hi, contains('11'));
    });
  });

  group('outcome (b) — insufficientContent (HTTP 200, diagnostic: null)', () {
    final body = <String, dynamic>{
      'ok': true,
      'success': true,
      'diagnostic': null,
      'insufficientContent': true,
      'reason': 'INSUFFICIENT_POOL',
      'message': {'en': 'Not enough questions', 'hi': 'पर्याप्त प्रश्न नहीं'},
      'headline': {'en': "This subject isn't ready yet", 'hi': 'यह विषय अभी तैयार नहीं है'},
      'alternatives': [
        {
          'kind': 'guided_lesson',
          'label': {'en': 'Start with a guided lesson', 'hi': 'गाइडेड पाठ से शुरू करें'},
          'href': '/learn/science/1?mode=read&from=diagnostic_unavailable',
        },
        {
          'kind': 'foxy',
          'label': {'en': 'Ask Foxy anything', 'hi': 'Foxy से कुछ भी पूछें'},
          'href': '/foxy?subject=science&from=diagnostic_unavailable',
        },
      ],
      'data': {
        'content_insufficient': true,
        'quality_tier': 'insufficient',
        'reason': 'too_few_items',
        'available_count': 4,
        'alternatives': [],
      },
    };

    test('is NOT treated as an error and NOT treated as a form', () {
      final r = parse(body);
      expect(r, isA<DiagnosticInsufficientContent>());
      expect(r, isNot(isA<DiagnosticFormReady>()));
    });

    test('keeps the server bilingual copy and every alternative CTA', () {
      final r = parse(body) as DiagnosticInsufficientContent;
      expect(r.headline.hi, 'यह विषय अभी तैयार नहीं है');
      expect(r.message.en, 'Not enough questions');
      expect(r.reason, 'INSUFFICIENT_POOL');
      expect(r.detailReason, 'too_few_items');
      expect(r.alternatives, hasLength(2));
      expect(r.alternatives.map((a) => a.kind), containsAll(['guided_lesson', 'foxy']));
    });

    test('also recognises the spec-shaped data.* mirror alone', () {
      final mirrorOnly = <String, dynamic>{
        'ok': true,
        'success': true,
        'diagnostic': null,
        'data': {
          'content_insufficient': true,
          'quality_tier': 'insufficient',
          'reason': 'no_hard_items',
          'alternatives': [
            {
              'kind': 'foxy',
              'label': {'en': 'Ask Foxy anything', 'hi': 'Foxy से कुछ भी पूछें'},
              'href': '/foxy',
            }
          ],
        },
      };
      final r = parse(mirrorOnly);
      expect(r, isA<DiagnosticInsufficientContent>());
      expect((r as DiagnosticInsufficientContent).alternatives, hasLength(1));
    });
  });

  group('outcome (c) — streamRequired (HTTP 200, no `data` key at all)', () {
    final body = <String, dynamic>{
      'ok': true,
      'success': true,
      'diagnostic': null,
      'streamRequired': true,
      'message': {'en': 'Class 11 subjects depend on your stream.', 'hi': 'कक्षा 11 के विषय आपकी स्ट्रीम पर निर्भर करते हैं।'},
      'headline': {'en': 'Pick your stream first', 'hi': 'पहले अपनी स्ट्रीम चुनें'},
      'cta': {'en': 'Choose stream', 'hi': 'स्ट्रीम चुनें'},
      'streamOptions': ['science', 'commerce', 'humanities'],
    };

    test('parses without throwing even though `data` is absent', () {
      expect(() => parse(body), returnsNormally);
      expect(parse(body), isA<DiagnosticStreamRequired>());
    });

    test('keeps the bilingual copy and the three stream options', () {
      final r = parse(body) as DiagnosticStreamRequired;
      expect(r.headline.en, 'Pick your stream first');
      expect(r.cta.hi, 'स्ट्रीम चुनें');
      expect(r.streamOptions, ['science', 'commerce', 'humanities']);
    });

    test('falls back to local copy + the 3 streams when the payload is thin', () {
      final r = parse(<String, dynamic>{
        'ok': true,
        'success': true,
        'diagnostic': null,
        'streamRequired': true,
      }) as DiagnosticStreamRequired;
      expect(r.headline.en, isNotEmpty);
      expect(r.headline.hi, isNotEmpty);
      expect(r.message.en, contains('9')); // {grade} substituted
      expect(r.streamOptions, hasLength(3));
    });
  });

  group('degraded / unknown 200 bodies never become an empty quiz', () {
    test('a form with zero questions falls back to the honest stop', () {
      final r = parse(<String, dynamic>{
        'success': true,
        'ok': true,
        'data': {'session_id': 'sess-1', 'questions': []},
      });
      expect(r, isA<DiagnosticInsufficientContent>());
      expect((r as DiagnosticInsufficientContent).reason, 'UNRECOGNISED_EMPTY_FORM');
    });

    test('an unrecognised diagnostic: null body falls back to the honest stop', () {
      final r = parse(<String, dynamic>{
        'success': true,
        'ok': true,
        'diagnostic': null,
        'someFutureFlag': true,
      });
      expect(r, isA<DiagnosticInsufficientContent>());
    });
  });
}
