'use client';

/**
 * useCosmicLightSurface — activate the Cosmic-LIGHT + student palette for the
 * lifetime of an Alfa OS flagship surface (ff_student_os_v1).
 *
 * The cosmic token scope in globals.css is keyed to `html[data-design="cosmic"]`
 * (and the light variant to `html[data-design="cosmic"][data-theme="light"]`),
 * so the flagship surfaces must set those attributes on <html> to inherit the
 * Cosmic-LIGHT tokens. This hook writes:
 *
 *     data-design="cosmic"  data-theme="light"  data-role="student"
 *
 * while the surface is mounted, and restores whatever was there before on
 * unmount. It DELIBERATELY never writes data-theme="dark" — dark mode is killed
 * for these surfaces (CEO directive). It only ever requests the LIGHT theme.
 *
 * SSR-safe (guards `document`). ff_student_os_v1 is permanently ON (seeded
 * 20260620001601, re-asserted 20260802110000) and the OS surfaces mount
 * unconditionally — the `active` argument is the only control (foxy passes
 * osEnabled=true; StudentOSDashboard always passes true).
 */

import { useEffect } from 'react';

export function useCosmicLightSurface(active: boolean = true): void {
  useEffect(() => {
    if (!active) return;
    if (typeof document === 'undefined') return;
    const html = document.documentElement;

    html.removeAttribute('data-design');
    html.removeAttribute('data-role');
    html.setAttribute('data-theme', 'light');
  }, [active]);
}
