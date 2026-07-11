import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../core/constants/api_constants.dart';
import '../core/network/api_client.dart';
import 'role_provider.dart';

/// Server-authoritative One Experience assignment for this signed-in user.
///
/// `USE_V2` remains an emergency build kill switch, but never enables the UI
/// by itself. Role, tenant and deterministic sticky cohort are resolved by the
/// same authenticated endpoint as the React application.
final oneExperienceProvider = FutureProvider<bool>((ref) async {
  if (!ApiConstants.useV2) return false;

  final role = await ref.watch(roleProvider.future);
  final experienceRole = experienceRoleFor(role);
  if (experienceRole == null) return false;

  try {
    final response = await ApiClient().get<Map<String, dynamic>>(
      '/experience-v3',
      queryParameters: {'role': experienceRole},
    );
    return isOneExperienceResponseEnabled(
      statusCode: response.statusCode,
      data: response.data,
    );
  } catch (_) {
    return false;
  }
});

/// Strict response gate: only an authenticated 200 response with the literal
/// boolean `true` may enter One Experience. Missing, malformed, cached-error,
/// or truthy-string responses all fail closed to the legacy surface.
bool isOneExperienceResponseEnabled({
  required int? statusCode,
  required dynamic data,
}) {
  return statusCode == 200 && data is Map && data['enabled'] == true;
}

String? experienceRoleFor(UserRole role) {
  return switch (role) {
    UserRole.student => 'student',
    UserRole.guardian => 'parent',
    UserRole.unknown => null,
  };
}
