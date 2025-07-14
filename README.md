# Drivenmetrics MCP Server

Server MCP standalone per l'integrazione con Facebook Ads Library.

## Installazione

```bash
npm install
cp .env.example .env
# Configura le variabili in .env
```

## Avvio

```bash
# Development
npm run dev

# Production
npm run build
npm start
```

## Endpoints

- `GET /sse` - Connessione SSE per MCP
- `POST /messages` - Invio messaggi JSON-RPC
- `GET /health` - Health check

## Autenticazione

L'autenticazione avviene tramite Bearer token nell'header Authorization:

```
Authorization: Bearer dmgt_xxxxx
```

Il token viene verificato su Supabase per ottenere l'utente e il token Facebook.

## Deploy su Render

1. Crea un nuovo Web Service
2. Runtime: Node
3. Build Command: `npm install && npm run build`
4. Start Command: `npm start`
5. Aggiungi le variabili d'ambiente dal file `.env.example`

## Uso con Claude.ai

URL da configurare: `https://your-service.onrender.com/sse`