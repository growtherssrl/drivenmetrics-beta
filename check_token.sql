-- Check tokens for demo user
SELECT 
    token,
    user_id,
    is_active,
    created_at,
    expires_at,
    scopes
FROM api_tokens
WHERE user_id = '90a41ba7-fcd6-45ae-bec9-b2a9362ad305'
ORDER BY created_at DESC
LIMIT 5;
EOF < /dev/null