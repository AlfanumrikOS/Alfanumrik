import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  Button,
  DataState,
  Dialog,
  ExperienceV3Root,
  ProgressBar,
  RoleShell,
  type NavItem,
} from '@alfanumrik/ui/v3';

vi.mock('next/navigation', () => ({ usePathname: () => '/parent/progress' }));

const navigation: NavItem[] = [
  { label: 'Home', href: '/parent/home?childId=child-1', capability: 'parent.home', exact: true },
  { label: 'Progress', href: '/parent/progress?childId=child-1', capability: 'parent.progress' },
  { label: 'Plan', href: '/parent/plan?childId=child-1', capability: 'parent.plan' },
  { label: 'Messages', href: '/parent/messages?childId=child-1', capability: 'parent.messages' },
  { label: 'Settings', href: '/parent/settings', capability: 'shared.settings' },
];

afterEach(() => document.body.classList.remove('v3-overlay-open'));

describe('One Experience V3 UI foundation', () => {
  it('renders one focusable main region and query-safe active navigation', () => {
    render(
      <ExperienceV3Root role="parent">
        <RoleShell role="parent" navigation={navigation} mobileMoreItems={navigation.slice(4)} context={<label>Active child<select aria-label="Active child"><option>Aarav</option></select></label>}>
          <h1>Progress</h1>
        </RoleShell>
      </ExperienceV3Root>,
    );
    const main = screen.getByRole('main');
    expect(main).toHaveAttribute('id', 'main-content');
    expect(main).toHaveAttribute('tabindex', '-1');
    expect(screen.getAllByRole('link', { name: /Progress/i }).some((link) => link.getAttribute('aria-current') === 'page')).toBe(true);
    const contextButton = screen.getByRole('button', { name: 'Context' });
    expect(contextButton).toHaveAttribute('aria-haspopup', 'dialog');
    fireEvent.click(contextButton);
    expect(screen.getByRole('dialog', { name: 'Current context' })).toBeInTheDocument();
  });

  it('exposes honest async and progress semantics', () => {
    render(<ExperienceV3Root role="student"><DataState state="error" /><ProgressBar value={140} max={100} label="Mastery" showValue /></ExperienceV3Root>);
    expect(screen.getByRole('alert')).toHaveTextContent('We could not load this');
    expect(screen.getByRole('progressbar', { name: 'Mastery' })).toHaveAttribute('aria-valuenow', '100');
  });

  it('traps modal context, supports Escape and restores background availability', async () => {
    const onClose = vi.fn();
    const { rerender } = render(
      <>
        <main id="main-content"><Button>Background action</Button></main>
        <Dialog open onClose={onClose} title="Confirm action"><Button data-autofocus>Confirm</Button></Dialog>
      </>,
    );
    await waitFor(() => expect(document.getElementById('main-content')).toHaveAttribute('inert'));
    expect(screen.getByRole('dialog')).toHaveAttribute('aria-modal', 'true');
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledOnce();
    rerender(
      <>
        <main id="main-content"><Button>Background action</Button></main>
        <Dialog open={false} onClose={onClose} title="Confirm action"><Button>Confirm</Button></Dialog>
      </>,
    );
    await waitFor(() => expect(document.getElementById('main-content')).not.toHaveAttribute('inert'));
  });
});
