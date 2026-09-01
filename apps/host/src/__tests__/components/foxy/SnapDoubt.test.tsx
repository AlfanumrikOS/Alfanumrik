/**
 * SnapDoubt — screen 10 "Snap a doubt" (packages/ui/src/foxy/v2/SnapDoubt.tsx).
 *
 * Pins the real/placeholder split called out in the component's doc comment:
 *   - the camera button is a permanently-disabled, clearly-labeled placeholder
 *     (no click handler fires anything real).
 *   - the typed-text fallback is REAL: submitting text calls onSubmitText.
 *   - "Adjust crop" is an inert, visual-only placeholder — it never mutates
 *     the block text and never calls a data-changing callback.
 *   - selecting a block is real (calls onSelectBlock).
 *   - the three intents call onIntent with the right intent id + block.
 *   - topic-match sub-states (loading / error / found / none) render
 *     correctly and never silently pretend to have a match.
 */
import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import SnapDoubt, { type SnapDoubtProps } from '@alfanumrik/ui/foxy/v2/SnapDoubt';

function baseProps(overrides: Partial<SnapDoubtProps> = {}): SnapDoubtProps {
  return {
    isHi: false,
    topicsLoading: false,
    topicsError: false,
    onRetryTopics: vi.fn(),
    blocks: [],
    onSubmitText: vi.fn(),
    onReset: vi.fn(),
    selectedBlockId: null,
    onSelectBlock: vi.fn(),
    match: null,
    onIntent: vi.fn(),
    ...overrides,
  };
}

describe('SnapDoubt — capture step (empty state)', () => {
  it('renders the capture step when there are no blocks yet', () => {
    render(<SnapDoubt {...baseProps()} />);
    expect(screen.getByTestId('snap-capture-step')).toBeInTheDocument();
    expect(screen.queryByTestId('snap-blocks-step')).not.toBeInTheDocument();
  });

  it('the camera button is a disabled placeholder that never calls any callback', () => {
    const onSubmitText = vi.fn();
    render(<SnapDoubt {...baseProps({ onSubmitText })} />);
    const cameraButton = screen.getByTestId('snap-camera-placeholder');
    expect(cameraButton).toBeDisabled();
    expect(cameraButton).toHaveTextContent(/not connected yet/i);
    fireEvent.click(cameraButton);
    expect(onSubmitText).not.toHaveBeenCalled();
  });

  it('the typed-text fallback is REAL: typing + Detect calls onSubmitText with the exact text', () => {
    const onSubmitText = vi.fn();
    render(<SnapDoubt {...baseProps({ onSubmitText })} />);
    fireEvent.change(screen.getByTestId('snap-text-input'), {
      target: { value: 'Solve: 3x + 5 = 20' },
    });
    fireEvent.click(screen.getByTestId('snap-detect-button'));
    expect(onSubmitText).toHaveBeenCalledWith('Solve: 3x + 5 = 20');
  });

  it('Detect stays disabled on empty/whitespace-only input', () => {
    render(<SnapDoubt {...baseProps()} />);
    const detectButton = screen.getByTestId('snap-detect-button');
    expect(detectButton).toBeDisabled();
    fireEvent.change(screen.getByTestId('snap-text-input'), { target: { value: '   ' } });
    expect(detectButton).toBeDisabled();
  });
});

describe('SnapDoubt — blocks step', () => {
  const blocks = [{ id: 'b1', text: 'Solve: 3x + 5 = 20' }];

  it('renders detected blocks and lets the student select one (real selection)', () => {
    const onSelectBlock = vi.fn();
    render(<SnapDoubt {...baseProps({ blocks, onSelectBlock })} />);
    expect(screen.getByTestId('snap-blocks-step')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('snap-block-select-b1'));
    expect(onSelectBlock).toHaveBeenCalledWith('b1');
  });

  it('"Adjust crop" only toggles an inline note — never calls a data callback', () => {
    const onSelectBlock = vi.fn();
    const onSubmitText = vi.fn();
    render(<SnapDoubt {...baseProps({ blocks, onSelectBlock, onSubmitText })} />);
    expect(screen.queryByTestId('snap-crop-note-b1')).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId('snap-crop-placeholder-b1'));
    expect(screen.getByTestId('snap-crop-note-b1')).toHaveTextContent(/isn't wired up yet/i);
    expect(onSelectBlock).not.toHaveBeenCalled();
    expect(onSubmitText).not.toHaveBeenCalled();
  });

  it('Start over calls onReset', () => {
    const onReset = vi.fn();
    render(<SnapDoubt {...baseProps({ blocks, onReset })} />);
    fireEvent.click(screen.getByTestId('snap-reset'));
    expect(onReset).toHaveBeenCalled();
  });

  it('no match panel renders until a block is selected', () => {
    render(<SnapDoubt {...baseProps({ blocks, selectedBlockId: null })} />);
    expect(screen.queryByTestId('snap-match-panel')).not.toBeInTheDocument();
  });
});

describe('SnapDoubt — topic-match panel states', () => {
  const blocks = [{ id: 'b1', text: 'Solve: 3x + 5 = 20' }];

  it('loading: shows a skeleton, not a fabricated match', () => {
    render(<SnapDoubt {...baseProps({ blocks, selectedBlockId: 'b1', topicsLoading: true })} />);
    expect(screen.getByTestId('snap-match-panel')).toBeInTheDocument();
    expect(screen.queryByTestId('snap-match-found')).not.toBeInTheDocument();
    expect(screen.queryByTestId('snap-match-none')).not.toBeInTheDocument();
  });

  it('error: shows retry, wired to onRetryTopics', () => {
    const onRetryTopics = vi.fn();
    render(<SnapDoubt {...baseProps({ blocks, selectedBlockId: 'b1', topicsError: true, onRetryTopics })} />);
    fireEvent.click(screen.getByRole('button', { name: /retry/i }));
    expect(onRetryTopics).toHaveBeenCalled();
  });

  it('no confident match: renders the honest "no match" copy, not a guess', () => {
    render(<SnapDoubt {...baseProps({ blocks, selectedBlockId: 'b1', match: null })} />);
    expect(screen.getByTestId('snap-match-none')).toBeInTheDocument();
  });

  it('match found: renders the real topic title, subject, chapter and confidence', () => {
    render(
      <SnapDoubt
        {...baseProps({
          blocks,
          selectedBlockId: 'b1',
          match: {
            topicId: 't1',
            title: 'Linear Equations in One Variable',
            titleHi: null,
            subjectCode: 'math',
            subjectName: 'Mathematics',
            chapterNumber: 2,
            confidence: 0.72,
          },
        })}
      />,
    );
    const found = screen.getByTestId('snap-match-found');
    expect(found).toHaveTextContent('Linear Equations in One Variable');
    expect(found).toHaveTextContent('Mathematics');
    expect(found).toHaveTextContent('Ch. 2');
  });
});

describe('SnapDoubt — three-intent hand-off', () => {
  const blocks = [{ id: 'b1', text: 'Solve: 3x + 5 = 20' }];

  it('each intent button calls onIntent with the right id and the selected block', () => {
    const onIntent = vi.fn();
    render(<SnapDoubt {...baseProps({ blocks, selectedBlockId: 'b1', onIntent })} />);

    fireEvent.click(screen.getByTestId('snap-intent-explain'));
    fireEvent.click(screen.getByTestId('snap-intent-steps'));
    fireEvent.click(screen.getByTestId('snap-intent-hint'));

    expect(onIntent).toHaveBeenNthCalledWith(1, 'explain', blocks[0]);
    expect(onIntent).toHaveBeenNthCalledWith(2, 'steps', blocks[0]);
    expect(onIntent).toHaveBeenNthCalledWith(3, 'hint', blocks[0]);
  });

  // The page routes `steps` through Foxy's `homework` mode, which will not
  // solve an assigned problem end-to-end. The button must not promise one.
  it('the "steps" CTA label does not promise a full solution (EN + HI parity)', () => {
    const { rerender } = render(<SnapDoubt {...baseProps({ blocks, selectedBlockId: 'b1' })} />);
    const en = screen.getByTestId('snap-intent-steps');
    expect(en).toHaveTextContent(/how to start/i);
    expect(en).not.toHaveTextContent(/just the steps/i);
    expect(en).not.toHaveTextContent(/solution/i);

    rerender(<SnapDoubt {...baseProps({ blocks, selectedBlockId: 'b1', isHi: true })} />);
    const hi = screen.getByTestId('snap-intent-steps');
    expect(hi).toHaveTextContent('कैसे शुरू करें');
    expect(hi).not.toHaveTextContent('सिर्फ़ स्टेप्स');
  });

  it('the other two CTA labels are unchanged (EN + HI)', () => {
    const { rerender } = render(<SnapDoubt {...baseProps({ blocks, selectedBlockId: 'b1' })} />);
    expect(screen.getByTestId('snap-intent-explain')).toHaveTextContent('Explain');
    expect(screen.getByTestId('snap-intent-hint')).toHaveTextContent('Hint only');

    rerender(<SnapDoubt {...baseProps({ blocks, selectedBlockId: 'b1', isHi: true })} />);
    expect(screen.getByTestId('snap-intent-explain')).toHaveTextContent('समझाओ');
    expect(screen.getByTestId('snap-intent-hint')).toHaveTextContent('सिर्फ़ संकेत');
  });
});
