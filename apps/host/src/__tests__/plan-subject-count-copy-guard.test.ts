/**
 * Plan copy guard — no student/parent-facing surface may claim a subject COUNT
 * as a plan differentiator.
 *
 * WHY THIS EXISTS (a live production falsehood, 2026-08-11):
 * Migration `20260814000018` set `subscription_plans.max_subjects` to NULL on
 * all four plans and seeded `plan_subject_access` with exactly 5 rows per plan
 * (`math`, `science`, `physics`, `chemistry`, `biology`). Every plan — free
 * included — now grants every subject code the product teaches. The product is
 * Mathematics and Science only: grades 6-10 see Maths + Science, grades 11-12
 * see Maths + Physics/Chemistry/Biology presented as one "Science" group.
 *
 * The client copy still said "2 subjects" (Explorer) and "4 subjects"
 * (Starter), and reserved "All subjects" for Pro/Unlimited. Every one of those
 * was a paywall claim the database no longer backs. Worse, the same claim was
 * embedded in the FAQPage JSON-LD emitted on /welcome, so a stale offer was
 * being cached off-site in search results where nobody checking the page can
 * see it.
 *
 * This guard is modelled on `student-surface-jargon-guard.test.ts`. Its
 * `renderedLiterals` extractor is COPIED below rather than imported: importing
 * one `.test.ts` from another re-registers the source file's whole suite, so a
 * single run of this guard would drag 200+ unrelated jargon assertions in with
 * it. The copy keeps the scan seeing what a human reads — not comments, not
 * import paths, not object keys. A comment explaining WHY a count was removed
 * must never be what fails this suite.
 *
 * WHAT IS NOT CHECKED HERE (deliberately):
 *   - Prices. Not one rupee figure is asserted; REG-65 and
 *     `contract/alfabot-kb-pricing-drift.test.ts` own that.
 *   - Data-driven gating UI. `/learn`'s "Unlock N more subjects" strip and
 *     QuizSetup's locked grid render from `useAllowedSubjects` →
 *     `/api/student/subjects` → `plan_subject_access`. Those are not claims,
 *     they are readouts of the live grant, and they correctly render nothing
 *     now that every plan is granted every code.
 *
 * Owner: frontend (copy). Plan entitlement semantics: architect/ops.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';

const REPO_ROOT = path.resolve(__dirname, '../../../..');

// ── source → rendered string literals ────────────────────────────────────────
// Copied verbatim (behaviour, not text) from `student-surface-jargon-guard.test.ts`.
// Keep the two in sync if that extractor is improved.

/** Strip comments so a removal note explaining WHY a count is gone cannot fail
 *  the suite. Never strips inside a string literal, hence a scanner not a regex. */
function stripComments(src: string): string {
  let out = '';
  let i = 0;
  const n = src.length;
  while (i < n) {
    const c = src[i];
    const next = src[i + 1];
    if (c === '/' && next === '/') {
      while (i < n && src[i] !== '\n') i++;
      continue;
    }
    if (c === '/' && next === '*') {
      i += 2;
      while (i < n && !(src[i] === '*' && src[i + 1] === '/')) i++;
      i += 2;
      continue;
    }
    if (c === "'" || c === '"' || c === '`') {
      const quote = c;
      out += c;
      i++;
      while (i < n) {
        if (src[i] === '\\') {
          out += src[i] + (src[i + 1] ?? '');
          i += 2;
          continue;
        }
        out += src[i];
        if (src[i] === quote) {
          i++;
          break;
        }
        i++;
      }
      continue;
    }
    out += c;
    i++;
  }
  return out;
}

/** Separates COPY from MACHINE VALUES (module paths, enum discriminants, DB
 *  column names). Real copy is Devanagari, or has a capital or a space. */
function isProseLike(s: string): boolean {
  if (s.length === 0) return false;
  if (/[ऀ-ॿ]/.test(s)) return true;
  if (!/\s/.test(s) && /^[a-z0-9_@./\-[\]$]+$/i.test(s) && !/[A-Z]/.test(s)) return false;
  if (!/\s/.test(s) && /^[a-z0-9_-]+$/.test(s)) return false;
  return /[A-Z]/.test(s) || /\s/.test(s);
}

/** String literals + JSX text nodes from comment-stripped source. */
function renderedLiterals(src: string): string[] {
  const code = stripComments(src)
    .replace(/\b(?:import|export)\s[^;\n]*?from\s*['"][^'"]*['"]/g, '')
    .replace(/\bimport\s*\(\s*['"][^'"]*['"]\s*\)/g, '')
    .replace(/['"]([A-Za-z0-9_$]+)['"]\s*:/g, '')
    .replace(/\.(?:select|eq|order|from|neq|gte|lte|in)\(\s*['"][^'"]*['"]/g, '');

  const out: string[] = [];
  for (const m of code.matchAll(/'((?:[^'\\\n]|\\.)*)'/g)) out.push(m[1]);
  for (const m of code.matchAll(/"((?:[^"\\\n]|\\.)*)"/g)) out.push(m[1]);
  for (const m of code.matchAll(/`((?:[^`\\]|\\.)*)`/g)) out.push(m[1]);
  for (const m of code.matchAll(/>[ \t\r\n]*([^<>{}\n]*[A-Za-zऀ-ॿ][^<>{}\n]*)[<{]/g)) {
    out.push(m[1].trim());
  }
  const STATEMENT_SHAPED = /[=;()]|\b(?:if|else|return|const|let|var|function|async|await|typeof|new|catch|try)\b/;
  for (const m of code.matchAll(/\}[ \t\r\n]*([^<>{}\n]*[A-Za-zऀ-ॿ][^<>{}\n]*)[<{]/g)) {
    const text = m[1].trim();
    if (!STATEMENT_SHAPED.test(text)) out.push(text);
  }
  return out.map((s) => s.trim()).filter(isProseLike);
}

/**
 * Surfaces that describe what a PLAN includes. Explicit list, not a glob, so
 * the suite states exactly what it covers and a moved file fails loudly rather
 * than silently scanning nothing.
 *
 * THE LIST IS THE WEAK POINT — it was wrong on its first draft. The initial
 * version named plans.ts + PricingPlansV3 + the two FAQs and went green, while
 * `PricingTeaserV3` (the pricing block on the live /welcome homepage),
 * `PricingTeaserV2` and `PricingFaqV3` (/pricing's own FAQ) still shipped
 * "2 subjects" / "4 subjects" / "All subjects + STEM Lab". A repo grep found
 * them, not the guard. Before adding a plan card anywhere, add its file here.
 */
const PLAN_COPY_SURFACES = [
  'packages/lib/src/plans.ts',
  // /pricing
  'packages/ui/src/landing/v3/PricingPlansV3.tsx',
  'packages/ui/src/landing/v3/PricingFaqV3.tsx',
  // /welcome (V3 is the default; V2 is the ?v=2 rollback path, still reachable)
  'packages/ui/src/landing/v3/PricingTeaserV3.tsx',
  'packages/ui/src/landing/v3/FAQV3.tsx',
  'packages/ui/src/landing/PricingTeaserV2.tsx',
  'packages/ui/src/landing/FAQV2.tsx',
  // NOT listed: packages/ui/src/landing/FinalCTA.tsx. It has ZERO importers
  // (verified by grep) — it is unmounted dead code, so it is not a surface a
  // visitor can reach. It carries three separate falsehoods (a "2 subjects"
  // plan claim, stale ₹399/₹999 prices, and a "16 subjects" catalog claim) and
  // is reported for deletion rather than patched here; adding it would make
  // this guard assert things about copy nobody renders.
  'packages/ui/src/onboarding/SubjectStep.tsx',
  'packages/ui/src/PlanBadge.tsx',
  'packages/ui/src/billing/v2/PlanModal.tsx',
  'packages/ui/src/UpgradeModal.tsx',
  'packages/ui/src/JsonLd.tsx',
] as const;

/**
 * The banned constructs. Each carries the literal it was written against, so a
 * future reader can see this list was derived from real production copy and not
 * guessed at.
 */
const BANNED: ReadonlyArray<{ name: string; re: RegExp; foundIn: string }> = [
  {
    name: 'numeric subject count (EN)',
    re: /\b\d+\s+subjects?\b/i,
    foundIn: "plans.ts '2 subjects' / '4 subjects'; FAQV3 'across 2 subjects'",
  },
  {
    name: 'numeric subject count (HI)',
    re: /\d+\s*विषय/,
    foundIn: "plans.ts '2 विषय' / '4 विषय'; FAQV3 '2 विषयों में'",
  },
  {
    name: '"all subjects" as a tier feature (EN)',
    re: /\ball subjects\b/i,
    foundIn: "plans.ts + PricingPlansV3 listed 'All subjects' on Pro/Unlimited only",
  },
  {
    name: '"all subjects" as a tier feature (HI)',
    re: /सभी विषय/,
    foundIn: "plans.ts + PricingPlansV3 listed 'सभी विषय' on Pro/Unlimited only",
  },
  {
    name: 'count-based subject upsell (EN)',
    re: /\bmore subjects\b/i,
    foundIn: "PricingPlansV3 Starter tagline 'More chats, more subjects'",
  },
  {
    // `और` ("and") is deliberately NOT in this alternation. It first was, and
    // it matched the innocent FAQ heading "कौन सी कक्षाएँ और विषय?" ("which
    // grades and subjects?"). A guard that cries wolf on correct copy gets
    // weakened until it guards nothing.
    name: 'count-based subject upsell (HI)',
    re: /(?:ज़्यादा|अधिक)\s+विषय/,
    foundIn: "PricingPlansV3 Starter tagline 'ज़्यादा चैट, ज़्यादा विषय'",
  },
];

/**
 * The honest replacement. Both subjects ship on every plan, so the SAME string
 * must appear on every tier — a tier that says something different about
 * subjects is, by construction, differentiating on subjects again.
 */
const HONEST_EN = 'Maths & Science included';
const HONEST_HI = 'गणित और विज्ञान शामिल';

function read(rel: string): string {
  return readFileSync(path.join(REPO_ROOT, rel), 'utf8');
}

function countOccurrences(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1;
}

describe('plan-copy guard — scan is non-vacuous', () => {
  it('every listed plan-copy surface exists', () => {
    const missing = PLAN_COPY_SURFACES.filter((rel) => !existsSync(path.join(REPO_ROOT, rel)));
    expect(
      missing,
      `listed surface(s) no longer exist — update this list rather than letting the guard scan nothing:\n${missing.join('\n')}`,
    ).toEqual([]);
  });

  it('extracts rendered strings from every listed surface', () => {
    for (const rel of PLAN_COPY_SURFACES) {
      expect(
        renderedLiterals(read(rel)).length,
        `${rel} yielded almost no strings — the extractor is broken for this file`,
      ).toBeGreaterThan(5);
    }
  });

  it('each banned pattern still matches the production literal it was written against', () => {
    // Self-test: if a pattern stops firing on the copy that motivated it, the
    // guard has gone vacuous even while every file passes.
    const PRE_CHANGE_LITERALS = [
      '2 subjects',
      '4 subjects',
      '2 विषय',
      '4 विषय',
      'All subjects',
      'सभी विषय',
      'More chats, more subjects',
      'ज़्यादा चैट, ज़्यादा विषय',
      'Explorer is free forever — 5 Foxy chats and 5 quizzes a day across 2 subjects',
      'आपके बच्चे को प्रतिदिन 2 विषयों में 5 Foxy चैट और 5 क्विज़ मिलते हैं',
    ];
    for (const literal of PRE_CHANGE_LITERALS) {
      expect(
        BANNED.some((b) => b.re.test(literal)),
        `no banned pattern matches the real pre-change literal "${literal}" — the guard would not have caught the original defect`,
      ).toBe(true);
    }
  });
});

describe('no plan-copy surface claims a subject COUNT as a plan differentiator', () => {
  for (const rel of PLAN_COPY_SURFACES) {
    it(`${rel} is free of subject-count plan claims`, () => {
      const literals = renderedLiterals(read(rel));
      const violations: string[] = [];
      for (const literal of literals) {
        for (const banned of BANNED) {
          if (banned.re.test(literal)) {
            violations.push(`  [${banned.name}] ${literal}\n      (pattern written against: ${banned.foundIn})`);
          }
        }
      }
      expect(
        violations,
        `${rel} renders subject-count plan copy that the database no longer backs.\n` +
          `Every plan grants every subject code (max_subjects = NULL, 5 rows in plan_subject_access).\n` +
          `Say what is true on every tier instead, e.g. "${HONEST_EN}" / "${HONEST_HI}".\n\n` +
          violations.join('\n'),
      ).toEqual([]);
    });
  }
});

/**
 * Every surface that renders one entry PER PLAN must say the same thing about
 * subjects on all four. This is the assertion that actually encodes the product
 * truth: a tier that words its subject line differently is differentiating on
 * subjects again, however politely.
 */
const PER_PLAN_CARD_SURFACES: ReadonlyArray<{ rel: string; cards: number }> = [
  { rel: 'packages/lib/src/plans.ts', cards: 4 },
  { rel: 'packages/ui/src/landing/v3/PricingPlansV3.tsx', cards: 4 },
  { rel: 'packages/ui/src/landing/v3/PricingTeaserV3.tsx', cards: 4 },
  { rel: 'packages/ui/src/landing/PricingTeaserV2.tsx', cards: 4 },
];

describe('the honest subject statement is identical on every tier', () => {
  for (const { rel, cards } of PER_PLAN_CARD_SURFACES) {
    it(`${rel} carries the same subject line on all ${cards} plans`, () => {
      const src = read(rel);
      expect(countOccurrences(src, HONEST_EN), `expected "${HONEST_EN}" once per plan (${cards}x) in ${rel}`).toBe(cards);
      expect(countOccurrences(src, HONEST_HI), `expected "${HONEST_HI}" once per plan (${cards}x) in ${rel}`).toBe(cards);
    });
  }
});

describe('the onboarding subject cap no longer caps', () => {
  /**
   * `PLAN_SUBJECT_CAPS` in SubjectStep.tsx is the client-side fallback
   * `OnboardingFlow.tsx` feeds into `maxSubjects`. While free was 2 and starter
   * was 4, a free student picking subjects during onboarding hit "Plan limit
   * reached — upgrade to add more subjects" against a database that caps
   * nothing (`max_subjects` IS NULL on all four plans). That is the same
   * falsehood as the pricing copy, expressed as behaviour.
   */
  it('every plan in PLAN_SUBJECT_CAPS is null (unlimited), mirroring max_subjects IS NULL', () => {
    const src = read('packages/ui/src/onboarding/SubjectStep.tsx');
    const block = src.match(/PLAN_SUBJECT_CAPS[^=]*=\s*\{([\s\S]*?)\}/);
    expect(block, 'PLAN_SUBJECT_CAPS declaration not found in SubjectStep.tsx').toBeTruthy();

    const entries = [...(block as RegExpMatchArray)[1].matchAll(/(\w+)\s*:\s*([^,\n]+)/g)].map(
      ([, plan, value]) => [plan, value.trim()] as const,
    );
    expect(entries.length, 'PLAN_SUBJECT_CAPS should still declare all four plans').toBe(4);

    const capped = entries.filter(([, value]) => value !== 'null');
    expect(
      capped.map(([plan, value]) => `${plan}: ${value}`),
      'PLAN_SUBJECT_CAPS still caps a plan. subscription_plans.max_subjects IS NULL on all four plans, ' +
        'so a client-side cap blocks students the server would allow and shows an upgrade prompt for a limit that does not exist.',
    ).toEqual([]);
  });
});
