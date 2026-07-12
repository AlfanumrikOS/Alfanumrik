import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../core/constants/api_constants.dart';
import '../core/network/api_client.dart';
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

final experienceRequestProvider = Provider<ExperienceRequest>((ref) {
  return (queryParameters) async {
    final response = await ApiClient().get<Map<String, dynamic>>(
      '/experience-v3',
      queryParameters: queryParameters,
    );
    return ExperienceHttpResponse(
      statusCode: response.statusCode,
      data: response.data,
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
/// same authenticated endpoint as the React application.
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
