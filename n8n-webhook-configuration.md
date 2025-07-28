# Configurazione Webhook n8n per Deep Marketing Dashboard

## Overview
Il sistema utilizza webhook per aggiornare la dashboard in tempo reale durante l'analisi delle campagne marketing.

## Endpoint Webhook Disponibili

### 1. Dashboard Update
**URL**: `https://drivenmetrics-beta.onrender.com/api/webhook/dashboard-update`
**Method**: POST
**Content-Type**: application/json

**Payload**:
```json
{
  "sessionId": "{{$json.metadata.sessionId}}",
  "type": "stats",
  "data": {
    "adsCount": 150,
    "brandsCount": 5,
    "queriesCount": 1
  }
}
```

### 2. Search Results
**URL**: `https://drivenmetrics-beta.onrender.com/api/webhook/search-results`
**Method**: POST

**Payload**:
```json
{
  "sessionId": "{{$json.metadata.sessionId}}",
  "results": {
    "ads": [
      {"brand": "Nike", "campaign": "Just Do It", "spend": 50000},
      {"brand": "Adidas", "campaign": "Impossible is Nothing", "spend": 45000}
    ],
    "campaigns": ["Campaign 1", "Campaign 2"],
    "insights": "Analisi completata: Nike domina il mercato con una spesa del 35%..."
  }
}
```

### 3. Status Update
**URL**: `https://drivenmetrics-beta.onrender.com/api/webhook/status-update`
**Method**: POST

**Payload**:
```json
{
  "sessionId": "{{$json.metadata.sessionId}}",
  "status": "processing",
  "message": "Sto recuperando le campagne da Facebook Ads..."
}
```

## Configurazione Workflow n8n

### 1. Chat Trigger Node
- Il sessionId viene passato automaticamente nel metadata
- Accedi con: `{{$json.metadata.sessionId}}`

### 2. Function Node per Processing
```javascript
// Estrai sessionId dal chat trigger
const sessionId = $input.first().json.metadata.sessionId;
const userMessage = $input.first().json.message;

// Determina il tipo di richiesta
let searchType = 'general';
if (userMessage.toLowerCase().includes('nike')) {
  searchType = 'brand_analysis';
}

return {
  sessionId,
  userMessage,
  searchType,
  timestamp: new Date().toISOString()
};
```

### 3. HTTP Request Node per Status Update
```javascript
// Invia status update
{
  "url": "https://drivenmetrics-beta.onrender.com/api/webhook/status-update",
  "method": "POST",
  "headers": {
    "Content-Type": "application/json"
  },
  "body": {
    "sessionId": "={{$json.sessionId}}",
    "status": "processing",
    "message": "Recupero dati da Facebook Ads API..."
  }
}
```

### 4. Dopo l'analisi - Invia risultati
```javascript
// HTTP Request per inviare i risultati finali
{
  "url": "https://drivenmetrics-beta.onrender.com/api/webhook/search-results",
  "method": "POST",
  "body": {
    "sessionId": "={{$json.sessionId}}",
    "results": {
      "ads": "={{$json.analyzedAds}}",
      "campaigns": "={{$json.campaigns}}",
      "insights": "={{$json.aiInsights}}"
    }
  }
}
```

## Flow Completo Esempio

1. **Chat Trigger** riceve messaggio
2. **Function Node** estrae sessionId e processa richiesta
3. **HTTP Request** invia status "processing"
4. **Facebook Ads API** recupera dati
5. **AI Node** analizza i dati
6. **HTTP Request** invia risultati finali
7. **Chat Response** risponde all'utente

## Testing

Per testare manualmente i webhook:

```bash
# Test status update
curl -X POST https://drivenmetrics-beta.onrender.com/api/webhook/status-update \
  -H "Content-Type: application/json" \
  -d '{
    "sessionId": "test-session-123",
    "status": "processing",
    "message": "Test in corso..."
  }'

# Test search results
curl -X POST https://drivenmetrics-beta.onrender.com/api/webhook/search-results \
  -H "Content-Type: application/json" \
  -d '{
    "sessionId": "test-session-123",
    "results": {
      "ads": [{"brand": "Test Brand"}],
      "insights": "Test completato"
    }
  }'
```

## Note Importanti

1. **SessionId**: Sempre includere il sessionId dal metadata del chat trigger
2. **Error Handling**: Gestire errori nei webhook per non bloccare il workflow
3. **Timeout**: I webhook hanno un timeout di 30 secondi
4. **Rate Limiting**: Max 100 richieste al minuto per IP