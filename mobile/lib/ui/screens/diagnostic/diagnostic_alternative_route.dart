// Translates a diagnostic `alternatives[].href` (a WEB URL, emitted verbatim
// by `apps/host/src/app/api/diagnostic/start/route.ts`'s `buildAlternatives`)
// into something mobile can actually act on.
//
// This is the same web→mobile translation problem `today_deeplink.dart` solves
// for the Today queue; it is deliberately kept separate because the diagnostic
// hrefs are a small, known, server-controlled set rather than an open space.
//
// The three server-emitted kinds and what mobile does with each:
//
//   other_subject  `/diagnostic?subject=<code>`
//                  → NOT a navigation. Mobile re-selects that subject in the
//                    diagnostic setup state and restarts, because pushing
//                    `/diagnostic` on top of `/diagnostic` would stack a second
//                    copy of the same screen with the same provider state.
//
//   guided_lesson  `/learn/<subject>/<chapterNumber>?mode=read&from=…`
//                  → `/learn/<subject>` (the chapters list).
//                    DELIBERATE: mobile's nested route is
//                    `/learn/:subjectCode/:topicId` — the second segment is a
//                    topic UUID, NOT a chapter number. Forwarding the web's
//                    chapter number into that slot would deep-link to a topic
//                    that does not exist. The chapters list is the closest
//                    destination that is guaranteed to resolve.
//
//   foxy           `/foxy?subject=<code>&from=…`
//                  → `/chat?subject=<code>` (mobile's Foxy surface; the route
//                    already accepts `subject`).
//
// Anything unrecognised falls back to `/learn`, never to a dead end.

import '../../../data/models/diagnostic_models.dart';

/// Subject code carried by an `other_subject` alternative, or null when this
/// alternative is not an in-app subject switch.
String? diagnosticOtherSubjectCode(DiagnosticAlternative alt) {
  if (alt.kind != 'other_subject') return null;
  final code = _queryParam(alt.href, 'subject');
  return (code != null && code.isNotEmpty) ? code : null;
}

/// Mobile GoRouter location for a NAVIGABLE alternative. Returns null for
/// `other_subject`, which the diagnostic screen handles in-place.
String? diagnosticAlternativeRoute(DiagnosticAlternative alt) {
  switch (alt.kind) {
    case 'other_subject':
      return null;
    case 'foxy':
      final subject = _queryParam(alt.href, 'subject');
      return (subject != null && subject.isNotEmpty)
          ? '/chat?subject=${Uri.encodeQueryComponent(subject)}'
          : '/chat';
    case 'guided_lesson':
      final subject = _firstPathSegmentAfter(alt.href, 'learn');
      return (subject != null && subject.isNotEmpty) ? '/learn/$subject' : '/learn';
    default:
      // Unknown kind from a newer server build. Do not attempt to replay an
      // arbitrary web path through mobile's router — land somewhere real.
      return '/learn';
  }
}

String? _queryParam(String href, String key) {
  final uri = Uri.tryParse(href);
  if (uri == null) return null;
  return uri.queryParameters[key];
}

String? _firstPathSegmentAfter(String href, String marker) {
  final uri = Uri.tryParse(href);
  if (uri == null) return null;
  final segments = uri.pathSegments;
  final idx = segments.indexOf(marker);
  if (idx < 0 || idx + 1 >= segments.length) return null;
  return segments[idx + 1];
}
