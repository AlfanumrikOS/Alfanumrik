import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:supabase_flutter/supabase_flutter.dart';

import '../../ui/screens/splash/splash_screen.dart';
import '../../ui/screens/auth/login_screen.dart';
import '../../ui/screens/auth/signup_screen.dart';
import '../../ui/screens/dashboard/dashboard_screen.dart';
import '../../ui/screens/learning/subjects_screen.dart';
import '../../ui/screens/learning/chapters_screen.dart';
import '../../ui/screens/learning/topics_screen.dart';
import '../../ui/screens/learning/concept_screen.dart';
import '../../ui/screens/chat/chat_screen.dart';
import '../../ui/screens/quiz/quiz_screen.dart';
import '../../ui/screens/subscription/plans_screen.dart';
import '../../ui/screens/settings/settings_screen.dart';
import '../../ui/widgets/app_shell.dart';

final routerProvider = Provider<GoRouter>((ref) {
  return GoRouter(
    initialLocation: '/splash',
    redirect: (context, state) {
      final loc = state.matchedLocation;

      // Allow splash to handle its own redirect
      if (loc == '/splash') return null;

      final session = Supabase.instance.client.auth.currentSession;
      final isAuth = session != null;
      final isAuthRoute = loc == '/login' || loc == '/signup';

      if (!isAuth && !isAuthRoute) return '/login';
      if (isAuth && isAuthRoute) return '/home';
      return null;
    },
    routes: [
      // Splash
      GoRoute(
        path: '/splash',
        builder: (context, state) => const SplashScreen(),
      ),

      // Auth routes (no shell)
      GoRoute(
        path: '/login',
        builder: (context, state) => const LoginScreen(),
      ),
      GoRoute(
        path: '/signup',
        pageBuilder: (context, state) => CustomTransitionPage(
          child: const SignupScreen(),
          transitionsBuilder: (context, animation, secondaryAnimation, child) {
            return SlideTransition(
              position: Tween(
                begin: const Offset(1, 0),
                end: Offset.zero,
              ).animate(CurvedAnimation(
                parent: animation,
                curve: Curves.easeInOut,
              )),
              child: child,
            );
          },
        ),
      ),

      // Main app with bottom nav shell
      ShellRoute(
        builder: (context, state, child) => AppShell(child: child),
        routes: [
          GoRoute(
            path: '/home',
            pageBuilder: (context, state) => const NoTransitionPage(
              child: DashboardScreen(),
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
                pageBuilder: (context, state) => _slideFromRight(
                  ChaptersScreen(
                    subjectCode: state.pathParameters['subjectCode']!,
                  ),
                ),
                routes: [
                  GoRoute(
                    path: ':chapterId',
                    pageBuilder: (context, state) => _slideFromRight(
                      TopicsScreen(
                        subjectCode: state.pathParameters['subjectCode']!,
                        chapterId: state.pathParameters['chapterId']!,
                        chapterTitle: state.uri.queryParameters['title'] ?? 'Topics',
                      ),
                    ),
                    routes: [
                      GoRoute(
                        path: ':topicId',
                        pageBuilder: (context, state) => _slideFromRight(
                          ConceptScreen(
                            topicId: state.pathParameters['topicId']!,
                            subjectCode: state.pathParameters['subjectCode']!,
                          ),
                        ),
                      ),
                    ],
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
        pageBuilder: (context, state) => _slideFromBottom(
          const PlansScreen(),
        ),
      ),
    ],
  );
});

/// Slide from right transition for pushed screens
CustomTransitionPage _slideFromRight(Widget child) {
  return CustomTransitionPage(
    child: child,
    transitionDuration: const Duration(milliseconds: 250),
    transitionsBuilder: (context, animation, secondaryAnimation, child) {
      return SlideTransition(
        position: Tween(
          begin: const Offset(1, 0),
          end: Offset.zero,
        ).animate(CurvedAnimation(
          parent: animation,
          curve: Curves.easeInOut,
        )),
        child: child,
      );
    },
  );
}

/// Slide from bottom transition for modal screens
CustomTransitionPage _slideFromBottom(Widget child) {
  return CustomTransitionPage(
    child: child,
    transitionDuration: const Duration(milliseconds: 300),
    transitionsBuilder: (context, animation, secondaryAnimation, child) {
      return SlideTransition(
        position: Tween(
          begin: const Offset(0, 1),
          end: Offset.zero,
        ).animate(CurvedAnimation(
          parent: animation,
          curve: Curves.easeOutCubic,
        )),
        child: child,
      );
    },
  );
}
