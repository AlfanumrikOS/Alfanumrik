import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import BuildYourOwnDeckSection from '@/components/refresh/BuildYourOwnDeckSection';

vi.mock('@/lib/AuthContext', () => ({
  useAuth: () => ({ isHi: false }),
}));
vi.mock('@/lib/useAllowedSubjects', () => ({
  useAllowedSubjects: () => ({
    unlocked: [
      { code: 'physics', name: 'Physics', icon: '⚛️', color: '#2563EB' },
      { code: 'chemistry', name: 'Chemistry', icon: '⚗️', color: '#16A34A' },
    ],
  }),
}));
vi.mock('@/components/ui/toast', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

describe('<BuildYourOwnDeckSection />', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    (globalThis.fetch as unknown) = vi.fn();
  });

  it('renders collapsed tip by default', () => {
    render(<BuildYourOwnDeckSection />);
    expect(screen.getByTestId('refresh-byod-open')).toBeInTheDocument();
  });

  it('expands composer on tip click', () => {
    render(<BuildYourOwnDeckSection />);
    fireEvent.click(screen.getByTestId('refresh-byod-open'));
    expect(screen.getByTestId('refresh-byod-subject')).toBeInTheDocument();
    expect(screen.getByTestId('refresh-byod-submit')).toBeDisabled();
  });

  it('enables submit when subject + front + back are valid', () => {
    render(<BuildYourOwnDeckSection />);
    fireEvent.click(screen.getByTestId('refresh-byod-open'));
    fireEvent.change(screen.getByTestId('refresh-byod-subject'), { target: { value: 'physics' } });
    fireEvent.change(screen.getByTestId('refresh-byod-front'), { target: { value: 'What is force?' } });
    fireEvent.change(screen.getByTestId('refresh-byod-back'), { target: { value: 'Mass times acceleration' } });
    expect(screen.getByTestId('refresh-byod-submit')).toBeEnabled();
  });

  it('POSTs to /api/learner/cards/create with correct body', async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ ok: true, cardId: 'new-uuid' }),
    });
    const onCardCreated = vi.fn();
    render(<BuildYourOwnDeckSection onCardCreated={onCardCreated} />);
    fireEvent.click(screen.getByTestId('refresh-byod-open'));
    fireEvent.change(screen.getByTestId('refresh-byod-subject'), { target: { value: 'physics' } });
    fireEvent.change(screen.getByTestId('refresh-byod-front'), { target: { value: 'Q' } });
    fireEvent.change(screen.getByTestId('refresh-byod-back'), { target: { value: 'A' } });
    fireEvent.click(screen.getByTestId('refresh-byod-submit'));
    await waitFor(() => expect(onCardCreated).toHaveBeenCalled());
    expect(globalThis.fetch).toHaveBeenCalledWith(
      '/api/learner/cards/create',
      expect.objectContaining({
        method: 'POST',
        body: expect.stringContaining('"subjectCode":"physics"'),
      }),
    );
  });
});
