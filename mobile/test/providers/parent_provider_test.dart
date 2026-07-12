// Tests for the parent-surface pure helpers (Wave 2.4).
//
// Covers the Encourage outcome mapping + its bilingual messaging — the part of
// the parent provider that carries product behaviour without a live HTTP round
// trip:
//   • outcomeFromStatus: HTTP status → EncourageOutcome (mirrors the web route's
//     200 / 429 / 403 / other contract).
//   • encourageMessage:  outcome × isHi → friendly bilingual toast copy (P7).
//
// NOTE: parent_provider.dart imports the GENERATED client
// (package:alfanumrik_api_v2), so this test compiles only after
// `dart run build_runner build` has produced the built_value `.g.dart` outputs
// in lib/api/v2 — same precondition as the other /v2 provider/repository tests.
// The live HTTP paths (getParentChildren / getParentGlance / postParentEncourage)
// are NOT integration-tested here, matching the existing /v2 repos' posture.
import 'package:flutter_test/flutter_test.dart';
import 'package:alfanumrik/providers/parent_provider.dart';

void main() {
  group('active child scope', () {
    test('keeps a linked selection and rejects stale selections', () {
      const linked = ['child-1', 'child-2'];
      expect(resolveActiveParentChildId(linked, 'child-2'), 'child-2');
      expect(resolveActiveParentChildId(linked, 'foreign-child'), 'child-1');
      expect(resolveActiveParentChildId(linked, null), 'child-1');
      expect(resolveActiveParentChildId(const [], 'child-2'), isNull);
    });
  });

  group('outcomeFromStatus — mirrors POST /v2/parent/encourage contract', () {
    test('200 → success', () {
      expect(outcomeFromStatus(200), EncourageOutcome.success);
    });

    test('201 → success', () {
      expect(outcomeFromStatus(201), EncourageOutcome.success);
    });

    test('429 → rateLimited (already cheered recently)', () {
      expect(outcomeFromStatus(429), EncourageOutcome.rateLimited);
    });

    test('403 → forbidden (not linked / no parent profile)', () {
      expect(outcomeFromStatus(403), EncourageOutcome.forbidden);
    });

    test('400 (unknown message_key) → error', () {
      expect(outcomeFromStatus(400), EncourageOutcome.error);
    });

    test('500 → error', () {
      expect(outcomeFromStatus(500), EncourageOutcome.error);
    });

    test('502 → error', () {
      expect(outcomeFromStatus(502), EncourageOutcome.error);
    });

    test('null (network failure) → error', () {
      expect(outcomeFromStatus(null), EncourageOutcome.error);
    });
  });

  group('encourageMessage — bilingual (P7), no PII (P13)', () {
    for (final outcome in EncourageOutcome.values) {
      test('${outcome.name} resolves non-empty en + hi and they differ', () {
        final en = encourageMessage(outcome, false);
        final hi = encourageMessage(outcome, true);
        expect(en.trim(), isNotEmpty);
        expect(hi.trim(), isNotEmpty);
        expect(en, isNot(equals(hi)),
            reason: '${outcome.name} must differ across languages');
      });
    }

    test('success copy reads as a confirmation', () {
      expect(encourageMessage(EncourageOutcome.success, false),
          contains('sent'));
    });

    test('rateLimited copy references trying again later', () {
      expect(
        encourageMessage(EncourageOutcome.rateLimited, false).toLowerCase(),
        contains('again'),
      );
    });

    test('messages contain no interpolation tokens (no leaked PII slots)', () {
      for (final outcome in EncourageOutcome.values) {
        for (final isHi in [true, false]) {
          final msg = encourageMessage(outcome, isHi);
          expect(msg, isNot(contains('{')));
          expect(msg, isNot(contains('}')));
          expect(msg, isNot(contains(r'$')));
        }
      }
    });
  });
}
