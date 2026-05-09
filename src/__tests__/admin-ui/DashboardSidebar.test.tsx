import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import DashboardSidebar, {
  type SidebarNavItem,
} from '@/components/admin-ui/DashboardSidebar';

/**
 * DashboardSidebar — Plan 0 Task 7.
 *
 * Generic sidebar primitive composed by both /super-admin and /school-admin
 * shells. These tests cover the contracts both shells rely on:
 *   - Bilingual label switching (isHi)
 *   - aria-current="page" on the active item only
 *   - Collapse toggle hides text labels (icons remain)
 *   - moduleEnablement filtering with fail-open semantics
 *   - Mobile hamburger opens a drawer with data-mobile-drawer="open"
 */

const ITEMS: SidebarNavItem[] = [
  { href: '/x', label: 'Dashboard', labelHi: 'डैशबोर्ड', icon: <span data-testid="ico-dashboard">D</span> },
  { href: '/x/students', label: 'Students', labelHi: 'छात्र', icon: <span data-testid="ico-students">S</span> },
  { href: '/x/exams', label: 'Exams', labelHi: 'परीक्षा', icon: <span data-testid="ico-exams">E</span>, moduleKey: 'testing_engine' },
  { href: '/x/reports', label: 'Reports', labelHi: 'रिपोर्ट', icon: <span data-testid="ico-reports">R</span>, moduleKey: 'analytics' },
];

const baseProps = {
  brandTitle: 'Test School',
  brandSubtitle: 'Admin',
  items: ITEMS,
  currentPath: '/x',
  isHi: false,
};

describe('admin-ui/DashboardSidebar', () => {
  it('renders all items with English labels by default', () => {
    render(<DashboardSidebar {...baseProps} />);
    // Both desktop and (on mount) mobile-hidden hamburger are rendered.
    // Desktop sidebar always renders; query within it to dedupe.
    const desktop = screen.getByTestId('dashboard-sidebar-desktop');
    expect(within(desktop).getByText('Dashboard')).toBeInTheDocument();
    expect(within(desktop).getByText('Students')).toBeInTheDocument();
    expect(within(desktop).getByText('Exams')).toBeInTheDocument();
    expect(within(desktop).getByText('Reports')).toBeInTheDocument();
    // No Hindi labels visible.
    expect(within(desktop).queryByText('डैशबोर्ड')).toBeNull();
  });

  it('renders Hindi labels when isHi=true', () => {
    render(<DashboardSidebar {...baseProps} isHi={true} />);
    const desktop = screen.getByTestId('dashboard-sidebar-desktop');
    expect(within(desktop).getByText('डैशबोर्ड')).toBeInTheDocument();
    expect(within(desktop).getByText('छात्र')).toBeInTheDocument();
    expect(within(desktop).getByText('परीक्षा')).toBeInTheDocument();
    // English labels not rendered.
    expect(within(desktop).queryByText('Dashboard')).toBeNull();
  });

  it('marks the active item with aria-current="page" and leaves others unmarked', () => {
    render(<DashboardSidebar {...baseProps} currentPath="/x/students" />);
    const desktop = screen.getByTestId('dashboard-sidebar-desktop');
    const studentsLink = within(desktop).getByText('Students').closest('a');
    const dashboardLink = within(desktop).getByText('Dashboard').closest('a');
    expect(studentsLink).toHaveAttribute('aria-current', 'page');
    expect(dashboardLink).not.toHaveAttribute('aria-current');
  });

  it('collapse toggle hides label text but keeps icons visible', () => {
    render(<DashboardSidebar {...baseProps} />);
    const desktop = screen.getByTestId('dashboard-sidebar-desktop');
    // Expanded → labels visible.
    expect(within(desktop).getByText('Dashboard')).toBeInTheDocument();

    // Click the collapse button (desktop-only, in the desktop aside).
    const toggle = within(desktop).getByRole('button', { name: /collapse sidebar/i });
    fireEvent.click(toggle);

    // Labels gone.
    expect(within(desktop).queryByText('Dashboard')).toBeNull();
    expect(within(desktop).queryByText('Students')).toBeNull();
    // Icons remain.
    expect(within(desktop).getByTestId('ico-dashboard')).toBeInTheDocument();
    expect(within(desktop).getByTestId('ico-students')).toBeInTheDocument();
  });

  it('moduleEnablement filtering: hides items whose moduleKey is false; items without moduleKey always shown', () => {
    render(
      <DashboardSidebar
        {...baseProps}
        moduleEnablement={{ testing_engine: false, analytics: true }}
      />,
    );
    const desktop = screen.getByTestId('dashboard-sidebar-desktop');
    // No moduleKey → always shown.
    expect(within(desktop).getByText('Dashboard')).toBeInTheDocument();
    expect(within(desktop).getByText('Students')).toBeInTheDocument();
    // moduleKey enabled → shown.
    expect(within(desktop).getByText('Reports')).toBeInTheDocument();
    // moduleKey disabled → hidden.
    expect(within(desktop).queryByText('Exams')).toBeNull();
  });

  it('moduleEnablement=null means fail-open: all items render', () => {
    render(<DashboardSidebar {...baseProps} moduleEnablement={null} />);
    const desktop = screen.getByTestId('dashboard-sidebar-desktop');
    expect(within(desktop).getByText('Dashboard')).toBeInTheDocument();
    expect(within(desktop).getByText('Exams')).toBeInTheDocument();
    expect(within(desktop).getByText('Reports')).toBeInTheDocument();
  });

  it('mobile hamburger opens the drawer (data-mobile-drawer="open")', () => {
    render(<DashboardSidebar {...baseProps} />);
    // Drawer not in DOM before opening.
    expect(document.querySelector('[data-mobile-drawer="open"]')).toBeNull();

    const hamburger = screen.getByRole('button', { name: /open navigation menu/i });
    fireEvent.click(hamburger);

    // Drawer is now in DOM with the open marker.
    expect(document.querySelector('[data-mobile-drawer="open"]')).not.toBeNull();
  });
});
