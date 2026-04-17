/**
 * ReportIssueModal — render + submit + a11y tests.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';

const mockIsHi = { value: false };
vi.mock('@/lib/AuthContext', () => ({
  useAuth: () => ({ isHi: mockIsHi.value }),
}));

import { ReportIssueModal } from '@/components/foxy/ReportIssueModal';

describe('ReportIssueModal', () => {
  beforeEach(() => {
    mockIsHi.value = false;
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('does not render when isOpen = false', () => {
    const { container } = render(<ReportIssueModal isOpen={false} onClose={vi.fn()} />);
    expect(container.firstChild).toBeNull();
  });

  it('renders when isOpen = true with role="dialog"', () => {
    render(<ReportIssueModal isOpen={true} onClose={vi.fn()} />);
    const dialog = screen.getByTestId('report-issue-modal');
    expect(dialog).toHaveAttribute('role', 'dialog');
    expect(dialog).toHaveAttribute('aria-modal', 'true');
  });

  it('renders 5 reason radio options (EN)', () => {
    render(<ReportIssueModal isOpen={true} onClose={vi.fn()} />);
    const radios = screen.getAllByRole('radio');
    expect(radios).toHaveLength(5);
    expect(screen.getByLabelText(/wrong answer/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/off topic/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/inappropriate/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/unclear/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/other/i)).toBeInTheDocument();
  });

  it('renders Hindi copy when isHi = true', () => {
    mockIsHi.value = true;
    render(<ReportIssueModal isOpen={true} onClose={vi.fn()} />);
    expect(screen.getByLabelText(/Galat jawab/i)).toBeInTheDocument();
  });

  it('shows validation error when submitted without a reason', async () => {
    render(<ReportIssueModal isOpen={true} onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /submit/i }));
    const alert = await screen.findByTestId('report-issue-validation-error');
    expect(alert.textContent).toMatch(/choose a reason/i);
  });

  it('closes when the Cancel button is clicked', () => {
    const onClose = vi.fn();
    render(<ReportIssueModal isOpen={true} onClose={onClose} />);
    fireEvent.click(screen.getByRole('button', { name: /cancel/i }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('closes when the ✕ button is clicked', () => {
    const onClose = vi.fn();
    render(<ReportIssueModal isOpen={true} onClose={onClose} />);
    fireEvent.click(screen.getByRole('button', { name: /close/i }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('POSTs to /api/support/ai-issue with the selected reason + trace', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ success: true, id: 'new-id' }),
    });
    vi.stubGlobal('fetch', fetchMock);
    const onClose = vi.fn();

    render(
      <ReportIssueModal
        isOpen={true}
        onClose={onClose}
        traceId="trace-123"
        messageId="msg-456"
        questionBankId="qb-789"
      />,
    );

    fireEvent.click(screen.getByLabelText(/wrong answer/i));
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'The 2+2=5 part' } });
    fireEvent.click(screen.getByRole('button', { name: /submit/i }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/support/ai-issue');
    expect(init.method).toBe('POST');
    const body = JSON.parse(init.body as string);
    expect(body).toEqual({
      traceId: 'trace-123',
      messageId: 'msg-456',
      questionBankId: 'qb-789',
      reasonCategory: 'wrong_answer',
      comment: 'The 2+2=5 part',
    });
  });

  it('shows success message then calls onClose after successful submit', async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ success: true, id: 'new-id' }),
    });
    vi.stubGlobal('fetch', fetchMock);
    const onClose = vi.fn();

    render(<ReportIssueModal isOpen={true} onClose={onClose} />);
    fireEvent.click(screen.getByLabelText(/wrong answer/i));
    fireEvent.click(screen.getByRole('button', { name: /submit/i }));

    // Flush the pending microtasks so the fetch.resolve runs
    await vi.waitFor(
      () => expect(screen.queryByTestId('report-issue-success')).toBeInTheDocument(),
    );
    const success = screen.getByTestId('report-issue-success');
    expect(success.textContent?.toLowerCase()).toMatch(/thanks for helping us improve|got it/i);

    // onClose fires after the 1.2s auto-dismiss timer
    act(() => { vi.advanceTimersByTime(1300); });
    expect(onClose).toHaveBeenCalled();
  });

  it('shows submit error when the API returns a failure', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      json: async () => ({ success: false, error: 'bad_request' }),
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<ReportIssueModal isOpen={true} onClose={vi.fn()} />);
    fireEvent.click(screen.getByLabelText(/wrong answer/i));
    fireEvent.click(screen.getByRole('button', { name: /submit/i }));

    const alert = await screen.findByRole('alert');
    expect(alert.textContent?.toLowerCase()).toMatch(/something went wrong|try again/);
  });

  it('caps the comment at 500 characters', () => {
    render(<ReportIssueModal isOpen={true} onClose={vi.fn()} />);
    const textarea = screen.getByRole('textbox') as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: 'x'.repeat(600) } });
    expect(textarea.value.length).toBe(500);
  });
});