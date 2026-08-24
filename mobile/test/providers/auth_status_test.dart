// CEO defect #3 (2026-08-24) — "the app logs out when the screen is locked".
//
// It was a FALSE logout. `supabase_flutter` restores the persisted session
// asynchronously and restarts `autoRefreshToken` on foreground, but the router
// (and the splash screen) read `Supabase.instance.client.auth.currentSession`
// SYNCHRONOUSLY. Any window where that read returned null — restore in flight,
// refresh in flight, offline — looked identical to a real sign-out and hard
// bounced the student to `/login`.
//
// These tests pin the tri-state that fixes it: only `unauthenticated` may
// redirect to login.
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:supabase_flutter/supabase_flutter.dart';

import 'package:alfanumrik/providers/auth_provider.dart';

// Built through parameterised helpers rather than inline literals: gotrue's
// `AuthState` has a const constructor, so an inline
// `AsyncData(AuthState(AuthChangeEvent.signedOut, null))` is a constant
// expression and trips `prefer_const_constructors` under
// mobile/analysis_options.yaml.
AsyncValue<AuthState> emitted(AuthChangeEvent event, [Session? session]) =>
    AsyncData(AuthState(event, session));

AsyncValue<AuthState> streamError(Object error) =>
    AsyncError<AuthState>(error, StackTrace.empty);

void main() {
  group('resolveAuthStatus', () {
    test('stream still loading + no session → restoring (NOT logged out)', () {
      expect(
        resolveAuthStatus(
          stream: const AsyncLoading<AuthState>(),
          hasCurrentSession: false,
        ),
        AuthStatus.restoring,
      );
    });

    test('a live session always wins, whatever the stream is doing', () {
      for (final stream in <AsyncValue<AuthState>>[
        const AsyncLoading<AuthState>(),
        emitted(AuthChangeEvent.tokenRefreshed),
        emitted(AuthChangeEvent.signedOut),
        streamError('boom'),
      ]) {
        expect(
          resolveAuthStatus(stream: stream, hasCurrentSession: true),
          AuthStatus.authenticated,
          reason: 'stream=$stream',
        );
      }
    });

    test('explicit signOut with no session → unauthenticated', () {
      expect(
        resolveAuthStatus(
          stream: emitted(AuthChangeEvent.signedOut),
          hasCurrentSession: false,
        ),
        AuthStatus.unauthenticated,
      );
    });

    test('initialSession with no session → unauthenticated (cold start)', () {
      // Nothing was persisted to restore. This is the ONE case where a null
      // session really does mean "logged out".
      expect(
        resolveAuthStatus(
          stream: emitted(AuthChangeEvent.initialSession),
          hasCurrentSession: false,
        ),
        AuthStatus.unauthenticated,
      );
    });

    test('tokenRefreshed carrying no session yet → restoring, not logout', () {
      // The exact screen-lock window: a refresh is in flight and the client
      // momentarily has nothing. The old code called this a logout.
      expect(
        resolveAuthStatus(
          stream: emitted(AuthChangeEvent.tokenRefreshed),
          hasCurrentSession: false,
        ),
        AuthStatus.restoring,
      );
    });

    test('broken stream with no session fails closed to login', () {
      // Better than trapping the student on a spinner forever.
      expect(
        resolveAuthStatus(
          stream: streamError('stream died'),
          hasCurrentSession: false,
        ),
        AuthStatus.unauthenticated,
      );
    });
  });

  group('shouldRefreshOnResume', () {
    final now = DateTime.utc(2026, 8, 24, 12, 0, 0);
    int epoch(DateTime d) => d.millisecondsSinceEpoch ~/ 1000;

    test('no session expiry → never refresh (and never sign out)', () {
      expect(
        shouldRefreshOnResume(expiresAtEpochSeconds: null, now: now),
        isFalse,
      );
    });

    test('token with plenty of life left is left alone', () {
      expect(
        shouldRefreshOnResume(
          expiresAtEpochSeconds: epoch(now.add(const Duration(minutes: 30))),
          now: now,
        ),
        isFalse,
      );
    });

    test('token inside the skew window is refreshed ahead of expiry', () {
      expect(
        shouldRefreshOnResume(
          expiresAtEpochSeconds: epoch(now.add(const Duration(seconds: 30))),
          now: now,
        ),
        isTrue,
      );
    });

    test('already-expired token is refreshed', () {
      expect(
        shouldRefreshOnResume(
          expiresAtEpochSeconds: epoch(now.subtract(const Duration(hours: 1))),
          now: now,
        ),
        isTrue,
      );
    });
  });
}
