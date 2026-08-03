import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useAdminFetch } from '@/app/internal/admin/_hooks/useAdminFetch';

beforeEach(() => {
  global.fetch = vi.fn();
  sessionStorage.clear();
});

describe('useAdminFetch (session-only)', () => {
  it('sends Content-Type json + credentials:same-origin and NO x-admin-secret header', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true }),
    });

    const { result } = renderHook(() => useAdminFetch());
    await act(async () => {
      await result.current('/api/internal/admin/stats');
    });

    const init = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0][1] as RequestInit;
    const headers = init.headers as Record<string, string>;
    expect(headers['Content-Type']).toBe('application/json');
    // The shared secret is gone — the httpOnly session cookie is the sole credential.
    expect(headers['x-admin-secret']).toBeUndefined();
    expect(init.credentials).toBe('same-origin');
  });

  it('merges caller-supplied headers without dropping Content-Type', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => ({}),
    });

    const { result } = renderHook(() => useAdminFetch());
    await act(async () => {
      await result.current('/api/internal/admin/stats', {
        headers: { 'X-Trace-Id': 'abc-123' },
      });
    });

    const headers = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0][1]
      .headers as Record<string, string>;
    expect(headers['Content-Type']).toBe('application/json');
    expect(headers['X-Trace-Id']).toBe('abc-123');
    expect(headers['x-admin-secret']).toBeUndefined();
  });

  it('throws on non-ok response with status + body in the error message', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: false,
      status: 401,
      text: async () => 'Unauthorized',
    });

    const { result } = renderHook(() => useAdminFetch());
    await expect(result.current('/api/internal/admin/stats')).rejects.toThrow(/401/);
  });

  it('returns parsed JSON on success', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => ({ data: [1, 2, 3] }),
    });

    const { result } = renderHook(() => useAdminFetch());
    let r: unknown;
    await act(async () => {
      r = await result.current<{ data: number[] }>('/api/internal/admin/stats');
    });
    expect(r).toEqual({ data: [1, 2, 3] });
  });

  it('forwards method/body on POST', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true }),
    });

    const { result } = renderHook(() => useAdminFetch());
    await act(async () => {
      await result.current('/api/internal/admin/bulk-action', {
        method: 'POST',
        body: JSON.stringify({ action: 'reset', ids: ['u1'] }),
      });
    });

    const init = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0][1] as RequestInit;
    expect(init.method).toBe('POST');
    expect(init.body).toBe(JSON.stringify({ action: 'reset', ids: ['u1'] }));
    expect(init.credentials).toBe('same-origin');
  });
});
