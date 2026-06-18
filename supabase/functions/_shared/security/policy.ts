import type { SecurityPolicy } from './types.ts';

type SupabaseClientLike = {
  rpc(name: string, args?: Record<string, unknown>): Promise<{ data: unknown; error: unknown }>;
};

export async function resolveRoutePolicy(
  sb: SupabaseClientLike,
  args: {
    route: string;
    schoolId: string | null;
    role: string;
    callerType: 'public' | 'authenticated' | 'internal_service';
    internalCallerId: string | null;
  },
): Promise<SecurityPolicy | null> {
  const res = await sb.rpc('security_resolve_route_policy', {
    p_route: args.route,
    p_school_id: args.schoolId,
    p_role: args.role,
    p_caller_type: args.callerType,
    p_internal_caller_id: args.internalCallerId,
  });

  if (res.error || !res.data || typeof res.data !== 'object') return null;
  const data = res.data as Record<string, unknown>;
  if (data.found !== true) return null;

  return {
    id: String(data.id ?? ''),
    route: String(data.route ?? args.route),
    schoolId: data.school_id ? String(data.school_id) : null,
    role: data.role ? (String(data.role) as SecurityPolicy['role']) : null,
    callerType: (String(data.caller_type ?? args.callerType) as SecurityPolicy['callerType']),
    internalCallerId: data.internal_caller_id ? String(data.internal_caller_id) : null,
    quotaProfileId: String(data.quota_profile_id ?? ''),
    enforcementMode: normalizeMode(String(data.enforcement_mode ?? 'enforce')),
    allowSignedInternal: data.allow_signed_internal === true,
    allowJwt: data.allow_jwt === true,
    allowServiceRole: data.allow_service_role === true,
    isEnabled: data.is_enabled === true,
  };
}

function normalizeMode(value: string): SecurityPolicy['enforcementMode'] {
  switch (value) {
    case 'enforce':
    case 'shadow':
    case 'observe':
    case 'disabled':
      return value;
    default:
      return 'enforce';
  }
}

