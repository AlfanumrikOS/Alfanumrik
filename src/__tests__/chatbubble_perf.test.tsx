import { render } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import ChatBubble from '@/components/foxy/ChatBubble';
import React from 'react';

describe('ChatBubble performance', () => {
  it('renders 100 bubbles in under 3s without crashing (smoke test)', () => {
    const props = {
      role: 'tutor' as const,
      content: <p>Test</p>,
      rawContent: 'Test',
      timestamp: new Date().toISOString(),
      color: '#ff0000',
      activeSubject: 'math',
      onFeedback: vi.fn(),
      onReport: vi.fn(),
    };

    const start = performance.now();
    for (let i = 0; i < 100; i++) {
      const { container } = render(<ChatBubble {...props} />);
      // Each render must produce actual DOM output (not null/empty)
      expect(container.firstChild).not.toBeNull();
    }
    const elapsed = performance.now() - start;
    // 3000ms ceiling — purely a hang/infinite-loop detector, not a precision benchmark
    expect(elapsed).toBeLessThan(3000);
  });
});
