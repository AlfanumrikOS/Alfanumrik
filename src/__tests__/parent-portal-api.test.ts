import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const SUPABASE_URL = 'https://test.supabase.co';
const SUPABASE_ANON = 'test-anon';

async function api(action: string, params: Record<string, unknown> = {}) {
  const res = await fetch(`${SUPABASE_URL}/functions/v1/parent-portal`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: SUPABASE_ANON },
    body: JSON.stringify({ action, ...params }),
  });
  if (!res.ok) {
    const err = await res.text().catch(() => 'unknown');
    throw new Error(`API error ${res.status}: ${err}`);
  }
  return res.json();
}

type FetchMock = ReturnType<typeof vi.fn>;

function lastFetchBody(): Record<string, unknown> {
  const mock = global.fetch as unknown as FetchMock;
  const init = mock.mock.calls[0][1] as RequestInit;
  return JSON.parse(init.body as string);
}

function lastFetchHeaders(): Record<string, string> {
  const mock = global.fetch as unknown as FetchMock;
  const init = mock.mock.calls[0][1] as RequestInit;
  return init.headers as Record<string, string>;
}

describe('parent-portal edge fn api wrapper', () => {
  beforeEach(() => {
    global.fetch = vi.fn();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('parent_login forwards link_code and parent_name in JSON body', async () => {
    (global.fetch as FetchMock).mockResolvedValue({
      ok: true,
      json: async () => ({
        guardian: { id: 'g1', name: 'Pradeep' },
        student: { id: 's1', name: 'Aarav', grade: '8' },
      }),
    });

    const result = await api('parent_login', {
      link_code: 'ABC123',
      parent_name: 'Pradeep',
    });

    expect(result.guardian.id).toBe('g1');
    expect(result.student.grade).toBe('8');
    expect(lastFetchBody()).toEqual({
      action: 'parent_login',
      link_code: 'ABC123',
      parent_name: 'Pradeep',
    });
  });

  it('get_child_dashboard sends student_id in body and returns stats', async () => {
    (global.fetch as FetchMock).mockResolvedValue({
      ok: true,
      json: async () => ({ stats: { xp: 1200, streak: 5 } }),
    });

    const result = await api('get_child_dashboard', { student_id: 's1' });

    expect(result.stats.xp).toBe(1200);
    const body = lastFetchBody();
    expect(body.action).toBe('get_child_dashboard');
    expect(body.student_id).toBe('s1');
  });

  it('attaches Content-Type and apikey headers on every request', async () => {
    (global.fetch as FetchMock).mockResolvedValue({
      ok: true,
      json: async () => ({ children: [] }),
    });

    await api('get_children');

    const headers = lastFetchHeaders();
    expect(headers['Content-Type']).toBe('application/json');
    expect(headers.apikey).toBe(SUPABASE_ANON);
  });

  it('throws with status code when edge fn responds 401 unauthorized', async () => {
    (global.fetch as FetchMock).mockResolvedValue({
      ok: false,
      status: 401,
      text: async () => 'Invalid or expired token',
    });

    await expect(
      api('get_child_dashboard', { student_id: 's1' }),
    ).rejects.toThrow(/401/);
  });

  it('throws with status code when edge fn responds 403 forbidden', async () => {
    (global.fetch as FetchMock).mockResolvedValue({
      ok: false,
      status: 403,
      text: async () => 'Caller is not a registered guardian',
    });

    await expect(api('get_children')).rejects.toThrow(/403/);
  });

  it('throws with status code when student is not found (404)', async () => {
    (global.fetch as FetchMock).mockResolvedValue({
      ok: false,
      status: 404,
      text: async () => 'Student not found',
    });

    await expect(
      api('get_child_dashboard', { student_id: 'missing' }),
    ).rejects.toThrow(/404/);
  });

  it('throws on 400 bad request for unknown action', async () => {
    (global.fetch as FetchMock).mockResolvedValue({
      ok: false,
      status: 400,
      text: async () => 'Unknown action: bogus_action',
    });

    await expect(api('bogus_action')).rejects.toThrow(/400/);
  });

  it('targets the parent-portal functions URL with POST method', async () => {
    (global.fetch as FetchMock).mockResolvedValue({
      ok: true,
      json: async () => ({}),
    });

    await api('get_tips', { student_id: 's1' });

    const mock = global.fetch as unknown as FetchMock;
    const [url, init] = mock.mock.calls[0];
    expect(url).toBe(`${SUPABASE_URL}/functions/v1/parent-portal`);
    expect((init as RequestInit).method).toBe('POST');
  });

  it.each([
    'parent_login',
    'get_child_dashboard',
    'get_tips',
    'get_children',
    'get_monthly_report',
  ])('routes action %s through the api wrapper with matching body.action', async action => {
    (global.fetch as FetchMock).mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true }),
    });

    const result = await api(action, { student_id: 's1' });

    expect(result).toEqual({ ok: true });
    expect(lastFetchBody().action).toBe(action);
  });
});
