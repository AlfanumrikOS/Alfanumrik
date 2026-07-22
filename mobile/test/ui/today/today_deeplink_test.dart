// Tests for `resolveMobileRoute` — the SINGLE place web → mobile route
// translation happens for `/v2` Today-queue items (Wave 2.3 mobile).
//
// These pin the full web→mobile route map so a regression in EITHER direction
// is caught. The load-bearing behavior change (Phase 6 sub-phase 7 nav-wiring)
// is that `/dive`, `/dive/history`, and `/synthesis` now resolve to their real
// ported mobile surfaces instead of dead-ending at the old `/learn` fallback.
//
// Unlike the pure-copy helpers, `resolveMobileRoute` references the generated
// built_value `TodayDeepLink` type, so this file needs the lib/api/v2
// build_runner output on disk (present in the Flutter CI env).
import 'package:flutter_test/flutter_test.dart';
import 'package:alfanumrik_api_v2/alfanumrik_api_v2.dart';
import 'package:alfanumrik/ui/screens/today/today_deeplink.dart';

TodayDeepLink _link(String route) =>
    TodayDeepLink((b) => b..route = route);

void main() {
  group('resolveMobileRoute — Dive/Synthesis now hit real routes (not /learn)',
      () {
    test('/dive resolves to the real Dive surface, not the old fallback', () {
      expect(resolveMobileRoute(_link('/dive')), '/dive');
      expect(resolveMobileRoute(_link('/dive')), isNot('/learn'));
    });

    test('/dive/history resolves to the real Dive history surface', () {
      expect(resolveMobileRoute(_link('/dive/history')), '/dive/history');
      expect(resolveMobileRoute(_link('/dive/history')), isNot('/learn'));
    });

    test('/synthesis resolves to the real Synthesis surface', () {
      expect(resolveMobileRoute(_link('/synthesis')), '/synthesis');
      expect(resolveMobileRoute(_link('/synthesis')), isNot('/learn'));
    });

    test('trailing slash is normalised before mapping', () {
      // `/dive/` → strip trailing slash → `/dive`.
      expect(resolveMobileRoute(_link('/dive/')), '/dive');
      // `/synthesis/` → `/synthesis`.
      expect(resolveMobileRoute(_link('/synthesis/')), '/synthesis');
    });
  });

  group('resolveMobileRoute — pre-existing mappings still hold (regression net)',
      () {
    test('bare /learn maps to the mobile learn tab', () {
      expect(resolveMobileRoute(_link('/learn')), '/learn');
    });

    test('nested /learn/<subject>/<chapter> keeps its shape', () {
      expect(resolveMobileRoute(_link('/learn/science/3')), '/learn/science/3');
    });

    test('/quiz maps to the mobile quiz tab', () {
      expect(resolveMobileRoute(_link('/quiz')), '/quiz');
    });

    test('/foxy maps to the mobile chat tab', () {
      expect(resolveMobileRoute(_link('/foxy')), '/chat');
    });

    test('unknown / web-only route falls back to Today home', () {
      expect(resolveMobileRoute(_link('/leaderboard')), '/today');
    });
  });
}
