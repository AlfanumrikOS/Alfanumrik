import { describe, it, expect } from 'vitest';
import { cssVarsFromBranding } from '@/lib/tenant-context';

describe('cssVarsFromBranding', () => {
  it('returns CSS variables from branding', () => {
    const vars = cssVarsFromBranding({
      logoUrl: null,
      primaryColor: '#FF0000',
      secondaryColor: '#00FF00',
      tagline: null,
      faviconUrl: null,
      showPoweredBy: true,
    });
    expect(vars['--color-brand-primary']).toBe('#FF0000');
    expect(vars['--color-brand-secondary']).toBe('#00FF00');
  });

  it('uses Alfanumrik defaults for default branding', () => {
    const vars = cssVarsFromBranding({
      logoUrl: null,
      primaryColor: '#7C3AED',
      secondaryColor: '#F97316',
      tagline: null,
      faviconUrl: null,
      showPoweredBy: false,
    });
    expect(vars['--color-brand-primary']).toBe('#7C3AED');
    expect(vars['--color-brand-secondary']).toBe('#F97316');
  });
});