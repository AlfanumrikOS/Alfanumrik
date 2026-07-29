import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../core/constants/api_constants.dart';
import '../core/network/v2_api_client.dart';
import 'parent_provider.dart';
import 'role_provider.dart';

enum OneExperienceAssignment { legacy, enabled, denied }

class OneExperienceResolution {
  const OneExperienceResolution({
    required this.assignment,
    this.role,
    this.permittedCapabilities = const <String>{},
    this.childId,
  });

  final OneExperienceAssignment assignment;
  final String? role;
  final Set<String> permittedCapabilities;
  final String? childId;

  bool allowsCapability(String capability) =>
      assignment == OneExperienceAssignment.enabled &&
      permittedCapabilities.contains(capability);

  static const legacy = OneExperienceResolution(
    assignment: OneExperienceAssignment.legacy,
  );
  static const denied = OneExperienceResolution(
    assignment: OneExperienceAssignment.denied,
  );
}

class ExperienceHttpResponse {
  const ExperienceHttpResponse({required this.statusCode, required this.data});

  final int? statusCode;
  final dynamic data;
}

typedef ExperienceRequest = Future<ExperienceHttpResponse> Function(
  Map<String, dynamic> queryParameters,
);

// RESOLVED 2026-07-29 (mobile forensic follow-up — repoint-vs-strip decision):
// `/api/experience-v3` was PERMANENTLY deleted server-side on 2026-07-15
// (PR #1282, "permanently remove Alfanumrik One Experience V3") per explicit
// CEO directive. The web equivalent of this exact server-driven,
// sticky-cohort, parallel-flag-gated shell was seeded OFF at 0% rollout for
// every one of its 5 roles and never turned on in production, so the CEO
// had it retired outright — "the frontend is evolved on the existing/live
// design language instead of a parallel flag-gated system" — rather than
// repointed to a successor. That PR's commit body explicitly lists
// "mobile Flutter v3" under "Untouched by design": web deliberately left
// this mobile-side call-site decision to mobile, it was not an oversight.
//
// No successor endpoint exists. `apps/host/src/app/api/v2/*` (today,
// curriculum-version, learn, parent, quiz, student) is a DIFFERENT,
// still-live "v2" namespace for individual data surfaces — not a
// capability-resolution/rollout-assignment endpoint. None of those routes
// serve the {enabled, manifest, capabilities, routeMapped, routeAllowed}
// shape [resolveOneExperienceResolution] expects.
//
// Decision: STRIP the network call (not repoint — there is nothing to
// repoint to), rather than perform a large removal of the ~24-file
// oneExperience*/useV2 provider graph in this same change. That plane
// (quiz/learn/parent/progress/leaderboard V2 surfaces + the offline-quiz-
// replay Wave 2.5.2 feature) is already unreachable in every production
// build today — USE_V2 defaults to false in both ApiConstants and
// build_apk.sh, and no CI workflow sets it true — so this fix only removes
// a guaranteed-404 network round trip on the rare manual USE_V2=true build;
// it changes no observable behavior for any shipped APK. The short-circuit
// lives here, in the production HTTP closure, rather than by hard-coding
// [oneExperienceProvider]'s result: that provider's resolution pipeline
// (legacy / enabled / denied branches) is unit-tested in isolation by
// overriding this exact provider — see
// `test/providers/experience_provider_test.dart` — so forcing a result at
// the [oneExperienceProvider] level would have silently broken that
// coverage. A future genuine capability-resolution endpoint can be wired
// back in by editing only the request body below.
//
// Flagged, not auto-fixed: the offline-quiz-replay feature's own mechanics
// (Hive queue store, drain service, `submitOfflineReplay` against the still
// -live `/v2/quiz` route) do not themselves call experience-v3 — they are
// gated only by [oneExperienceRuntimeEnabledProvider], the SAME server
// -cohort-assignment switch used by every other V2 surface. Making offline
// replay reachable without a real successor endpoint would mean bypassing
// that documented two-layer rollout-safety switch platform-wide (touches
// quiz/learn/parent/progress/leaderboard/router, not just offline replay) —
// that is a materially bigger product decision than this endpoint fix and is
// left for an explicit follow-up call, not made unilaterally here.
final experienceRequestProvider = Provider<ExperienceRequest>((ref) {
  return (queryParameters) async {
    // Server-side retirement short-circuit: `/api/experience-v3` was
    // permanently deleted 2026-07-15 and has no successor (see block
    // comment above). Every real call here would 404; fail fast locally
    // instead of paying the round trip. [oneExperienceProvider]'s catch
    // block turns this into [OneExperienceResolution.denied], identical to
    // the prior 404 outcome.
    throw StateError(
      'experience-v3 retired server-side 2026-07-15 — no successor endpoint',
    );
  };
});

final oneExperienceBuildEnabledProvider = Provider<bool>(
  (ref) => ApiConstants.useV2,
);

/// Runtime data-plane switch for student V2 repositories and surfaces.
///
/// The compile-time switch only permits a build to ask for assignment. It
/// never selects V2 data by itself: loading, denied, and explicit server
/// legacy assignments all remain on the legacy data plane.
final oneExperienceRuntimeEnabledProvider = Provider<bool>((ref) {
  return ref.watch(oneExperienceProvider).valueOrNull?.assignment ==
      OneExperienceAssignment.enabled;
});

/// Generated V2 client exposed only to a server-enabled One Experience user.
/// Parent assignment bootstrap continues to use [v2ApiClientProvider]
/// directly because it must resolve linked-child scope before assignment.
final oneExperienceV2ApiClientProvider = Provider<V2ApiClient?>((ref) {
  if (!ref.watch(oneExperienceRuntimeEnabledProvider)) return null;
  return ref.read(v2ApiClientProvider);
});

/// Server-authoritative One Experience assignment for this signed-in user.
///
/// `USE_V2` remains an emergency build kill switch, but never enables the UI
/// by itself. Role, tenant and deterministic sticky cohort are resolved by the
/// same authenticated endpoint the React application used to call. As of
/// 2026-07-29 that endpoint (`/api/experience-v3`) is permanently retired
/// server-side with no successor — see the note above
/// [experienceRequestProvider] — so in a real (non-test-overridden) build
/// this now fails fast at the request step below and always resolves to
/// [OneExperienceResolution.denied] once past the compile-time kill switch.
/// The full try/resolve pipeline is left intact (rather than force-denied
/// here) because [experienceRequestProvider] is overridden in tests to
/// exercise the legacy/enabled/denied resolution branches in isolation —
/// see `test/providers/experience_provider_test.dart`.
final oneExperienceProvider = FutureProvider<OneExperienceResolution>((
  ref,
) async {
  // Explicit local emergency kill switch. Server responses never reach this
  // branch; once USE_V2 is on, only a valid 200 false response may use legacy.
  if (!ref.watch(oneExperienceBuildEnabledProvider)) {
    return OneExperienceResolution.legacy;
  }

  final role = await ref.watch(roleProvider.future);
  final experienceRole = experienceRoleFor(role);
  if (experienceRole == null) return OneExperienceResolution.denied;

  try {
    String? activeChildId;
    if (experienceRole == 'parent') {
      final requestedChildId = ref.watch(selectedParentChildProvider);
      final children = await ref.watch(parentChildrenProvider.future);
      activeChildId = resolveActiveParentChildId(
        children.children.map((child) => child.studentId),
        requestedChildId,
      );
    }

    final response = await ref.read(experienceRequestProvider)(
      experienceV3QueryParameters(
        experienceRole,
        childId: activeChildId,
        path: experienceProbePath(experienceRole),
      ),
    );
    return resolveOneExperienceResolution(
      statusCode: response.statusCode,
      data: response.data,
      expectedRole: experienceRole,
      requestedChildId: activeChildId,
    );
  } catch (_) {
    return OneExperienceResolution.denied;
  }
});

Map<String, dynamic> experienceV3QueryParameters(
  String role, {
  String? childId,
  String? path,
}) {
  return <String, dynamic>{
    'role': role,
    if (path?.trim().isNotEmpty == true) 'path': path!.trim(),
    if (role == 'parent' && childId?.trim().isNotEmpty == true)
      'childId': childId!.trim(),
  };
}

String experienceProbePath(String role) =>
    role == 'parent' ? '/parent' : '/today';

/// Strict response gate. A literal false on a valid 200 is the only server
/// response allowed to select legacy. Auth failures, malformed payloads,
/// non-success responses, and transport exceptions are denied.
OneExperienceResolution resolveOneExperienceResolution({
  required int? statusCode,
  required dynamic data,
  required String expectedRole,
  String? requestedChildId,
}) {
  if (statusCode != 200 || data is! Map || data['enabled'] is! bool) {
    return OneExperienceResolution.denied;
  }
  if (data['enabled'] == false) return OneExperienceResolution.legacy;

  final manifest = data['manifest'];
  final rawCapabilities = data['capabilities'];
  if (manifest is! Map ||
      manifest['role'] != expectedRole ||
      manifest['desktop'] is! List ||
      rawCapabilities is! Map ||
      data['routeMapped'] != true ||
      data['routeAllowed'] != true) {
    return OneExperienceResolution.denied;
  }

  final capabilities = <String, bool>{};
  for (final entry in rawCapabilities.entries) {
    if (entry.key is! String || entry.value is! bool) {
      return OneExperienceResolution.denied;
    }
    capabilities[entry.key as String] = entry.value as bool;
  }

  final permitted = <String>{};
  for (final item in manifest['desktop'] as List) {
    if (item is! Map || item['capability'] is! String) {
      return OneExperienceResolution.denied;
    }
    final capability = item['capability'] as String;
    if (capabilities[capability] == true) permitted.add(capability);
  }
  final probeCapability =
      expectedRole == 'parent' ? 'parent.home' : 'student.today';
  if (!permitted.contains(probeCapability)) {
    return OneExperienceResolution.denied;
  }

  String? authoritativeChildId;
  if (expectedRole == 'parent') {
    final scope = data['scope'];
    if (scope != null && scope is! Map) return OneExperienceResolution.denied;
    final rawChildId = scope is Map ? scope['childId'] : null;
    if (rawChildId != null && rawChildId is! String) {
      return OneExperienceResolution.denied;
    }
    authoritativeChildId = rawChildId as String?;
    if (requestedChildId != null && authoritativeChildId != requestedChildId) {
      return OneExperienceResolution.denied;
    }
  }

  return OneExperienceResolution(
    assignment: OneExperienceAssignment.enabled,
    role: expectedRole,
    permittedCapabilities: Set.unmodifiable(permitted),
    childId: authoritativeChildId,
  );
}

String? mobileCapabilityForPath(String role, String location) {
  final path = Uri.tryParse(location)?.path ?? location.split('?').first;
  bool matches(String prefix) => path == prefix || path.startsWith('$prefix/');
  if (role == 'parent') {
    if (path == '/parent') return 'parent.home';
    if (matches('/parent/progress')) return 'parent.progress';
    if (matches('/parent/plan')) return 'parent.plan';
    if (matches('/parent/messages')) return 'parent.messages';
    return null;
  }
  if (path == '/today') return 'student.today';
  if (matches('/learn')) return 'student.learn';
  if (matches('/chat')) return 'student.foxy';
  if (matches('/quiz')) return 'student.practice';
  if (matches('/progress')) return 'student.progress';
  if (matches('/leaderboard')) return 'student.rewards';
  if (matches('/settings')) return 'shared.settings';
  if (matches('/stem-lab')) return 'student.learn';
  return null;
}

bool oneExperienceAllowsPath(
  OneExperienceResolution resolution,
  String role,
  String location,
) {
  final capability = mobileCapabilityForPath(role, location);
  return capability == null || resolution.allowsCapability(capability);
}

String? experienceRoleFor(UserRole role) {
  return switch (role) {
    UserRole.student => 'student',
    UserRole.guardian => 'parent',
    UserRole.unknown => null,
  };
}
