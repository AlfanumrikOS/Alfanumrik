// CEO defect #3 (2026-08-24) — the router half.
//
// `app_router.dart`'s redirect used to open with:
//
//     final session = Supabase.instance.client.auth.currentSession;
//     final isAuth = session != null;
//     if (!isAuth && !isLoginRoute) return '/login';
//
// …a SYNCHRONOUS read against an ASYNCHRONOUSLY restored session. Combined
// with `refreshListenable: ApiConstants.useV2 ? … : null` (null in a default
// build), a student whose session was mid-restore got bounced to `/login` and
// nothing ever re-ran the redirect when the session came back.
//
// The load-bearing assertion in this file: **the router does NOT redirect to
// `/login` while auth status is `restoring`.**
import 'package:flutter_test/flutter_test.dart';

import 'package:alfanumrik/core/router/app_router.dart';
import 'package:alfanumrik/providers/auth_provider.dart';

void main() {
  group('resolveAuthGate — restoring never means logged out', () {
    const protectedRoutes = [
      '/',
      '/today',
      '/learn',
      '/chat',
      '/quiz',
      '/progress',
      '/parent',
      '/settings',
    ];

    for (final location in protectedRoutes) {
      test('$location does NOT redirect to /login while restoring', () {
        final decision = resolveAuthGate(
          status: AuthStatus.restoring,
          matchedLocation: location,
        );

        expect(decision.redirectTo, isNot('/login'));
        expect(decision.redirectTo, authCheckRoute);
        expect(decision.proceed, isFalse);
      });
    }

    test('already on the holding route while restoring → stay put', () {
      final decision = resolveAuthGate(
        status: AuthStatus.restoring,
        matchedLocation: authCheckRoute,
      );

      expect(decision.redirectTo, isNull);
      expect(decision.proceed, isFalse);
    });

    test('a student typing on /login or /signup is not yanked away', () {
      for (final location in const ['/login', '/signup']) {
        final decision = resolveAuthGate(
          status: AuthStatus.restoring,
          matchedLocation: location,
        );
        expect(decision.redirectTo, isNull, reason: location);
        expect(decision.proceed, isFalse, reason: location);
      }
    });
  });

  group('resolveAuthGate — unauthenticated is the only login redirect', () {
    test('protected route → /login', () {
      final decision = resolveAuthGate(
        status: AuthStatus.unauthenticated,
        matchedLocation: '/today',
      );
      expect(decision.redirectTo, '/login');
    });

    test('already on an auth route → stay', () {
      for (final location in const ['/login', '/signup']) {
        expect(
          resolveAuthGate(
            status: AuthStatus.unauthenticated,
            matchedLocation: location,
          ).redirectTo,
          isNull,
          reason: location,
        );
      }
    });

    test('stranded on the holding route → /login (never a permanent spinner)',
        () {
      expect(
        resolveAuthGate(
          status: AuthStatus.unauthenticated,
          matchedLocation: authCheckRoute,
        ).redirectTo,
        '/login',
      );
    });
  });

  group('resolveAuthGate — authenticated', () {
    test('leaves the holding route once restore completes', () {
      final decision = resolveAuthGate(
        status: AuthStatus.authenticated,
        matchedLocation: authCheckRoute,
      );
      expect(decision.redirectTo, '/');
      expect(decision.proceed, isFalse);
    });

    test('hands every other route to the role/experience rules', () {
      for (final location in const ['/', '/today', '/parent', '/login']) {
        final decision = resolveAuthGate(
          status: AuthStatus.authenticated,
          matchedLocation: location,
        );
        expect(decision.redirectTo, isNull, reason: location);
        expect(decision.proceed, isTrue, reason: location);
      }
    });
  });

  group('isLoginRouteLocation', () {
    test('matches exactly /login and /signup', () {
      expect(isLoginRouteLocation('/login'), isTrue);
      expect(isLoginRouteLocation('/signup'), isTrue);
      expect(isLoginRouteLocation('/'), isFalse);
      expect(isLoginRouteLocation('/login-help'), isFalse);
    });
  });
}
