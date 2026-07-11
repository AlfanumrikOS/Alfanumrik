import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  Button,
  DataState,
  Dialog,
  ExperienceV3Root,
  Input,
  ProgressBar,
  RoleShell,
  Select,
  Textarea,
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

  it('inerts all shell chrome while a sheet is open and restores trigger focus', async () => {
    render(
      <ExperienceV3Root role="parent">
        <RoleShell role="parent" navigation={navigation} mobileMoreItems={navigation.slice(4)}>
          <h1>Progress</h1>
        </RoleShell>
      </ExperienceV3Root>,
    );

    const trigger = screen.getByRole('button', { name: 'More' });
    trigger.focus();
    fireEvent.click(trigger);

    await waitFor(() => expect(screen.getByRole('dialog', { name: 'More' })).toBeInTheDocument());
    const regions = Array.from(document.querySelectorAll<HTMLElement>('[data-v3-shell-background]'));
    expect(regions).toHaveLength(4);
    regions.forEach((region) => expect(region).toHaveAttribute('inert'));

    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'More' })).not.toBeInTheDocument());
    regions.forEach((region) => expect(region).not.toHaveAttribute('inert'));
    expect(trigger).toHaveFocus();
  });

  it('associates textarea and select hints and errors with their controls', () => {
    render(
      <>
        <span id="external-help">External help</span>
        <Input label="Assignment title" hint="Use a clear title" error="Title is required" aria-describedby="external-help" />
        <Textarea
          name="teacher-note"
          label="Teacher note"
          hint="Keep it concise"
          error="A note is required"
          aria-describedby="external-help"
        />
        <Select label="Intervention" hint="Choose one" error="Select an intervention">
          <option value="">Choose</option>
        </Select>
      </>,
    );

    const input = screen.getByRole('textbox', { name: /Assignment title/i });
    expect(input.id).not.toBe('');
    expect(input).toHaveAttribute('aria-describedby', `external-help ${input.id}-hint ${input.id}-error`);
    expect(input).toHaveAttribute('aria-invalid', 'true');

    const textarea = screen.getByRole('textbox', { name: /Teacher note/i });
    expect(textarea).toHaveAttribute(
      'aria-describedby',
      'external-help teacher-note-hint teacher-note-error',
    );
    expect(textarea).toHaveAttribute('aria-invalid', 'true');
    expect(document.getElementById('teacher-note-hint')).toHaveTextContent('Keep it concise');
    expect(document.getElementById('teacher-note-error')).toHaveTextContent('A note is required');

    const select = screen.getByRole('combobox', { name: /Intervention/i });
    expect(select.id).not.toBe('');
    expect(select).toHaveAttribute(
      'aria-describedby',
      `${select.id}-hint ${select.id}-error`,
    );
    expect(select).toHaveAttribute('aria-invalid', 'true');
    expect(document.getElementById(`${select.id}-hint`)).toHaveTextContent('Choose one');
    expect(document.getElementById(`${select.id}-error`)).toHaveTextContent('Select an intervention');
  });

  it('keeps the full application inert until nested overlays close out of order', async () => {
    const firstClose = vi.fn();
    const secondClose = vi.fn();
    const { container, rerender } = render(
      <>
        <button type="button">Application trigger</button>
        <header>Application header</header>
        <main id="main-content">Application content</main>
        <footer>Application footer</footer>
        <Dialog open={false} onClose={firstClose} title="First overlay"><Button>First action</Button></Dialog>
        <Dialog open={false} onClose={secondClose} title="Second overlay"><Button>Second action</Button></Dialog>
      </>,
    );
    const trigger = screen.getByRole('button', { name: 'Application trigger' });
    trigger.focus();
    rerender(
      <>
        <button type="button">Application trigger</button>
        <header>Application header</header>
        <main id="main-content">Application content</main>
        <footer>Application footer</footer>
        <Dialog open onClose={firstClose} title="First overlay"><Button>First action</Button></Dialog>
        <Dialog open onClose={secondClose} title="Second overlay"><Button>Second action</Button></Dialog>
      </>,
    );
    await waitFor(() => expect(container).toHaveAttribute('inert'));
    expect(document.body).toHaveClass('v3-overlay-open');

    rerender(
      <>
        <button type="button">Application trigger</button>
        <header>Application header</header>
        <main id="main-content">Application content</main>
        <footer>Application footer</footer>
        <Dialog open={false} onClose={firstClose} title="First overlay"><Button>First action</Button></Dialog>
        <Dialog open onClose={secondClose} title="Second overlay"><Button>Second action</Button></Dialog>
      </>,
    );
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'First overlay' })).not.toBeInTheDocument());
    expect(container).toHaveAttribute('inert');
    expect(document.body).toHaveClass('v3-overlay-open');

    rerender(
      <>
        <button type="button">Application trigger</button>
        <header>Application header</header>
        <main id="main-content">Application content</main>
        <footer>Application footer</footer>
        <Dialog open={false} onClose={firstClose} title="First overlay"><Button>First action</Button></Dialog>
        <Dialog open={false} onClose={secondClose} title="Second overlay"><Button>Second action</Button></Dialog>
      </>,
    );
    await waitFor(() => expect(container).not.toHaveAttribute('inert'));
    expect(document.body).not.toHaveClass('v3-overlay-open');
    expect(trigger).toHaveFocus();
  });
});
