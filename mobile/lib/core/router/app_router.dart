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
import '../../ui/screens/stem/stem_lab_screen.dart';
import '../../ui/screens/subscription/plans_screen.dart';
import '../../ui/screens/settings/settings_screen.dart';
import '../../ui/widgets/app_shell.dart';
import '../constants/api_constants.dart';

final routerProvider = Provider<GoRouter>((ref) {
  return GoRouter(
    initialLocation: '/',
    redirect: (context, state) {
      final session = Supabase.instance.client.auth.currentSession;
      final isAuth = session != null;
      final isLoginRoute = state.matchedLocation == '/login' ||
          state.matchedLocation == '/signup';

      if (!isAuth && !isLoginRoute) return '/login';
      if (isAuth && isLoginRoute) return ApiConstants.useV2 ? '/today' : '/';

      // /v2 flag ON: the adaptive Today home is the default authed landing.
      // Redirect the legacy Dashboard root to it so deep links and the
      // initial location both resolve to /today. Flag OFF: no redirect, the
      // root stays on Dashboard exactly as today.
      if (isAuth &&
          ApiConstants.useV2 &&
          state.matchedLocation == '/') {
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
    ],
  );
});
