/**
 * Alfa Momentum Wave 4a — Learn + Exams presentation-only restyle/tokenization.
 *
 * Wave 4a tokenized the /learn and /exams surfaces: raw brand/status hex literals
 * (#E8581C, #7C3AED, #0891B2, the readiness palette #027A48/#175CD3/#B54708/#B42318,
 * and the countdown palette #EF4444/#F59E0B/#16A34A) were replaced with cosmic-aware
 * CSS custom properties (var(--accent-warm), var(--purple), var(--teal), var(--green),
 * var(--gold), var(--red)); subject/exam cards moved to <PremiumCard>, CTAs to
 * <GlowButton>, and plan-locked subjects to the <LockedCard> primitive.
 *
 * The change is PRESENTATION-ONLY — no scoring, XP, routing, or day-count behavior
 * may shift. These focused tests pin the BEHAVIOR-PRESERVING bits the restyle touched.
 *
 * Why not mount the full /exams and /learn pages? Both are heavy client pages with
 * large hook/effect graphs (SWR, Supabase chains, dynamic imports, celebration
 * overlays). Re-importing them fresh per test (vi.resetModules + vi.doMock) blows the
 * JSDOM worker heap. So we pin the value-bearing seams at the smallest faithful unit:
 *
 *   1. Exams countdown — the urgency-colour threshold + day-count math are a small
 *      pure derivation lifted verbatim from the page's inline JSX. We test that pure
 *      mapping (<=3 → var(--red), <=7 → var(--gold), else var(--green); day =
 *      Math.ceil(diff/day)) AND assert — by reading the page SOURCE — that the page
 *      still uses those tokens and no longer contains the old countdown hex. The
 *      source assertion is the drift canary; the pure test pins the contract.
 *   2. Learn locked subjects — the <LockedCard> primitive is what the /learn page now
 *      renders for plan-locked subjects. We mount it with the EXACT props the page
 *      passes (variant="plan", onAction → router.push('/pricing')) and assert the
 *      upgrade route + lock affordance survive. Plus a source assertion that /learn
 *      wires onAction to /pricing.
 *   3. Readiness badge — ready/almost/building/not_yet each render their label with a
 *      token-driven colour (no raw status hex). Real render (the component is cheap).
 *
 * JSDOM has no layout/CSS, so colour assertions read the inline `style` string.
 *
 * Owning agent: testing. Presentation-only → tested-only (no new regression-catalog
 * entry; see report).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import React from 'react';

// 6-digit hex literals are forbidden on these tokenized surfaces. 3-digit anchors
// (#fff/#000) inside a color-mix() endpoint are allowed — they are not brand colours.
const SIX_DIGIT_HEX = /#[0-9a-fA-F]{6}\b/;

// The specific raw literals Wave 4a removed from the runtime colour assignments.
const OLD_COUNTDOWN_HEX = /#(EF4444|F59E0B|16A34A)\b/i;
const OLD_STATUS_HEX = /#(027A48|175CD3|B54708|B42318)\b/i;

function inlineStyles(root: HTMLElement): string {
  return Array.from(root.querySelectorAll<HTMLElement>('[style]'))
    .map((el) => el.getAttribute('style') ?? '')
    .join(' | ');
}

const SRC = join(process.cwd(), 'src');
const readSrc = (rel: string) => readFileSync(join(SRC, rel), 'utf8');

afterEach(cleanup);

// ───────────────────────────────────────────────────────────────────────────────
// 1. Exams countdown — token-driven urgency colour + unchanged day-count math
// ───────────────────────────────────────────────────────────────────────────────

// Pure derivations lifted VERBATIM from src/app/exams/page.tsx:
//   getDaysRemaining: Math.ceil(diff / (1000*60*60*24))
//   countdown colour: daysLeft <= 3 ? --red : daysLeft <= 7 ? --gold : --green
// The page renders `{daysLeft > 0 ? daysLeft : 0}` so a past exam shows 0.
function getDaysRemaining(dateStr: string, now: number): number {
  const diff = new Date(dateStr).getTime() - now;
  return Math.ceil(diff / (1000 * 60 * 60 * 24));
}
function countdownColorToken(daysLeft: number): string {
  return daysLeft <= 3 ? 'var(--red)' : daysLeft <= 7 ? 'var(--gold)' : 'var(--green)';
}
function displayedDays(daysLeft: number): number {
  return daysLeft > 0 ? daysLeft : 0;
}

describe('Wave 4a — /exams countdown: urgency token + day-count math (pure mapping)', () => {
  const NOW = Date.UTC(2026, 5, 30, 0, 0, 0); // 2026-06-30, deterministic.
  const inDays = (n: number) => new Date(NOW + n * 86_400_000).toISOString();

  it('<=3 days remaining → var(--red)', () => {
    for (const d of [1, 2, 3]) {
      const days = getDaysRemaining(inDays(d), NOW);
      expect(days).toBe(d); // day-count behavior preserved
      expect(countdownColorToken(days)).toBe('var(--red)');
    }
  });

  it('4–7 days remaining → var(--gold)', () => {
    for (const d of [4, 5, 6, 7]) {
      const days = getDaysRemaining(inDays(d), NOW);
      expect(days).toBe(d);
      expect(countdownColorToken(days)).toBe('var(--gold)');
    }
  });

  it('>7 days remaining → var(--green)', () => {
    for (const d of [8, 15, 30]) {
      const days = getDaysRemaining(inDays(d), NOW);
      expect(days).toBe(d);
      expect(countdownColorToken(days)).toBe('var(--green)');
    }
  });

  it('a past exam clamps the displayed count to 0 and still maps to var(--red)', () => {
    const days = getDaysRemaining(inDays(-5), NOW);
    expect(days).toBeLessThanOrEqual(0);
    expect(displayedDays(days)).toBe(0);
    expect(countdownColorToken(days)).toBe('var(--red)');
  });

  it('the boundary at exactly 3 and 7 days falls on the inclusive side (<=)', () => {
    expect(countdownColorToken(3)).toBe('var(--red)');
    expect(countdownColorToken(4)).toBe('var(--gold)');
    expect(countdownColorToken(7)).toBe('var(--gold)');
    expect(countdownColorToken(8)).toBe('var(--green)');
  });

  // Drift canary: the page must keep using these tokens for the countdown and must
  // NOT have regressed to the old raw countdown hex. If someone re-introduces a hex,
  // the pure mapping above no longer reflects the page → this fails first.
  it('SOURCE: /exams uses --red/--gold/--green for the countdown and no old hex', () => {
    const src = readSrc('app/exams/page.tsx');
    expect(src).toContain("daysLeft <= 3 ? 'var(--red)'");
    expect(src).toContain("daysLeft <= 7 ? 'var(--gold)'");
    expect(src).toContain("'var(--green)'");
    expect(src).not.toMatch(OLD_COUNTDOWN_HEX);
  });

  // EXAM_TYPES colour tokenization (warm channel under cosmic, purple, teal).
  it('SOURCE: /exams EXAM_TYPES colours are tokens, not raw brand hex', () => {
    const src = readSrc('app/exams/page.tsx');
    expect(src).toContain("color: 'var(--accent-warm)'"); // unit_test rides warm channel
    expect(src).toContain("color: 'var(--purple)'");      // half_yearly
    expect(src).toContain("color: 'var(--teal)'");        // annual
    // The old raw literals these replaced must be gone.
    expect(src).not.toMatch(/#E8581C\b/i);
    expect(src).not.toMatch(/#0891B2\b/i);
  });
});

// ───────────────────────────────────────────────────────────────────────────────
// 2. Learn locked subjects — LockedCard preserves the /pricing upgrade route
// ───────────────────────────────────────────────────────────────────────────────

describe('Wave 4a — /learn locked subject → /pricing via LockedCard', () => {
  it('renders the lock affordance and fires onAction (page wires it to /pricing)', async () => {
    const { LockedCard } = await import('@/components/ui');
    const onAction = vi.fn();
    // Exact props the /learn page passes for a plan-locked subject.
    render(
      <LockedCard
        variant="plan"
        icon="⚛"
        title="Physics"
        reason="Unlock with an upgrade"
        actionLabel="Upgrade to unlock"
        onAction={onAction}
        className="p-4"
      />,
    );

    // Lock affordance: aria-labelled + the locked subject title is visible (never hidden).
    expect(screen.getByLabelText('Locked: Physics')).toBeInTheDocument();
    expect(screen.getByText('Physics')).toBeInTheDocument();

    // Action fires the upgrade callback (the page passes () => router.push('/pricing')).
    fireEvent.click(screen.getByText(/Upgrade to unlock/));
    expect(onAction).toHaveBeenCalledTimes(1);
  });

  it('plan variant is token-driven (no raw 6-digit hex in the locked card)', async () => {
    const { LockedCard } = await import('@/components/ui');
    const { container } = render(
      <LockedCard variant="plan" title="Physics" reason="Unlock with an upgrade" />,
    );
    // The plan accent is var(--purple); allow alpha-suffixed token forms like
    // `var(--purple)15`. No 6-digit brand hex literal.
    const styles = inlineStyles(container);
    expect(styles).toContain('var(--purple)');
    expect(styles).not.toMatch(SIX_DIGIT_HEX);
  });

  // Drift canary: the /learn page must keep routing locked subjects to /pricing
  // through LockedCard.onAction.
  it('SOURCE: /learn renders <LockedCard> and routes its action to /pricing', () => {
    const src = readSrc('app/learn/page.tsx');
    expect(src).toContain('<LockedCard');
    expect(src).toContain("variant=\"plan\"");
    expect(src).toContain("onAction={() => router.push('/pricing')}");
  });
});

// ───────────────────────────────────────────────────────────────────────────────
// 3. Readiness badge — token-driven colour per level (no raw status hex)
// ───────────────────────────────────────────────────────────────────────────────

describe('Wave 4a — ChapterReadinessBadge: token-driven colour per level', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.doMock('@/lib/AuthContext', () => ({ useAuth: () => ({ isHi: false }) }));
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // level → (expected fg token, expected EN label). Mirrors BADGE_STYLES in the
  // component AFTER Wave 4a tokenization.
  const CASES: Array<{ level: 'ready' | 'almost' | 'building' | 'not_yet'; token: string; label: string }> = [
    { level: 'ready', token: 'var(--green)', label: 'Ready' },
    { level: 'almost', token: 'var(--teal)', label: 'Almost' },
    { level: 'building', token: 'var(--gold)', label: 'Building' },
    { level: 'not_yet', token: 'var(--red)', label: 'New' },
  ];

  for (const { level, token, label } of CASES) {
    it(`${level} → renders "${label}" with ${token} and no raw status hex`, async () => {
      const { ChapterReadinessBadge } = await import('@/components/learn/ChapterReadinessBadge');
      const { container } = render(<ChapterReadinessBadge level={level} />);

      expect(screen.getByText(label)).toBeInTheDocument();

      const badge = screen.getByTestId(`chapter-readiness-badge-${level}`);
      const style = badge.getAttribute('style') ?? '';
      expect(style).toContain(token);                       // semantic token present
      expect(inlineStyles(container)).not.toMatch(SIX_DIGIT_HEX); // no raw hex anywhere
      expect(style).not.toMatch(OLD_STATUS_HEX);            // none of the old palette
    });
  }

  it('null level renders nothing (behavior preserved)', async () => {
    const { ChapterReadinessBadge } = await import('@/components/learn/ChapterReadinessBadge');
    const { container } = render(<ChapterReadinessBadge level={null} />);
    expect(container.firstChild).toBeNull();
  });

  // Drift canary: the readiness palette files use semantic tokens, not the old hex.
  it('SOURCE: readiness components carry no old status palette hex', () => {
    const badge = readSrc('components/learn/ChapterReadinessBadge.tsx');
    const summary = readSrc('components/learn/SubjectReadinessSummary.tsx');
    for (const src of [badge, summary]) {
      expect(src).not.toMatch(OLD_STATUS_HEX);
      expect(src).toContain('var(--green)');
      expect(src).toContain('var(--red)');
    }
  });
});
