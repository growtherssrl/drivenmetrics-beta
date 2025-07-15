# Come connettere Drivenmetrics a Claude.ai

## Metodo attuale: Usa il token API

### 1. Genera il tuo token API
1. Vai su https://mcp.drivenmetrics.com
2. Fai login o registrati
3. Connetti il tuo account Facebook (necessario per usare gli strumenti)
4. Clicca su "Generate API Token"
5. Copia il token che inizia con `dmgt_`

### 2. Configura Claude Desktop
**Nota: Claude.ai web non supporta ancora i server MCP con autenticazione**

1. Scarica Claude Desktop se non l'hai già
2. Vai in Settings → Developer
3. Clicca "Edit config" sotto MCP
4. Aggiungi questa configurazione:

```json
{
  "drivenmetrics": {
    "command": "mcp-server-http",
    "args": {
      "url": "https://mcp.drivenmetrics.com/mcp-api",
      "headers": {
        "Authorization": "Bearer dmgt_IL_TUO_TOKEN_QUI"
      }
    }
  }
}
```

5. Sostituisci `dmgt_IL_TUO_TOKEN_QUI` con il tuo token
6. Salva e riavvia Claude Desktop

### 3. Verifica la connessione
Una volta riavviato Claude, dovresti vedere gli strumenti Drivenmetrics disponibili.

Prova a chiedere:
- "Cerca annunci Facebook per 'nike shoes'"
- "Mostra gli annunci della pagina Facebook di Adidas"

## Problemi comuni

**"Connection closed" error:**
- Verifica che il token sia copiato correttamente
- Assicurati di aver connesso Facebook su Drivenmetrics
- Controlla che l'URL sia esattamente come indicato sopra

**Claude.ai web non funziona:**
- Al momento solo Claude Desktop supporta server MCP con autenticazione
- Stiamo lavorando per supportare anche Claude.ai web