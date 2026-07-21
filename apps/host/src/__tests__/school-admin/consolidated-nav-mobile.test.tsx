import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import ConsolidatedSchoolNav from '@/app/school-admin/_components/ConsolidatedSchoolNav';

const ALL_MODULES_ENABLED = {
  analytics: true,
  lms: true,
  testing_engine: true,
  communication: true,
  ai_tutor: true,
};

const ALL_PRINCIPAL_DESTINATIONS = [
  '/school-admin',
  '/school-admin/students',
  '/school-admin/teachers',
  '/school-admin/parents',
  '/school-admin/enroll',
  '/school-admin/invite-codes',
  '/school-admin/staff',
  '/school-admin/rbac',
  '/school-admin/ai-assistant',
  '/school-admin/classes',
  '/school-admin/exams',
  '/school-admin/content',
  '/school-admin/reports',
  '/school-admin/reports-depth',
  '/school-admin/announcements',
  '/school-admin/escalations',
  '/school-admin/billing',
  '/school-admin/branding',
  '/school-admin/modules',
  '/school-admin/ai-config',
  '/school-admin/api-keys',
  '/school-admin/audit-log',
  '/school-admin/setup',
];

function renderNav(overrides: Record<string, unknown> = {}) {
  return render(
    <ConsolidatedSchoolNav
      brandTitle="Greenwood High"
      brandSubtitle="School Administration"
      currentPath="/school-admin"
      isHi={false}
      moduleEnablement={ALL_MODULES_ENABLED}
      rbacEnabled
      adminRole="principal"
      reportsDepthEnabled
      principalAiEnabled
      {...overrides}
    />,
  );
}

function mobileNav() {
  return screen.getByRole('navigation', { name: 'School mobile navigation' });
}

async function openAllDestinations() {
  fireEvent.click(
    within(mobileNav()).getByRole('button', { name: 'Open all destinations' }),
  );
  const dialog = await screen.findByRole('dialog', { name: 'All destinations' });
  return {
    dialog,
    groupedNav: within(dialog).getByRole('navigation', {
      name: 'All school destinations',
    }),
  };
}

function hrefsIn(element: HTMLElement): string[] {
  return within(element)
    .getAllByRole('link')
    .map((link) => link.getAttribute('href'))
    .filter((href): href is string => href != null);
}

describe('ConsolidatedSchoolNav mobile information architecture', () => {
  it('renders four direct routes and one More action with 48px touch targets', () => {
    renderNav();

    const nav = mobileNav();
    expect(nav.children).toHaveLength(5);
    expect(within(nav).getAllByRole('link')).toHaveLength(4);
    expect(within(nav).getByText('Overview')).toBeDefined();
    expect(within(nav).getByText('People')).toBeDefined();
    expect(within(nav).getByText('Academics')).toBeDefined();
    expect(within(nav).getByText('Insights')).toBeDefined();
    expect(within(nav).getByText('More')).toBeDefined();

    for (const destination of Array.from(nav.children)) {
      expect(destination.className).toContain('min-h-12');
      expect(destination.className).toContain('min-w-12');
    }
    expect(screen.queryByRole('button', { name: 'Open navigation menu' })).toBeNull();
  });

  it('opens an accessible BottomSheet containing every principal-authorized destination', async () => {
    renderNav();

    const moreButton = within(mobileNav()).getByRole('button', {
      name: 'Open all destinations',
    });
    expect(moreButton.getAttribute('aria-expanded')).toBe('false');

    const { dialog, groupedNav } = await openAllDestinations();
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    expect(moreButton.getAttribute('aria-expanded')).toBe('true');
    expect(
      within(dialog).getByRole('button', { name: 'Close navigation' }),
    ).toBeDefined();
    expect(hrefsIn(groupedNav)).toEqual(ALL_PRINCIPAL_DESTINATIONS);
    for (const section of ['Overview', 'People', 'Academics', 'Billing', 'Settings']) {
      expect(within(groupedNav).getByRole('heading', { name: section })).toBeDefined();
    }
  });

  it('keeps disabled modules visible as locked destinations without navigable hrefs', async () => {
    renderNav({
      moduleEnablement: {
        ...ALL_MODULES_ENABLED,
        analytics: false,
        lms: false,
      },
    });

    const insights = within(mobileNav()).getByRole('button', {
      name: 'Insights. Module not enabled',
    });
    expect(insights).toBeDisabled();

    const { groupedNav } = await openAllDestinations();
    const hrefs = hrefsIn(groupedNav);
    expect(hrefs).not.toContain('/school-admin/content');
    expect(hrefs).not.toContain('/school-admin/reports');
    expect(hrefs).not.toContain('/school-admin/reports-depth');

    for (const label of ['Content', 'Academic Reports', 'Board Report']) {
      const lockedItem = within(groupedNav).getByText(label).closest('[aria-disabled="true"]');
      expect(lockedItem).not.toBeNull();
      expect(lockedItem?.querySelector('a')).toBeNull();
    }
  });

  it('preserves role and feature gates in the grouped More manifest', async () => {
    renderNav({ adminRole: 'academic_coordinator' });

    const { groupedNav } = await openAllDestinations();
    const hrefs = hrefsIn(groupedNav);
    expect(hrefs).toContain('/school-admin/students');
    expect(hrefs).toContain('/school-admin/audit-log');
    for (const deniedHref of [
      '/school-admin/staff',
      '/school-admin/ai-assistant',
      '/school-admin/billing',
      '/school-admin/branding',
      '/school-admin/modules',
      '/school-admin/ai-config',
      '/school-admin/api-keys',
      '/school-admin/setup',
    ]) {
      expect(hrefs).not.toContain(deniedHref);
    }
  });

  it('localizes the five destinations and BottomSheet controls in Hindi', async () => {
    renderNav({ isHi: true });

    const nav = screen.getByRole('navigation', { name: 'स्कूल मोबाइल नेविगेशन' });
    for (const label of ['अवलोकन', 'लोग', 'शैक्षणिक', 'अंतर्दृष्टि', 'अधिक']) {
      expect(within(nav).getByText(label)).toBeDefined();
    }
    fireEvent.click(within(nav).getByRole('button', { name: 'सभी विकल्प खोलें' }));
    const dialog = await screen.findByRole('dialog', { name: 'सभी विकल्प' });
    expect(within(dialog).getByRole('button', { name: 'नेविगेशन बंद करें' })).toBeDefined();
    expect(
      within(dialog).getByRole('navigation', { name: 'स्कूल के सभी विकल्प' }),
    ).toBeDefined();
  });
});
