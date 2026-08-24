import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:supabase_flutter/supabase_flutter.dart';

import '../data/models/student.dart';
import '../data/repositories/auth_repository.dart';
import '../core/network/api_result.dart';

/// Repository singleton
final authRepositoryProvider = Provider<AuthRepository>((ref) {
  return AuthRepository();
});

/// Current student — loaded after auth, refreshed on profile changes
final studentProvider = AsyncNotifierProvider<StudentNotifier, Student?>(
  StudentNotifier.new,
);

class StudentNotifier extends AsyncNotifier<Student?> {
  @override
  Future<Student?> build() async {
    final repo = ref.read(authRepositoryProvider);
    final user = Supabase.instance.client.auth.currentUser;
    if (user == null) return null;

    final result = await repo.getCurrentStudent();
    return result.dataOrNull;
  }

  Future<ApiResult<Student?>> signIn({
    required String email,
    required String password,
  }) async {
    state = const AsyncLoading();
    final result = await ref
        .read(authRepositoryProvider)
        .signIn(email: email, password: password);
    result.when(
      success: (student) => state = AsyncData(student),
      failure: (msg) => state = AsyncError(msg, StackTrace.current),
    );
    return result;
  }

  Future<ApiResult<Student>> signUp({
    required String email,
    required String password,
    required String name,
    required String grade,
  }) async {
    state = const AsyncLoading();
    final result = await ref
        .read(authRepositoryProvider)
        .signUp(email: email, password: password, name: name, grade: grade);
    result.when(
      success: (student) => state = AsyncData(student),
      failure: (msg) => state = AsyncError(msg, StackTrace.current),
    );
    return result;
  }

  Future<void> signOut() async {
    await ref.read(authRepositoryProvider).signOut();
    state = const AsyncData(null);
  }

  Future<void> refresh() async {
    final result = await ref.read(authRepositoryProvider).refreshProfile();
    result.when(
      success: (student) => state = AsyncData(student),
      failure: (_) {},
    );
  }
}

/// Auth state stream — drives router redirects.
///
/// Backed by `GoTrueClient.onAuthStateChange`, which replays its latest event
/// to new subscribers, so a late subscriber still learns the restored session.
final authStateProvider = StreamProvider<AuthState>((ref) {
  return ref.read(authRepositoryProvider).authStateChanges;
});

/// Tri-state auth status.
///
/// CEO defect #3 (2026-08-24) — "the app logs out when the screen is locked".
/// It was a FALSE logout: the router read
/// `Supabase.instance.client.auth.currentSession` SYNCHRONOUSLY, but
/// `supabase_flutter` restores the persisted session asynchronously and
/// restarts `autoRefreshToken` on foreground. Any window where that read
/// returned null (restore in flight, refresh in flight, offline) bounced the
/// student to `/login` even though the persisted session was still valid.
///
/// The cure is to distinguish "we do not know yet" from "definitely signed
/// out". Only [unauthenticated] may redirect to `/login`; [restoring] holds on
/// a loading route.
enum AuthStatus {
  /// Session restore / refresh is in flight. Hold — never redirect to login.
  restoring,

  /// A valid session exists.
  authenticated,

  /// Definitively signed out. This is the ONLY state that may bounce to login.
  unauthenticated,
}

/// Pure resolver for [authStatusProvider] — no Supabase, no Flutter bindings,
/// so it is directly unit-testable.
///
/// [hasCurrentSession] short-circuits to [AuthStatus.authenticated]: a live
/// session always wins, regardless of what the event stream is doing.
AuthStatus resolveAuthStatus({
  required AsyncValue<AuthState> stream,
  required bool hasCurrentSession,
}) {
  if (hasCurrentSession) return AuthStatus.authenticated;

  return stream.when(
    data: (authState) {
      if (authState.session != null) return AuthStatus.authenticated;
      // `signedOut` is an explicit user action (all 15 signOut() call sites).
      // `initialSession` with a null session means there was nothing persisted
      // to restore — a genuinely logged-out cold start.
      if (authState.event == AuthChangeEvent.signedOut ||
          authState.event == AuthChangeEvent.initialSession) {
        return AuthStatus.unauthenticated;
      }
      // Any other event carrying no session (e.g. a token refresh that has not
      // produced one yet) is transient. Hold.
      return AuthStatus.restoring;
    },
    // Stream has not emitted yet — restore is still in flight.
    loading: () => AuthStatus.restoring,
    // A broken auth stream with no session left: fail closed to the login
    // screen rather than trapping the student on a spinner forever.
    error: (_, __) => AuthStatus.unauthenticated,
  );
}

/// Router-facing auth status. Sourced from the EXISTING [authStateProvider]
/// (previously declared but consumed by nothing) so there is exactly one auth
/// stream in the app.
final authStatusProvider = Provider<AuthStatus>((ref) {
  final stream = ref.watch(authStateProvider);
  return resolveAuthStatus(
    stream: stream,
    hasCurrentSession: currentSessionExists(),
  );
});

/// `Supabase.instance` throws if `initialize()` has not run (unit tests).
/// Treat that as "no session" rather than letting it blow up the router.
bool currentSessionExists() {
  try {
    return Supabase.instance.client.auth.currentSession != null;
  } catch (_) {
    return false;
  }
}

/// Whether a resumed app should proactively refresh its access token.
///
/// Pure + testable. Returns false when there is no session at all — a missing
/// session must NEVER trigger a refresh attempt (and never a sign-out); it is
/// left to `supabase_flutter`'s own restore.
///
/// [skew] refreshes slightly ahead of real expiry so a student coming back to a
/// locked phone does not fire their first request with a token that dies
/// mid-flight.
bool shouldRefreshOnResume({
  required int? expiresAtEpochSeconds,
  required DateTime now,
  Duration skew = const Duration(minutes: 2),
}) {
  if (expiresAtEpochSeconds == null) return false;
  final expiry = DateTime.fromMillisecondsSinceEpoch(
    expiresAtEpochSeconds * 1000,
    isUtc: true,
  );
  return expiry.difference(now.toUtc()) <= skew;
}
