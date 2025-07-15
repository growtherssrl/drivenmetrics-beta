-- Enable necessary extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Create users table
CREATE TABLE IF NOT EXISTS users (
    id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    user_id TEXT UNIQUE NOT NULL,
    email TEXT,
    name TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create api_tokens table
CREATE TABLE IF NOT EXISTS api_tokens (
    id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    token TEXT UNIQUE NOT NULL,
    user_id TEXT NOT NULL,
    scopes TEXT[],
    created_at TIMESTAMPTZ DEFAULT NOW(),
    expires_at TIMESTAMPTZ,
    last_used TIMESTAMPTZ,
    FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
);

-- Create facebook_tokens table
CREATE TABLE IF NOT EXISTS facebook_tokens (
    id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    user_id TEXT NOT NULL,
    access_token TEXT NOT NULL,
    service TEXT DEFAULT 'competition',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    CONSTRAINT facebook_tokens_user_id_service_unique UNIQUE (user_id, service),
    FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_api_tokens_user_id ON api_tokens(user_id);
CREATE INDEX IF NOT EXISTS idx_api_tokens_token ON api_tokens(token);
CREATE INDEX IF NOT EXISTS idx_facebook_tokens_user_id ON facebook_tokens(user_id);
CREATE INDEX IF NOT EXISTS idx_facebook_tokens_service ON facebook_tokens(service);

-- Create function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Create triggers for updated_at
CREATE TRIGGER update_users_updated_at BEFORE UPDATE ON users
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_facebook_tokens_updated_at BEFORE UPDATE ON facebook_tokens
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Enable Row Level Security (RLS)
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE api_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE facebook_tokens ENABLE ROW LEVEL SECURITY;

-- Create RLS policies for service role (full access)
CREATE POLICY "Service role has full access to users" ON users
    FOR ALL USING (true);

CREATE POLICY "Service role has full access to api_tokens" ON api_tokens
    FOR ALL USING (true);

CREATE POLICY "Service role has full access to facebook_tokens" ON facebook_tokens
    FOR ALL USING (true);