// JSON-decode tests for synthesis_models.dart (Monthly Synthesis, Pedagogy v2
// Wave 3). Fixtures follow the CURRENT `SynthesisRow` shape returned by
// apps/host/src/app/api/synthesis/state/route.ts — i.e. the post-Phase-4
// vocabulary that includes the `flagged` parent-share status added on
// 2026-07-21 by migration 20260722098000_monthly_synthesis_flagged_status.sql.
//
// Nothing here asserts on generated summary TEXT content: that text is
// Claude-produced and oracle-validated server-side, and mobile only decodes
// and renders it verbatim.
library;

import 'package:flutter_test/flutter_test.dart';

import 'package:alfanumrik/data/models/synthesis_models.dart';

void main() {
  group('ParentShareStatus', () {
    test('decodes all SIX current statuses', () {
      expect(ParentShareStatus.fromString('pending'), ParentShareStatus.pending);
      expect(ParentShareStatus.fromString('sent'), ParentShareStatus.sent);
      expect(
          ParentShareStatus.fromString('opted_out'), ParentShareStatus.optedOut);
      expect(ParentShareStatus.fromString('failed'), ParentShareStatus.failed);
      expect(ParentShareStatus.fromString('suppressed'),
          ParentShareStatus.suppressed);
      expect(ParentShareStatus.fromString('flagged'), ParentShareStatus.flagged);
    });

    test('an unknown/absent status degrades to pending, never sent or failed',
        () {
      // A future server-side status this build doesn't know must not read as
      // an unearned "sent" or a false-alarm "failed".
      expect(ParentShareStatus.fromString(null), ParentShareStatus.pending);
      expect(ParentShareStatus.fromString('queued_v2'),
          ParentShareStatus.pending);
    });

    test('sent / opted_out / flagged block re-sending; others do not', () {
      expect(ParentShareStatus.sent.blocksSending, isTrue);
      expect(ParentShareStatus.optedOut.blocksSending, isTrue);
      // flagged = held for human review; re-sending would just re-flag.
      expect(ParentShareStatus.flagged.blocksSending, isTrue);

      expect(ParentShareStatus.pending.blocksSending, isFalse);
      expect(ParentShareStatus.failed.blocksSending, isFalse);
      expect(ParentShareStatus.suppressed.blocksSending, isFalse);
    });
  });

  group('SynthesisBundle', () {
    test('decodes the full bundle including chapterMockSummary', () {
      final b = SynthesisBundle.fromJson(const {
        'monthLabel': '2026-06',
        'weeklyArtifactIds': ['a1', 'a2', 'a3'],
        'masteryDelta': {
          'chaptersTouched': ['Light', 'Motion'],
          'topicsMastered': 3,
          'topicsImproved': 5,
          'topicsRegressed': 1,
        },
        'chapterMockSummary': {
          'chapters': ['Light'],
          'totalQuestions': 20,
          'targetDifficulty': 0.62,
        },
      });

      expect(b.monthLabel, '2026-06');
      expect(b.weeklyArtifactIds, hasLength(3));
      expect(b.masteryDelta.chaptersTouched, ['Light', 'Motion']);
      expect(b.masteryDelta.topicsMastered, 3);
      expect(b.masteryDelta.topicsImproved, 5);
      expect(b.masteryDelta.topicsRegressed, 1);
      expect(b.chapterMockSummary!.totalQuestions, 20);
      expect(b.chapterMockSummary!.targetDifficulty, closeTo(0.62, 1e-9));
    });

    test('a null chapterMockSummary decodes to null (the tile is hidden)', () {
      final b = SynthesisBundle.fromJson(const {
        'monthLabel': '2026-06',
        'weeklyArtifactIds': <String>[],
        'masteryDelta': <String, dynamic>{},
        'chapterMockSummary': null,
      });
      expect(b.chapterMockSummary, isNull);
      expect(b.masteryDelta.topicsMastered, 0);
      expect(b.masteryDelta.chaptersTouched, isEmpty);
    });
  });

  group('SynthesisRow', () {
    Map<String, dynamic> rowJson({String status = 'pending'}) => {
          'id': 'run-1',
          'synthesisMonth': '2026-06',
          'bundle': {
            'monthLabel': '2026-06',
            'weeklyArtifactIds': ['a1'],
            'masteryDelta': {
              'chaptersTouched': ['Light'],
              'topicsMastered': 2,
              'topicsImproved': 1,
              'topicsRegressed': 0,
            },
            'chapterMockSummary': null,
          },
          'summaryTextEn': 'You mastered 2 topics this month.',
          'summaryTextHi': 'इस महीने तुमने 2 विषयों में महारत हासिल की।',
          'parentShareStatus': status,
          'parentShareSentAt': null,
          'createdAt': '2026-07-01T00:00:00.000Z',
        };

    test('decodes the ready row', () {
      final r = SynthesisRow.fromJson(rowJson());
      expect(r.id, 'run-1');
      expect(r.synthesisMonth, '2026-06');
      expect(r.parentShareStatus, ParentShareStatus.pending);
      expect(r.parentShareSentAt, isNull);
      expect(r.bundle.masteryDelta.topicsMastered, 2);
    });

    test('decodes the flagged status end-to-end', () {
      final r = SynthesisRow.fromJson(rowJson(status: 'flagged'));
      expect(r.parentShareStatus, ParentShareStatus.flagged);
      expect(r.parentShareStatus.blocksSending, isTrue);
    });

    test('Hindi summary falls back to English when blank', () {
      final json = rowJson()..['summaryTextHi'] = '   ';
      final r = SynthesisRow.fromJson(json);
      expect(r.summary(true), 'You mastered 2 topics this month.');
      expect(r.summary(false), 'You mastered 2 topics this month.');
    });

    test('an unfilled summary decodes to empty strings (shows the wait hint)',
        () {
      final json = rowJson()
        ..['summaryTextEn'] = ''
        ..['summaryTextHi'] = '';
      final r = SynthesisRow.fromJson(json);
      expect(r.summary(false), isEmpty);
      expect(r.summary(true), isEmpty);
    });

    test('copyWith only changes the share fields, preserving the bundle', () {
      final r = SynthesisRow.fromJson(rowJson());
      final updated = r.copyWith(
        parentShareStatus: ParentShareStatus.sent,
        parentShareSentAt: '2026-07-02T09:00:00.000Z',
      );
      expect(updated.parentShareStatus, ParentShareStatus.sent);
      expect(updated.parentShareSentAt, '2026-07-02T09:00:00.000Z');
      expect(updated.id, r.id);
      expect(updated.summaryTextEn, r.summaryTextEn);
      expect(updated.bundle, r.bundle);
    });
  });
}
