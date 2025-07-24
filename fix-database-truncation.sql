-- Script to fix potential database truncation issues for Deep Marketing results

-- 1. Check current column type and size
SELECT 
    column_name,
    data_type,
    character_maximum_length,
    is_nullable
FROM information_schema.columns
WHERE table_name = 'deep_marketing_searches'
AND column_name IN ('results', 'plan', 'error');

-- 2. Convert results column to JSONB if it's TEXT (JSONB has no size limit)
ALTER TABLE deep_marketing_searches 
ALTER COLUMN results TYPE JSONB USING results::JSONB;

-- 3. Convert plan column to JSONB if needed
ALTER TABLE deep_marketing_searches 
ALTER COLUMN plan TYPE JSONB USING plan::JSONB;

-- 4. Add check to see largest result size
SELECT 
    id,
    query,
    LENGTH(results::text) as results_size,
    created_at
FROM deep_marketing_searches
ORDER BY LENGTH(results::text) DESC
LIMIT 10;

-- 5. Find potentially truncated results
SELECT 
    id,
    query,
    SUBSTRING(results::text FROM LENGTH(results::text) - 100) as last_chars,
    created_at
FROM deep_marketing_searches
WHERE 
    results::text LIKE '%...' 
    OR results::text LIKE '%motivaz'
    OR results::text LIKE '%...'
    OR LENGTH(results::text) < 1000
ORDER BY created_at DESC;

-- 6. Create index for better performance
CREATE INDEX IF NOT EXISTS idx_deep_marketing_user_created 
ON deep_marketing_searches(user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_deep_marketing_status 
ON deep_marketing_searches(status);

-- 7. Add a function to validate results completeness
CREATE OR REPLACE FUNCTION validate_deep_marketing_results()
RETURNS TABLE (
    search_id UUID,
    query TEXT,
    issue TEXT,
    created_at TIMESTAMPTZ
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        id,
        query,
        CASE 
            WHEN results IS NULL THEN 'No results'
            WHEN LENGTH(results::text) < 500 THEN 'Results too short'
            WHEN results::text LIKE '%...' THEN 'Possible truncation (ends with ...)'
            WHEN results::text LIKE '%motivaz' THEN 'Known truncation issue'
            WHEN NOT (results::text LIKE '%fullReport%') THEN 'Missing fullReport field'
            ELSE 'Unknown issue'
        END as issue,
        created_at
    FROM deep_marketing_searches
    WHERE 
        status = 'completed'
        AND (
            results IS NULL 
            OR LENGTH(results::text) < 500
            OR results::text LIKE '%...'
            OR results::text LIKE '%motivaz'
            OR NOT (results::text LIKE '%fullReport%')
        )
    ORDER BY created_at DESC;
END;
$$ LANGUAGE plpgsql;

-- 8. Run validation
SELECT * FROM validate_deep_marketing_results();