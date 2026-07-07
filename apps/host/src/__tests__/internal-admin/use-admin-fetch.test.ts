import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import {
  useAdminFetch,
  loadAdminSecret,
  saveAdminSecret,
  clearAdminSecret,
} from '@/app/internal/admin/_hooks/useAdminFetch';

beforeEach(() => {
  global.fetch = vi.fn();
  sessionStorage.clear();
});

describe('useAdminFetch', () => {
  it('attaches the x-admin-secret header (lowercase, matching adminHeaders)', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true }),
    });

    const { result } = renderHook(() => useAdminFetch('test-secret'));
    await act(async () => {
      await result.current('/api/internal/admin/stats');
    });

    const callArgs = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    const callHeaders = callArgs[1].headers as Record<string, string>;
    expect(callHeaders['x-admin-secret']).toBe('test-secret');
    expect(callHeaders['Content-Type']).toBe('application/json');
  });

  it('passes empty string when secret is null (no header injection error)', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => ({}),
    });

    const { result } = renderHook(() => useAdminFetch(null));
    await act(async () => {
      await result.current('/api/internal/admin/stats');
    });

    const callHeaders = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0][1]
      .headers as Record<string, string>;
    expect(callHeaders['x-admin-secret']).toBe('');
  });

  it('merges caller-supplied headers without dropping the admin secret', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => ({}),
    });

    const { result } = renderHook(() => useAdminFetch('s'));
    await act(async () => {
      await result.current('/api/internal/admin/stats', {
        headers: { 'X-Trace-Id': 'abc-123' },
      });
    });

    const callHeaders = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0][1]
      .headers as Record<string, string>;
    expect(callHeaders['x-admin-secret']).toBe('s');
    expect(callHeaders['X-Trace-Id']).toBe('abc-123');
  });

  it('throws on non-ok response with status + body in the error message', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: false,
      status: 401,
      text: async () => 'Unauthorized',
    });

    const { result } = renderHook(() => useAdminFetch('bad'));
    await expect(result.current('/api/internal/admin/stats')).rejects.toThrow(/401/);
  });

  it('returns parsed JSON on success', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => ({ data: [1, 2, 3] }),
    });

    const { result } = renderHook(() => useAdminFetch('s'));
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

    const { result } = renderHook(() => useAdminFetch('s'));
    await act(async () => {
      await result.current('/api/internal/admin/bulk-action', {
        method: 'POST',
        body: JSON.stringify({ action: 'reset', ids: ['u1'] }),
      });
    });

    const init = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0][1] as RequestInit;
    expect(init.method).toBe('POST');
    expect(init.body).toBe(JSON.stringify({ action: 'reset', ids: ['u1'] }));
  });
});

describe('admin-session re-exports', () => {
  it('saveAdminSecret + loadAdminSecret round-trip through sessionStorage', () => {
    expect(loadAdminSecret()).toBe('');
    saveAdminSecret('hunter2');
    expect(loadAdminSecret()).toBe('hunter2');
    // Confirm the canonical key is used (NOT alfanumrik_admin_secret).
    expect(sessionStorage.getItem('alfa_admin_secret')).toBe('hunter2');
  });

  it('clearAdminSecret removes the stored value', () => {
    saveAdminSecret('hunter2');
    clearAdminSecret();
    expect(loadAdminSecret()).toBe('');
    expect(sessionStorage.getItem('alfa_admin_secret')).toBeNull();
  });
});
