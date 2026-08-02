/**
 * StudyToolsBar — the "Snap a doubt" navigation pill (ff_foxy_snap_v1).
 *
 * Scope: this pins ONLY the new nav-wiring surface added to make Wave B gap
 * screen 10 (/foxy/snap) reachable from the Foxy toolbar. The diagram/lesson
 * pills already had implicit coverage via the page snapshot test; this file
 * does not re-test them beyond what's needed to confirm the OFF-path
 * byte-identical contract still holds with the new prop added.
 */
import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { StudyToolsBar } from '@/app/foxy/_components/StudyToolsBar';

function baseProps(overrides: Partial<React.ComponentProps<typeof StudyToolsBar>> = {}) {
  return {
    isHi: false,
    showDiagram: false,
    showLesson: false,
    hasChapter: false,
    accentColor: '#F97316',
    onDiagram: vi.fn(),
    onLesson: vi.fn(),
    onNeedChapter: vi.fn(),
    ...overrides,
  };
}

describe('StudyToolsBar — "Snap a doubt" pill (ff_foxy_snap_v1)', () => {
  it('renders nothing when diagram, lesson, AND snap are all off (OFF-path byte-identical)', () => {
    const { container } = render(<StudyToolsBar {...baseProps()} />);
    expect(container.firstChild).toBeNull();
  });

  it('showSnap=false: the pill is absent even if onSnap is provided', () => {
    render(<StudyToolsBar {...baseProps({ showSnap: false, onSnap: vi.fn() })} />);
    expect(screen.queryByTestId('foxy-tool-snap')).not.toBeInTheDocument();
  });

  it('showSnap=true: renders the pill and calls onSnap on click — never muted by hasChapter', () => {
    const onSnap = vi.fn();
    render(<StudyToolsBar {...baseProps({ showSnap: true, onSnap, hasChapter: false })} />);
    const pill = screen.getByTestId('foxy-tool-snap');
    expect(pill).toBeInTheDocument();
    expect(pill).not.toBeDisabled();
    fireEvent.click(pill);
    expect(onSnap).toHaveBeenCalledTimes(1);
  });

  it('renders the Hindi label when isHi is true', () => {
    render(<StudyToolsBar {...baseProps({ isHi: true, showSnap: true, onSnap: vi.fn() })} />);
    expect(screen.getByTestId('foxy-tool-snap')).toHaveTextContent('फोटो से पूछो');
  });

  it('renders alongside the diagram/lesson pills when all three flags are on', () => {
    render(
      <StudyToolsBar
        {...baseProps({
          showDiagram: true,
          showLesson: true,
          showSnap: true,
          hasChapter: true,
          onSnap: vi.fn(),
        })}
      />,
    );
    expect(screen.getByTestId('foxy-tool-diagram')).toBeInTheDocument();
    expect(screen.getByTestId('foxy-tool-lesson')).toBeInTheDocument();
    expect(screen.getByTestId('foxy-tool-snap')).toBeInTheDocument();
  });
});
