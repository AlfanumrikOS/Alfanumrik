/**
 * FoxyToolsSheet — Foxy OS (ff_foxy_os_v1) mobile Tools bottom sheet (<lg only).
 * Phase 3 of the redesign.
 *
 * Presentation-only component built on the shared SheetModal primitive. `isHi`
 * is a plain prop (no AuthContext), and SheetModal renders inline (no portal),
 * so we can render and query the open sheet directly with Testing Library.
 *
 * These tests pin the bounded a11y + handler contract:
 *   1. open=false → renders null (sheet hidden).
 *   2. Language control is role="radiogroup" with one role="radio" per language;
 *      the active language is aria-checked; selecting another fires
 *      onSelectLanguage with that language code.
 *   3. languageLocked disables the radios and suppresses onSelectLanguage.
 *   4. Voice control is role="switch" with aria-checked tracking voiceOn, and
 *      clicking it fires onToggleVoice. When voiceSupported=false it is absent.
 *   5. "Chat history" row click fires onOpenHistory. "Your context" row renders
 *      only when onOpenContext is supplied and fires it on click.
 *   6. XP / streak / grade / usage readouts render the passed values.
 *   7. Bilingual (P7): isHi=true swaps chrome strings to Hindi.
 *
 * NOTE (manual-validation-only): SheetModal's role="dialog"/aria-modal and the
 * focus-trap / focus-return behaviour cannot be meaningfully exercised in JSDOM
 * (no layout, no real focus ring, requestAnimationFrame timing). Real
 * screen-reader announcements are out of scope here — verify on device.
 */

import { render, fireEvent, within } from '@testing-library/react';
import { vi, describe, it, expect } from 'vitest';

import {
  FoxyToolsSheet,
  type ToolsSheetLanguage,
} from '@alfanumrik/ui/foxy/mobile/FoxyToolsSheet';

const LANGUAGES: ToolsSheetLanguage[] = [
  { code: 'en', label: 'EN' },
  { code: 'hi', label: 'HI' },
  { code: 'hinglish', label: 'Hing' },
];

function makeProps(overrides: Partial<React.ComponentProps<typeof FoxyToolsSheet>> = {}) {
  return {
    open: true,
    onClose: vi.fn(),
    isHi: false,
    languages: LANGUAGES,
    activeLanguage: 'en',
    languageLocked: false,
    onSelectLanguage: vi.fn(),
    voiceSupported: true,
    voiceOn: false,
    onToggleVoice: vi.fn(),
    xpTotal: 1234,
    streakDays: 7,
    studentGrade: '9',
    usageRemaining: 12,
    usageLimit: 30,
    onOpenHistory: vi.fn(),
    onOpenContext: undefined,
    ...overrides,
  } satisfies React.ComponentProps<typeof FoxyToolsSheet>;
}

describe('FoxyToolsSheet', () => {
  it('renders nothing when closed', () => {
    const { container } = render(<FoxyToolsSheet {...makeProps({ open: false })} />);
    expect(container.firstChild).toBeNull();
  });

  it('language control is a radiogroup with one radio per language', () => {
    const { getByRole, getAllByRole } = render(<FoxyToolsSheet {...makeProps()} />);
    const group = getByRole('radiogroup');
    expect(group).toBeTruthy();
    const radios = within(group).getAllByRole('radio');
    expect(radios).toHaveLength(3);
    // Sanity: getAllByRole at the document level also finds exactly the 3 radios.
    expect(getAllByRole('radio')).toHaveLength(3);
  });

  it('marks the active language aria-checked', () => {
    const { getByRole } = render(
      <FoxyToolsSheet {...makeProps({ activeLanguage: 'hi' })} />,
    );
    const group = getByRole('radiogroup');
    const hiRadio = within(group).getByRole('radio', { name: 'HI' });
    expect(hiRadio).toHaveAttribute('aria-checked', 'true');
    const enRadio = within(group).getByRole('radio', { name: 'EN' });
    expect(enRadio).toHaveAttribute('aria-checked', 'false');
  });

  it('selecting a language fires onSelectLanguage with its code', () => {
    const onSelectLanguage = vi.fn();
    const { getByRole } = render(
      <FoxyToolsSheet {...makeProps({ onSelectLanguage })} />,
    );
    const group = getByRole('radiogroup');
    fireEvent.click(within(group).getByRole('radio', { name: 'Hing' }));
    expect(onSelectLanguage).toHaveBeenCalledTimes(1);
    expect(onSelectLanguage).toHaveBeenCalledWith('hinglish');
  });

  it('languageLocked disables the radios and suppresses selection', () => {
    const onSelectLanguage = vi.fn();
    const { getByRole } = render(
      <FoxyToolsSheet {...makeProps({ languageLocked: true, onSelectLanguage })} />,
    );
    const group = getByRole('radiogroup');
    const hiRadio = within(group).getByRole('radio', { name: 'HI' });
    expect(hiRadio).toBeDisabled();
    fireEvent.click(hiRadio);
    expect(onSelectLanguage).not.toHaveBeenCalled();
  });

  it('voice control is a switch tracking voiceOn and toggles via the handler', () => {
    const onToggleVoice = vi.fn();
    const { getByRole, rerender } = render(
      <FoxyToolsSheet {...makeProps({ voiceOn: false, onToggleVoice })} />,
    );
    const sw = getByRole('switch');
    expect(sw).toHaveAttribute('aria-checked', 'false');
    fireEvent.click(sw);
    expect(onToggleVoice).toHaveBeenCalledTimes(1);

    rerender(<FoxyToolsSheet {...makeProps({ voiceOn: true, onToggleVoice })} />);
    expect(getByRole('switch')).toHaveAttribute('aria-checked', 'true');
  });

  it('omits the voice switch when TTS is unsupported', () => {
    const { queryByRole } = render(
      <FoxyToolsSheet {...makeProps({ voiceSupported: false })} />,
    );
    expect(queryByRole('switch')).toBeNull();
  });

  it('chat history row click fires onOpenHistory', () => {
    const onOpenHistory = vi.fn();
    const { getByRole } = render(
      <FoxyToolsSheet {...makeProps({ onOpenHistory })} />,
    );
    fireEvent.click(getByRole('button', { name: /chat history/i }));
    expect(onOpenHistory).toHaveBeenCalledTimes(1);
  });

  it('renders "Your context" row only when onOpenContext is provided', () => {
    const onOpenContext = vi.fn();
    const { queryByRole, rerender, getByRole } = render(
      <FoxyToolsSheet {...makeProps({ onOpenContext: undefined })} />,
    );
    expect(queryByRole('button', { name: /your context/i })).toBeNull();

    rerender(<FoxyToolsSheet {...makeProps({ onOpenContext })} />);
    fireEvent.click(getByRole('button', { name: /your context/i }));
    expect(onOpenContext).toHaveBeenCalledTimes(1);
  });

  it('renders the XP / streak / grade / usage readouts', () => {
    const { getByText } = render(
      <FoxyToolsSheet
        {...makeProps({
          xpTotal: 1234,
          streakDays: 7,
          studentGrade: '9',
          usageRemaining: 12,
          usageLimit: 30,
        })}
      />,
    );
    expect(getByText('1234')).toBeTruthy();
    expect(getByText('7')).toBeTruthy();
    expect(getByText('Gr 9')).toBeTruthy();
    // Usage readout renders "remaining/limit" together.
    expect(getByText('12/30')).toBeTruthy();
  });

  it('hides the usage line when usage is unknown', () => {
    const { queryByText } = render(
      <FoxyToolsSheet
        {...makeProps({ usageRemaining: null, usageLimit: null })}
      />,
    );
    expect(queryByText(/Messages left today/i)).toBeNull();
  });

  it('renders Hindi chrome when isHi=true (P7)', () => {
    const { getByText, getByRole } = render(
      <FoxyToolsSheet {...makeProps({ isHi: true })} />,
    );
    // Section heading "भाषा" (Language) and SheetModal title "टूल्स" (Tools).
    expect(getByText('भाषा')).toBeTruthy();
    expect(getByRole('dialog', { name: 'टूल्स' })).toBeTruthy();
  });
});
