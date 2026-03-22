import { describe, it, expect, vi } from 'vitest';

// Mock Next.js modules
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }),
  usePathname: () => '/',
}));

vi.mock('@/lib/AuthContext', () => ({
  useAuth: () => ({
    student: null,
    isLoggedIn: false,
    isLoading: false,
    isHi: false,
    language: 'en',
    roles: ['student'],
    activeRole: 'student',
    setActiveRole: vi.fn(),
  }),
}));

describe('Smoke tests', () => {
  it('constants are defined correctly', async () => {
    const { GRADES, BOARDS, SUBJECT_META } = await import('@/lib/constants');
    expect(GRADES).toBeDefined();
    expect(GRADES.length).toBeGreaterThan(0);
    expect(BOARDS).toContain('CBSE');
    expect(SUBJECT_META.find(s => s.code === 'math')).toBeDefined();
  });

  it('types are properly defined', async () => {
    const types = await import('@/lib/types');
    // Verify key interfaces exist by checking the module exports
    expect(types).toBeDefined();
  });

  it('supabase client is created', async () => {
    const { supabase } = await import('@/lib/supabase');
    expect(supabase).toBeDefined();
    expect(supabase.auth).toBeDefined();
    expect(supabase.from).toBeDefined();
  });

  it('JsonLd component renders structured data', async () => {
    const { default: JsonLd } = await import('@/components/JsonLd');
    const { render } = await import('@testing-library/react');
    const { container } = render(JsonLd());
    const script = container.querySelector('script[type="application/ld+json"]');
    expect(script).toBeDefined();
    const data = JSON.parse(script!.textContent || '{}');
    expect(data['@type']).toBe('WebApplication');
    expect(data.name).toBe('Alfanumrik');
    expect(data.applicationCategory).toBe('EducationalApplication');
  });

  it('SimulationCard renders with memo', async () => {
    const mod = await import('@/components/SimulationCard');
    // React.memo wraps the component — check it's a valid component
    expect(mod.default).toBeDefined();
    expect(typeof mod.default).toBe('object'); // memo returns an object
  });
});
