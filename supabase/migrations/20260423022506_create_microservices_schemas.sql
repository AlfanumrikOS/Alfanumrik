-- Create schemas for microservices domains
CREATE SCHEMA IF NOT EXISTS student;
CREATE SCHEMA IF NOT EXISTS parent;
CREATE SCHEMA IF NOT EXISTS teacher;
CREATE SCHEMA IF NOT EXISTS admin;

-- Grant usage to authenticated users
GRANT USAGE ON SCHEMA student TO authenticated;
GRANT USAGE ON SCHEMA parent TO authenticated;
GRANT USAGE ON SCHEMA teacher TO authenticated;
GRANT USAGE ON SCHEMA admin TO authenticated;

-- Grant to service role for admin operations
GRANT USAGE ON SCHEMA student TO service_role;
GRANT USAGE ON SCHEMA parent TO service_role;
GRANT USAGE ON SCHEMA teacher TO service_role;
GRANT USAGE ON SCHEMA admin TO service_role;

-- Grant create on schemas to service_role for migrations
GRANT CREATE ON SCHEMA student TO service_role;
GRANT CREATE ON SCHEMA parent TO service_role;
GRANT CREATE ON SCHEMA teacher TO service_role;
GRANT CREATE ON SCHEMA admin TO service_role;