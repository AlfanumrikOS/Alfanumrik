/**
 * Catalogue-claim guard — no user-facing surface may claim Alfanumrik teaches a
 * subject CATALOGUE bigger than Mathematics and Science.
 *
 * WHY THIS EXISTS (a live production falsehood, measured 2026-08-11):
 * `subjects.is_active` is true for exactly FIVE codes in production — `math`,
 * `science`, `physics`, `chemistry`, `biology` — and false for the other 18.
 * Grades 6-10 study Maths + Science; grades 11-12 study Maths plus
 * Physics/Chemistry/Biology, presented together as one "Science" group. Three
 * live surfaces nonetheless claimed "16 subjects":
 *
 *   - `apps/host/src/app/layout.tsx` root `openGraph.description` — the worst
 *     of the three, because search engines and link unfurlers scrape and CACHE
 *     it off-site, so the lie outlives the page fix.
 *   - `apps/host/src/app/help/page.tsx` — an FAQ answer enumerating all 16 by
 *     name, EN and HI.
 *   - `apps/host/src/app/for-schools/page.tsx` — "Foxy teaches 16 subjects".
 *
 * A parent can sign up on the strength of that number and find two subjects.
 *
 * WHY THIS IS A GLOB SCAN AND NOT A FILE LIST:
 * Its sibling `plan-subject-count-copy-guard.test.ts` uses an explicit
 * PLAN_COPY_SURFACES list, and that list was wrong on its first draft — it went
 * green while `PricingTeaserV3`, `PricingTeaserV2` and `PricingFaqV3` still
 * shipped the defect. Its author recorded that in a comment. A repo grep found
 * those, not the guard. So this guard walks directory trees instead: a NEW page
 * added under a scanned root is covered the day it lands, with nobody having to
 * remember to register it. Exceptions are opt-OUT (see ALLOWLIST), never opt-in.
 *
 * SCOPE (`SCAN_ROOTS`): `apps/host/src/app` + `packages/ui/src`. Deliberately
 * NOT `packages/lib/src` — that tree is machine constants (`constants.ts`
 * subject codes), AI prompt scaffolding (`foxy/prompt-sections.ts` names
 * Geography/Political Science to teach Foxy what NOT to answer), and
 * `plans.ts`, which the sibling guard already asserts file-by-file. Scanning it
 * would produce allowlist entries that say nothing about user-facing copy.
 *
 * WHAT IS NOT CHECKED HERE (deliberately):
 *   - Prices. Not one rupee figure is asserted; REG-65 and
 *     `contract/alfabot-kb-pricing-drift.test.ts` own that.
 *   - Which subject codes the DB grants. That is architect/ops territory; this
 *     guard only asserts that COPY does not oversell whatever they are.
 *
 * Reference wording: `docs/alfabot/knowledge-base.md` (`product-features`).
 *
 * Owner: frontend (copy). Catalogue semantics: architect/ops.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import path from 'node:path';

const REPO_ROOT = path.resolve(__dirname, '../../../..');

// ── source → rendered string literals ────────────────────────────────────────
// Copied (behaviour, not text) from `plan-subject-count-copy-guard.test.ts`,
// which in turn copied it from `student-surface-jargon-guard.test.ts`.
// Importing one `.test.ts` from another re-registers the source file's whole
// suite, so a single run of this guard would drag hundreds of unrelated
// assertions in with it. Keep the three copies in sync if the extractor is
// improved.

/** Strip comments so a removal note explaining WHY a claim is gone cannot fail
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

// ── scan scope ───────────────────────────────────────────────────────────────

const SCAN_ROOTS = ['apps/host/src/app', 'packages/ui/src'] as const;
const SKIP_DIRS = new Set(['__tests__', 'node_modules', '.next', '__mocks__']);

function walk(absDir: string, acc: string[]): string[] {
  for (const entry of readdirSync(absDir)) {
    const abs = path.join(absDir, entry);
    if (statSync(abs).isDirectory()) {
      if (SKIP_DIRS.has(entry)) continue;
      walk(abs, acc);
      continue;
    }
    if (/\.tsx?$/.test(entry) && !/\.(?:test|spec)\.tsx?$/.test(entry)) {
      acc.push(path.relative(REPO_ROOT, abs).split(path.sep).join('/'));
    }
  }
  return acc;
}

function scannedFiles(): string[] {
  const acc: string[] = [];
  for (const root of SCAN_ROOTS) walk(path.join(REPO_ROOT, root), acc);
  return acc.sort();
}

// ── the banned constructs ────────────────────────────────────────────────────

/**
 * Subject names that CBSE has and Alfanumrik does not teach. `English` and
 * `Hindi` are deliberately ABSENT: they name the two UI languages far more
 * often than they name a subject ("in Hindi and English" appears on nearly
 * every marketing surface), and a guard that cries wolf on correct copy gets
 * weakened until it guards nothing.
 */
const NOT_TAUGHT = [
  'Social Studies',
  'Social Science',
  'Sanskrit',
  'Computer Science',
  'Economics',
  'Accountancy',
  'Business Studies',
  'Political Science',
  'Geography',
];

/** Every CBSE subject name, taught or not — used only for the enumeration
 *  shape, which needs a COUNT of names in one sentence. */
const ANY_SUBJECT_NAME = [
  'Mathematics',
  'Maths',
  'Science',
  'Physics',
  'Chemistry',
  'Biology',
  'English',
  'Hindi',
  ...NOT_TAUGHT,
  'History',
  'Coding',
];

const BANNED: ReadonlyArray<{ name: string; test: (s: string) => boolean; foundIn: string }> = [
  {
    name: 'numeric subject count (EN)',
    test: (s) => /\b\d+\s+subjects?\b/i.test(s),
    foundIn: "layout.tsx openGraph '16 subjects'; for-schools 'Foxy teaches 16 subjects'; help 'We cover 16 subjects'",
  },
  {
    name: 'numeric subject count (HI)',
    test: (s) => /\d+\s*विषय/.test(s),
    foundIn: "for-schools 'Foxy 16 विषय…'; help '16 विषय: गणित, विज्ञान, …'",
  },
  {
    name: '"covers/teaches all subjects" (EN)',
    test: (s) => /\b(?:cover|covers|covering|teach|teaches|teaching|help|across|including|include|includes)\b[^.]{0,40}\b(?:all|every)\b[^.]{0,30}\bsubjects?\b/i.test(s),
    foundIn: "parent/support 'Alfanumrik covers all major CBSE subjects: …'; foxy/layout 'Get help … across all CBSE subjects'",
  },
  {
    name: '"covers all subjects" (HI)',
    test: (s) => /(?:सभी|हर)\s+(?:प्रमुख\s+)?(?:CBSE\s+)?विषय/.test(s) && /(?:कवर|पढ़ात|शामिल|मिलत)/.test(s),
    foundIn: "parent/support 'Alfanumrik सभी प्रमुख CBSE विषयों को कवर करता है: …'",
  },
  {
    // The enumeration shape. Three-or-more distinct CBSE subject names in ONE
    // rendered string, at least one of which we do not teach, is a catalogue
    // claim however it is punctuated. This is what catches StatsV2's bare list
    // ('English, Hindi, Maths, Science, Social, Sanskrit, Computer') where the
    // number "16" lives in adjacent JSX and the count patterns above cannot see
    // it.
    name: 'catalogue enumeration (>=3 subject names, >=1 not taught)',
    test: (s) => {
      const named = ANY_SUBJECT_NAME.filter((n) => new RegExp(`\\b${n}\\b`, 'i').test(s));
      if (named.length < 3) return false;
      return named.some((n) => NOT_TAUGHT.includes(n)) || /\bSocial\b|\bComputer\b/i.test(s);
    },
    foundIn:
      "help 'Mathematics, Science, Physics, Chemistry, Biology, English, Hindi, Social Studies, Computer Science, …'; StatsV2 'English, Hindi, Maths, Science, Social, Sanskrit, Computer'",
  },
  {
    name: 'catalogue enumeration (HI)',
    test: (s) => {
      const HI_NAMES = ['गणित', 'विज्ञान', 'भौतिकी', 'रसायन', 'जीवविज्ञान', 'जीव विज्ञान', 'अंग्रेज़ी', 'हिंदी', 'सामाजिक', 'कंप्यूटर', 'अर्थशास्त्र', 'लेखांकन', 'लेखाशास्त्र', 'व्यापार', 'व्यवसाय', 'राजनीति', 'इतिहास', 'भूगोल', 'संस्कृत', 'कोडिंग'];
      const HI_NOT_TAUGHT = ['सामाजिक', 'कंप्यूटर', 'अर्थशास्त्र', 'लेखांकन', 'लेखाशास्त्र', 'व्यापार', 'व्यवसाय', 'राजनीति', 'भूगोल', 'संस्कृत', 'कोडिंग'];
      const named = HI_NAMES.filter((n) => s.includes(n));
      if (named.length < 3) return false;
      return named.some((n) => HI_NOT_TAUGHT.includes(n));
    },
    foundIn: "help '16 विषय: गणित, विज्ञान, भौतिकी, …, कंप्यूटर, अर्थशास्त्र, …'; StatsV2 'अंग्रेज़ी, हिन्दी, गणित, विज्ञान, सामाजिक, संस्कृत, कंप्यूटर'",
  },
];

/**
 * Some claims are not expressible as one string literal. A stat tile splits the
 * number and the noun across two adjacent object properties — `{ value: '16',
 * label: 'Subjects' }` — and `renderedLiterals` sees only `'16'` (filtered out
 * as a machine value) and `'Subjects'` (harmless alone). Three separate
 * surfaces carried exactly that shape: `landing/Hero.tsx`,
 * `landing/CredibilityStrip.tsx`, and `landing/StatsV2.tsx` (whose number lives
 * in JSX: `num: <>16</>`). So this one rule reads the comment-stripped SOURCE
 * rather than the extracted literals.
 */
const BANNED_SOURCE: ReadonlyArray<{ name: string; re: RegExp; foundIn: string }> = [
  {
    name: 'numeric subject stat tile (count and noun in adjacent properties)',
    re: /\b(?:value|val|num|stat)\s*:\s*(?:<>\s*)?['"]?\s*\d+[^,\n]{0,20}[,\s][\s\S]{0,160}?(?:\bsubjects?\b|विषय)/i,
    foundIn:
      "Hero.tsx `{ value: '16', label: 'Subjects' }`; CredibilityStrip.tsx `{ val: '16', label: t('subjects', 'विषय') }`; StatsV2.tsx `num: <>16</>` over `lblEn: 'subjects · grades 6—12'`",
  },
];

/**
 * Opt-OUT, not opt-in. Every entry names the file, the rule it suppresses, and
 * WHY the copy is legitimate. An entry with no reason is a bug.
 *
 * Two legitimate classes live here:
 *   (a) ADMIN INPUT CAPS — a validation message bounding a bulk payload is not
 *       a claim about what we teach.
 *   (b) CBSE-DOMAIN RECORDS — copy that describes what the CBSE *board* offers
 *       (the 11-12 stream chooser), so a student can identify their own stream.
 *
 * The list started longer. Entries for the mock-test filter, the NCERT-question
 * display-name map, the super-admin misconception curator and the parent-report
 * label map were written pre-emptively, and the "load-bearing" suite below
 * proved none of them suppressed anything real — the extractor already treats
 * those as machine values. They were deleted rather than left as false
 * precedent for excusing the next thing.
 */
const ALLOWLIST: ReadonlyArray<{ file: string; rule: string; reason: string }> = [
  {
    file: 'apps/host/src/app/api/super-admin/students/[id]/subjects/route.ts',
    rule: 'numeric subject count (EN)',
    reason:
      'Zod validation message "No more than 20 subjects" — an admin-facing input cap on a bulk assignment payload, not a claim about what we teach.',
  },
  {
    file: 'packages/ui/src/onboarding/StreamStep.tsx',
    rule: 'catalogue enumeration (>=3 subject names, >=1 not taught)',
    reason:
      'Describes what the CBSE COMMERCE / HUMANITIES streams contain so an 11-12 student can identify their stream. It is a statement about the board, not about Alfanumrik, and the blurbs end in "etc." precisely because we do not teach them.',
  },
  {
    file: 'packages/ui/src/onboarding/StreamStep.tsx',
    rule: 'catalogue enumeration (HI)',
    reason:
      'The same CBSE stream description in Hindi. It tells an 11-12 student what the Commerce/Humanities streams contain so they can identify their own; it does not offer those subjects.',
  },
  {
    file: 'packages/ui/src/StreamGate.tsx',
    rule: 'catalogue enumeration (>=3 subject names, >=1 not taught)',
    reason:
      'Same CBSE-stream identification copy as StreamStep, on the stream-gate card. Describes the board\'s streams, not our catalogue.',
  },
];

function isAllowed(file: string, rule: string): boolean {
  return ALLOWLIST.some((a) => a.file === file && a.rule === rule);
}

/** One pass over the tree. Returned as `${file} ${rule}` keys so both the
 *  violation suite and the allowlist-rot suite read the same evidence. */
function scanHits(): Array<{ file: string; rule: string; literal: string; foundIn: string }> {
  const hits: Array<{ file: string; rule: string; literal: string; foundIn: string }> = [];
  for (const rel of scannedFiles()) {
    const src = readFileSync(path.join(REPO_ROOT, rel), 'utf8');
    for (const literal of renderedLiterals(src)) {
      for (const banned of BANNED) {
        if (banned.test(literal)) hits.push({ file: rel, rule: banned.name, literal, foundIn: banned.foundIn });
      }
    }
    const bare = stripComments(src);
    for (const banned of BANNED_SOURCE) {
      const m = bare.match(banned.re);
      if (m) hits.push({ file: rel, rule: banned.name, literal: m[0].replace(/\s+/g, ' '), foundIn: banned.foundIn });
    }
  }
  return hits;
}

// ── suites ───────────────────────────────────────────────────────────────────

describe('catalogue-claim guard — scan is non-vacuous', () => {
  it('every scan root exists', () => {
    const missing = SCAN_ROOTS.filter((r) => !existsSync(path.join(REPO_ROOT, r)));
    expect(
      missing,
      `scan root(s) no longer exist — update SCAN_ROOTS rather than letting the guard walk nothing:\n${missing.join('\n')}`,
    ).toEqual([]);
  });

  it('walks a substantial number of source files', () => {
    // A path typo would make walk() return [] and every assertion below pass.
    expect(scannedFiles().length).toBeGreaterThan(300);
  });

  it('each banned pattern still matches the real pre-change literal it was written against', () => {
    // Self-test: if a pattern stops firing on the copy that motivated it, the
    // guard has gone vacuous even while every file passes.
    const PRE_CHANGE_LITERALS: ReadonlyArray<[string, string]> = [
      [
        'numeric subject count (EN)',
        'Meet Foxy, your personal AI tutor that teaches at YOUR level. 16 subjects, Hindi & English. Adaptive learning powered by Bayesian mastery tracking.',
      ],
      ['numeric subject count (EN)', 'Foxy teaches 16 subjects in Hindi and English with step-by-step explanations.'],
      ['numeric subject count (HI)', 'Foxy 16 विषय हिंदी और अंग्रेज़ी में स्टेप-बाय-स्टेप समझाता है।'],
      [
        '"covers/teaches all subjects" (EN)',
        'Alfanumrik covers all major CBSE subjects: Mathematics, Science, Physics, Chemistry, Biology, English, Hindi, Social Studies, Computer Science, Economics, Accountancy, and more — for Classes 6 through 12.',
      ],
      [
        '"covers/teaches all subjects" (EN)',
        'Chat with Foxy, your personal tutor. Get help in Hindi and English across all CBSE subjects.',
      ],
      [
        '"covers all subjects" (HI)',
        'Alfanumrik सभी प्रमुख CBSE विषयों को कवर करता है: गणित, विज्ञान, भौतिकी, रसायन विज्ञान, जीव विज्ञान, अंग्रेज़ी, हिंदी, सामाजिक विज्ञान, कंप्यूटर विज्ञान, अर्थशास्त्र, लेखाशास्त्र और बहुत कुछ — कक्षा 6 से 12 तक।',
      ],
      [
        'catalogue enumeration (>=3 subject names, >=1 not taught)',
        'We cover 16 subjects: Mathematics, Science, Physics, Chemistry, Biology, English, Hindi, Social Studies, Computer Science, Economics, Accountancy, Business Studies, Political Science, History, Geography, and Coding — all aligned to CBSE curriculum for Grades 6-12.',
      ],
      [
        'catalogue enumeration (>=3 subject names, >=1 not taught)',
        'English, Hindi, Maths, Science, Social, Sanskrit, Computer',
      ],
      [
        'catalogue enumeration (HI)',
        '16 विषय: गणित, विज्ञान, भौतिकी, रसायन, जीवविज्ञान, अंग्रेज़ी, हिंदी, सामाजिक विज्ञान, कंप्यूटर, अर्थशास्त्र, लेखांकन, व्यापार, राजनीति, इतिहास, भूगोल, और कोडिंग।',
      ],
      ['catalogue enumeration (HI)', 'अंग्रेज़ी, हिन्दी, गणित, विज्ञान, सामाजिक, संस्कृत, कंप्यूटर'],
    ];
    for (const [rule, literal] of PRE_CHANGE_LITERALS) {
      const pattern = BANNED.find((b) => b.name === rule);
      expect(pattern, `no banned pattern is named "${rule}"`).toBeTruthy();
      expect(
        (pattern as (typeof BANNED)[number]).test(literal),
        `rule "${rule}" no longer matches the real pre-change literal:\n  ${literal}\nThe guard would not have caught the original defect.`,
      ).toBe(true);
    }
  });

  it('the stat-tile rule still matches the real pre-change source it was written against', () => {
    const PRE_CHANGE_SOURCE = [
      // landing/Hero.tsx
      "    { value: '16', label: 'Subjects', labelHi: 'विषय' },\n    { value: '6–12', label: 'Grades', labelHi: 'कक्षाएँ' },",
      // landing/CredibilityStrip.tsx
      "              { val: '16', label: t('subjects', 'विषय') },\n              { val: '7', label: t('grades', 'कक्षाएँ') },",
      // landing/StatsV2.tsx — number in JSX, noun in the next property
      "    num: <>16</>,\n    lblEn: 'subjects · grades 6—12',\n    lblHi: 'विषय · कक्षा 6—12',",
    ];
    for (const src of PRE_CHANGE_SOURCE) {
      expect(
        BANNED_SOURCE.some((b) => b.re.test(src)),
        `the stat-tile rule no longer matches real pre-change source:\n${src}`,
      ).toBe(true);
    }
  });

  it('the honest replacement copy passes every rule', () => {
    // Under-promise, not over-promise (P12). These are the strings the fix
    // actually shipped; if a future pattern starts rejecting them the pattern
    // is wrong, not the copy.
    const HONEST = [
      'We teach Mathematics and Science, and nothing else. Grades 6 to 10 study Maths and Science; grades 11 and 12 study Maths plus Physics, Chemistry and Biology, presented together as one Science group.',
      'हम केवल गणित और विज्ञान पढ़ाते हैं, और कुछ नहीं। कक्षा 6 से 10 में गणित और विज्ञान; कक्षा 11 और 12 में गणित के साथ भौतिकी, रसायन और जीवविज्ञान, जो एक ही Science समूह के रूप में मिलते हैं।',
      'Foxy teaches Mathematics and Science in Hindi and English with step-by-step explanations.',
      'Foxy गणित और विज्ञान हिंदी और अंग्रेज़ी में स्टेप-बाय-स्टेप समझाता है।',
      'Maths & Science included',
      'गणित और विज्ञान शामिल',
    ];
    for (const literal of HONEST) {
      const hits = BANNED.filter((b) => b.test(literal)).map((b) => b.name);
      expect(hits, `honest copy tripped ${hits.join(', ')}:\n  ${literal}`).toEqual([]);
    }
  });

  it('every allowlist entry names a file that exists and a rule that exists', () => {
    const badFiles = ALLOWLIST.filter((a) => !existsSync(path.join(REPO_ROOT, a.file))).map((a) => a.file);
    expect(badFiles, `allowlist names file(s) that no longer exist — delete the entry:\n${badFiles.join('\n')}`).toEqual([]);
    const badRules = ALLOWLIST.filter((a) => !BANNED.some((b) => b.name === a.rule)).map((a) => a.rule);
    expect(badRules, `allowlist names rule(s) that do not exist:\n${badRules.join('\n')}`).toEqual([]);
    const noReason = ALLOWLIST.filter((a) => a.reason.trim().length < 40).map((a) => `${a.file} :: ${a.rule}`);
    expect(noReason, `allowlist entries must carry a real justification:\n${noReason.join('\n')}`).toEqual([]);
  });

  it('every allowlist entry is load-bearing (suppresses a hit that really fires)', () => {
    // Allowlist rot is how a guard quietly stops guarding: an entry outlives the
    // copy it excused, and the next person reads it as precedent for excusing
    // something else. If an entry suppresses nothing, delete it.
    const firing = new Set(scanHits().map((h) => `${h.file}::${h.rule}`));
    const dead = ALLOWLIST.filter((a) => !firing.has(`${a.file}::${a.rule}`)).map((a) => `${a.file} :: ${a.rule}`);
    expect(
      dead,
      `allowlist entries that suppress nothing — the copy they excused is gone, so delete them:\n${dead.join('\n')}`,
    ).toEqual([]);
  });
});

describe('no user-facing surface claims a subject catalogue bigger than Maths & Science', () => {
  it('repo-wide scan of apps/host/src/app + packages/ui/src is clean', () => {
    const violations = scanHits()
      .filter((h) => !isAllowed(h.file, h.rule))
      .map(
        (h) =>
          `  ${h.file}\n    [${h.rule}] ${h.literal.slice(0, 220)}${h.literal.length > 220 ? '…' : ''}\n      (pattern written against: ${h.foundIn})`,
      );
    expect(
      violations,
      'A user-facing surface claims a subject catalogue the product does not have.\n' +
        'Production `subjects.is_active` is true for exactly five codes: math, science, physics, chemistry, biology.\n' +
        'Grades 6-10 study Maths + Science; grades 11-12 study Maths plus Physics/Chemistry/Biology as one Science group.\n' +
        'Say that instead — see docs/alfabot/knowledge-base.md (product-features) for the house wording.\n' +
        'If the copy is legitimately not a claim (a filter label, a CBSE-stream description, a per-row display label),\n' +
        'add it to ALLOWLIST above WITH A REASON.\n\n' +
        violations.join('\n'),
    ).toEqual([]);
  });
});
