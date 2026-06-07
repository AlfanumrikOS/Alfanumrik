import 'package:flutter/foundation.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:supabase_flutter/supabase_flutter.dart';

import '../../ui/screens/auth/login_screen.dart';
import '../../ui/screens/auth/signup_screen.dart';
import '../../ui/screens/dashboard/dashboard_screen.dart';
import '../../ui/screens/today/today_screen.dart';
import '../../ui/screens/learning/subjects_screen.dart';
import '../../ui/screens/learning/chapters_screen.dart';
import '../../ui/screens/learning/concept_screen.dart';
import '../../ui/screens/chat/chat_screen.dart';
import '../../ui/screens/quiz/quiz_screen.dart';
import '../../ui/screens/progress/progress_screen.dart';
import '../../ui/screens/leaderboard/leaderboard_screen.dart';
import '../../ui/screens/parent/parent_glance_screen.dart';
import '../../ui/screens/stem/stem_lab_screen.dart';
import '../../ui/screens/subscription/plans_screen.dart';
import '../../ui/screens/settings/settings_screen.dart';
import '../../ui/widgets/app_shell.dart';
import '../../providers/role_provider.dart';
import '../constants/api_constants.dart';

final routerProvider = Provider<GoRouter>((ref) {
  return GoRouter(
    initialLocation: '/',
    // Re-evaluate redirects when the async role lookup resolves so a freshly
    // authenticated guardian is forked to `/parent` as soon as the role is
    // known.
    //
    // CRITICAL (flag-OFF byte-identical): this listenable is attached ONLY when
    // `ApiConstants.useV2` is ON. When OFF it is null, so the [roleProvider] is
    // NEVER initialized — no `get_user_role` RPC is ever issued on the auth
    // path of a flag-OFF build, and the router behaves exactly as it does today.
    refreshListenable:
        ApiConstants.useV2 ? _RoleRefreshNotifier(ref) : null,
    redirect: (context, state) {
      final session = Supabase.instance.client.auth.currentSession;
      final isAuth = session != null;
      final isLoginRoute = state.matchedLocation == '/login' ||
          state.matchedLocation == '/signup';

      if (!isAuth && !isLoginRoute) return '/login';

      // ── /v2 flag OFF: behaviour is BYTE-IDENTICAL to today. The role
      // provider is never consulted; the student tree is the only experience. ──
      if (!ApiConstants.useV2) {
        if (isAuth && isLoginRoute) return '/';
        return null;
      }

      // ── /v2 flag ON: role-aware fork. ──
      // A guardian lands on the parent tree (`/parent`); everyone else (student
      // or not-yet-resolved role) lands on the existing student flow (`/today`).
      // `isGuardianProvider` defaults to false while the role lookup is loading
      // or on error, so a student is NEVER blocked on the async lookup and a
      // guardian on a slow network briefly sees `/today` until the role
      // resolves and the refreshListenable re-runs this redirect.
      final isGuardian = ref.read(isGuardianProvider);

      if (isAuth && isLoginRoute) {
        return isGuardian ? '/parent' : '/today';
      }

      if (isAuth && isGuardian) {
        // Keep guardians inside the parent tree. If they somehow land on a
        // student route (deep link, root), send them to /parent.
        if (state.matchedLocation == '/' ||
            !state.matchedLocation.startsWith('/parent')) {
          return '/parent';
        }
        return null;
      }

      // Student (or unresolved role) under the flag: the adaptive Today home is
      // the default authed landing. Redirect the legacy Dashboard root to it.
      if (isAuth && state.matchedLocation == '/') {
        return '/today';
      }
      // A non-guardian must never sit on the parent tree.
      if (isAuth && state.matchedLocation.startsWith('/parent')) {
        return '/today';
      }
      return null;
    },
    routes: [
      // Auth routes (no shell)
      GoRoute(
        path: '/login',
        builder: (context, state) => const LoginScreen(),
      ),
      GoRoute(
        path: '/signup',
        builder: (context, state) => const SignupScreen(),
      ),

      // Main app with bottom nav shell
      ShellRoute(
        builder: (context, state, child) => AppShell(child: child),
        routes: [
          GoRoute(
            path: '/',
            pageBuilder: (context, state) => const NoTransitionPage(
              child: DashboardScreen(),
            ),
          ),
          // /v2 adaptive Today home. Only reachable when ApiConstants.useV2 is
          // ON (the redirect above sends '/' → '/today' and the 4-tab nav
          // points here). Registered unconditionally so the route always
          // resolves; flag-OFF builds simply never navigate to it.
          GoRoute(
            path: '/today',
            pageBuilder: (context, state) => const NoTransitionPage(
              child: TodayScreen(),
            ),
          ),
          GoRoute(
            path: '/learn',
            pageBuilder: (context, state) => const NoTransitionPage(
              child: SubjectsScreen(),
            ),
            routes: [
              GoRoute(
                path: ':subjectCode',
                builder: (context, state) => ChaptersScreen(
                  subjectCode: state.pathParameters['subjectCode']!,
                ),
                routes: [
                  GoRoute(
                    path: ':topicId',
                    builder: (context, state) => ConceptScreen(
                      topicId: state.pathParameters['topicId']!,
                      subjectCode: state.pathParameters['subjectCode']!,
                    ),
                  ),
                ],
              ),
            ],
          ),
          GoRoute(
            path: '/chat',
            pageBuilder: (context, state) => const NoTransitionPage(
              child: ChatScreen(),
            ),
          ),
          GoRoute(
            path: '/quiz',
            pageBuilder: (context, state) => const NoTransitionPage(
              child: QuizScreen(),
            ),
          ),
          // /v2 student-parity surfaces (Wave 2.3b). Registered
          // unconditionally so the routes always resolve; flag-OFF builds
          // never navigate to them (no nav/entry point shows them). Kept in
          // the shell so they keep the bottom nav.
          GoRoute(
            path: '/progress',
            pageBuilder: (context, state) => const NoTransitionPage(
              child: ProgressScreen(),
            ),
          ),
          GoRoute(
            path: '/leaderboard',
            pageBuilder: (context, state) => const NoTransitionPage(
              child: LeaderboardScreen(),
            ),
          ),
          GoRoute(
            path: '/settings',
            pageBuilder: (context, state) => const NoTransitionPage(
              child: SettingsScreen(),
            ),
          ),
        ],
      ),

      // Full-screen routes (no bottom nav)
      GoRoute(
        path: '/plans',
        builder: (context, state) => const PlansScreen(),
      ),
      // STEM Lab — Tier 3 R12 Phase 1: WebView wrap of /stem-centre.
      // Full-screen (no bottom nav) so simulations get max screen real estate.
      GoRoute(
        path: '/stem-lab',
        builder: (context, state) => const StemLabScreen(),
      ),

      // ── Parent tree (Wave 2.4) ──────────────────────────────────────────
      // The guardian's glance-first home. Registered unconditionally so the
      // route always resolves, but only REACHABLE when `ApiConstants.useV2` is
      // ON AND the authenticated user is a guardian (the redirect above forks
      // guardians here and keeps non-guardians out). Full-screen (no bottom nav
      // shell) — the parent mobile is intentionally minimal: glance + logout.
      GoRoute(
        path: '/parent',
        builder: (context, state) => const ParentGlanceScreen(),
      ),
    ],
  );
});

/// Bridges the async [roleProvider] to GoRouter's [GoRouter.refreshListenable]
/// so the redirect re-runs the moment the role lookup resolves (or changes).
///
/// It listens to [roleProvider] via the router provider's own `ref` and pings
/// listeners on any change. Only consequential when `ApiConstants.useV2` is ON
/// — the redirect ignores role when the flag is OFF, so a flag-OFF build sees
/// no extra redirects from this notifier.
class _RoleRefreshNotifier extends ChangeNotifier {
  _RoleRefreshNotifier(Ref ref) {
    _sub = ref.listen<AsyncValue<UserRole>>(
      roleProvider,
      (_, __) => notifyListeners(),
    );
  }

  late final ProviderSubscription<AsyncValue<UserRole>> _sub;

  @override
  void dispose() {
    _sub.close();
    super.dispose();
  }
}
