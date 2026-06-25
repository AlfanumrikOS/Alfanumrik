import './globals.css';
// KaTeX math styling, self-hosted from the npm package (was a third-party CDN
// <link> that browsers' Tracking Prevention blocked + version-mismatched).
import 'katex/dist/katex.min.css';
import type { Metadata, Viewport } from 'next';
import { AuthProvider } from '@/lib/AuthContext';
import { CosmicThemeProvider } from '@/lib/cosmic-theme';
import { cosmicFontVars } from '@/lib/cosmic-fonts';
import { SchoolProvider } from '@/lib/SchoolContext';
import { TenantConfigProvider } from '@/lib/tenant-domain/client';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import RegisterSW from '@/lib/RegisterSW';
import JsonLd from '@/components/JsonLd';
import LayoutDeferredChrome from '@/components/LayoutDeferredChrome';
import { Toaster } from '@/components/ui/toast';
import { GlobalAppLayout } from '@/components/navigation/GlobalAppLayout';

export const metadata: Metadata = {
  title: {
    default: 'Alfanumrik - Adaptive Learning OS | AI Tutor for CBSE Students',
    template: '%s | Alfanumrik',
  },
  description:
    'Alfanumrik is India\'s smartest AI-powered adaptive learning platform for CBSE students. Foxy AI Tutor teaches in Hindi and English with Bayesian mastery tracking, spaced repetition, and gamified learning. Grades 6-12.',
  authors: [{ name: 'Cusiosense Learning India Private Limited' }],
  manifest: '/manifest.json',
  icons: {
    icon: '/favicon.svg',
    apple: '/apple-touch-icon.svg',
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: 'black-translucent',
    title: 'Alfanumrik',
  },
  keywords: 'CBSE AI tutor, adaptive learning India, AI tutor Hindi, board exam preparation, Foxy AI tutor, spaced repetition CBSE, personalized learning India, class 9 science, class 10 math, online tutor India, Hindi medium tutor, Alfanumrik, Cusiosense Learning',
  openGraph: {
    title: 'Alfanumrik - AI Tutor for CBSE Students | Learn Smarter',
    description:
      'Meet Foxy, your personal AI tutor that teaches at YOUR level. 7 subjects, Hindi & English. Adaptive learning powered by Bayesian mastery tracking.',
    url: 'https://alfanumrik.com',
    locale: 'en_IN',
    type: 'website',
    siteName: 'Alfanumrik Adaptive Learning OS',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Alfanumrik - India\'s Smartest AI Tutor for CBSE Students',
    description:
      'Foxy AI Tutor teaches CBSE in Hindi and English. Adaptive learning, spaced repetition, gamified practice. Start now.',
    creator: '@alfanumrik',
  },
  robots: {
    index: true,
    follow: true,
    googleBot: { index: true, follow: true, 'max-snippet': -1, 'max-image-preview': 'large' as const },
  },
  alternates: {
    canonical: 'https://alfanumrik.com',
  },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#FBF8F4',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Server-side read of the Vercel env (architect maps this in next.config.js).
  // 'preview' on every PR deploy, 'production' on prod, undefined in local/dev.
  // Baked into the pre-hydration script below as a literal boolean so previews
  // paint cosmic before first paint, while production bakes `false` and stays
  // byte-identical. typeof-guarded so an unmapped env var is undefined-safe.
  const isPreview = process.env.NEXT_PUBLIC_VERCEL_ENV === 'preview';

  return (
    // cosmicFontVars only DEFINES the --font-cosmic-* CSS variables on <html>.
    // They are consumed exclusively inside the html[data-design="cosmic"] scope
    // in globals.css, so when ff_cosmic_redesign_v1 is OFF (no data-design
    // attribute) they have zero visual effect — the app stays pixel-identical.
    <html lang="en" className={cosmicFontVars} suppressHydrationWarning>
      <head>
        {/*
          color-scheme: REVERSED 2026-05-11 — dark mode (#705/#706) caused
          severe legibility regressions in admin surfaces, so the product
          ships a single light theme until a proper accessibility pass is
          done. Setting "light" tells the browser to render native chrome
          (scrollbars, form controls, autofill) in light variants too,
          avoiding the dark-system-pref mismatch the previous "light dark"
          value tolerated. See src/lib/AuthContext.tsx::resolveTheme.
        */}
        <meta name="color-scheme" content="light" />
        {/*
          Cosmic anti-FOUC pre-hydration script (architect Condition 2).

          Runs synchronously in <head> BEFORE first paint. It mirrors the
          computeCosmicEnabled() decision in src/lib/cosmic-theme.tsx so the
          first paint matches what React will resolve, with no light→dark (or
          dark→light) flash. It sets data-design / data-theme / data-role on
          <html> ONLY when cosmic should be on, using the SAME localStorage keys
          and the SAME preview/override signals the provider uses.

          Enable decision (must stay in lock-step with computeCosmicEnabled):
            forceOff ? OFF
                     : ( isPreview || urlForce==='on' || storedForce==='on'
                         || (cached flag ON) )
          where:
            - isPreview is the server-baked NEXT_PUBLIC_VERCEL_ENV==='preview'
              boolean below (literal `true` only on PR previews; `false` on prod
              and local, keeping production first paint unchanged).
            - urlForce reads ?cosmic=1/preview/0 (case-insensitive) and, on a
              '1', persists 'alfanumrik_cosmic_force'='1' so it survives client
              navigation; on a '0' persists '0' (force-off).
            - storedForce reads 'alfanumrik_cosmic_force' ('1'=on, '0'=off).
            - the cached flag is read exactly like getCosmicFlagSync()
              (key alfanumrik_cosmic_flag_v1, shape { on, ts }, 1-hour TTL).

          INERT WHEN OFF: when (not preview) AND (no url/stored force ON) AND
          (no cached ON flag) — i.e. production with the flag OFF and no manual
          override — it writes NOTHING. First paint is byte-identical to today
          and AuthContext's force-light path remains the sole owner of
          data-theme. A force-OFF (?cosmic=0 or stored '0') also writes nothing
          and beats every enable signal. The whole body is wrapped in try/catch
          and is dependency-free. <html> has suppressHydrationWarning, and the
          attributes written here match CosmicThemeProvider's applyCosmicToDOM
          exactly, so there is no post-hydration attribute thrash. Keep this
          logic in lock-step with src/lib/cosmic-theme.tsx.
        */}
        <script
          dangerouslySetInnerHTML={{
            __html:
              "(function(){try{" +
              "var PREVIEW=" + (isPreview ? "true" : "false") + ";" + // server-baked NEXT_PUBLIC_VERCEL_ENV==='preview'
              "var FK='alfanumrik_cosmic_force';" +
              // ── manual override (URL is authoritative this navigation, then persisted) ──
              "var force=null;" +
              "try{var q=new URLSearchParams(location.search).get('cosmic');" +
              "if(q!==null){q=q.toLowerCase();" +
              "if(q==='1'||q==='preview'||q==='true'||q==='on'){force='on';localStorage.setItem(FK,'1');}" +
              "else if(q==='0'||q==='false'||q==='off'){force='off';localStorage.setItem(FK,'0');}}}catch(e){}" +
              "if(force===null){try{var s=localStorage.getItem(FK);if(s==='1')force='on';else if(s==='0')force='off';}catch(e){}}" +
              // ── force-off beats everything (incl. preview + cached ON flag) ──
              "if(force==='off')return;" +
              // ── cached DB flag (same shape/TTL as getCosmicFlagSync) ──
              "var flagOn=false;" +
              "try{var raw=localStorage.getItem('alfanumrik_cosmic_flag_v1');" +
              "if(raw){var c=JSON.parse(raw);if(c&&typeof c.ts==='number'&&Date.now()-c.ts<=36e5&&c.on)flagOn=true;}}catch(e){}" +
              // ── enable = preview || forceOn || cached flag || student role (OS always cosmic-light) ──
              "var r=localStorage.getItem('alfanumrik_active_role');" +
              "var isStudent=(!r||r==='student');" +
              "if(!(PREVIEW||force==='on'||flagOn||isStudent))return;" +
              "var h=document.documentElement;" +
              "h.setAttribute('data-design','cosmic');" +
              "var t;if(isStudent&&!(flagOn||PREVIEW||force==='on')){t='light';}" +
              "else{var V={dark:1,light:1,hc:1};t=localStorage.getItem('alfanumrik_cosmic_theme');if(!V[t])t='dark';}" +
              "h.setAttribute('data-theme',t);" +
              "var role=r==='guardian'?'parent':r==='teacher'?'teacher':r==='institution_admin'?'school':'student';" +
              "h.setAttribute('data-role',role);" +
              "}catch(e){}})();",
          }}
        />
        <link rel="dns-prefetch" href="https://fonts.googleapis.com" />
        <link rel="dns-prefetch" href="https://fonts.gstatic.com" />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,300;9..144,400;9..144,500;9..144,600;9..144,700&family=Sora:wght@300;400;500;600;700;800&family=Plus+Jakarta+Sans:wght@400;500;600;700;800&display=swap"
          rel="stylesheet"
        />
        <JsonLd />
      </head>
      <body>
        <a href="#main-content" className="skip-nav">Skip to content</a>
        {/*
          TenantConfigProvider — Phase B/C/D consumer (mounted outermost).
          Fetches /api/tenant/config once on hydration; for B2C visitors the
          endpoint returns { isTenantContext: false } and the provider is a
          no-op (no CSS vars set, hooks return defaults). For white-label
          tenants it sets --color-brand-{primary,secondary} and the
          --tenant-font-{heading,body} / --tenant-radius CSS vars on <html>.
          Sits alongside the legacy SchoolProvider — both co-exist. The
          legacy --school-{primary,secondary} vars from SchoolProvider use
          a different namespace, so there's no collision.
        */}
        <TenantConfigProvider>
          <SchoolProvider>
            <AuthProvider>
              {/* CosmicThemeProvider — Phase 0 of the cosmic redesign. Reads
                  ff_cosmic_redesign_v1 client-side and, only when ON, writes
                  data-design="cosmic" + data-theme + data-role to <html> to
                  activate the cosmic token scope. When OFF it removes those
                  attributes, so the legacy light theme renders unchanged.
                  Mounted inside AuthProvider so it can read activeRole for the
                  role-scoped palettes. Renders no markup itself. */}
              <CosmicThemeProvider>
                <ErrorBoundary>
                  <div id="main-content" className="app-shell">
                    <GlobalAppLayout>{children}</GlobalAppLayout>
                  </div>
                </ErrorBoundary>
                <RegisterSW />
                {/* In-app toast mount (Phase A.4). Replaces native alert() for
                    error UI so cheap school tablets don't see blocking dialogs. */}
                <Toaster />
                {/* Non-critical client-only chrome (consent banner, maintenance
                    banner, offline indicator, PostHog SDK init). Lazy-loaded
                    to keep shared JS under the P10 budget. */}
                <LayoutDeferredChrome />
              </CosmicThemeProvider>
            </AuthProvider>
          </SchoolProvider>
        </TenantConfigProvider>
      </body>
    </html>
  );
}
