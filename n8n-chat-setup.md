# Configurazione n8n Chat per DrivenMetrics

## 1. Creazione del Workflow n8n

### Passo 1: Crea un nuovo workflow
1. Accedi al tuo n8n
2. Crea un nuovo workflow chiamato "DrivenMetrics Chat Handler"

### Passo 2: Aggiungi il Chat Trigger Node
1. Aggiungi un nodo "Chat Trigger" 
2. Configurazione:
   - **Webhook Name**: drivenmetrics-chat
   - **Allowed Origins**: 
     - https://drivenmetrics-beta.onrender.com
     - http://localhost:3000 (per sviluppo)
   - **Authentication**: None (o configura se necessario)

### Passo 3: Aggiungi la logica del workflow
Esempio di workflow base:

```
Chat Trigger → OpenAI/AI Node → Response
```

### Passo 4: Ottieni il Webhook URL
1. Salva ed attiva il workflow
2. Copia il Production URL dal Chat Trigger node
3. Formato: `https://your-n8n-instance.com/webhook/xxx/chat`

## 2. Configurazione Frontend

Aggiorna il file `public/index.html` sostituendo `YOUR_N8N_WEBHOOK_URL` con l'URL ottenuto:

```javascript
const chat = createChat({
    webhookUrl: 'https://your-n8n-instance.com/webhook/xxx/chat',
    // ... altre configurazioni
});
```

## 3. Esempio di Workflow Avanzato

Per integrare con le funzionalità di DrivenMetrics:

1. **Chat Trigger** → 
2. **Function Node** (per processare la richiesta) →
3. **HTTP Request** (chiama API DrivenMetrics) →
4. **OpenAI** (genera risposta) →
5. **Response**

### Function Node esempio:
```javascript
// Estrai il messaggio dell'utente
const userMessage = $input.first().json.message;

// Determina l'azione richiesta
let action = 'general';
if (userMessage.toLowerCase().includes('dashboard')) {
  action = 'create_dashboard';
} else if (userMessage.toLowerCase().includes('report')) {
  action = 'generate_report';
}

return {
  message: userMessage,
  action: action,
  timestamp: new Date().toISOString()
};
```

## 4. Testing

1. Apri https://drivenmetrics-beta.onrender.com
2. Digita un messaggio nella chat
3. Verifica che il messaggio arrivi al workflow n8n
4. Controlla la risposta nella chat

## 5. Personalizzazione CSS

Per personalizzare l'aspetto del widget n8n chat, puoi aggiungere CSS custom:

```css
/* Override n8n chat styles */
:root {
  --chat--color-primary: #667eea;
  --chat--color-primary-shade-50: #f0f4ff;
  --chat--color-primary-shade-100: #e0e9ff;
  --chat--color-secondary: #764ba2;
  --chat--color-white: #ffffff;
  --chat--color-light: #f8f9fa;
}

.n8n-chat {
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif !important;
}
```

## 6. Variabili d'ambiente consigliate

Aggiungi al tuo `.env`:

```
N8N_WEBHOOK_URL=https://your-n8n-instance.com/webhook/xxx/chat
N8N_API_KEY=your-api-key-if-needed
```

## Note di sicurezza

- Configura sempre gli Allowed Origins nel Chat Trigger
- Usa HTTPS in produzione
- Implementa rate limiting se necessario
- Valida l'input utente nel workflow n8n