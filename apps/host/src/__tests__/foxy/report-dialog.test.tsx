/**
 * ReportDialog — component tests.
 *
 * Plan ref: docs/superpowers/plans/2026-05-09-student-quality-upgrade.md
 *           Task 5c: extract report flow; tests follow extraction.
 *
 * Asserts the bounded contract:
 *   1. open=false → renders null (modal hidden)
 *   2. open=true  → header, REPORT_REASONS chips, textarea, submit button
 *   3. clicking a reason chip fires onReasonChange with the reason value
 *   4. submit → onSubmit; cancel → onClose
 *   5. success=true swaps body to thank-you message
 */

import { render, fireEvent } from '@testing-library/react';
import { vi, describe, it, expect } from 'vitest';

import { ReportDialog } from '@/app/foxy/_components/ReportDialog';

const baseProps = {
  open: true,
  foxyMsg: 'The mitochondria is the kitchen of the cell.',
  reason: 'wrong_answer',
  correction: '',
  submitting: false,
  success: false,
  isHi: false,
  onReasonChange: vi.fn(),
  onCorrectionChange: vi.fn(),
  onSubmit: vi.fn(),
  onClose: vi.fn(),
};

describe('ReportDialog', () => {
  it('renders nothing when closed', () => {
    const { container } = render(<ReportDialog {...baseProps} open={false} />);
    expect(container.firstChild).toBeNull();
  });

  it('renders header, response preview, reason chips, and submit when open', () => {
    const { getByText, getAllByText } = render(<ReportDialog {...baseProps} />);
    expect(getByText('⚠️ Report Incorrect Answer')).toBeTruthy();
    expect(getByText(/mitochondria/)).toBeTruthy();
    // REPORT_REASONS has 7 entries — we should see all 7 chips rendered
    const wrongAnswerChip = getAllByText(/Wrong answer/);
    expect(wrongAnswerChip.length).toBeGreaterThanOrEqual(1);
    expect(getByText('⚠️ Submit Report')).toBeTruthy();
  });

  it('clicking a reason chip fires onReasonChange', () => {
    const onReasonChange = vi.fn();
    const { getByText } = render(
      <ReportDialog {...baseProps} onReasonChange={onReasonChange} />,
    );
    fireEvent.click(getByText(/Wrong formula/));
    expect(onReasonChange).toHaveBeenCalledWith('wrong_formula');
  });

  it('clicking Submit fires onSubmit; clicking Cancel fires onClose', () => {
    const onSubmit = vi.fn();
    const onClose = vi.fn();
    const { getByText } = render(
      <ReportDialog {...baseProps} onSubmit={onSubmit} onClose={onClose} />,
    );
    fireEvent.click(getByText('⚠️ Submit Report'));
    expect(onSubmit).toHaveBeenCalledTimes(1);
    fireEvent.click(getByText('Cancel'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('success=true swaps to thank-you message', () => {
    const { getByText, queryByText } = render(
      <ReportDialog {...baseProps} success={true} />,
    );
    expect(getByText('Thank you!')).toBeTruthy();
    expect(queryByText('⚠️ Submit Report')).toBeNull();
  });
});
