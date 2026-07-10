import { describe, expect, it } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { CONSUMER_MINIMALISM_FLAGS } from '@alfanumrik/lib/flags/registries/consumer';
import RoleBottomNav from '@alfanumrik/ui/navigation/RoleBottomNav';
import {
  ROLE_NAV_CONFIGS,
  getLocalizedRoleNavLabel,
  isRoleNavItemActive,
  splitRoleNavItems,
  visibleRoleNavItems,
} from '@alfanumrik/ui/navigation/role-nav';

describe('role navigation contract', () => {
  it('caps visible mobile items at five while preserving overflow items', () => {
    const split = splitRoleNavItems(ROLE_NAV_CONFIGS.student.items);

    expect(split.primary).toHaveLength(5);
    expect(split.primary.map((item) => item.label)).toEqual([
      'Today',
      'Learn',
      'Practice',
      'Foxy',
      'Profile',
    ]);
    expect(split.overflow.map((item) => item.label)).toContain('Reports');
  });

  it('renders bilingual labels from the same nav item', () => {
    const parentHome = ROLE_NAV_CONFIGS.parent.items[0];

    expect(getLocalizedRoleNavLabel(parentHome, false)).toBe('Home');
    expect(getLocalizedRoleNavLabel(parentHome, true)).toBe('होम');
  });

  it('fails open for unknown module and feature gate state', () => {
    const gatedItems = [
      { href: '/teacher/assignments', label: 'Assign', labelHi: 'असाइन', iconKey: 'assign', moduleKey: 'assignments' },
      { href: '/school-admin/reports-depth', label: 'Depth', labelHi: 'गहराई', iconKey: 'reports', flagName: 'ff_depth' },
    ] as const;

    expect(visibleRoleNavItems(gatedItems, {})).toHaveLength(2);
    expect(visibleRoleNavItems(gatedItems, { moduleEnablement: { assignments: false } })).toHaveLength(1);
    expect(visibleRoleNavItems(gatedItems, { flags: { ff_depth: false } })).toHaveLength(1);
  });

  it('hides the student Today item when its fetched feature flag is explicitly off', () => {
    const withoutFlagState = visibleRoleNavItems(ROLE_NAV_CONFIGS.student.items, {});
    const flagOff = visibleRoleNavItems(ROLE_NAV_CONFIGS.student.items, {
      flags: { [CONSUMER_MINIMALISM_FLAGS.TODAY_HOME_V1]: false },
    });

    expect(withoutFlagState.map((item) => item.href)).toContain('/today');
    expect(flagOff.map((item) => item.href)).not.toContain('/today');
  });

  it('marks nested routes active without making root-like routes overmatch', () => {
    expect(isRoleNavItemActive('/teacher/messages/abc', { href: '/teacher/messages', label: 'Messages', labelHi: 'संदेश', iconKey: 'messages' })).toBe(true);
    expect(isRoleNavItemActive('/teacher/classes', { href: '/teacher', label: 'Class', labelHi: 'कक्षा', iconKey: 'class', exact: true })).toBe(false);
  });

  it('renders all five student primary items when the student nav opts out of reserving a More slot', () => {
    render(
      <RoleBottomNav
        config={ROLE_NAV_CONFIGS.student}
        isHi={false}
        pathname="/today"
        onNavigate={() => undefined}
        reserveMoreSlot={false}
      />,
    );

    const nav = screen.getByRole('navigation', { name: 'Student navigation' });
    ['Today', 'Learn', 'Practice', 'Foxy', 'Profile'].forEach((label) => {
      expect(within(nav).getByRole('button', { name: label })).toBeInTheDocument();
    });
    expect(within(nav).queryByRole('button', { name: 'More options' })).not.toBeInTheDocument();
  });
});
