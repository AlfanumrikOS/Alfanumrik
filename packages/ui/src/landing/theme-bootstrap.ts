/**
 * THEME_BOOTSTRAP_SCRIPT — the single source of truth for the landing-surface
 * light-theme lock.
 *
 * Inline blocking script that runs BEFORE first paint. It stamps
 * data-theme="light" onto its own parent element so any global
 * `[data-theme]` selector resolves to its light branch before the browser
 * paints — no dark flash, no hydration mismatch.
 *
 * 2026-05-11: dark mode was removed from the landing pages per user
 * direction. The landing surface always renders light regardless of
 * localStorage / matchMedia. Dark CSS left in welcome-v2.module.css for a
 * potential future re-enable; this script (plus each page's post-hydration
 * re-assertion) short-circuits theme resolution to 'light' so those
 * selectors never apply. The v3 stylesheets ship no dark styles at all.
 *
 * Consumed via `<script dangerouslySetInnerHTML={{ __html: … }} />` so React
 * injects it as raw markup.
 *
 * This literal was previously copy-pasted byte-for-byte into four page
 * shells (WelcomeV2, WelcomeV3, MarketingShell, PricingV3). Keep it here —
 * a divergent copy means one landing page flashes dark and the others do
 * not, which is invisible in review and obvious to a user.
 */
export const THEME_BOOTSTRAP_SCRIPT = `(function(){try{var r=document.currentScript&&document.currentScript.parentElement;if(r&&r.setAttribute){r.setAttribute('data-theme','light');}}catch(e){}})();`;
