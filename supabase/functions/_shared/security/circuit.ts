type SupabaseClientLike = {
  rpc(name: string, args?: Record<string, unknown>): Promise<{ data: unknown; error: unknown }>;
};

export async function recordCircuitOutcome(
  sb: SupabaseClientLike,
  args: {
    route: string;
    schoolId: string | null;
    role: string;
    callerType: 'authenticated' | 'internal_service';
    internalCallerId: string | null;
    event: 'success' | 'failure' | 'probe' | 'force_open';
    errorCode?: string | null;
  },
): Promise<void> {
  await sb.rpc('security_update_circuit_state', {
    p_route: args.route,
    p_school_id: args.schoolId,
    p_role: args.role,
    p_caller_type: args.callerType,
    p_internal_caller_id: args.internalCallerId,
    p_event: args.event,
    p_error_code: args.errorCode ?? null,
  });
}

