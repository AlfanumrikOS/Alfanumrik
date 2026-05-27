import { render } from '@testing-library/react';
import { vi } from 'vitest';
import ChatBubble from '@/components/foxy/ChatBubble';
import React from 'react';

describe('ChatBubble performance', () => {
  const originalTime = console.time;
  const originalTimeEnd = console.timeEnd;
  const timings: Record<string, number[]> = {};
  beforeAll(() => {
    console.time = (label: string) => {
      timings[label] = timings[label] || [];
      // store start via high resolution timer
      (timings as any)[`start_${label}`] = performance.now();
    };
    console.timeEnd = (label: string) => {
      const start = (timings as any)[`start_${label}`];
      if (start !== undefined) {
        const duration = performance.now() - start;
        timings[label].push(duration);
      }
    };
  });
  afterAll(() => {
    console.time = originalTime;
    console.timeEnd = originalTimeEnd;
    // Log average duration
    const arr = timings['ChatBubble render'] || [];
    const avg = arr.reduce((a, b) => a + b, 0) / (arr.length || 1);
    // eslint-disable-next-line no-console
    console.log('Average ChatBubble render (ms):', avg);
  });

  it('renders 100 bubbles and records timing', () => {
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
    for (let i = 0; i < 100; i++) {
      render(<ChatBubble {...props} />);
    }
    // Ensure at least one timing recorded
    expect(timings['ChatBubble render']?.length).toBeGreaterThan(0);
  });
});
