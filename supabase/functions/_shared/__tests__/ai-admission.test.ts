import { beforeEach, describe, expect, it, vi } from 'vitest';
import { admitAiRoute, createStaticAiRouteProfile, finalizeAiRoute } from '../security/ai-admission.ts';

vi.stubGlobal('Deno', { env: { get: (key: string) => key === 'SUPABASE_SERVICE_ROLE_KEY' ? 'service-key' : key === 'SECURITY_IP_HASH_SALT' ? 'salt' : '' } });

function req(headers: Record<string, string> = {}, body = '{"prompt":"hello"}') {
  return new Request('https://example.test/functions/v1/test-ai', { method: 'POST', headers, body });
}

function sb(overrides: Record<string, unknown> = {}) {
  const rpc = vi.fn(async (name: string) => {
    if (name === 'security_resolve_user_context') return { data: { role: 'student', school_id: 'school-1' }, error: null };
    if (name === 'security_resolve_route_policy') return { data: { found: true, id: 'policy-1', route: 'test-ai', role: 'student', caller_type: 'authenticated', quota_profile_id: 'quota-1', enforcement_mode: 'enforce', allow_jwt: true, is_enabled: true }, error: null };
    if (name === 'security_compute_ai_cost') return { data: 0.01, error: null };
    if (name === 'security_reserve_quota') return { data: { allowed: true, decision: 'allow', enforcement_mode: 'enforce', circuit_state: 'closed' }, error: null };
    return { data: null, error: null };
  });
  const client = {
    auth: { getUser: vi.fn(async () => ({ data: { user: { id: 'user-1' } }, error: null })) },
    rpc,
    ...overrides,
  };
  return client;
}

const profile = createStaticAiRouteProfile({ route: 'test-ai', callerTypes: ['student'] });

describe('AI admission wrapper', () => {
  beforeEach(() => vi.clearAllMocks());

  it('denies missing auth before provider admission', async () => {
    const result = await admitAiRoute({ req: req(), sb: sb() as never, profile, bodyText: '{}' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.response.status).toBe(401);
  });

  it('denies callers whose role is not in the route inventory', async () => {
    const client = sb({ rpc: vi.fn(async (name: string) => name === 'security_resolve_user_context'
      ? { data: { role: 'teacher', school_id: 'school-1' }, error: null }
      : { data: null, error: null }) });
    const result = await admitAiRoute({ req: req({ authorization: 'Bearer jwt' }), sb: client as never, profile, bodyText: '{}' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.response.status).toBe(403);
  });

  it('maps circuit breaker quota denies to 503', async () => {
    const client = sb({ rpc: vi.fn(async (name: string) => {
      if (name === 'security_resolve_user_context') return { data: { role: 'student', school_id: 'school-1' }, error: null };
      if (name === 'security_resolve_route_policy') return { data: { found: true, is_enabled: true, enforcement_mode: 'enforce', allow_jwt: true }, error: null };
      if (name === 'security_compute_ai_cost') return { data: 0.01, error: null };
      if (name === 'security_reserve_quota') return { data: { allowed: false, decision: 'deny_breaker', enforcement_mode: 'enforce', circuit_state: 'open' }, error: null };
      return { data: null, error: null };
    }) });
    const result = await admitAiRoute({ req: req({ authorization: 'Bearer jwt' }), sb: client as never, profile, bodyText: '{}' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.response.status).toBe(503);
  });

  it('admits successful requests and records audit, settlement, and circuit success', async () => {
    const client = sb();
    const result = await admitAiRoute({ req: req({ authorization: 'Bearer jwt' }), sb: client as never, profile, bodyText: '{"prompt":"hello"}' });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    await finalizeAiRoute({ sb: client as never, admission: result.admission, statusCode: 200, actualInputTokens: 10, actualOutputTokens: 20, actualCost: 0.02 });
    expect(client.rpc).toHaveBeenCalledWith('security_reserve_quota', expect.objectContaining({ p_route: 'test-ai' }));
    expect(client.rpc).toHaveBeenCalledWith('security_write_request_audit', expect.objectContaining({ p_request_id: result.admission.requestId, p_status_code: 200 }));
    expect(client.rpc).toHaveBeenCalledWith('security_settle_quota', expect.objectContaining({ p_actual_input_tokens: 10 }));
    expect(client.rpc).toHaveBeenCalledWith('security_update_circuit_state', expect.objectContaining({ p_event: 'success' }));
  });
});
