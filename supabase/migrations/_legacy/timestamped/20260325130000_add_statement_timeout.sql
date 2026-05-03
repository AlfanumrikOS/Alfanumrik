-- ============================================================================
-- I2: Add database-level statement timeout
--
-- PROBLEM: Without a statement timeout, a badly written query or a lock
-- contention can hold a connection indefinitely, starving the pool.
--
-- FIX: Set a 15-second statement timeout for the API roles.
-- This is the database-side safety net; the client-side 10s fetch timeout
-- is the primary protection.
-- ============================================================================

-- Set default statement timeout for the service role (API routes)
ALTER ROLE authenticator SET statement_timeout = '15s';

-- Set for the anon role (client-side queries via RLS)
ALTER ROLE anon SET statement_timeout = '15s';

-- Set for the authenticated role (logged-in user queries)
ALTER ROLE authenticated SET statement_timeout = '15s';
