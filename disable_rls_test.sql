-- Temporary SQL to test without RLS
-- Run this in Supabase SQL Editor to temporarily disable RLS on facebook_tokens

-- First, check current policies
SELECT 
    schemaname,
    tablename,
    policyname,
    permissive,
    roles,
    cmd,
    qual,
    with_check
FROM pg_policies 
WHERE tablename = 'facebook_tokens';

-- Check if RLS is enabled
SELECT 
    schemaname,
    tablename,
    rowsecurity
FROM pg_tables 
WHERE tablename = 'facebook_tokens';

-- To temporarily disable RLS (for testing only!)
-- ALTER TABLE facebook_tokens DISABLE ROW LEVEL SECURITY;

-- To re-enable RLS after testing
-- ALTER TABLE facebook_tokens ENABLE ROW LEVEL SECURITY;

-- Alternative: Create a proper policy for service role
-- DROP POLICY IF EXISTS "Service role has full access to facebook_tokens" ON facebook_tokens;
-- CREATE POLICY "Service role full access" ON facebook_tokens
--     FOR ALL 
--     TO service_role
--     USING (true)
--     WITH CHECK (true);