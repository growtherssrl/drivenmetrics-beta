-- 1. Verifica quante ricerche ci sono in totale
SELECT COUNT(*) as total_searches 
FROM deep_marketing_searches;

-- 2. Verifica quante ricerche hanno un user_id
SELECT COUNT(*) as searches_with_user 
FROM deep_marketing_searches 
WHERE user_id IS NOT NULL;

-- 3. Verifica quante ricerche NON hanno un user_id
SELECT COUNT(*) as searches_without_user 
FROM deep_marketing_searches 
WHERE user_id IS NULL;

-- 4. Mostra le ricerche senza user_id (se ce ne sono)
SELECT id, query, status, created_at 
FROM deep_marketing_searches 
WHERE user_id IS NULL
LIMIT 10;

-- 5. Conta ricerche per ogni utente
SELECT user_id, COUNT(*) as search_count 
FROM deep_marketing_searches 
WHERE user_id IS NOT NULL
GROUP BY user_id
ORDER BY search_count DESC;

-- 6. Verifica se ci sono user_id che non esistono nella tabella users
SELECT DISTINCT dms.user_id, u.user_id as user_exists
FROM deep_marketing_searches dms
LEFT JOIN users u ON dms.user_id = u.user_id
WHERE dms.user_id IS NOT NULL AND u.user_id IS NULL;