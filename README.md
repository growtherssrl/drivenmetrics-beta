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

## Configurazione Facebook Ad Library

### Country Default

Per impostazione predefinita, le ricerche nella Facebook Ad Library utilizzano il paese "IT" (Italia). Puoi modificare questo comportamento tramite la variabile d'ambiente:

```bash
DEFAULT_AD_COUNTRY=IT  # Opzioni: IT, US, GB, FR, DE, ES, ALL, ecc.
```

### Campi Restituiti

L'API restituisce ora tutti i campi disponibili per gli annunci pubblicitari (esclusi quelli specifici per annunci politici):

- `id`: ID della libreria dell'annuncio
- `ad_creation_time`: Data/ora UTC di creazione dell'annuncio
- `ad_creative_bodies`: Lista dei testi visualizzati in ogni scheda dell'annuncio
- `ad_creative_link_captions`: Lista delle didascalie nella sezione call-to-action
- `ad_creative_link_descriptions`: Lista delle descrizioni dei link
- `ad_creative_link_titles`: Lista dei titoli nella sezione call-to-action
- `ad_delivery_start_time`: Data/ora di inizio della consegna dell'annuncio
- `ad_delivery_stop_time`: Data/ora di fine della consegna dell'annuncio
- `ad_snapshot_url`: URL per visualizzare l'annuncio archiviato
- `age_country_gender_reach_breakdown`: Distribuzione demografica (UK e UE)
- `beneficiary_payers`: Beneficiari e pagatori segnalati (solo UE)
- `br_total_reach`: Reach stimato per il Brasile
- `currency`: Valuta utilizzata per pagare l'annuncio
- `demographic_distribution`: Distribuzione demografica del pubblico raggiunto
- `estimated_audience_size`: Dimensione stimata del pubblico
- `eu_total_reach`: Reach combinato stimato per l'UE
- `impressions`: Numero di impression in range
- `languages`: Lista delle lingue contenute nell'annuncio
- `page_id`: ID della pagina Facebook che ha eseguito l'annuncio
- `page_name`: Nome della pagina Facebook
- `publisher_platforms`: Piattaforme Meta dove è apparso l'annuncio
- `spend`: Spesa in range
- `target_ages`: Fasce d'età selezionate per il targeting (UK e UE)
- `target_gender`: Generi selezionati per il targeting (UK e UE)
- `target_locations`: Località incluse/escluse per il targeting (UK e UE)
- `total_reach_by_location`: Reach stimato per località

## Deploy su Render

1. Crea un nuovo Web Service
2. Runtime: Node
3. Build Command: `npm install && npm run build`
4. Start Command: `npm start`
5. Aggiungi le variabili d'ambiente dal file `.env.example`

## Uso con Claude.ai

URL da configurare: `https://your-service.onrender.com/sse`