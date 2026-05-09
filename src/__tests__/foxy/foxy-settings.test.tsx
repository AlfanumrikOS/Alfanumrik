/**
 * FoxySettings — component tests for LanguagePicker + ModePicker.
 *
 * Plan ref: docs/superpowers/plans/2026-05-09-student-quality-upgrade.md
 *           Task 5b: extract subject/mode/lang picker(s); tests follow.
 *
 * Asserts the bounded contract:
 *   1. LanguagePicker renders all 3 LANGS pills
 *   2. LanguagePicker fires onLanguageChange unless isLocked
 *   3. ModePicker renders the simplified-mode pills + Lesson pill
 *   4. ModePicker fires onSwitchMode with the simplified mode id
 */

import { render, fireEvent } from '@testing-library/react';
import { vi, describe, it, expect } from 'vitest';

vi.mock('@/components/foxy/ConversationManager', () => ({
  SIMPLIFIED_MODES: [
    { id: 'learn', icon: '📖', label: 'Learn', labelHi: 'सीखो' },
    { id: 'practice', icon: '✏️', label: 'Practice', labelHi: 'अभ्यास' },
    { id: 'ask', icon: '❓', label: 'Ask', labelHi: 'पूछो' },
  ],
  MODE_MAP: { learn: 'learn', practice: 'practice', ask: 'doubt' } as Record<string, string>,
}));

import { LanguagePicker, ModePicker } from '@/app/foxy/_components/FoxySettings';

describe('LanguagePicker', () => {
  it('renders EN, HI, and Hing pills', () => {
    const { getByText } = render(
      <LanguagePicker language="en" isLocked={false} onLanguageChange={vi.fn()} />,
    );
    expect(getByText('EN')).toBeTruthy();
    expect(getByText('HI')).toBeTruthy();
    expect(getByText('Hing')).toBeTruthy();
  });

  it('fires onLanguageChange when a pill is clicked (unlocked)', () => {
    const onLanguageChange = vi.fn();
    const { getByText } = render(
      <LanguagePicker language="en" isLocked={false} onLanguageChange={onLanguageChange} />,
    );
    fireEvent.click(getByText('HI'));
    expect(onLanguageChange).toHaveBeenCalledWith('hi');
  });

  it('does not fire when locked', () => {
    const onLanguageChange = vi.fn();
    const { getByText } = render(
      <LanguagePicker language="hi" isLocked={true} onLanguageChange={onLanguageChange} />,
    );
    fireEvent.click(getByText('EN'));
    expect(onLanguageChange).not.toHaveBeenCalled();
  });
});

describe('ModePicker', () => {
  it('renders simplified mode pills + Lesson', () => {
    const { getByText } = render(
      <ModePicker sessionMode="learn" color="#10B981" isHi={false} onSwitchMode={vi.fn()} />,
    );
    expect(getByText('Learn')).toBeTruthy();
    expect(getByText('Practice')).toBeTruthy();
    expect(getByText('Ask')).toBeTruthy();
    expect(getByText('Lesson')).toBeTruthy();
  });

  it('fires onSwitchMode with the simplified id when a pill is clicked', () => {
    const onSwitchMode = vi.fn();
    const { getByText } = render(
      <ModePicker
        sessionMode="learn"
        color="#10B981"
        isHi={false}
        onSwitchMode={onSwitchMode}
      />,
    );
    fireEvent.click(getByText('Practice'));
    expect(onSwitchMode).toHaveBeenCalledWith('practice');
    fireEvent.click(getByText('Lesson'));
    expect(onSwitchMode).toHaveBeenCalledWith('lesson');
  });

  it('renders Hindi labels when isHi=true', () => {
    const { getByText } = render(
      <ModePicker sessionMode="learn" color="#10B981" isHi={true} onSwitchMode={vi.fn()} />,
    );
    expect(getByText('सीखो')).toBeTruthy();
    expect(getByText('पाठ')).toBeTruthy(); // Lesson in Hindi
  });
});
