import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ParentReportsPage from '@/app/parent/reports/page';

const navigation = vi.hoisted(() => ({
  params: new URLSearchParams('childId=student-2'),
  router: { replace: vi.fn(), push: vi.fn() },
}));

const authState = vi.hoisted(() => ({
  isHi: false,
  isLoading: false,
  guardian: { id: 'guardian-1', name: 'Parent' },
}));

vi.mock('next/navigation', () => ({
  useRouter: () => navigation.router,
  useSearchParams: () => navigation.params,
}));

vi.mock('@alfanumrik/lib/AuthContext', () => ({
  useAuth: () => authState,
}));

vi.mock('@alfanumrik/lib/supabase', () => ({
  supabase: {
    auth: {
      getSession: vi.fn().mockResolvedValue({ data: { session: { access_token: 'test-token' } } }),
    },
  },
}));

describe('parent reports child-scope recovery', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('unavailable', { status: 503 })));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('offers retry when the guardian-scoped child list cannot be loaded', async () => {
    render(<ParentReportsPage />);

    expect(await screen.findByRole('alert')).toHaveTextContent('Could not load linked children.');
    expect(fetch).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
  });
});
