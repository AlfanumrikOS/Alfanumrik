// today_deeplink.dart — turns a `/v2` `TodayDeepLink` ({route, params}) into a
// navigable MOBILE GoRouter location.
//
// The server emits WEB routes in `deepLink.route` (the navigation contract is
// the web URL space, e.g. `/learn/science/3`, `/quiz`, `/dive`,
// `/synthesis`, `/foxy`). Mobile's GoRouter uses a different route shape, so
// this is the SINGLE place that web → mobile route translation happens.
// Widgets pass the result straight to `context.go(...)`.
//
// Translation is intentionally conservative: for the routes Wave 2.3 mobile
// already has screens for we map precisely; for anything else (weekly dive,
// monthly synthesis — not yet ported to mobile) we fall back to the closest
// existing tab so a tap is never a dead end. The next increment will add the
// missing destinations and tighten this map.

import 'package:alfanumrik_api_v2/alfanumrik_api_v2.dart';

/// Resolve a parsed [TodayDeepLink] into a mobile GoRouter path (path +
/// optional querystring). Never returns an empty string.
String resolveMobileRoute(TodayDeepLink deepLink) {
  final webRoute = deepLink.route;
  final params = _flatParams(deepLink);

  // Normalise: strip a trailing slash (but keep root "/").
  final route = (webRoute.length > 1 && webRoute.endsWith('/'))
      ? webRoute.substring(0, webRoute.length - 1)
      : webRoute;

  // ── Learn: web `/learn/<subjectCode>/<chapterNumber>` → mobile
  //    `/learn/<subjectCode>/<chapterNumber>` (same shape; mobile's nested
  //    route is `/learn/:subjectCode/:topicId`). Bare `/learn` → subjects.
  if (route == '/learn' || route.startsWith('/learn/')) {
    return _withQuery(route, params);
  }

  // ── Quiz: web `/quiz?subject=…&chapter=…` → mobile `/quiz` (the quiz tab).
  //    Mobile's quiz screen owns its own setup; params are preserved on the
  //    querystring for when the quiz screen learns to honour them.
  if (route == '/quiz' || route.startsWith('/quiz')) {
    return _withQuery('/quiz', params);
  }

  // ── Foxy / chat: web `/foxy` → mobile `/chat` (the Foxy tab).
  if (route == '/foxy' || route.startsWith('/foxy')) {
    return '/chat';
  }

  // ── Routes mobile has not yet ported (weekly dive, monthly synthesis, and
  //    any future web-only destination). Fall back to a sensible existing
  //    surface so the tap always lands somewhere:
  //      • dive / synthesis → Learn (closest "explore your learning" home)
  //      • everything else  → Today home root
  if (route.startsWith('/dive') || route.startsWith('/synthesis')) {
    return '/learn';
  }

  // Unknown / web-only route — land on the Today home rather than a 404.
  return '/today';
}

/// Flatten the generated `BuiltMap<String, TodayDeepLinkParamsValue>` into a
/// plain `<String, String>` map (the param values are AnyOf<String, num>).
Map<String, String> _flatParams(TodayDeepLink deepLink) {
  final params = deepLink.params;
  if (params == null || params.isEmpty) return const {};
  final out = <String, String>{};
  for (final entry in params.entries) {
    // The param value is an `AnyOf<String, num>` (built_value oneOf wrapper).
    // `AnyOf.value` (from package:one_of) holds the underlying String or num.
    // Read it via `dynamic` so we don't couple to the wrapper's exact type.
    final dynamic anyOf = entry.value.anyOf;
    final Object? value = anyOf.value as Object?;
    if (value != null) out[entry.key] = value.toString();
  }
  return out;
}

/// Append [params] as a stable-order querystring; route alone when empty.
String _withQuery(String route, Map<String, String> params) {
  if (params.isEmpty) return route;
  final qs = params.entries
      .map((e) =>
          '${Uri.encodeQueryComponent(e.key)}=${Uri.encodeQueryComponent(e.value)}')
      .join('&');
  return '$route?$qs';
}
