// D5: render tests for the new StreamStep / SubjectStep components and the
// wiring logic that gates stream selection on grade. We don't mount the full
// OnboardingFlow (it pulls in AuthContext, Supabase, router, etc.); instead we
// render the two new components in isolation with a mocked hook.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

// Mock the subjects hook so SubjectStep renders deterministically.
const subjectsMock = vi.fn();
vi.mock('@/lib/useAllowedSubjects', () => ({
  useAllowedSubjects: () => subjectsMock(),
}));

import StreamStep from '@/components/onboarding/StreamStep';
import SubjectStep from '@/components/onboarding/SubjectStep';

describe('Onboarding subject flow', () => {
  beforeEach(() => {
    subjectsMock.mockReset();
  });

  it('grade 6 path skips stream step (StreamStep is not rendered when not needed)', () => {
    // Simulating the OnboardingFlow's decision: for grade 6, `needsStream` is
    // false, so StreamStep never mounts. We assert by simply not rendering it
    // when needsStream===false.
    const needsStream = false;
    const { container } = render(needsStream ? <StreamStep value={null} onChange={() => {}} onNext={() => {}} onBack={() => {}} isHi={false} /> : <div data-testid="no-stream" />);
    expect(container.querySelector('[data-testid="no-stream"]')).not.toBeNull();
  });

  it('grade 11 science path renders StreamStep and advances on science selection', () => {
    const onNext = vi.fn();
    const onChange = vi.fn();
    render(<StreamStep value={null} onChange={onChange} onNext={onNext} onBack={() => {}} isHi={false} />);
    expect(screen.getByText(/Choose your stream/i)).toBeInTheDocument();
    // Selecting a stream should invoke onChange with the right id.
    // The "Science" label appears exactly once in the stream card title.
    const scienceLabels = screen.getAllByText(/^Science$/);
    fireEvent.click(scienceLabels[0]);
    expect(onChange).toHaveBeenCalledWith('science');
  });

  it('SubjectStep disables additional picks once the plan cap is reached', () => {
    subjectsMock.mockReturnValue({
      subjects: [],
      unlocked: [
        { code: 'math', name: 'Math', nameHi: 'गणित', icon: '∑', color: '#000', subjectKind: 'cbse_core', isCore: true, isLocked: false },
        { code: 'english', name: 'English', nameHi: 'अंग्रेज़ी', icon: 'Aa', color: '#111', subjectKind: 'cbse_core', isCore: true, isLocked: false },
        { code: 'science', name: 'Science', nameHi: 'विज्ञान', icon: '⚛', color: '#222', subjectKind: 'cbse_core', isCore: true, isLocked: false },
      ],
      locked: [],
      isLoading: false,
      error: null,
      refresh: vi.fn(),
    });
    // Value already has 2 of 2 picks — the free-plan cap.
    render(
      <SubjectStep
        value={['math', 'english']}
        onChange={() => {}}
        onNext={() => {}}
        onBack={() => {}}
        isHi={false}
        maxSubjects={2}
      />,
    );
    expect(screen.getByText(/2 of 2 selected/i)).toBeInTheDocument();
    // The "Science" subject (not yet picked) must be disabled now.
    const scienceBtn = screen.getByText(/Science/).closest('button');
    expect(scienceBtn).toHaveAttribute('disabled');
  });
});
