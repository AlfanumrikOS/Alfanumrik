import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import React from 'react';
import type { FoxyResponse } from '@/lib/foxy/schema';

/**
 * GUARD #8 (McqBlock half) — inline "Quiz me" self-check MCQ.
 *
 * The McqBlock inside FoxyStructuredRenderer is FORMATIVE-ONLY:
 *   - selecting an option reveals correctness LOCALLY (no network),
 *   - the chosen vs correct options are colour + glyph flagged,
 *   - the explanation appears after a check,
 *   - chrome labels are bilingual (P7).
 *
 * It must NOT POST anywhere. We let any stray fetch throw so a self-check that
 * tried to submit would fail the test (formative-only contract, P1/P2/P4).
 */

let _isHi = false;
vi.mock('@/lib/AuthContext', () => ({
  useAuth: () => ({ isHi: _isHi }),
}));
vi.mock('@/lib/useSubjectLookup', () => ({
  useSubjectLookup: () => () => ({ code: 'science', icon: '⚛', color: '#10B981', name: 'Science' }),
}));
// supabase-client is pulled by the DiagramBlock import path; stub it so the
// module graph resolves without a real client.
vi.mock('@/lib/supabase-client', () => ({
  supabase: { from: () => ({ select: () => ({ textSearch: () => ({ limit: () => Promise.resolve({ data: [], error: null }) }) }) }) },
}));

import { FoxyStructuredRenderer } from '@/components/foxy/FoxyStructuredRenderer';

function mcqResponse(): FoxyResponse {
  return {
    title: 'Quiz me',
    subject: 'science',
    blocks: [
      {
        type: 'mcq',
        stem: 'Which organelle is the powerhouse of the cell?',
        options: ['Nucleus', 'Mitochondria', 'Ribosome', 'Golgi body'],
        correct_answer_index: 1,
        explanation: 'Mitochondria produce ATP, so it is called the powerhouse of the cell.',
        bloom_level: 'Understand',
        difficulty: 'easy',
      },
    ],
  } as FoxyResponse;
}

beforeEach(() => {
  cleanup();
  _isHi = false;
  // Any network call from a "self-check" is a contract violation → make fetch throw.
  vi.stubGlobal('fetch', vi.fn(() => {
    throw new Error('McqBlock self-check must not POST to any route');
  }));
});

describe('GUARD #8 — inline McqBlock self-check (formative-only)', () => {
  it('renders the mcq block with all four options before any selection', () => {
    render(<FoxyStructuredRenderer response={mcqResponse()} />);
    expect(screen.getByTestId('foxy-mcq-block')).toBeTruthy();
    expect(screen.getByText('Nucleus')).toBeTruthy();
    expect(screen.getByText('Mitochondria')).toBeTruthy();
    expect(screen.getByText('Ribosome')).toBeTruthy();
    expect(screen.getByText('Golgi body')).toBeTruthy();
    // No explanation shown before a check.
    expect(screen.queryByText(/Mitochondria produce ATP/)).toBeNull();
  });

  it('selecting the CORRECT option reveals "Correct!" + the explanation, no network call', () => {
    render(<FoxyStructuredRenderer response={mcqResponse()} />);
    fireEvent.click(screen.getByText('Mitochondria')); // correct (index 1)
    expect(screen.getByText(/Correct!/)).toBeTruthy();
    expect(screen.getByText(/Mitochondria produce ATP/)).toBeTruthy();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('selecting a WRONG option reveals "Not quite", flags chosen ✗ AND correct ✓, no network call', () => {
    render(<FoxyStructuredRenderer response={mcqResponse()} />);
    fireEvent.click(screen.getByText('Nucleus')); // wrong (index 0)
    expect(screen.getByText(/Not quite/)).toBeTruthy();
    // Explanation still shown so the student learns the right answer.
    expect(screen.getByText(/Mitochondria produce ATP/)).toBeTruthy();
    // Chosen-wrong glyph ✗ and correct glyph ✓ both present (colour is not the only signal).
    expect(screen.getByText('✗')).toBeTruthy();
    expect(screen.getByText('✓')).toBeTruthy();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('options become disabled after the first check (single self-check, no re-submit)', () => {
    render(<FoxyStructuredRenderer response={mcqResponse()} />);
    const group = screen.getByRole('radiogroup');
    fireEvent.click(screen.getByText('Mitochondria'));
    const radios = group.querySelectorAll('button[role="radio"]');
    radios.forEach((r) => expect((r as HTMLButtonElement).disabled).toBe(true));
  });

  it('renders bilingual chrome under isHi (Hindi labels)', () => {
    _isHi = true;
    render(<FoxyStructuredRenderer response={mcqResponse()} />);
    fireEvent.click(screen.getByText('Mitochondria'));
    // "सही!" = Correct!, "कारण" = Why
    expect(screen.getByText(/सही!/)).toBeTruthy();
    expect(screen.getByText(/कारण/)).toBeTruthy();
  });
});
