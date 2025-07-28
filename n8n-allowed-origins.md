# Configurazione Allowed Origins per n8n Chat Trigger

## Domini da aggiungere nel Chat Trigger node di n8n:

Nel tuo workflow n8n, vai al nodo **Chat Trigger** e aggiungi questi domini nella sezione **Allowed Origins**:

```
https://drivenmetrics-beta.onrender.com
https://beta.drivenmetrics.com
http://localhost:3000
http://localhost:10000
```

## Come configurare:

1. Apri il tuo workflow n8n
2. Clicca sul nodo **Chat Trigger**
3. Trova la sezione **Settings** o **Options**
4. Cerca il campo **Allowed Origins** o **CORS Origins**
5. Aggiungi i domini sopra (uno per riga)
6. Salva e attiva il workflow

## Verifica:

Per verificare che funzioni:
1. Apri la console del browser (F12)
2. Vai su https://drivenmetrics-beta.onrender.com/deep-marketing.html
3. Controlla se ci sono errori CORS nella console
4. Il widget chat dovrebbe apparire in basso a destra

## Troubleshooting:

Se continua a non funzionare:
1. Verifica che il webhook URL sia corretto
2. Controlla che il workflow sia attivo
3. Prova a ricaricare la pagina con cache disabilitata (Ctrl+Shift+R)