# Debug n8n Streaming Issues

## Problema Identificato
Il workflow n8n sta inviando eventi di streaming con `content: "undefined"` invece del contenuto reale dell'AI.

## Output Ricevuto
```json
{"type":"item","content":"undefined","metadata":{...}}
```

## Output Atteso
```json
{"type":"item","content":"Testo reale qui...","metadata":{...}}
```

## Possibili Cause nel Workflow n8n

### 1. Configurazione AI Agent Node
- Verificare che l'AI Agent node sia configurato per streaming
- Controllare che il campo di output sia mappato correttamente
- Verificare che il modello AI supporti streaming

### 2. Webhook Response Node
- Il Webhook Response deve essere configurato con:
  - Response Mode: "When Last Node Finishes" 
  - Response Data: "All Execution Data"
  - O meglio ancora: Response Mode: "Using Respond to Webhook Node" per SSE

### 3. Configurazione Streaming SSE
Per abilitare correttamente lo streaming SSE in n8n:

```javascript
// Nel Code node prima del Webhook Response:
const items = $input.all();
const streamData = [];

for (const item of items) {
  // Assicurarsi che il content sia estratto correttamente
  const content = item.json.output || item.json.response || item.json.message || '';
  
  streamData.push({
    type: 'item',
    content: content, // NON item.json.content che potrebbe non esistere
    metadata: {
      nodeId: $execution.id,
      nodeName: $node.name,
      timestamp: Date.now()
    }
  });
}

return streamData;
```

### 4. Verifica nel Workflow n8n

1. **Apri l'execution che non funziona**
2. **Controlla l'output dell'AI Agent node**
   - Dovrebbe avere un campo come `output`, `response`, o `message`
   - NON `content` (che probabilmente non esiste)

3. **Controlla il Code/Function node che prepara lo streaming**
   - Sta cercando di accedere a `item.json.content`?
   - Dovrebbe invece accedere a `item.json.output` o simile

### 5. Soluzione Rapida
Nel workflow n8n, trova dove viene preparato lo streaming e cambia:

```javascript
// DA:
content: item.json.content || 'undefined'

// A:
content: item.json.output || item.json.response || item.json.message || ''
```

## Test Diretto con n8n Chat Widget

Se vuoi usare il widget ufficiale @n8n/chat invece del nostro codice custom:

```html
<!DOCTYPE html>
<html>
<head>
  <title>Test n8n Chat Widget</title>
</head>
<body>
  <script type="module">
    import { createChat } from 'https://cdn.jsdelivr.net/npm/@n8n/chat/dist/chat.bundle.es.js'
    
    createChat({
      webhookUrl: 'https://n8n.growthers.io/webhook/21b75195-84e4-4e1b-8350-166b0b223a12/chat',
      mode: 'fullscreen', // o 'window'
      showWelcomeScreen: true,
      defaultLanguage: 'it',
      initialMessages: [
        'Ciao! Sono il tuo assistente di marketing intelligence.'
      ],
    })
  </script>
  
  <link href="https://cdn.jsdelivr.net/npm/@n8n/chat/dist/style.css" rel="stylesheet">
</body>
</html>
```

## Verifica Output AI Agent

Nel tuo workflow n8n, aggiungi un Code node subito dopo l'AI Agent per debug:

```javascript
console.log('AI Agent Output:', JSON.stringify($input.all(), null, 2));

// Mappa correttamente i campi
return $input.all().map(item => {
  const aiOutput = item.json;
  console.log('AI fields available:', Object.keys(aiOutput));
  
  return {
    json: {
      type: 'item',
      // Prova diversi campi finché non trovi quello giusto
      content: aiOutput.output || 
               aiOutput.response || 
               aiOutput.message || 
               aiOutput.text || 
               aiOutput.answer ||
               JSON.stringify(aiOutput), // fallback per debug
      metadata: {
        availableFields: Object.keys(aiOutput),
        rawData: aiOutput
      }
    }
  };
});
```

Questo ti mostrerà esattamente quali campi sono disponibili dall'AI Agent node.