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
    const onClose = vi.fn();
    render(<DetailDrawer open={true} onClose={onClose} title="x">y</DetailDrawer>);
    fireEvent.keyDown(window, { key: 'Escape' });
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
