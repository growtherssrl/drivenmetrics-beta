-- Check RLS configuration for facebook_tokens table

-- 1. Check if RLS is enabled
SELECT 
    schemaname,
    tablename,
    rowsecurity,
    (CASE WHEN rowsecurity THEN 'RLS ENABLED' ELSE 'RLS DISABLED' END) as rls_status
FROM pg_tables 
WHERE schemaname = 'public' 
AND tablename = 'facebook_tokens';

-- 2. List all policies on facebook_tokens
SELECT 
    policyname,
    permissive,
    roles,
    cmd,
    qual,
    with_check
FROM pg_policies 
WHERE schemaname = 'public' 
AND tablename = 'facebook_tokens';

-- 3. Check current user and role
SELECT 
    current_user,
    current_role,
    current_setting('role'),
    session_user;

-- 4. Test if service_role can bypass RLS
-- First, ensure we're using service_role
SET ROLE service_role;

-- Try to insert a test record
INSERT INTO facebook_tokens (user_id, access_token, service, updated_at)
VALUES ('test-rls-check', 'test-token', 'test', NOW())
ON CONFLICT (user_id, service) DO UPDATE 
SET access_token = 'test-token-updated', updated_at = NOW();

-- Check if it worked
SELECT * FROM facebook_tokens WHERE user_id = 'test-rls-check';

-- Clean up
DELETE FROM facebook_tokens WHERE user_id = 'test-rls-check';

-- Reset role
RESET ROLE;

-- 5. Alternative: Create a more permissive policy
-- DROP POLICY IF EXISTS "Service role has full access to facebook_tokens" ON facebook_tokens;
-- CREATE POLICY "Allow all for service role" ON facebook_tokens
--     FOR ALL 
--     TO authenticated, service_role
--     USING (true)
--     WITH CHECK (true);