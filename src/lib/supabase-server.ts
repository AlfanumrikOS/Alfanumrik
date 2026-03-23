/**
 * Server-Side Supabase Client
 *
 * Used in Route Handlers (API routes) and Server Components
 * for operations that need cookie-based session management.
 *
 * This is REQUIRED for the PKCE auth flow:
 * 1. User clicks email link (signup confirm / password reset)
 * 2. Link contains a `code` parameter
 * 3. Server exchanges code for session via exchangeCodeForSession()
 * 4. Session is set in cookies
 * 5. User is redirected to the destination page with a valid session
 *
 * Without this, email verification and password reset links break.
 */

import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';

export async function createSupabaseServerClient() {
  const cookieStore = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            );
          } catch {
            // setAll called from Server Component — can only set in Route Handler/Middleware
          }
        },
      },
    }
  );
}
