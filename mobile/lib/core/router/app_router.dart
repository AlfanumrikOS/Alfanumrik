import 'package:flutter/material.dart';
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
import '../../ui/screens/parent/parent_v3_sections.dart';
import '../../ui/screens/stem/stem_lab_screen.dart';
import '../../ui/screens/stem/lab_notebook_screen.dart';
import '../../ui/screens/subscription/plans_screen.dart';
import '../../ui/screens/settings/settings_screen.dart';
import '../../ui/screens/notifications/notifications_screen.dart';
import '../../ui/screens/library/library_screen.dart';
import '../../ui/screens/challenge/daily_challenge_screen.dart';
import '../../ui/screens/pyq/pyq_screen.dart';
import '../../ui/screens/diagnostic/diagnostic_screen.dart';
import '../../ui/screens/revision/revision_overview_screen.dart';
import '../../ui/screens/revision/quick_recall_screen.dart';
import '../../ui/screens/assignments/assignments_list_screen.dart';
import '../../ui/screens/assignments/assignment_detail_screen.dart';
import '../../ui/screens/exam/exam_catalog_screen.dart';
import '../../ui/screens/exam/mock_exam_screen.dart';
import '../../ui/screens/exam/mock_exam_results_screen.dart';
import '../../ui/screens/scan_solve/scan_capture_screen.dart';
import '../../ui/screens/scan_solve/scan_solve_result_screen.dart';
import '../../ui/screens/dive/dive_screen.dart';
import '../../ui/screens/dive/dive_history_screen.dart';
import '../../ui/screens/synthesis/synthesis_screen.dart';
import '../../ui/screens/progress/hpc_screen.dart';
import '../../ui/widgets/app_shell.dart';
import '../../ui/widgets/parent_app_shell.dart';
import '../../providers/experience_provider.dart';
import '../../providers/parent_provider.dart';
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
    refreshListenable: ApiConstants.useV2 ? _RoleRefreshNotifier(ref) : null,
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

      // ── /v2 flag ON: role-aware, fail-closed fork. ──
      // Restricted role destinations never flash while the authoritative RPC
      // is loading. Unknown/unsupported roles get a recoverable access screen
      // instead of being silently treated as students.
      final roleAsync = ref.read(roleProvider);
      if (roleAsync.isLoading) {
        return state.matchedLocation == '/role-check' ? null : '/role-check';
      }
      final role = roleAsync.valueOrNull ?? UserRole.unknown;
      if (role == UserRole.unknown) {
        return state.matchedLocation == '/unsupported-role'
            ? null
            : '/unsupported-role';
      }
      final isGuardian = role == UserRole.guardian;
      final experienceAsync = ref.read(oneExperienceProvider);
      if (experienceAsync.isLoading) {
        // A child switch re-resolves the parent scope. Keep the current parent
        // subroute while its shell renders a closed loading state.
        if (isAuth && state.matchedLocation.startsWith('/parent')) return null;
        return state.matchedLocation == '/role-check' ? null : '/role-check';
      }
      final resolution =
          experienceAsync.valueOrNull ?? OneExperienceResolution.denied;
      final assignment = resolution.assignment;
      if (assignment == OneExperienceAssignment.denied) {
        return state.matchedLocation == '/experience-unavailable'
            ? null
            : '/experience-unavailable';
      }
      final oneExperience = assignment == OneExperienceAssignment.enabled;
      if (oneExperience &&
          !oneExperienceAllowsPath(
            resolution,
            experienceRoleFor(role)!,
            state.matchedLocation,
          )) {
        return state.matchedLocation == '/experience-unavailable'
            ? null
            : '/experience-unavailable';
      }

      if (isAuth && isLoginRoute) {
        return isGuardian ? '/parent' : (oneExperience ? '/today' : '/');
      }

      if (state.matchedLocation == '/role-check' ||
          state.matchedLocation == '/unsupported-role' ||
          state.matchedLocation == '/experience-unavailable') {
        return isGuardian ? '/parent' : (oneExperience ? '/today' : '/');
      }

      if (isAuth && isGuardian) {
        // Keep guardians inside the parent tree. If they somehow land on a
        // student route (deep link, root), send them to /parent.
        if (state.matchedLocation == '/' ||
            !state.matchedLocation.startsWith('/parent')) {
          return '/parent';
        }
        if (!oneExperience && state.matchedLocation != '/parent') {
          return '/parent';
        }
        return null;
      }

      const oneExperienceOnlyRoutes = {'/today', '/progress', '/leaderboard'};
      if (!oneExperience &&
          oneExperienceOnlyRoutes.contains(state.matchedLocation)) {
        return '/';
      }

      // Student (or unresolved role) under the flag: the adaptive Today home is
      // the default authed landing. Redirect the legacy Dashboard root to it.
      if (isAuth && state.matchedLocation == '/') {
        return oneExperience ? '/today' : null;
      }
      // A non-guardian must never sit on the parent tree.
      if (isAuth && state.matchedLocation.startsWith('/parent')) {
        return oneExperience ? '/today' : '/';
      }
      return null;
    },
    routes: [
      // Auth routes (no shell)
      GoRoute(path: '/login', builder: (context, state) => const LoginScreen()),
      GoRoute(
        path: '/signup',
        builder: (context, state) => const SignupScreen(),
      ),
      GoRoute(
        path: '/role-check',
        builder: (context, state) => const _RoleCheckScreen(),
      ),
      GoRoute(
        path: '/unsupported-role',
        builder: (context, state) => const _UnsupportedRoleScreen(),
      ),
      GoRoute(
        path: '/experience-unavailable',
        builder: (context, state) => const _ExperienceUnavailableScreen(),
      ),

      // Main app with bottom nav shell
      ShellRoute(
        builder: (context, state, child) => AppShell(child: child),
        routes: [
          GoRoute(
            path: '/',
            pageBuilder: (context, state) =>
                const NoTransitionPage(child: DashboardScreen()),
          ),
          // /v2 adaptive Today home. Only reachable when ApiConstants.useV2 is
          // ON (the redirect above sends '/' → '/today' and the 4-tab nav
          // points here). Registered unconditionally so the route always
          // resolves; flag-OFF builds simply never navigate to it.
          GoRoute(
            path: '/today',
            pageBuilder: (context, state) =>
                const NoTransitionPage(child: TodayScreen()),
          ),
          GoRoute(
            path: '/learn',
            pageBuilder: (context, state) =>
                const NoTransitionPage(child: SubjectsScreen()),
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
          // Phase 6 sub-phase 7 (Weekly Dive): `/chat` now optionally reads
          // `mode`, `topic` and `subject` query parameters so the Weekly
          // Curiosity Dive can launch Foxy in `explorer` mode on the dive's
          // topic — mobile's equivalent of the web dive's
          // `/foxy?mode=explorer&topic=…` hand-off. A bare `/chat` push (no
          // query params) behaves EXACTLY as before: `initialMode` is null,
          // so ChatScreen runs its original "start a session only if none
          // exists, in the default `learn` mode" branch.
          GoRoute(
            path: '/chat',
            pageBuilder: (context, state) {
              final qp = state.uri.queryParameters;
              final mode = qp['mode'];
              return NoTransitionPage(
                child: ChatScreen(
                  initialMode: (mode != null && mode.isNotEmpty) ? mode : null,
                  initialTopic: qp['topic'],
                  initialSubject: qp['subject'],
                ),
              );
            },
          ),
          // Phase 6 sub-phase 5 (Assignments): `/quiz` now optionally reads
          // query parameters (`subject`, `count`, `chapter`, `from`,
          // `assignmentId`) so a deep link from the Assignments screen can
          // auto-start the right quiz — mirrors the web's
          // `/quiz?subject=&count=&chapter=&from=assignment&assignmentId=`.
          // A bare `/quiz` push (no query params) behaves EXACTLY as before
          // (manual subject picker).
          GoRoute(
            path: '/quiz',
            pageBuilder: (context, state) {
              final qp = state.uri.queryParameters;
              final from = qp['from'];
              final assignmentId = from == 'assignment' ? qp['assignmentId'] : null;
              return NoTransitionPage(
                child: QuizScreen(
                  initialSubject: qp['subject'],
                  initialChapter: qp['chapter'],
                  initialCount: int.tryParse(qp['count'] ?? ''),
                  assignmentId: (assignmentId != null && assignmentId.isNotEmpty)
                      ? assignmentId
                      : null,
                ),
              );
            },
          ),
          // /v2 student-parity surfaces (Wave 2.3b). Registered
          // unconditionally so the routes always resolve; flag-OFF builds
          // never navigate to them (no nav/entry point shows them). Kept in
          // the shell so they keep the bottom nav.
          GoRoute(
            path: '/progress',
            pageBuilder: (context, state) =>
                const NoTransitionPage(child: ProgressScreen()),
          ),
          GoRoute(
            path: '/leaderboard',
            pageBuilder: (context, state) =>
                const NoTransitionPage(child: LeaderboardScreen()),
          ),
          GoRoute(
            path: '/settings',
            pageBuilder: (context, state) =>
                const NoTransitionPage(child: SettingsScreen()),
          ),
        ],
      ),

      // Full-screen routes (no bottom nav)
      GoRoute(path: '/plans', builder: (context, state) => const PlansScreen()),
      // STEM Lab — Tier 3 R12 Phase 1: WebView wrap of /stem-centre.
      // Full-screen (no bottom nav) so simulations get max screen real estate.
      GoRoute(
        path: '/stem-lab',
        builder: (context, state) => const StemLabScreen(),
      ),
      // Lab Notebook — WebView wrap of /lab-notebook/[studentId]. Full-screen,
      // same pattern as STEM Lab above.
      GoRoute(
        path: '/lab-notebook',
        builder: (context, state) => const LabNotebookScreen(),
      ),
      // Notifications feed — Phase 6 mobile parity for
      // src/app/notifications/page.tsx. Full-screen (pushed from the bell
      // overlay in AppShell / the Settings "Notifications" tile).
      GoRoute(
        path: '/notifications',
        builder: (context, state) => const NotificationsScreen(),
      ),
      // Library — browse-first content discovery (Tier 3 mobile parity for
      // src/app/(student)/library/page.tsx). Full-screen; chapter taps push
      // into the EXISTING /learn/:subjectCode/:topicId route.
      GoRoute(
        path: '/library',
        builder: (context, state) => const LibraryScreen(),
      ),
      // Daily Challenge (Concept Chain) — Phase 6 sub-phase 2 mobile parity
      // for src/app/challenge/page.tsx. Full-screen, own back button (not a
      // bottom-tab destination on web either).
      GoRoute(
        path: '/challenge',
        builder: (context, state) => const DailyChallengeScreen(),
      ),
      // PYQ (Previous Year Questions) — mobile parity for
      // src/app/(student)/pyq/page.tsx. Shares question_bank directly
      // (year-tagged, falling back to ungapped bank questions) — confirmed
      // NOT wired to the exam_papers/mock-test system.
      GoRoute(
        path: '/pyq',
        builder: (context, state) => const PyqScreen(),
      ),
      // Diagnostic assessment — mobile parity for src/app/diagnostic/page.tsx.
      // Deep-linked from the `first_quiz_nudge` notification type (Phase 6
      // sub-phase 1's notification_type_config.dart already registers that
      // type's icon/label; this route registration is what resolves its
      // `/diagnostic` deep link instead of it being a dead link on mobile).
      GoRoute(
        path: '/diagnostic',
        builder: (context, state) => const DiagnosticScreen(),
      ),
      // Refresh — Phase 6 sub-phase 4 mobile parity for
      // src/app/refresh/page.tsx (Quick Recall + Chapter Refresh +
      // Retention Tests). Full-screen, own back button (matches web, which
      // also has its own header rather than living inside the bottom nav).
      GoRoute(
        path: '/refresh',
        builder: (context, state) => const RevisionOverviewScreen(),
      ),
      GoRoute(
        path: '/refresh/recall',
        builder: (context, state) => const QuickRecallScreen(),
      ),
      // Assignments (teacher-created) — Phase 6 sub-phase 5 mobile parity
      // for `apps/host/src/app/(student)/assignments/page.tsx`. Full-screen
      // (own back button, matches web which also has its own header rather
      // than living inside the bottom nav).
      GoRoute(
        path: '/assignments',
        builder: (context, state) => const AssignmentsListScreen(),
      ),
      GoRoute(
        path: '/assignments/:id',
        builder: (context, state) => AssignmentDetailScreen(
          assignmentId: state.pathParameters['id']!,
        ),
      ),
      // Exams / Mock Tests — Phase 6 sub-phase 6 mobile parity for
      // `apps/host/src/app/(student)/exams/mock/**`. Full-screen (own back
      // button, matches web). The runner is the app's ONLY countdown-timer
      // surface; the clock is seeded from the server's
      // `exam_papers.duration_minutes` and the score shown on the results
      // route is the submit API's response verbatim (P1).
      GoRoute(
        path: '/exams',
        builder: (context, state) => const ExamCatalogScreen(),
      ),
      GoRoute(
        path: '/exams/mock/:paperId',
        builder: (context, state) => MockExamScreen(
          paperId: state.pathParameters['paperId']!,
        ),
      ),
      GoRoute(
        path: '/exams/mock/:paperId/results',
        builder: (context, state) => MockExamResultsScreen(
          paperId: state.pathParameters['paperId']!,
        ),
      ),
      // Scan & Solve — Phase 6 sub-phase 8 mobile parity for
      // `apps/host/src/app/scan/page.tsx`, but wired to the REAL pipeline:
      // `POST /api/scan-solve` (Storage upload → `scan-ocr` Edge Function →
      // `ncert-solver`) in ONE call. The web page still renders a hardcoded
      // `simulateOCR()` fixture; mobile does not reproduce that.
      //
      // Full-screen (own back button, matches web, which has its own header
      // rather than a bottom nav). `/scan/result` reads the SAME
      // `scanSolveProvider` state the capture screen populated — it is a
      // presentation route, not a re-fetch, so a scan is never billed twice
      // against the daily cap by navigating.
      GoRoute(
        path: '/scan',
        builder: (context, state) => const ScanCaptureScreen(),
      ),
      GoRoute(
        path: '/scan/result',
        builder: (context, state) => const ScanSolveResultScreen(),
      ),
      // Weekly Curiosity Dive — Phase 6 sub-phase 7 mobile parity for
      // `apps/host/src/app/dive/page.tsx` (+ `/dive/history`). LIVE at 100%
      // on web since 2026-06-24, so this closes a real production gap rather
      // than pre-building a dormant surface. Full-screen (own back button,
      // matches web, which has its own header rather than a bottom nav).
      GoRoute(
        path: '/dive',
        builder: (context, state) => const DiveScreen(),
      ),
      GoRoute(
        path: '/dive/history',
        builder: (context, state) => const DiveHistoryScreen(),
      ),
      // Monthly Synthesis — mobile parity for
      // `apps/host/src/app/synthesis/page.tsx`. Registered unconditionally so
      // the route always resolves; the SERVER gates it
      // (`ff_pedagogy_v2_monthly_synthesis`, still OFF in production) and the
      // screen degrades to a soft "not available yet" card on the 404.
      GoRoute(
        path: '/synthesis',
        builder: (context, state) => const SynthesisScreen(),
      ),
      // Holistic Progress Card (NEP 2020) — WebView wrap of `/hpc`, same
      // pattern as STEM Lab / Lab Notebook above.
      GoRoute(
        path: '/hpc',
        builder: (context, state) => const HpcScreen(),
      ),

      // Guardian One Experience. ParentAppShell returns the legacy glance
      // unchanged when the server cohort is OFF.
      ShellRoute(
        builder: (context, state, child) => ParentAppShell(child: child),
        routes: [
          GoRoute(
            path: '/parent',
            builder: (context, state) => const ParentGlanceScreen(),
          ),
          GoRoute(
            path: '/parent/progress',
            builder: (context, state) =>
                const ParentV3SectionScreen(section: ParentSection.progress),
          ),
          GoRoute(
            path: '/parent/plan',
            builder: (context, state) =>
                const ParentV3SectionScreen(section: ParentSection.plan),
          ),
          GoRoute(
            path: '/parent/messages',
            builder: (context, state) =>
                const ParentV3SectionScreen(section: ParentSection.messages),
          ),
          GoRoute(
            path: '/parent/messages/:threadId',
            builder: (context, state) => ParentConversationScreen(
              threadId: state.pathParameters['threadId']!,
            ),
          ),
          GoRoute(
            path: '/parent/more',
            builder: (context, state) =>
                const ParentV3SectionScreen(section: ParentSection.more),
          ),
        ],
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
    _experienceSub = ref.listen<AsyncValue<OneExperienceResolution>>(
      oneExperienceProvider,
      (_, __) => notifyListeners(),
    );
  }

  late final ProviderSubscription<AsyncValue<UserRole>> _sub;
  late final ProviderSubscription<AsyncValue<OneExperienceResolution>>
      _experienceSub;

  @override
  void dispose() {
    _sub.close();
    _experienceSub.close();
    super.dispose();
  }
}

class _RoleCheckScreen extends StatelessWidget {
  const _RoleCheckScreen();

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: SafeArea(
        child: Center(
          child: Semantics(
            liveRegion: true,
            label: 'Checking account access',
            child: const Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                CircularProgressIndicator(),
                SizedBox(height: 16),
                Text('Checking your account…'),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

class _UnsupportedRoleScreen extends ConsumerWidget {
  const _UnsupportedRoleScreen();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    return Scaffold(
      body: SafeArea(
        child: Center(
          child: ConstrainedBox(
            constraints: const BoxConstraints(maxWidth: 420),
            child: Padding(
              padding: const EdgeInsets.all(24),
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  const Icon(Icons.lock_person_outlined, size: 40),
                  const SizedBox(height: 16),
                  Text(
                    'This account is not available in the mobile app.',
                    textAlign: TextAlign.center,
                    style: Theme.of(context).textTheme.titleLarge,
                  ),
                  const SizedBox(height: 8),
                  const Text(
                    'Student and guardian accounts are supported. You can retry the role check or sign in with another account.',
                    textAlign: TextAlign.center,
                  ),
                  const SizedBox(height: 24),
                  ElevatedButton.icon(
                    onPressed: () => ref.invalidate(roleProvider),
                    icon: const Icon(Icons.refresh),
                    label: const Text('Retry'),
                  ),
                  const SizedBox(height: 8),
                  TextButton(
                    onPressed: () async {
                      await Supabase.instance.client.auth.signOut();
                      ref.invalidate(roleProvider);
                      if (context.mounted) context.go('/login');
                    },
                    child: const Text('Use another account'),
                  ),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}

class _ExperienceUnavailableScreen extends ConsumerWidget {
  const _ExperienceUnavailableScreen();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    return Scaffold(
      body: SafeArea(
        child: Center(
          child: ConstrainedBox(
            constraints: const BoxConstraints(maxWidth: 420),
            child: Padding(
              padding: const EdgeInsets.all(24),
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  const Icon(Icons.shield_outlined, size: 40),
                  const SizedBox(height: 16),
                  Text(
                    'Your learning workspace is unavailable.',
                    textAlign: TextAlign.center,
                    style: Theme.of(context).textTheme.titleLarge,
                  ),
                  const SizedBox(height: 8),
                  const Text(
                    'We could not verify access securely. Retry the check or sign in with another account.',
                    textAlign: TextAlign.center,
                  ),
                  const SizedBox(height: 24),
                  ElevatedButton.icon(
                    onPressed: () {
                      if (ref.read(roleProvider).valueOrNull ==
                          UserRole.guardian) {
                        ref.invalidate(parentChildrenProvider);
                        ref.invalidate(parentThreadsProvider);
                      }
                      ref.invalidate(oneExperienceProvider);
                    },
                    icon: const Icon(Icons.refresh),
                    label: const Text('Retry'),
                  ),
                  const SizedBox(height: 8),
                  TextButton(
                    onPressed: () async {
                      await Supabase.instance.client.auth.signOut();
                      ref.invalidate(roleProvider);
                      ref.invalidate(oneExperienceProvider);
                      if (context.mounted) context.go('/login');
                    },
                    child: const Text('Use another account'),
                  ),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}
