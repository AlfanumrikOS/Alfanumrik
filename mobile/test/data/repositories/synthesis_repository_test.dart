// Tests for SynthesisRepository's two pure response classifiers.
//
// /api/synthesis/parent-share packs NINE error codes into FIVE status codes
// (404 = flag-off | row-missing | no-guardian | guardian-missing;
//  422 = phone-missing | flagged-for-review), so the classifier MUST key off
// the body's machine-readable `error` string, not the status alone. These
// tests pin that, plus the deliberate divergence from the web page's
// "treat every 403 as opted_out" shortcut.
library;

import 'package:flutter_test/flutter_test.dart';

import 'package:alfanumrik/data/models/synthesis_models.dart';
import 'package:alfanumrik/data/repositories/synthesis_repository.dart';

void main() {
  group('SynthesisRepository.classifyStateResponse', () {
    test('404 → Unavailable (flag off OR no student profile)', () {
      expect(
        SynthesisRepository.classifyStateResponse(404, {'error': 'not_found'}),
        isA<SynthesisUnavailable>(),
      );
      expect(
        SynthesisRepository.classifyStateResponse(
            404, {'error': 'no_student_profile'}),
        isA<SynthesisUnavailable>(),
      );
    });

    test("200 { state: 'no_synthesis_yet' } → NotYet, distinct from Unavailable",
        () {
      final r = SynthesisRepository.classifyStateResponse(
          200, {'state': 'no_synthesis_yet'});
      expect(r, isA<SynthesisNotYet>());
      expect(r, isNot(isA<SynthesisUnavailable>()));
    });

    test("200 { state: 'ready', row } → Ready with the decoded row", () {
      final r = SynthesisRepository.classifyStateResponse(200, {
        'state': 'ready',
        'row': {
          'id': 'run-1',
          'synthesisMonth': '2026-06',
          'bundle': {
            'monthLabel': '2026-06',
            'weeklyArtifactIds': ['a1'],
            'masteryDelta': {
              'chaptersTouched': <String>[],
              'topicsMastered': 4,
              'topicsImproved': 0,
              'topicsRegressed': 0,
            },
            'chapterMockSummary': null,
          },
          'summaryTextEn': 'en',
          'summaryTextHi': 'hi',
          'parentShareStatus': 'flagged',
          'parentShareSentAt': null,
          'createdAt': '2026-07-01T00:00:00.000Z',
        },
      });
      expect(r, isA<SynthesisReady>());
      final row = (r as SynthesisReady).row;
      expect(row.id, 'run-1');
      expect(row.parentShareStatus, ParentShareStatus.flagged);
      expect(row.bundle.masteryDelta.topicsMastered, 4);
    });

    test('a 200 with an unrecognised discriminator degrades to NotYet, never a fabricated row',
        () {
      expect(
        SynthesisRepository.classifyStateResponse(200, {'state': 'weird'}),
        isA<SynthesisNotYet>(),
      );
      expect(
        SynthesisRepository.classifyStateResponse(200, {'state': 'ready'}),
        isA<SynthesisNotYet>(),
      );
    });

    test('401 and 500 are retriable failures', () {
      expect(
        SynthesisRepository.classifyStateResponse(401, {}),
        isA<SynthesisStateFailure>(),
      );
      expect(
        SynthesisRepository.classifyStateResponse(
            500, {'error': 'state_fetch_failed'}),
        isA<SynthesisStateFailure>(),
      );
    });
  });

  group('SynthesisRepository.classifyParentShareResponse', () {
    test('200 { ok, sentAt } → Sent carrying the SERVER timestamp', () {
      final r = SynthesisRepository.classifyParentShareResponse(
        200,
        {'ok': true, 'sentAt': '2026-07-02T09:00:00.000Z', 'waId': 'wa-1'},
      );
      expect(r, isA<ParentShareSent>());
      expect((r as ParentShareSent).sentAt, '2026-07-02T09:00:00.000Z');
    });

    test('200 without sentAt yields a null timestamp (none is invented)', () {
      final r = SynthesisRepository.classifyParentShareResponse(
          200, {'ok': true});
      expect((r as ParentShareSent).sentAt, isNull);
    });

    test('200 { alreadySent: true } → AlreadySent', () {
      expect(
        SynthesisRepository.classifyParentShareResponse(
            200, {'ok': true, 'alreadySent': true}),
        isA<ParentShareAlreadySent>(),
      );
    });

    test('403 guardian_opted_out → OptedOut', () {
      expect(
        SynthesisRepository.classifyParentShareResponse(
            403, {'error': 'guardian_opted_out'}),
        isA<ParentShareOptedOut>(),
      );
    });

    test('a NON-opt-out 403 (the RBAC gate) is NOT reported as opted_out', () {
      // The route added authorizeRequest('report.download_own') on 2026-07-20,
      // which also emits 403. Telling a student "your parent opted out" when
      // the real cause is a permission denial would be a false claim about
      // someone else's choice — so this must be a generic failure.
      final r = SynthesisRepository.classifyParentShareResponse(
          403, {'code': 'PERMISSION_DENIED'});
      expect(r, isA<ParentShareFailure>());
      expect(r, isNot(isA<ParentShareOptedOut>()));
    });

    test('422 flagged_for_review → Flagged (a review hold, not a failure)', () {
      final r = SynthesisRepository.classifyParentShareResponse(
          422, {'error': 'flagged_for_review'});
      expect(r, isA<ParentShareFlagged>());
      expect(r, isNot(isA<ParentShareFailure>()));
      expect(r, isNot(isA<ParentShareDeliveryFailed>()));
    });

    test('422 guardian_phone_missing → PhoneMissing, NOT Flagged', () {
      // Both are 422 — only the body code tells them apart.
      final r = SynthesisRepository.classifyParentShareResponse(
          422, {'error': 'guardian_phone_missing'});
      expect(r, isA<ParentSharePhoneMissing>());
      expect(r, isNot(isA<ParentShareFlagged>()));
    });

    test('the four 404 codes split into NoGuardian vs Unavailable', () {
      expect(
        SynthesisRepository.classifyParentShareResponse(
            404, {'error': 'no_linked_guardian'}),
        isA<ParentShareNoGuardian>(),
      );
      expect(
        SynthesisRepository.classifyParentShareResponse(
            404, {'error': 'guardian_not_found'}),
        isA<ParentShareNoGuardian>(),
      );
      expect(
        SynthesisRepository.classifyParentShareResponse(
            404, {'error': 'not_found'}),
        isA<ParentShareUnavailable>(),
      );
      // Unknown 404 code falls back to the safest reading of that status.
      expect(
        SynthesisRepository.classifyParentShareResponse(
            404, {'error': 'synthesis_not_found'}),
        isA<ParentShareUnavailable>(),
      );
    });

    test('502 whatsapp_delivery_failed → DeliveryFailed', () {
      expect(
        SynthesisRepository.classifyParentShareResponse(
            502, {'error': 'whatsapp_delivery_failed'}),
        isA<ParentShareDeliveryFailed>(),
      );
    });

    test('a non-Map body and a null status never throw', () {
      expect(
        SynthesisRepository.classifyParentShareResponse(500, '<html>'),
        isA<ParentShareFailure>(),
      );
      expect(
        SynthesisRepository.classifyParentShareResponse(null, null),
        isA<ParentShareFailure>(),
      );
    });
  });
}
