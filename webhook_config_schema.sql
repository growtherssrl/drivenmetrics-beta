-- Create table for webhook configuration
CREATE TABLE IF NOT EXISTS webhook_config (
    id SERIAL PRIMARY KEY,
    service_name TEXT NOT NULL UNIQUE,
    webhook_url TEXT NOT NULL,
    description TEXT,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    created_by TEXT REFERENCES users(user_id)
);

-- Create index for faster lookups
CREATE INDEX idx_webhook_service_name ON webhook_config(service_name);
CREATE INDEX idx_webhook_active ON webhook_config(is_active);

-- Insert default webhooks (update with your actual n8n URLs)
INSERT INTO webhook_config (service_name, webhook_url, description) VALUES
    ('deep_marketing_create_plan', 'https://your-n8n.com/webhook/xxx', 'Creates search plan from user query'),
    ('deep_marketing_execute_search', 'https://your-n8n.com/webhook/yyy', 'Executes the search plan'),
    ('deep_marketing_process_results', 'https://your-n8n.com/webhook/zzz', 'Processes and formats results')
ON CONFLICT (service_name) DO NOTHING;

-- Create or replace function to update updated_at
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Create trigger
CREATE TRIGGER update_webhook_config_updated_at BEFORE UPDATE ON webhook_config
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Enable RLS
ALTER TABLE webhook_config ENABLE ROW LEVEL SECURITY;

-- Only admins and service role can read webhooks
CREATE POLICY "Service role can manage webhooks" ON webhook_config
    FOR ALL USING (true);

-- Create a view for easy access
CREATE OR REPLACE VIEW active_webhooks AS
SELECT service_name, webhook_url 
FROM webhook_config 
WHERE is_active = true;

-- Grant permissions
GRANT SELECT ON webhook_config TO authenticated;
GRANT ALL ON webhook_config TO service_role;
GRANT SELECT ON active_webhooks TO authenticated;
GRANT SELECT ON active_webhooks TO anon;