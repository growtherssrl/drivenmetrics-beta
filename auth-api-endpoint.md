# Auth Check API Endpoint

Aggiungi questo endpoint al server Express in `src/index.ts`:

```typescript
// Auth check endpoint
app.get('/api/auth/check', (req, res) => {
  // Check if user has a valid session
  if (req.session && req.session.userId) {
    res.status(200).json({ 
      authenticated: true,
      userId: req.session.userId 
    });
  } else {
    res.status(401).json({ 
      authenticated: false 
    });
  }
});
```

## Alternative semplice (per testing)

Se non hai ancora un sistema di autenticazione, puoi temporaneamente usare:

```typescript
// Temporary auth check - REMOVE IN PRODUCTION
app.get('/api/auth/check', (req, res) => {
  // Always return authenticated for testing
  res.status(200).json({ 
    authenticated: true,
    userId: 'test-user' 
  });
});
```

## Funzionalità implementate:

1. **Homepage (`index.html`)**:
   - Quando scrivi nel campo input, controlla se sei autenticato
   - Se autenticato: salva il messaggio e reindirizza a `/deep-marketing-chat.html`
   - Se non autenticato: salva il messaggio e reindirizza a `/login?redirect=/deep-marketing-chat.html`

2. **Chat Page (`deep-marketing-chat.html`)**:
   - Controlla l'autenticazione al caricamento
   - Se non autenticato: reindirizza al login
   - Se c'è un messaggio salvato (da homepage o dopo login), lo invia automaticamente

3. **Session Storage Keys**:
   - `initialMessage`: messaggio da inviare quando l'utente è già autenticato
   - `pendingMessage`: messaggio da inviare dopo il login