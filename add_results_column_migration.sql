-- Add results column to deep_marketing_searches if it doesn't exist
DO $$ 
BEGIN
    IF NOT EXISTS (
        SELECT 1 
        FROM information_schema.columns 
        WHERE table_name='deep_marketing_searches' 
        AND column_name='results'
    ) THEN
        ALTER TABLE deep_marketing_searches ADD COLUMN results JSONB;
    END IF;
END $$;

-- Add completed_at column if it doesn't exist
DO $$ 
BEGIN
    IF NOT EXISTS (
        SELECT 1 
        FROM information_schema.columns 
        WHERE table_name='deep_marketing_searches' 
        AND column_name='completed_at'
    ) THEN
        ALTER TABLE deep_marketing_searches ADD COLUMN completed_at TIMESTAMPTZ;
    END IF;
END $$;

-- Add error column if it doesn't exist
DO $$ 
BEGIN
    IF NOT EXISTS (
        SELECT 1 
        FROM information_schema.columns 
        WHERE table_name='deep_marketing_searches' 
        AND column_name='error'
    ) THEN
        ALTER TABLE deep_marketing_searches ADD COLUMN error TEXT;
    END IF;
END $$;