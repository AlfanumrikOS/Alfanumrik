// D6: render test for ReselectBanner — appears when the student has zero
// unlocked subjects and surfaces the "Choose your subjects" CTA in EN + HI.
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ReselectBanner } from '@/components/subjects/ReselectBanner';

describe('ReselectBanner', () => {
  it('renders English copy with title and body', () => {
    const onReselect = vi.fn();
    render(<ReselectBanner isHi={false} onReselect={onReselect} />);
    // Title and button share the same copy by design.
    expect(screen.getAllByText(/Choose your subjects/i).length).toBeGreaterThanOrEqual(1);
    expect(
      screen.getByText(/Tap below to pick the subjects available for your grade and plan/i),
    ).toBeInTheDocument();
  });

  it('renders Hindi copy', () => {
    render(<ReselectBanner isHi={true} onReselect={() => {}} />);
    // Title: अपने विषय चुनें
    expect(screen.getAllByText('अपने विषय चुनें').length).toBeGreaterThan(0);
    // Body
    expect(
      screen.getByText(/अपनी कक्षा और योजना के लिए विषय चुनने के लिए नीचे टैप करें/),
    ).toBeInTheDocument();
  });

  it('invokes onReselect when the CTA is clicked', () => {
    const onReselect = vi.fn();
    render(<ReselectBanner isHi={false} onReselect={onReselect} />);
    fireEvent.click(screen.getByRole('button', { name: /Choose your subjects/i }));
    expect(onReselect).toHaveBeenCalledOnce();
  });
});
