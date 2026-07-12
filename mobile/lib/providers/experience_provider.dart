import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../core/constants/api_constants.dart';
import '../core/network/api_client.dart';
import 'parent_provider.dart';
import 'role_provider.dart';

enum OneExperienceAssignment { legacy, enabled, denied }

/// Server-authoritative One Experience assignment for this signed-in user.
///
/// `USE_V2` remains an emergency build kill switch, but never enables the UI
/// by itself. Role, tenant and deterministic sticky cohort are resolved by the
/// same authenticated endpoint as the React application.
final oneExperienceProvider = FutureProvider<OneExperienceAssignment>((
  ref,
) async {
  // Explicit local emergency kill switch. Server responses never reach this
  // branch; once USE_V2 is on, only a valid 200 false response may use legacy.
  if (!ApiConstants.useV2) return OneExperienceAssignment.legacy;

  final role = await ref.watch(roleProvider.future);
  final experienceRole = experienceRoleFor(role);
  if (experienceRole == null) return OneExperienceAssignment.denied;

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

    final response = await ApiClient().get<Map<String, dynamic>>(
      '/experience-v3',
      queryParameters: experienceV3QueryParameters(
        experienceRole,
        childId: activeChildId,
      ),
    );
    return resolveOneExperienceAssignment(
      statusCode: response.statusCode,
      data: response.data,
    );
  } catch (_) {
    return OneExperienceAssignment.denied;
  }
});

Map<String, dynamic> experienceV3QueryParameters(
  String role, {
  String? childId,
}) {
  return <String, dynamic>{
    'role': role,
    if (role == 'parent' && childId?.trim().isNotEmpty == true)
      'childId': childId!.trim(),
  };
}

/// Strict response gate. A literal false on a valid 200 is the only server
/// response allowed to select legacy. Auth failures, malformed payloads,
/// non-success responses, and transport exceptions are denied.
OneExperienceAssignment resolveOneExperienceAssignment({
  required int? statusCode,
  required dynamic data,
}) {
  if (statusCode != 200 || data is! Map || data['enabled'] is! bool) {
    return OneExperienceAssignment.denied;
  }
  return data['enabled'] == true
      ? OneExperienceAssignment.enabled
      : OneExperienceAssignment.legacy;
}

String? experienceRoleFor(UserRole role) {
  return switch (role) {
    UserRole.student => 'student',
    UserRole.guardian => 'parent',
    UserRole.unknown => null,
  };
}
