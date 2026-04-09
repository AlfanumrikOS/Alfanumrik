import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

/**
 * DB Performance API route tests
 *
 * Covers GET /api/super-admin/db-performance:
 *   - Returns 401 when not authenticated as admin
 *   - Response shape: { success: true, data: { connections, tables, slow_functions, timestamp, alert } }
 *   - alert is null when connections.active <= 80
 *   - alert is the HIGH string when connections.active > 80
 *   - Gracefully returns empty arrays when RPCs fail (never 500)
 *
 * Regression catalog: admin_secret_required (Admin Panel)
 */

// ── Mock: authorizeAdmin ──────────────────────────────────────────────────────
const mockAuthorizeAdmin = vi.fn();

vi.mock('@/lib/admin-auth', () => ({
  authorizeAdmin:   (...args: unknown[]) => mockAuthorizeAdmin(...args),
  logAdminAudit:    vi.fn(),
  isValidUUID:      (s: string) => /^[0-9a-f-]{36}$/.test(s),
  supabaseAdminHeaders: vi.fn(),
  supabaseAdminUrl: vi.fn(),
}));

// ── Mock: supabaseAdmin RPCs ──────────────────────────────────────────────────
// Each RPC is individually controlled so tests can simulate per-RPC failure.
const mockGetSlowFunctions  = vi.fn();
const mockGetConnectionStats = vi.fn();
const mockGetTableSizes      = vi.fn();

vi.mock('@/lib/supabase-admin', () => ({
  supabaseAdmin: {
    rpc: (name: string) => {
      if (name === 'get_slow_functions_stats')  return mockGetSlowFunctions();
      if (name === 'get_connection_stats')       return mockGetConnectionStats();
      if (name === 'get_table_sizes')            return mockGetTableSizes();
      return Promise.resolve({ data: null, error: null });
    },
  },
  getSupabaseAdmin: vi.fn(() => ({
    rpc: (name: string) => {
      if (name === 'get_slow_functions_stats')  return mockGetSlowFunctions();
      if (name === 'get_connection_stats')       return mockGetConnectionStats();
      if (name === 'get_table_sizes')            return mockGetTableSizes();
      return Promise.resolve({ data: null, error: null });
    },
  })),
}));

// ── Mock: logger ──────────────────────────────────────────────────────────────
vi.mock('@/lib/logger', () => ({
  logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeGetRequest(headers: Record<string, string> = {}): NextRequest {
  return new NextRequest('http://localhost/api/super-admin/db-performance', {
    method: 'GET',
    headers: { 'Content-Type': 'application/json', ...headers },
  });
}

function unauthorizedResponse() {
  return NextResponse401();
}

// authorizeAdmin failure helper — returns the NextResponse directly (route does `return auth.response`)
import { NextResponse } from 'next/server';
function NextResponse401() {
  return NextResponse.json(
    { error: 'Please log in.', code: 'ADMIN_NO_TOKEN' },
    { status: 401 },
  );
}

const MOCK_ADMIN = {
  authorized: true as const,
  userId: 'user-1',
  adminId: 'admin-1',
  email: 'admin@example.com',
  name: 'Test Admin',
  adminLevel: 'super_admin',
};

function defaultRpcSuccess() {
  mockGetSlowFunctions.mockResolvedValue({ data: [], error: null });
  mockGetConnectionStats.mockResolvedValue({
    data: [{ state: 'active', count: 5 }, { state: 'idle', count: 10 }],
    error: null,
  });
  mockGetTableSizes.mockResolvedValue({
    data: [{ tablename: 'students', live_rows: 100, dead_rows: 2, size_bytes: 4096 }],
    error: null,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  // Default: not authenticated
  mockAuthorizeAdmin.mockResolvedValue({
    authorized: false,
    response: NextResponse401(),
  });
  defaultRpcSuccess();
});

// =============================================================================
// Authentication guard (admin_secret_required regression)
// =============================================================================

describe('GET /api/super-admin/db-performance — authentication', () => {
  it('returns 401 when not authenticated as admin', async () => {
    // authorizeAdmin already mocked to return 401 by default
    const { GET } = await import('@/app/api/super-admin/db-performance/route');
    const res = await GET(makeGetRequest());
    expect(res.status).toBe(401);
  });

  it('returns 401 when authorization header is missing', async () => {
    const { GET } = await import('@/app/api/super-admin/db-performance/route');
    const res = await GET(makeGetRequest());
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toBeTruthy();
  });

  it('does not return 200 when not authenticated', async () => {
    const { GET } = await import('@/app/api/super-admin/db-performance/route');
    const res = await GET(makeGetRequest());
    expect(res.status).not.toBe(200);
  });
});

// =============================================================================
// Response shape
// =============================================================================

describe('GET /api/super-admin/db-performance — response shape', () => {
  beforeEach(() => {
    mockAuthorizeAdmin.mockResolvedValue(MOCK_ADMIN);
  });

  it('returns success: true with correct data shape when authenticated', async () => {
    const { GET } = await import('@/app/api/super-admin/db-performance/route');
    const res = await GET(makeGetRequest({ Authorization: 'Bearer valid-token' }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data).toBeDefined();
  });

  it('response data contains connections, tables, slow_functions, timestamp, alert', async () => {
    const { GET } = await import('@/app/api/super-admin/db-performance/route');
    const res = await GET(makeGetRequest({ Authorization: 'Bearer valid-token' }));
    const body = await res.json();
    const data = body.data;
    expect(data).toHaveProperty('connections');
    expect(data).toHaveProperty('tables');
    expect(data).toHaveProperty('slow_functions');
    expect(data).toHaveProperty('timestamp');
    expect(data).toHaveProperty('alert');
  });

  it('connections object has active count and by_state array', async () => {
    const { GET } = await import('@/app/api/super-admin/db-performance/route');
    const res = await GET(makeGetRequest({ Authorization: 'Bearer valid-token' }));
    const { data } = await res.json();
    expect(typeof data.connections.active).toBe('number');
    expect(Array.isArray(data.connections.by_state)).toBe(true);
  });

  it('tables is an array', async () => {
    const { GET } = await import('@/app/api/super-admin/db-performance/route');
    const res = await GET(makeGetRequest({ Authorization: 'Bearer valid-token' }));
    const { data } = await res.json();
    expect(Array.isArray(data.tables)).toBe(true);
  });

  it('slow_functions is an array', async () => {
    const { GET } = await import('@/app/api/super-admin/db-performance/route');
    const res = await GET(makeGetRequest({ Authorization: 'Bearer valid-token' }));
    const { data } = await res.json();
    expect(Array.isArray(data.slow_functions)).toBe(true);
  });

  it('timestamp is a valid ISO string', async () => {
    const { GET } = await import('@/app/api/super-admin/db-performance/route');
    const res = await GET(makeGetRequest({ Authorization: 'Bearer valid-token' }));
    const { data } = await res.json();
    expect(() => new Date(data.timestamp)).not.toThrow();
    expect(new Date(data.timestamp).toISOString()).toBe(data.timestamp);
  });
});

// =============================================================================
// Alert threshold logic
// =============================================================================

describe('GET /api/super-admin/db-performance — alert threshold', () => {
  beforeEach(() => {
    mockAuthorizeAdmin.mockResolvedValue(MOCK_ADMIN);
  });

  it('alert is null when active connections is exactly 0', async () => {
    mockGetConnectionStats.mockResolvedValue({
      data: [{ state: 'active', count: 0 }],
      error: null,
    });
    const { GET } = await import('@/app/api/super-admin/db-performance/route');
    const res = await GET(makeGetRequest({ Authorization: 'Bearer valid-token' }));
    const { data } = await res.json();
    expect(data.alert).toBeNull();
    expect(data.connections.active).toBe(0);
  });

  it('alert is null when active connections is 5 (normal load)', async () => {
    // defaultRpcSuccess sets active=5 — already the default
    const { GET } = await import('@/app/api/super-admin/db-performance/route');
    const res = await GET(makeGetRequest({ Authorization: 'Bearer valid-token' }));
    const { data } = await res.json();
    expect(data.alert).toBeNull();
    expect(data.connections.active).toBe(5);
  });

  it('alert is null when active connections is exactly 80 (at threshold, not over)', async () => {
    mockGetConnectionStats.mockResolvedValue({
      data: [{ state: 'active', count: 80 }],
      error: null,
    });
    const { GET } = await import('@/app/api/super-admin/db-performance/route');
    const res = await GET(makeGetRequest({ Authorization: 'Bearer valid-token' }));
    const { data } = await res.json();
    expect(data.alert).toBeNull();
    expect(data.connections.active).toBe(80);
  });

  it('alert is the HIGH string when active connections is 81 (just above threshold)', async () => {
    mockGetConnectionStats.mockResolvedValue({
      data: [{ state: 'active', count: 81 }],
      error: null,
    });
    const { GET } = await import('@/app/api/super-admin/db-performance/route');
    const res = await GET(makeGetRequest({ Authorization: 'Bearer valid-token' }));
    const { data } = await res.json();
    expect(data.alert).not.toBeNull();
    expect(typeof data.alert).toBe('string');
    expect(data.alert).toMatch(/HIGH/i);
    expect(data.connections.active).toBe(81);
  });

  it('alert is the HIGH string when active connections is 200 (well above threshold)', async () => {
    mockGetConnectionStats.mockResolvedValue({
      data: [{ state: 'active', count: 200 }],
      error: null,
    });
    const { GET } = await import('@/app/api/super-admin/db-performance/route');
    const res = await GET(makeGetRequest({ Authorization: 'Bearer valid-token' }));
    const { data } = await res.json();
    expect(data.alert).toMatch(/HIGH/i);
    expect(data.connections.active).toBe(200);
  });

  it('active count is sum across all active-state rows', async () => {
    // Multiple rows with state='active' — route sums them
    mockGetConnectionStats.mockResolvedValue({
      data: [
        { state: 'active', count: 50 },
        { state: 'active', count: 35 },
        { state: 'idle',   count: 20 },
      ],
      error: null,
    });
    const { GET } = await import('@/app/api/super-admin/db-performance/route');
    const res = await GET(makeGetRequest({ Authorization: 'Bearer valid-token' }));
    const { data } = await res.json();
    // 50 + 35 = 85 → above 80 → HIGH alert
    expect(data.connections.active).toBe(85);
    expect(data.alert).toMatch(/HIGH/i);
  });
});

// =============================================================================
// Graceful degradation — RPC failures must not produce 500
// =============================================================================

describe('GET /api/super-admin/db-performance — graceful RPC failure', () => {
  beforeEach(() => {
    mockAuthorizeAdmin.mockResolvedValue(MOCK_ADMIN);
  });

  it('returns 200 with empty slow_functions when get_slow_functions_stats RPC throws', async () => {
    mockGetSlowFunctions.mockRejectedValue(new Error('RPC unavailable'));
    const { GET } = await import('@/app/api/super-admin/db-performance/route');
    const res = await GET(makeGetRequest({ Authorization: 'Bearer valid-token' }));
    expect(res.status).toBe(200);
    const { data } = await res.json();
    expect(Array.isArray(data.slow_functions)).toBe(true);
    expect(data.slow_functions).toHaveLength(0);
  });

  it('returns 200 with empty tables when get_table_sizes RPC throws', async () => {
    mockGetTableSizes.mockRejectedValue(new Error('RPC unavailable'));
    const { GET } = await import('@/app/api/super-admin/db-performance/route');
    const res = await GET(makeGetRequest({ Authorization: 'Bearer valid-token' }));
    expect(res.status).toBe(200);
    const { data } = await res.json();
    expect(Array.isArray(data.tables)).toBe(true);
    expect(data.tables).toHaveLength(0);
  });

  it('returns 200 with 0 active connections when get_connection_stats RPC throws', async () => {
    mockGetConnectionStats.mockRejectedValue(new Error('RPC unavailable'));
    const { GET } = await import('@/app/api/super-admin/db-performance/route');
    const res = await GET(makeGetRequest({ Authorization: 'Bearer valid-token' }));
    expect(res.status).toBe(200);
    const { data } = await res.json();
    expect(data.connections.active).toBe(0);
    expect(data.connections.by_state).toHaveLength(0);
    expect(data.alert).toBeNull();
  });

  it('returns 200 when all three RPCs return errors (never 500)', async () => {
    mockGetSlowFunctions.mockResolvedValue({ data: null, error: { message: 'error' } });
    mockGetConnectionStats.mockResolvedValue({ data: null, error: { message: 'error' } });
    mockGetTableSizes.mockResolvedValue({ data: null, error: { message: 'error' } });
    const { GET } = await import('@/app/api/super-admin/db-performance/route');
    const res = await GET(makeGetRequest({ Authorization: 'Bearer valid-token' }));
    expect(res.status).toBe(200);
    const { data } = await res.json();
    expect(data.slow_functions).toHaveLength(0);
    expect(data.tables).toHaveLength(0);
    expect(data.connections.active).toBe(0);
  });

  it('response shape is complete even when all RPCs fail', async () => {
    mockGetSlowFunctions.mockRejectedValue(new Error('fail'));
    mockGetConnectionStats.mockRejectedValue(new Error('fail'));
    mockGetTableSizes.mockRejectedValue(new Error('fail'));
    const { GET } = await import('@/app/api/super-admin/db-performance/route');
    const res = await GET(makeGetRequest({ Authorization: 'Bearer valid-token' }));
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data).toHaveProperty('connections');
    expect(body.data).toHaveProperty('tables');
    expect(body.data).toHaveProperty('slow_functions');
    expect(body.data).toHaveProperty('timestamp');
    expect(body.data).toHaveProperty('alert');
  });
});
