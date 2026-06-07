import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:supabase_flutter/supabase_flutter.dart';

/// The user's primary role, as resolved by the `get_user_role` Postgres RPC —
/// the SAME mechanism the web `AuthContext` uses (`supabase.rpc('get_user_role',
/// { p_auth_user_id })`, see `src/lib/AuthContext.tsx`). Mobile reuses the
/// identical RPC so the role fork is authoritative and consistent with web; no
/// new role mechanism is introduced.
///
/// The Wave 2.4 mobile fork only distinguishes student vs guardian. Teacher /
/// institution_admin (web roles) are not yet surfaced on mobile and collapse to
/// [UserRole.student] for routing purposes is intentionally NOT done — they map
/// to [UserRole.unknown] so we never accidentally drop a non-student into the
/// student tree. The router treats anything that is not `guardian` as the
/// existing student flow (the historical, only mobile experience), preserving
/// the current behaviour for every non-guardian login.
enum UserRole {
  student,
  guardian,
  unknown,
}

/// Resolves the authenticated user's primary role via the `get_user_role` RPC.
///
/// Contract (mirrors web + `src/lib/middleware-helpers.ts`): the RPC takes
/// `{ p_auth_user_id }` and returns a JSONB object
/// `{ primary_role: 'student'|'teacher'|'guardian'|'none', roles: [...] }`.
/// We read `primary_role` and map `guardian` → [UserRole.guardian],
/// `student` → [UserRole.student], everything else → [UserRole.unknown].
///
/// Failure handling: if the user is unauthenticated, the RPC errors, or the
/// shape is unexpected, we return [UserRole.unknown]. The router treats
/// `unknown` exactly like `student` (the existing default flow), so a transient
/// RPC failure can never strand a real student — it just means a guardian on a
/// flaky network briefly sees the student tree until the provider re-resolves.
///
/// FutureProvider (not autoDispose) so the single role lookup is cached for the
/// session; `ref.invalidate(roleProvider)` after a re-login forces a refresh.
///
/// NOTE: this provider is only ever READ by the router when `ApiConstants.useV2`
/// is ON. With the flag OFF the router never consults it, so a flag-OFF build is
/// byte-identical to today — no RPC is issued on the auth path.
final roleProvider = FutureProvider<UserRole>((ref) async {
  final client = Supabase.instance.client;
  final user = client.auth.currentUser;
  if (user == null) return UserRole.unknown;

  try {
    // The Supabase Flutter `.rpc()` returns the decoded JSON directly. The RPC
    // returns a JSONB object, so `data` is a `Map<String, dynamic>`.
    final data = await client.rpc(
      'get_user_role',
      params: {'p_auth_user_id': user.id},
    );
    return mapPrimaryRole(data);
  } catch (_) {
    // Fail-safe: never throw on the auth path. Unknown → student flow.
    return UserRole.unknown;
  }
});

/// Map the `get_user_role` JSONB payload to a [UserRole]. Tolerant of both the
/// object shape `{ primary_role: '...' }` and a bare string (defensive — some
/// PostgREST/jsonb_build_object variants can surface either).
///
/// Exposed (not private) so the role-fork mapping is unit-testable without
/// standing up Supabase.
UserRole mapPrimaryRole(dynamic data) {
  String? primary;
  if (data is Map) {
    final raw = data['primary_role'];
    if (raw is String) primary = raw;
  } else if (data is String) {
    primary = data;
  }

  switch (primary) {
    case 'guardian':
      return UserRole.guardian;
    case 'student':
      return UserRole.student;
    default:
      return UserRole.unknown;
  }
}

/// True when the resolved role is a guardian. Convenience for the router and
/// shells. Defaults to `false` while loading / on error, so the student flow is
/// the safe default and the router never blocks on the role lookup.
final isGuardianProvider = Provider<bool>((ref) {
  return ref.watch(roleProvider).maybeWhen(
        data: (role) => role == UserRole.guardian,
        orElse: () => false,
      );
});
