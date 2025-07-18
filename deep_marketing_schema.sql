-- Create table for Deep Marketing searches
CREATE TABLE IF NOT EXISTS deep_marketing_searches (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    query TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('planning', 'executing', 'completed', 'error')),
    plan JSONB,
    results JSONB,
    error TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    completed_at TIMESTAMPTZ,
    CONSTRAINT fk_user FOREIGN KEY (user_id) REFERENCES users(user_id)
);

-- Create indexes for better performance
CREATE INDEX idx_deep_marketing_user_id ON deep_marketing_searches(user_id);
CREATE INDEX idx_deep_marketing_status ON deep_marketing_searches(status);
CREATE INDEX idx_deep_marketing_created_at ON deep_marketing_searches(created_at);

-- Enable Row Level Security
ALTER TABLE deep_marketing_searches ENABLE ROW LEVEL SECURITY;

-- Create RLS policies
-- Users can only see their own searches
CREATE POLICY "Users can view own searches" ON deep_marketing_searches
    FOR SELECT USING (auth.uid()::text = user_id);

-- Users can insert their own searches
CREATE POLICY "Users can insert own searches" ON deep_marketing_searches
    FOR INSERT WITH CHECK (auth.uid()::text = user_id);

-- Users can update their own searches
CREATE POLICY "Users can update own searches" ON deep_marketing_searches
    FOR UPDATE USING (auth.uid()::text = user_id);

-- Users can delete their own searches
CREATE POLICY "Users can delete own searches" ON deep_marketing_searches
    FOR DELETE USING (auth.uid()::text = user_id);

-- Grant permissions
GRANT SELECT, INSERT, UPDATE, DELETE ON deep_marketing_searches TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON deep_marketing_searches TO service_role;