import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import DetailDrawer from '@alfanumrik/ui/admin-ui/DetailDrawer';

describe('admin-ui/DetailDrawer', () => {
  it('renders nothing when open=false', () => {
    const { container } = render(
      <DetailDrawer open={false} onClose={() => {}} title="x">body</DetailDrawer>,
    );
    expect(container.firstChild).toBeNull();
  });

  it('renders title and children when open', () => {
    render(
      <DetailDrawer open={true} onClose={() => {}} title="Student details">
        <p>body content</p>
      </DetailDrawer>,
    );
    expect(screen.getByText('Student details')).toBeInTheDocument();
    expect(screen.getByText('body content')).toBeInTheDocument();
  });

  it('calls onClose when Escape pressed', () => {
    // DetailDrawer is built on the shared overlay foundation's useEscapeKey
    // (packages/ui/src/ui/primitives/overlay/useEscapeKey.ts), which listens
    // on `document` (capture phase) so stacked overlays close top-first via
    // the overlay stack — the same as Dialog/Drawer/BottomSheet. A real
    // keydown targets the focused element and bubbles/captures through
    // document, so dispatching on `document` here matches real usage more
    // closely than the previous window-targeted dispatch (an artifact of the
    // old hand-rolled `window.addEventListener` implementation).
    const onClose = vi.fn();
    render(<DetailDrawer open={true} onClose={onClose} title="x">y</DetailDrawer>);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('calls onClose when overlay clicked', () => {
    const onClose = vi.fn();
    render(<DetailDrawer open={true} onClose={onClose} title="x">y</DetailDrawer>);
    fireEvent.click(screen.getByTestId('detail-drawer-overlay'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('has correct ARIA role for accessibility', () => {
    render(<DetailDrawer open={true} onClose={() => {}} title="x">y</DetailDrawer>);
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByRole('dialog')).toHaveAttribute('aria-modal', 'true');
    expect(screen.getByRole('dialog')).toHaveAttribute('aria-label', 'x');
  });
});
