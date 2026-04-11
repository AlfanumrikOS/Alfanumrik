/**
 * Next.js Middleware Entry Point
 *
 * ⚠️ CRITICAL AUTH PATH — DO NOT MODIFY without testing login/signup/reset flows
 *
 * Next.js requires this file to be named `middleware.ts` at `src/middleware.ts`.
 * The actual implementation lives in `src/proxy.ts` (renamed for clarity).
 *
 * This file exists solely to satisfy Next.js's file-name convention.
 * All logic is in proxy.ts.
 *
 * If you rename or delete this file, ALL middleware stops running:
 *   - Supabase session refresh stops → PKCE email flows break (signup confirm, password reset)
 *   - Protected route guards stop → /parent, /school-admin unprotected
 *   - Rate limiting stops → brute-force protection disabled
 *   - Security headers stop applying via middleware path
 */

// ⚠️ CRITICAL AUTH PATH — DO NOT MODIFY without testing login/signup/reset flows
export { middleware, config } from './proxy';
