'use client';

import { useLang } from './LangToggle';

/**
 * Inline bilingual text component.
 * Usage: <T en="Hello" hi="नमस्ते" />
 * Renders the active language text as a fragment.
 */
export default function T({ en, hi }: { en: string; hi: string }) {
  const { isHi } = useLang();
  return <>{isHi ? hi : en}</>;
}
