import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { render, screen, waitFor } from '@testing-library/react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { GlobalAppLayout } from '@alfanumrik/ui/navigation/GlobalAppLayout';
import { ExperienceV3Root, RoleShell, type NavItem } from '@alfanumrik/ui/v3';

vi.mock('next/dynamic', () => ({ default: () => () => null }));
vi.mock('next/navigation', () => ({ usePathname: () => '/today' }));
vi.mock('@alfanumrik/lib/AuthContext', () => ({
  useAuth: () => ({ isLoggedIn: true, activeRole: 'student' }),
}));

const navigation: NavItem[] = [
  { label: 'Today', href: '/today', capability: 'student.today', exact: true },
];

function V3Tree() {
  return (
    <ExperienceV3Root role="student">
      <RoleShell role="student" navigation={navigation}>
        <h1>Today</h1>
      </RoleShell>
    </ExperienceV3Root>
  );
}

afterEach(() => document.documentElement.removeAttribute('data-experience-v3-active'));

describe('GlobalAppLayout V3 ownership', () => {
  it('renders one stable skip-link target and one semantic main before effects run', () => {
    const markup = renderToStaticMarkup(<GlobalAppLayout><V3Tree /></GlobalAppLayout>);
    const documentRoot = document.createElement('div');
    documentRoot.innerHTML = markup;

    expect(documentRoot.querySelectorAll('#main-content')).toHaveLength(1);
    expect(documentRoot.querySelectorAll('main')).toHaveLength(1);
    expect(documentRoot.querySelector('main')).not.toHaveAttribute('id');
    expect(documentRoot.querySelector('#main-content')?.querySelector('main')).not.toBeNull();
  });

  it('keeps the same ownership after registration and exposes the Safari fallback marker', async () => {
    const { unmount } = render(
      <>
        <a href="#main-content">Skip to content</a>
        <div className="app-shell"><GlobalAppLayout><V3Tree /></GlobalAppLayout></div>
      </>,
    );

    await waitFor(() => expect(document.documentElement).toHaveAttribute('data-experience-v3-active', 'true'));
    expect(document.querySelectorAll('#main-content')).toHaveLength(1);
    expect(screen.getAllByRole('main')).toHaveLength(1);
    expect(document.getElementById('main-content')).toContainElement(screen.getByRole('main'));
    expect(screen.getByRole('link', { name: 'Skip to content' })).toHaveAttribute('href', '#main-content');

    const css = readFileSync(resolve(__dirname, '../../../../../packages/ui/src/v3/foundations/tokens.css'), 'utf8');
    expect(css).toContain('html[data-experience-v3-active] .app-shell > .sidebar-nav');
    expect(css).toContain('html[data-experience-v3-active] .app-shell > .bottom-nav-mobile');

    unmount();
    expect(document.documentElement).not.toHaveAttribute('data-experience-v3-active');
  });
});
