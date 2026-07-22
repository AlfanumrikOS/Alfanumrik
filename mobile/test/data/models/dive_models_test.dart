// JSON-decode tests for dive_models.dart (Weekly Curiosity Dive, Pedagogy v2
// Wave 2). Fixtures are transcribed from the ACTUAL route responses in
// apps/host/src/app/api/dive/{state,start,artifact,history}/route.ts — in
// particular the MIXED CASING of /api/dive/state, where the phenomena rows
// come back in raw snake_case off the `phenomena` table while every other
// field is camelCase. If the server ever normalises that, these tests are the
// tripwire.
//
// Nothing here asserts on a derived value: `weeklyStreakCount`, `isoWeek` and
// the `state` verdict are all server-computed and only decoded.
library;

import 'package:flutter_test/flutter_test.dart';

import 'package:alfanumrik/data/models/dive_models.dart';

void main() {
  group('DivePickerOption', () {
    test('decodes all three wire values', () {
      expect(DivePickerOption.fromString('phenomenon'),
          DivePickerOption.phenomenon);
      expect(
          DivePickerOption.fromString('weak_topic'), DivePickerOption.weakTopic);
      expect(DivePickerOption.fromString('own_topic'), DivePickerOption.ownTopic);
    });

    test('falls back to own_topic on unknown/null (always-visible option)', () {
      expect(DivePickerOption.fromString(null), DivePickerOption.ownTopic);
      expect(DivePickerOption.fromString('something_new'),
          DivePickerOption.ownTopic);
    });
  });

  group('DivePhenomenon', () {
    test('decodes the raw snake_case shape /api/dive/state actually returns',
        () {
      final p = DivePhenomenon.fromJson(const {
        'id': 'ph-1',
        'slug': 'rainbows',
        'title_en': 'Why do rainbows form?',
        'title_hi': 'इंद्रधनुष कैसे बनता है?',
        'summary_en': 'Light bends through water droplets.',
        'summary_hi': 'प्रकाश पानी की बूँदों से मुड़ता है।',
        'subjects': ['physics', 'science'],
      });

      expect(p.id, 'ph-1');
      expect(p.slug, 'rainbows');
      expect(p.titleEn, 'Why do rainbows form?');
      expect(p.titleHi, 'इंद्रधनुष कैसे बनता है?');
      expect(p.subjects, ['physics', 'science']);
      expect(p.title(false), 'Why do rainbows form?');
      expect(p.title(true), 'इंद्रधनुष कैसे बनता है?');
      expect(p.summary(true), 'प्रकाश पानी की बूँदों से मुड़ता है।');
    });

    test('Hindi falls back to English when the Hindi column is blank', () {
      final p = DivePhenomenon.fromJson(const {
        'slug': 's',
        'title_en': 'English title',
        'title_hi': '',
        'summary_en': 'English summary',
        'summary_hi': '',
      });
      expect(p.title(true), 'English title');
      expect(p.summary(true), 'English summary');
    });

    test('null subjects decodes to an empty list, never null', () {
      final p = DivePhenomenon.fromJson(const {'slug': 's'});
      expect(p.subjects, isEmpty);
    });
  });

  group('DiveState', () {
    test('decodes the full open-state response', () {
      final s = DiveState.fromJson(const {
        'state': 'open',
        'currentIsoWeek': '2026-W30',
        'lastCompletedIsoWeek': '2026-W29',
        'weeklyStreakCount': 4,
        'defaultPicker': 'weak_topic',
        'showPhenomenonOption': true,
        'showWeakTopicOption': true,
        'showOwnTopicOption': true,
        'eligiblePhenomena': [
          {'id': 'p1', 'slug': 'tides', 'title_en': 'Tides', 'title_hi': 'ज्वार'},
        ],
        'weakTopics': [
          {
            'topicId': 't1',
            'title': 'Fractions',
            'titleHi': 'भिन्न',
            'masteryProbability': 0.31,
          },
        ],
      });

      expect(s.isCompleted, isFalse);
      expect(s.currentIsoWeek, '2026-W30');
      expect(s.lastCompletedIsoWeek, '2026-W29');
      expect(s.weeklyStreakCount, 4);
      expect(s.defaultPicker, DivePickerOption.weakTopic);
      expect(s.eligiblePhenomena, hasLength(1));
      expect(s.eligiblePhenomena.single.slug, 'tides');
      expect(s.weakTopics.single.topicId, 't1');
      expect(s.weakTopics.single.label(true), 'भिन्न');
      expect(s.weakTopics.single.masteryProbability, closeTo(0.31, 1e-9));
    });

    test("state == 'completed' is the ONLY thing that marks a dive complete",
        () {
      expect(
        DiveState.fromJson(const {'state': 'completed'}).isCompleted,
        isTrue,
      );
      // A non-zero streak must NOT imply completion — the two are independent
      // server facts.
      expect(
        DiveState.fromJson(const {'state': 'open', 'weeklyStreakCount': 9})
            .isCompleted,
        isFalse,
      );
    });

    test('own_topic option defaults to VISIBLE on a malformed body', () {
      // The picker must never end up with zero selectable options.
      final s = DiveState.fromJson(const {'state': 'open'});
      expect(s.showOwnTopicOption, isTrue);
      expect(s.showPhenomenonOption, isFalse);
      expect(s.showWeakTopicOption, isFalse);
      expect(s.eligiblePhenomena, isEmpty);
      expect(s.weakTopics, isEmpty);
      expect(s.weeklyStreakCount, 0);
    });
  });

  group('ResolvedDive', () {
    test('re-attaches the pickerOption the response omits', () {
      final r = ResolvedDive.fromJson(
        const {
          'diveTopic': 'Why do rainbows form?',
          'diveSubjects': ['physics'],
          'phenomenonSlug': 'rainbows',
        },
        pickerOption: DivePickerOption.phenomenon,
      );
      expect(r.pickerOption, DivePickerOption.phenomenon);
      expect(r.diveTopic, 'Why do rainbows form?');
      expect(r.diveSubjects, ['physics']);
      expect(r.phenomenonSlug, 'rainbows');
    });

    test('own_topic resolves with empty subjects and a null slug', () {
      final r = ResolvedDive.fromJson(
        const {
          'diveTopic': 'Black holes',
          'diveSubjects': <String>[],
          'phenomenonSlug': null,
        },
        pickerOption: DivePickerOption.ownTopic,
      );
      expect(r.diveSubjects, isEmpty);
      expect(r.phenomenonSlug, isNull);
    });
  });

  group('DiveArtifactSaveResult', () {
    test('decodes the 200 body', () {
      final r = DiveArtifactSaveResult.fromJson(const {
        'artifactId': 'a-1',
        'weeklyStreakCount': 5,
        'isoWeek': '2026-W30',
      });
      expect(r.artifactId, 'a-1');
      expect(r.weeklyStreakCount, 5);
      expect(r.isoWeek, '2026-W30');
    });
  });

  group('DiveHistoryItem', () {
    test('decodes a fully camelCase history row', () {
      final h = DiveHistoryItem.fromJson(const {
        'id': 'a-1',
        'isoWeek': '2026-W29',
        'pickerOption': 'own_topic',
        'diveTopic': 'Black holes',
        'diveSubjects': <String>[],
        'phenomenonSlug': null,
        'title': 'What I learned about black holes',
        'createdAt': '2026-07-18T10:30:00.000Z',
      });
      expect(h.id, 'a-1');
      expect(h.isoWeek, '2026-W29');
      expect(h.pickerOption, DivePickerOption.ownTopic);
      expect(h.diveSubjects, isEmpty);
      expect(h.phenomenonSlug, isNull);
      expect(h.title, 'What I learned about black holes');
    });
  });
}
