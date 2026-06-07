// Tests for the mobile cheer-preset catalog (Wave 2.4 parent surface).
//
// These pin the SYNC CONTRACT with the web catalog
// (`src/lib/parent/cheer-catalog.ts`): the exact 8 message_keys, in the same
// set, each with non-empty bilingual labels (P7) and an icon. The `message_key`
// values are the cross-surface wire contract validated server-side by
// `isValidMessageKey`, so a drift here would mean the picker offers a key the
// server rejects.
//
// Pure data — no network, no generated client, no Flutter binding needed.
import 'package:flutter_test/flutter_test.dart';
import 'package:alfanumrik/ui/screens/parent/cheer_presets.dart';

void main() {
  group('cheer presets — web sync contract', () {
    // The authoritative 8 keys from src/lib/parent/cheer-catalog.ts CHEER_PRESETS.
    const webKeys = {
      'great_work',
      'keep_going',
      'so_proud',
      'effort_counts',
      'streak_star',
      'quiz_champion',
      'big_milestone',
      'believe_in_you',
    };

    test('exposes exactly the 8 web message_keys (no more, no fewer)', () {
      final mobileKeys = kCheerPresets.map((p) => p.messageKey).toSet();
      expect(mobileKeys, equals(webKeys));
      expect(kCheerPresets.length, 8);
    });

    test('message_keys are unique', () {
      final keys = kCheerPresets.map((p) => p.messageKey).toList();
      expect(keys.toSet().length, keys.length);
    });

    test('default key is great_work and is a valid preset', () {
      expect(kDefaultCheerKey, 'great_work');
      expect(
        kCheerPresets.any((p) => p.messageKey == kDefaultCheerKey),
        isTrue,
      );
    });

    test('every preset has non-empty bilingual labels + icon (P7)', () {
      for (final p in kCheerPresets) {
        expect(p.titleEn.trim(), isNotEmpty, reason: '${p.messageKey} en');
        expect(p.titleHi.trim(), isNotEmpty, reason: '${p.messageKey} hi');
        expect(p.icon.trim(), isNotEmpty, reason: '${p.messageKey} icon');
        // En and Hi must actually differ (a copy/paste of English into Hindi
        // would defeat P7). Icons are shared across both, so we only compare
        // the text part by stripping the trailing icon if present.
        expect(p.titleEn, isNot(equals(p.titleHi)),
            reason: '${p.messageKey} labels must differ across languages');
      }
    });

    test('title(isHi) selects the correct language', () {
      final greatWork =
          kCheerPresets.firstWhere((p) => p.messageKey == 'great_work');
      expect(greatWork.title(false), greatWork.titleEn);
      expect(greatWork.title(true), greatWork.titleHi);
    });
  });
}
