/**
 * PrereqSuggestion — Foxy North-Star Phase 3 (E5) component test.
 *
 * Pins:
 *   - null fetch result (flag off / error) → renders nothing (fail-open).
 *   - `{ suggestion: null }` (prereqs met) → renders nothing.
 *   - Suggestion present → banner with two CTAs; both fire.
 *   - Bilingual copy resolves via isHi.
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';

import PrereqSuggestion from '@alfanumrik/ui/quiz/PrereqSuggestion';

beforeEach(() => cleanup());

const SUGGESTION = {
  prereqTopicId: 'topic-frac',
  prereqTitle: 'Fractions',
  prereqTitleHi: 'भिन्न',
  chapterNumber: 2,
  masteryProbability: 0.4,
  reason: 'Fractions underpin ratios.',
  reasonHi: 'भिन्न से अनुपात बनता है।',
};

describe('PrereqSuggestion', () => {
  it('renders nothing when the fetcher returns null (flag off / error)', async () => {
    const fetchPrereq = vi.fn().mockResolvedValue(null);
    render(
      <PrereqSuggestion
        isHi={false}
        subject="math"
        grade="9"
        chapter={5}
        fetchPrereq={fetchPrereq}
      />,
    );
    await waitFor(() => expect(fetchPrereq).toHaveBeenCalledTimes(1));
    expect(screen.queryByTestId('prereq-suggestion')).toBeNull();
  });

  it('renders nothing when suggestion is null (prereqs met)', async () => {
    const fetchPrereq = vi.fn().mockResolvedValue({ suggestion: null });
    render(
      <PrereqSuggestion
        isHi={false}
        subject="math"
        grade="9"
        chapter={5}
        fetchPrereq={fetchPrereq}
      />,
    );
    await waitFor(() => expect(fetchPrereq).toHaveBeenCalledTimes(1));
    expect(screen.queryByTestId('prereq-suggestion')).toBeNull();
  });

  it('renders banner with two CTAs; Warm up fires with the prereq chapter', async () => {
    const fetchPrereq = vi.fn().mockResolvedValue({ suggestion: SUGGESTION });
    const onWarmUp = vi.fn();
    const onDismiss = vi.fn();
    render(
      <PrereqSuggestion
        isHi={false}
        subject="math"
        grade="9"
        chapter={5}
        fetchPrereq={fetchPrereq}
        onWarmUp={onWarmUp}
        onDismiss={onDismiss}
      />,
    );
    await waitFor(() => screen.getByTestId('prereq-suggestion'));
    expect(screen.getByTestId('prereq-suggestion').textContent).toContain('Fractions');

    fireEvent.click(screen.getByTestId('prereq-suggestion-warmup'));
    expect(onWarmUp).toHaveBeenCalledWith(2, SUGGESTION);

    fireEvent.click(screen.getByTestId('prereq-suggestion-dismiss'));
    expect(onDismiss).toHaveBeenCalledTimes(1);
    // Dismiss hides the banner locally.
    await waitFor(() => expect(screen.queryByTestId('prereq-suggestion')).toBeNull());
  });

  it('Hindi copy is used when isHi=true', async () => {
    const fetchPrereq = vi.fn().mockResolvedValue({ suggestion: SUGGESTION });
    render(
      <PrereqSuggestion
        isHi={true}
        subject="math"
        grade="9"
        chapter={5}
        fetchPrereq={fetchPrereq}
      />,
    );
    await waitFor(() => screen.getByTestId('prereq-suggestion'));
    expect(screen.getByTestId('prereq-suggestion').textContent).toContain('भिन्न');
    expect(screen.getByTestId('prereq-suggestion').textContent).toContain('वार्म-अप करो');
  });

  it('does not fetch when chapter is null (no selection yet)', () => {
    const fetchPrereq = vi.fn().mockResolvedValue(null);
    render(
      <PrereqSuggestion
        isHi={false}
        subject="math"
        grade="9"
        chapter={null}
        fetchPrereq={fetchPrereq}
      />,
    );
    expect(fetchPrereq).not.toHaveBeenCalled();
  });
});
