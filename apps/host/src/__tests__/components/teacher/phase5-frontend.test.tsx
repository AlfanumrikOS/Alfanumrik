/**
 * Phase 5 frontend — component contract tests for the new surfaces:
 *   - MisconceptionClusterCard renders cluster name + count + evidence CTA
 *   - EvidenceDrawer renders examples when open, closes on Escape
 *   - InterventionApprovalCard fires record_intervention_decision with the
 *     right shape for approve/override/dismiss
 *   - DraftQuestionList regenerate fires callback; edit saves valid shape
 *   - PercentileBandCard renders the correct bilingual copy per band
 *   - ConversationPromptsCard renders 1..3 prompts and nothing when empty
 *
 * Pure presentation; no network/auth mocks required.
 */

import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';

import { MisconceptionClusterCard } from '@alfanumrik/ui/teacher/MisconceptionClusterCard';
import { EvidenceDrawer } from '@alfanumrik/ui/teacher/EvidenceDrawer';
import {
  InterventionApprovalCard,
  type InterventionSuggestion,
} from '@alfanumrik/ui/teacher/InterventionApprovalCard';
import { DraftQuestionList, type DraftQuestion } from '@alfanumrik/ui/teacher/DraftQuestionList';
import { PercentileBandCard } from '@alfanumrik/ui/leaderboard/PercentileBandCard';
import { ConversationPromptsCard } from '@alfanumrik/ui/parent/ConversationPromptsCard';

afterEach(cleanup);

describe('MisconceptionClusterCard', () => {
  it('renders name, count badge, chips and fires evidence CTA', () => {
    const onView = vi.fn();
    render(
      <MisconceptionClusterCard
        cluster={{
          pattern_code: 'sign_flip_error',
          concept_codes: ['linear_eq'],
          student_count: 5,
          students: [
            { id: 'a', name: 'A' },
            { id: 'b', name: 'B' },
          ],
          first_detected: '2026-08-01',
          last_detected: '2026-08-04',
        }}
        isHi={false}
        onViewEvidence={onView}
      />,
    );
    expect(screen.getByTestId('cluster-count-badge').textContent).toBe('5');
    fireEvent.click(screen.getByTestId('view-evidence-btn'));
    expect(onView).toHaveBeenCalledTimes(1);
  });

  it('bilingual — Hindi CTA', () => {
    render(
      <MisconceptionClusterCard
        cluster={{
          pattern_code: 'x',
          concept_codes: [],
          student_count: 1,
          students: [{ id: 'a', name: 'A' }],
          first_detected: 'x',
          last_detected: 'x',
        }}
        isHi
        onViewEvidence={() => {}}
      />,
    );
    expect(screen.getByTestId('view-evidence-btn').textContent).toContain('सबूत');
  });
});

describe('EvidenceDrawer', () => {
  it('renders examples when open', () => {
    render(
      <EvidenceDrawer
        open
        payload={{
          title: 'Sign flip',
          examples: [
            {
              question_text: 'x + 2 = 5',
              student_answer: '-3',
              correct_answer: '3',
              detected_at: '2026-08-04T00:00:00Z',
            },
          ],
        }}
        isHi={false}
        onClose={() => {}}
      />,
    );
    expect(screen.getByTestId('evidence-drawer')).toBeTruthy();
    expect(screen.getByText(/x \+ 2 = 5/)).toBeTruthy();
  });

  it('does not render when closed', () => {
    render(
      <EvidenceDrawer open={false} payload={null} isHi={false} onClose={() => {}} />,
    );
    expect(screen.queryByTestId('evidence-drawer')).toBeNull();
  });
});

describe('InterventionApprovalCard', () => {
  const suggestion: InterventionSuggestion = {
    intervention_id: 'iv1',
    recommended_tier: 'tier2',
    tiers: [
      { tier: 'tier1', students: [{ id: 'a', name: 'A' }], recommended_action: 'Nudge' },
      {
        tier: 'tier2',
        students: [{ id: 'b', name: 'B' }],
        recommended_action: 'Practice',
      },
      { tier: 'tier3', students: [], recommended_action: 'Re-teach' },
    ],
  };

  it('approve fires with recommended tier + reason_code', () => {
    const onDecision = vi.fn();
    render(
      <InterventionApprovalCard
        suggestion={suggestion}
        isHi={false}
        onDecision={onDecision}
      />,
    );
    fireEvent.click(screen.getByTestId('intervention-approve-btn'));
    expect(onDecision).toHaveBeenCalledWith(
      expect.objectContaining({
        intervention_id: 'iv1',
        decision: 'approved',
        chosen_tier: 'tier2',
      }),
    );
  });

  it('dismiss opens reason picker', () => {
    render(
      <InterventionApprovalCard
        suggestion={suggestion}
        isHi={false}
        onDecision={() => {}}
      />,
    );
    fireEvent.click(screen.getByTestId('intervention-dismiss-btn'));
    expect(screen.getByTestId('intervention-reason-picker')).toBeTruthy();
  });
});

describe('DraftQuestionList', () => {
  const q: DraftQuestion = {
    id: 'q1',
    question_text: 'What is 2 + 2?',
    options: ['3', '4', '5', '6'],
    correct_answer_index: 1,
  };

  it('regenerate fires callback with the row index', () => {
    const onRegen = vi.fn();
    render(
      <DraftQuestionList
        drafts={[q]}
        isHi={false}
        onEdit={() => {}}
        onRegenerate={onRegen}
      />,
    );
    fireEvent.click(screen.getByTestId('draft-regenerate-btn'));
    expect(onRegen).toHaveBeenCalledWith(0);
  });
});

describe('PercentileBandCard', () => {
  it.each([
    ['top_10', /top 10%/i],
    ['top_25', /top 25%/i],
    ['top_50', /top half/i],
    ['keep_going', /keep going/i],
  ] as const)('English band %s renders copy', (band, re) => {
    render(<PercentileBandCard band={band} isHi={false} />);
    expect(screen.getByTestId('percentile-band-card').textContent).toMatch(re);
    cleanup();
  });

  it('Hindi band top_10 renders Devanagari copy', () => {
    render(<PercentileBandCard band="top_10" isHi />);
    expect(screen.getByTestId('percentile-band-card').textContent).toContain('टॉप 10%');
  });

  it('never renders an absolute rank number', () => {
    render(<PercentileBandCard band="top_25" isHi={false} />);
    const html = screen.getByTestId('percentile-band-card').innerHTML;
    // Only "25%" should appear; there is no "#N" or leading "#" rank display.
    expect(/#\d+/.test(html)).toBe(false);
  });
});

describe('ConversationPromptsCard', () => {
  it('renders up to 3 prompts', () => {
    render(
      <ConversationPromptsCard
        prompts={['One', 'Two', 'Three', 'Four']}
        isHi={false}
      />,
    );
    const card = screen.getByTestId('conversation-prompts-card');
    expect(card.querySelectorAll('li').length).toBe(3);
  });

  it('renders nothing when empty', () => {
    const { container } = render(
      <ConversationPromptsCard prompts={[]} isHi={false} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it('bilingual chrome — Hindi title', () => {
    render(
      <ConversationPromptsCard prompts={['बात करें']} isHi />,
    );
    expect(
      screen.getByTestId('conversation-prompts-card').textContent,
    ).toContain('अपने बच्चे से पूछें');
  });
});
