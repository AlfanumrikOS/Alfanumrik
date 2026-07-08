/**
 * QuickRecallSection — humane card-label hardening
 * (fix/srs-dedupe-per-question follow-up).
 *
 * Quiz-review flashcards write `topic = subject:chapter:question_id` (a
 * machine dedupe key for idx_src_u). This section's label line falls back to
 * `topic` when `chapter_title` is missing, which — before the fix — would
 * have rendered `math · math:5:3f2a…uuid` to a student. Pins:
 *   1. A composite-key topic is NEVER rendered raw (no uuid on screen).
 *   2. Human-readable topics (Foxy cards) still render byte-identical.
 *   3. A real chapter_title always wins and renders as-is.
 *   4. Bilingual: Hindi UI renders "अध्याय N" (P7).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup } from '@testing-library/react';

const UUID = '3f2a8b9c-7d4e-4f1a-9b2c-8e5d6a7f0c1d';

// ─── Mutable mock state ───────────────────────────────────────────────

const authState = {
  isHi: false,
  student: { id: 'stu-1' } as { id: string } | null,
};

const cardsState = {
  cards: [] as Record<string, unknown>[],
};

// ─── Mocks ────────────────────────────────────────────────────────────

vi.mock('@alfanumrik/lib/AuthContext', () => ({
  useAuth: () => authState,
}));

vi.mock('@alfanumrik/lib/domains/profile', () => ({
  getReviewCards: vi.fn(async () => ({ ok: true, data: cardsState.cards })),
}));

import QuickRecallSection from '@alfanumrik/ui/refresh/QuickRecallSection';

// ─── Helpers ──────────────────────────────────────────────────────────

function makeCard(overrides: Record<string, unknown> = {}) {
  return {
    id: 'card-1',
    subject: 'math',
    topic: `math:5:${UUID}`,
    chapter_title: null,
    front_text: 'What is 2+2?',
    back_text: '4',
    hint: '',
    source: 'quiz_wrong_answer',
    ease_factor: 2.5,
    interval_days: 1,
    streak: 0,
    repetition_count: 0,
    total_reviews: 0,
    correct_reviews: 0,
    last_review_date: null,
    ...overrides,
  };
}

beforeEach(() => {
  authState.isHi = false;
  authState.student = { id: 'stu-1' };
  cardsState.cards = [makeCard()];
  vi.clearAllMocks();
});

afterEach(() => cleanup());

// ─── Tests ────────────────────────────────────────────────────────────

describe('QuickRecallSection — composite dedupe key never rendered raw', () => {
  it('missing chapter_title + composite topic → renders "Chapter N", never the key/uuid', async () => {
    const { container } = render(<QuickRecallSection />);

    await waitFor(() => {
      expect(screen.getByText('What is 2+2?')).toBeInTheDocument();
    });

    // Humane label rendered next to the subject
    expect(screen.getByText(/Chapter 5/)).toBeInTheDocument();
    // The raw machine key must never appear anywhere in the section
    expect(container.textContent).not.toContain(UUID);
    expect(container.textContent).not.toContain(UUID.slice(0, 8));
    expect(container.textContent).not.toContain(`math:5:${UUID}`);
  });

  it('Hindi UI → "अध्याय N" (P7), still no raw key', async () => {
    authState.isHi = true;
    const { container } = render(<QuickRecallSection />);

    await waitFor(() => {
      expect(screen.getByText('What is 2+2?')).toBeInTheDocument();
    });

    expect(screen.getByText(/अध्याय 5/)).toBeInTheDocument();
    expect(container.textContent).not.toContain(UUID.slice(0, 8));
  });

  it('composite key without a numeric chapter (na sentinel) → subject name, never the uuid', async () => {
    cardsState.cards = [makeCard({ topic: `science:na:${UUID}`, subject: 'science' })];
    const { container } = render(<QuickRecallSection />);

    await waitFor(() => {
      expect(screen.getByText('What is 2+2?')).toBeInTheDocument();
    });

    expect(container.textContent).not.toContain(UUID.slice(0, 8));
    expect(container.textContent).toContain('science');
  });
});

describe('QuickRecallSection — existing label behavior preserved', () => {
  it('Foxy-style human-readable topic renders as-is', async () => {
    cardsState.cards = [makeCard({ topic: 'Photosynthesis', source: 'foxy' })];
    render(<QuickRecallSection />);

    await waitFor(() => {
      expect(screen.getByText(/Photosynthesis/)).toBeInTheDocument();
    });
  });

  it('a real chapter_title wins over topic and renders as-is', async () => {
    cardsState.cards = [makeCard({ chapter_title: 'Linear Equations' })];
    const { container } = render(<QuickRecallSection />);

    await waitFor(() => {
      expect(screen.getByText(/Linear Equations/)).toBeInTheDocument();
    });
    expect(container.textContent).not.toContain(UUID.slice(0, 8));
  });
});
