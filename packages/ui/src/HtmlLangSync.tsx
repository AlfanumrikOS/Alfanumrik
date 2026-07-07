'use client';

import { useEffect } from 'react';
import { useAuth } from '@alfanumrik/lib/AuthContext';

/**
 * Mirrors the user's language preference (AuthContext.isHi) onto
 * <html lang>. Without this, the root layout's hard-coded `lang="en"`
 * misrepresents Hindi content to screen readers, hreflang SEO, and
 * browser-translate tools — P7 invariant violation. Audit 2026-05-11 §0 F3.
 *
 * Client-only; renders nothing. Mounted from LayoutDeferredChrome so it
 * runs once on hydration and on every isHi change thereafter.
 */
export default function HtmlLangSync() {
  const { isHi } = useAuth();

  useEffect(() => {
    if (typeof document === 'undefined') return;
    document.documentElement.setAttribute('lang', isHi ? 'hi' : 'en');
  }, [isHi]);

  return null;
}
