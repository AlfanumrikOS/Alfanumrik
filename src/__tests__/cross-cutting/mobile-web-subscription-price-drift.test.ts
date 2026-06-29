/**
 * XC-6 [mobile / P11-adjacent] — mobile↔web subscription-price DRIFT guard.
 *
 * THEME: constants synced by COMMENT, not contract. The Flutter app hardcodes
 * subscription prices that mirror the web source of truth. Nothing mechanical
 * links them — only a `// mirrors web app's plans.ts` comment and the P14
 * mobile review chain. If web pricing changes and the Flutter literals are not
 * hand-updated (or vice-versa), the app displays a price that does NOT match
 * what Razorpay charges. Server is authoritative for the actual charge, so this
 * is a DISPLAY/billing-trust mismatch (REG-65 spirit), not a charge bypass —
 * but still user-facing, reputational, and consumer-law-adjacent.
 *
 * WHAT THIS TEST ASSERTS: mobile prices == web prices, per plan. PURE PARITY.
 * It does NOT assert that any specific rupee value is "correct" — pricing is a
 * user-gated product decision. A drift in EITHER direction fails CI, forcing
 * backend/mobile to reconcile in the same PR.
 *
 * PARSE ANCHORS (documented so a future refactor that breaks them is obvious):
 *   - Web   `src/lib/plans.ts`: the `export const PRICING = { ... } as const;`
 *           object. Each line: `<plan>: { monthly: <int>, yearly: <int> },`.
 *   - Mobile `mobile/lib/data/models/subscription.dart`: `PlanInfo(` blocks,
 *           each with `code: '<plan>'`, `priceMonthly: <int>`, `priceYearly: <int>`.
 *
 * NON-VACUOUS: asserts >= 2 plan prices were extracted from EACH side before
 * comparing, so an empty/failed parse cannot pass green.
 *
 * NOTE: this is a TEST-ONLY pin. It never edits plans.ts or the Dart file — it
 * only detects drift between them.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const WEB_PLANS_PATH = resolve(process.cwd(), 'src/lib/plans.ts');
const MOBILE_SUBSCRIPTION_PATH = resolve(
  process.cwd(),
  'mobile/lib/data/models/subscription.dart'
);

interface PlanPrice {
  monthly: number;
  yearly: number;
}

/** Parse web `export const PRICING = { ... } as const;`. */
function parseWebPrices(): Record<string, PlanPrice> {
  const text = readFileSync(WEB_PLANS_PATH, 'utf8');
  const blockMatch = /export\s+const\s+PRICING\s*=\s*\{([\s\S]*?)\}\s*as\s+const\s*;/.exec(
    text
  );
  if (!blockMatch) {
    throw new Error('parse anchor not found: `export const PRICING = { ... } as const;`');
  }
  const block = blockMatch[1];
  const re = /(\w+)\s*:\s*\{\s*monthly\s*:\s*(\d+)\s*,\s*yearly\s*:\s*(\d+)\s*\}/g;
  const out: Record<string, PlanPrice> = {};
  let m: RegExpExecArray | null;
  while ((m = re.exec(block)) !== null) {
    out[m[1]] = { monthly: Number(m[2]), yearly: Number(m[3]) };
  }
  return out;
}

/** Parse Flutter `PlanInfo(... code:'x' ... priceMonthly:N ... priceYearly:N ...)` blocks. */
function parseMobilePrices(): Record<string, PlanPrice> {
  const text = readFileSync(MOBILE_SUBSCRIPTION_PATH, 'utf8');
  // Each PlanInfo block declares, in order: code, name, icon, priceMonthly, priceYearly.
  const re =
    /code:\s*'([^']+)'[\s\S]*?priceMonthly:\s*(\d+)[\s\S]*?priceYearly:\s*(\d+)/g;
  const out: Record<string, PlanPrice> = {};
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    out[m[1]] = { monthly: Number(m[2]), yearly: Number(m[3]) };
  }
  return out;
}

describe('XC-6: mobile↔web subscription price parity (drift guard)', () => {
  const web = parseWebPrices();
  const mobile = parseMobilePrices();

  it('extracted >= 2 plan prices from the web source of truth (non-vacuous)', () => {
    expect(Object.keys(web).length).toBeGreaterThanOrEqual(2);
    for (const [code, p] of Object.entries(web)) {
      expect(Number.isInteger(p.monthly), `${code}.monthly parsed`).toBe(true);
      expect(Number.isInteger(p.yearly), `${code}.yearly parsed`).toBe(true);
      expect(p.monthly).toBeGreaterThan(0);
      expect(p.yearly).toBeGreaterThan(0);
    }
  });

  it('extracted >= 2 plan prices from the Flutter file (non-vacuous)', () => {
    expect(Object.keys(mobile).length).toBeGreaterThanOrEqual(2);
    for (const [code, p] of Object.entries(mobile)) {
      expect(Number.isInteger(p.monthly), `${code}.monthly parsed`).toBe(true);
      expect(Number.isInteger(p.yearly), `${code}.yearly parsed`).toBe(true);
      expect(p.monthly).toBeGreaterThan(0);
      expect(p.yearly).toBeGreaterThan(0);
    }
  });

  it('every Flutter plan price EQUALS the web price (no mobile→web drift)', () => {
    for (const [code, mobilePrice] of Object.entries(mobile)) {
      const webPrice = web[code];
      expect(
        webPrice,
        `Flutter declares plan "${code}" but web plans.ts has no PRICING entry for it`
      ).toBeDefined();
      expect(
        mobilePrice.monthly,
        `monthly price drift for "${code}": mobile=${mobilePrice.monthly} web=${webPrice?.monthly}`
      ).toBe(webPrice.monthly);
      expect(
        mobilePrice.yearly,
        `yearly price drift for "${code}": mobile=${mobilePrice.yearly} web=${webPrice?.yearly}`
      ).toBe(webPrice.yearly);
    }
  });

  it('every web paid plan is present in the Flutter file (no web→mobile drift)', () => {
    for (const [code, webPrice] of Object.entries(web)) {
      const mobilePrice = mobile[code];
      expect(
        mobilePrice,
        `web plans.ts prices plan "${code}" but Flutter subscription.dart has no PlanInfo for it`
      ).toBeDefined();
      expect(mobilePrice.monthly).toBe(webPrice.monthly);
      expect(mobilePrice.yearly).toBe(webPrice.yearly);
    }
  });
});
