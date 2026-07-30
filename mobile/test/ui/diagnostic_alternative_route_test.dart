// Pins the web-href → mobile-route translation for the diagnostic
// insufficient-content fallback CTAs. The hrefs are produced verbatim by
// `buildAlternatives()` in `apps/host/src/app/api/diagnostic/start/route.ts`;
// the literals below are copied from that function.
library;

import 'package:flutter_test/flutter_test.dart';

import 'package:alfanumrik/data/models/diagnostic_models.dart';
import 'package:alfanumrik/ui/screens/diagnostic/diagnostic_alternative_route.dart';

const _label = DiagnosticBilingual(en: 'CTA', hi: 'सीटीए');

DiagnosticAlternative _alt(String kind, String href) =>
    DiagnosticAlternative(kind: kind, label: _label, href: href);

void main() {
  group('diagnosticOtherSubjectCode', () {
    test('extracts the subject from an other_subject href', () {
      expect(
        diagnosticOtherSubjectCode(_alt('other_subject', '/diagnostic?subject=science')),
        'science',
      );
    });

    test('returns null for the other kinds', () {
      expect(diagnosticOtherSubjectCode(_alt('foxy', '/foxy?subject=math')), isNull);
      expect(
        diagnosticOtherSubjectCode(_alt('guided_lesson', '/learn/math/1?mode=read')),
        isNull,
      );
    });
  });

  group('diagnosticAlternativeRoute', () {
    test('other_subject is handled in-app, not by navigation', () {
      expect(
        diagnosticAlternativeRoute(_alt('other_subject', '/diagnostic?subject=science')),
        isNull,
      );
    });

    test('foxy maps to mobile /chat and preserves the subject', () {
      expect(
        diagnosticAlternativeRoute(
            _alt('foxy', '/foxy?subject=math&from=diagnostic_unavailable')),
        '/chat?subject=math',
      );
    });

    test('foxy without a subject still resolves', () {
      expect(diagnosticAlternativeRoute(_alt('foxy', '/foxy')), '/chat');
    });

    test(
        'guided_lesson stops at the subject — mobile\'s second path segment is a '
        'topic UUID, NOT the web\'s chapter number', () {
      expect(
        diagnosticAlternativeRoute(_alt(
          'guided_lesson',
          '/learn/science/3?mode=read&from=diagnostic_unavailable',
        )),
        '/learn/science',
      );
    });

    test('an unknown kind lands on a real screen instead of a dead end', () {
      expect(diagnosticAlternativeRoute(_alt('something_new', '/whatever')), '/learn');
    });

    test('a malformed href never throws', () {
      expect(() => diagnosticAlternativeRoute(_alt('foxy', '::::')), returnsNormally);
      expect(
        () => diagnosticAlternativeRoute(_alt('guided_lesson', '')),
        returnsNormally,
      );
    });
  });
}
