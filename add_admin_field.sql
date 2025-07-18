-- Aggiungi campo is_admin alla tabella users
ALTER TABLE users 
ADD COLUMN IF NOT EXISTS is_admin BOOLEAN DEFAULT false;

-- Imposta info@growthers.io come admin
UPDATE users 
SET is_admin = true 
WHERE email = 'info@growthers.io';

-- Crea un indice per query più veloci
CREATE INDEX IF NOT EXISTS idx_users_is_admin ON users(is_admin);

-- Opzionale: Aggiungi altri campi utili per la gestione utenti
ALTER TABLE users 
ADD COLUMN IF NOT EXISTS role TEXT DEFAULT 'user',
ADD COLUMN IF NOT EXISTS permissions JSONB DEFAULT '{}';

-- Commento per documentazione
COMMENT ON COLUMN users.is_admin IS 'True if user has admin privileges';
COMMENT ON COLUMN users.role IS 'User role: user, admin, moderator, etc.';
COMMENT ON COLUMN users.permissions IS 'JSON object with specific permissions';