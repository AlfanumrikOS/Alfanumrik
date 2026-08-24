import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:supabase_flutter/supabase_flutter.dart';

import 'core/constants/api_constants.dart';
import 'core/router/app_router.dart';
import 'core/theme/app_theme.dart';
import 'providers/auth_provider.dart';
import 'providers/offline_quiz_provider.dart';

class AlfanumrikApp extends ConsumerStatefulWidget {
  const AlfanumrikApp({super.key});

  @override
  ConsumerState<AlfanumrikApp> createState() => _AlfanumrikAppState();
}

class _AlfanumrikAppState extends ConsumerState<AlfanumrikApp>
    with WidgetsBindingObserver {
  @override
  void initState() {
    super.initState();
    // The observer is registered UNCONDITIONALLY. It used to be gated on
    // `ApiConstants.useV2`, which defaults to false — so a default build had NO
    // lifecycle observer and therefore nothing that could recover the auth
    // session on foreground (CEO defect #3). Auth recovery must not depend on
    // an unrelated experiment flag. The OFFLINE DRAIN inside the callback stays
    // flag-gated, so flag-OFF offline behaviour is unchanged.
    WidgetsBinding.instance.addObserver(this);
    if (ApiConstants.useV2) {
      // Instantiate the coordinator once at startup so its connectivity
      // listener (drain-on-reconnect) is installed. Deferred to the first
      // frame so the Hive store provider has resolved. No-op when useV2 is OFF.
      WidgetsBinding.instance.addPostFrameCallback((_) => _kickOffline());
    }
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    super.dispose();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state != AppLifecycleState.resumed) return;

    // On app FOREGROUND, recover the auth session BEFORE anything that needs a
    // bearer token. Screen-lock/unlock is the common path here.
    unawaited(_recoverSession());

    // …then drain any queued offline attempts. The drain serializes
    // internally, so this never races the connectivity listener.
    if (ApiConstants.useV2) {
      _kickOffline();
    }
  }

  /// Best-effort token refresh on foreground.
  ///
  /// Deliberate non-behaviours (CEO defect #3):
  ///   * NEVER calls `signOut()`. A failed refresh is a network problem, not a
  ///     logout. `api_client.dart` maps 401 → `NetworkException.unauthorized()`
  ///     for the same reason; that contract is preserved.
  ///   * Does nothing when there is no current session — `refreshSession()`
  ///     would throw, and restoring a persisted session is `supabase_flutter`'s
  ///     own job.
  ///   * Swallows every error. The router's tri-state gate keeps the student on
  ///     screen while offline instead of bouncing them to `/login`.
  Future<void> _recoverSession() async {
    try {
      final auth = Supabase.instance.client.auth;
      final session = auth.currentSession;
      if (session == null) return;
      if (!shouldRefreshOnResume(
        expiresAtEpochSeconds: session.expiresAt,
        now: DateTime.now(),
      )) {
        return;
      }
      await auth.refreshSession();
    } catch (_) {
      // Offline or transient auth failure — intentionally ignored. P13: the
      // error is not logged because auth errors can carry identifying detail.
    }
  }

  void _kickOffline() {
    final coordinator = ref.read(offlineQuizCoordinatorProvider);
    if (coordinator != null) {
      unawaited(coordinator.drain());
    }
  }

  @override
  Widget build(BuildContext context) {
    final router = ref.watch(routerProvider);

    return MaterialApp.router(
      title: 'Alfanumrik',
      debugShowCheckedModeBanner: false,
      theme: AppTheme.light,
      darkTheme: AppTheme.dark,
      themeMode: ThemeMode.light,
      routerConfig: router,
    );
  }
}
