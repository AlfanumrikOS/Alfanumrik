/**
 * Tenant override block builder used by the GROUNDED Foxy path.
 *
 * Pins:
 *   - Empty string when all overrides unset → byte-identical legacy contract.
 *   - Personality block prepended for non-default personas only (warm_mentor
 *     produces no block — the route's existing prompt IS the warm-mentor
 *     framing, so prepending an empty override would just add whitespace).
 *   - Tone block emits per non-neutral tone; `neutral` is the platform
 *     default and produces no line.
 *   - Pedagogy block emits per pedagogy.
 *   - Independence — any combination works without coupling.
 *
 * Different from the LIB path's tenant test (foxy-system-tenant-personality):
 * the lib REPLACES the persona body wholesale; this version PREPENDS a
 * "## Tenant Persona" block onto a different prompt surface.
 */

import { describe, it, expect } from 'vitest';
import { buildTenantOverrideSection } from '@/lib/ai/prompts/tenant-overrides';

describe('buildTenantOverrideSection — empty input contract', () => {
  it('returns empty string when no overrides are set', () => {
    expect(buildTenantOverrideSection({})).toBe('');
  });

  it('returns empty string when overrides are all undefined', () => {
    expect(
      buildTenantOverrideSection({
        tenantPersonality: undefined,
        tenantTone: undefined,
        tenantPedagogy: undefined,
      }),
    ).toBe('');
  });

  it('returns empty string when overrides are all platform defaults', () => {
    // warm_mentor + neutral are the platform defaults — no override needed.
    // Pedagogy has no "default" so it always emits when set.
    expect(
      buildTenantOverrideSection({
        tenantPersonality: 'warm_mentor',
        tenantTone: 'neutral',
      }),
    ).toBe('');
  });
});

describe('buildTenantOverrideSection — personality blocks', () => {
  it('rigorous_coach prepends the coach persona block', () => {
    const out = buildTenantOverrideSection({ tenantPersonality: 'rigorous_coach' });
    expect(out).toContain('## Tenant Persona');
    expect(out).toContain('Direct, demanding, and high-standards');
    expect(out).toContain('past-paper traps');
  });

  it('formal_examiner prepends the examiner persona block', () => {
    const out = buildTenantOverrideSection({ tenantPersonality: 'formal_examiner' });
    expect(out).toContain('## Tenant Persona');
    expect(out).toContain('Formal, neutral, and procedural');
    expect(out).toContain('precise, syllabus-correct terminology');
  });

  it('playful_buddy prepends the buddy persona block', () => {
    const out = buildTenantOverrideSection({ tenantPersonality: 'playful_buddy' });
    expect(out).toContain('## Tenant Persona');
    expect(out).toContain('Light, playful, and energetic');
    expect(out).toContain('Hinglish');
  });

  it('warm_mentor (the platform default) emits no block', () => {
    expect(buildTenantOverrideSection({ tenantPersonality: 'warm_mentor' })).toBe('');
  });
});

describe('buildTenantOverrideSection — tone modulation', () => {
  it('formal tone emits a Tenant Style line', () => {
    const out = buildTenantOverrideSection({ tenantTone: 'formal' });
    expect(out).toContain('## Tenant Style');
    expect(out).toContain('Tone: formal');
    expect(out).toContain('avoid contractions');
  });

  it('casual tone emits a Tenant Style line', () => {
    const out = buildTenantOverrideSection({ tenantTone: 'casual' });
    expect(out).toContain('Tone: casual');
    expect(out).toContain('Contractions welcome');
  });

  it('neutral tone emits no line (it is the platform default)', () => {
    expect(buildTenantOverrideSection({ tenantTone: 'neutral' })).toBe('');
  });
});

describe('buildTenantOverrideSection — pedagogy modulation', () => {
  it.each([
    ['socratic', 'Teaching style: Socratic'],
    ['direct_instruction', 'Teaching style: direct instruction'],
    ['worked_example', 'Teaching style: worked example'],
  ] as const)('pedagogy=%s emits the matching line', (pedagogy, expected) => {
    const out = buildTenantOverrideSection({ tenantPedagogy: pedagogy });
    expect(out).toContain('## Tenant Style');
    expect(out).toContain(expected);
  });
});

describe('buildTenantOverrideSection — independence', () => {
  it('all three together: persona block + style block', () => {
    const out = buildTenantOverrideSection({
      tenantPersonality: 'rigorous_coach',
      tenantTone: 'formal',
      tenantPedagogy: 'worked_example',
    });
    expect(out).toContain('## Tenant Persona');
    expect(out).toContain('Direct, demanding');
    expect(out).toContain('## Tenant Style');
    expect(out).toContain('Tone: formal');
    expect(out).toContain('worked example');
    // The two sections must be separated by a blank line.
    expect(out).toMatch(/## Tenant Persona[\s\S]+?\n\n## Tenant Style/);
  });

  it('persona alone — only the persona block', () => {
    const out = buildTenantOverrideSection({ tenantPersonality: 'rigorous_coach' });
    expect(out).toContain('## Tenant Persona');
    expect(out).not.toContain('## Tenant Style');
  });

  it('style alone — only the style block', () => {
    const out = buildTenantOverrideSection({ tenantTone: 'casual' });
    expect(out).not.toContain('## Tenant Persona');
    expect(out).toContain('## Tenant Style');
  });
});
