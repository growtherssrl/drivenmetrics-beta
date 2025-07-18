# n8n Deep Marketing Workflow Setup

Questa guida spiega come configurare i workflow n8n per il sistema Deep Marketing Analysis.

## Panoramica del Sistema

Il sistema Deep Marketing utilizza 3 webhook n8n interconnessi:

1. **Webhook 1: Create Plan** - Riceve la richiesta iniziale e crea il piano di ricerca
2. **Webhook 2: Execute Search** - Esegue la ricerca utilizzando l'MCP server
3. **Webhook 3: Process Results** - Elabora e formatta i risultati

## Configurazione Webhook 1: Create Plan

### 1. Crea un nuovo workflow in n8n
### 2. Aggiungi un nodo Webhook

```
Webhook URL: https://your-n8n-instance.com/webhook/deep-marketing
Method: POST
Response Mode: Immediately
```

### 3. Aggiungi un nodo Code per processare la richiesta

```javascript
// Parse the incoming request
const { query, search_id, user_id } = $input.item.json;

// Use AI to analyze the query and create a search plan
// This is a simplified example - you can use OpenAI/Claude to analyze
const plan = {
  keywords: [],
  pages: [],
  date_range: {
    from: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
    to: new Date().toISOString().split('T')[0]
  },
  countries: ["IT"],
  analysis_type: "competitor_analysis"
};

// Extract keywords from query
if (query.toLowerCase().includes("nike")) {
  plan.keywords.push("nike", "scarpe nike", "nike shoes");
  plan.pages.push("nike");
}

if (query.toLowerCase().includes("adidas")) {
  plan.keywords.push("adidas", "scarpe adidas", "adidas shoes");
  plan.pages.push("adidas");
}

// Default keywords if none found
if (plan.keywords.length === 0) {
  plan.keywords = query.split(" ").filter(word => word.length > 3);
}

return {
  json: {
    search_id,
    plan,
    status: "planning"
  }
};
```

### 4. Aggiungi un nodo HTTP Request per rispondere

```
URL: {{$node["Webhook"].json["body"]["callback_url"]}} (se fornito)
Method: POST
Body: {{ $json }}
```

## Configurazione Webhook 2: Execute Search

### 1. Crea un secondo workflow
### 2. Aggiungi un nodo Webhook

```
Webhook URL: https://your-n8n-instance.com/webhook/deep-marketing-execute
```

### 3. Aggiungi un nodo HTTP Request per chiamare l'MCP

```javascript
// Prepare MCP request
const plan = $input.item.json.plan;
const mcp_endpoint = $input.item.json.mcp_endpoint;

// Create search parameters based on plan
const searchParams = {
  search_terms: plan.keywords.join(" "),
  ad_reached_countries: plan.countries[0] || "IT",
  limit: 50,
  ad_delivery_date_min: plan.date_range.from,
  ad_delivery_date_max: plan.date_range.to
};

return {
  json: {
    url: mcp_endpoint,
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": "Bearer YOUR_API_TOKEN" // Use from environment
    },
    body: {
      jsonrpc: "2.0",
      method: "search_ads_by_terms",
      params: searchParams,
      id: 1
    }
  }
};
```

### 4. Aggiungi nodi per processare pagine specifiche

Per ogni pagina nel piano, aggiungi una chiamata MCP:

```javascript
// For each page in plan.pages
const pageSearchParams = {
  page_id: page,
  ad_reached_countries: plan.countries[0] || "IT",
  limit: 25
};
```

### 5. Aggiungi un nodo per aggregare i risultati

```javascript
// Combine all results
const allResults = [];

// Add results from keyword search
if ($node["MCP_Keywords"].json.ads) {
  allResults.push(...$node["MCP_Keywords"].json.ads);
}

// Add results from page searches
// ... aggregate all page results

// Remove duplicates
const uniqueResults = allResults.filter((ad, index, self) =>
  index === self.findIndex((a) => a.id === ad.id)
);

return {
  json: {
    search_id: $input.item.json.search_id,
    results: uniqueResults,
    status: "completed"
  }
};
```

### 6. Invia i risultati al callback

```
URL: {{ $input.item.json.callback_url }}
Method: POST
Body: {{ $json }}
```

## Configurazione Webhook 3: Process Results (Opzionale)

Se vuoi elaborare ulteriormente i risultati:

### 1. Crea un terzo workflow per analisi avanzate

```javascript
// Analyze competitor strategies
const results = $input.item.json.results;

// Group by page/advertiser
const byAdvertiser = {};
results.forEach(ad => {
  if (!byAdvertiser[ad.page_name]) {
    byAdvertiser[ad.page_name] = [];
  }
  byAdvertiser[ad.page_name].push(ad);
});

// Analyze messaging patterns
const insights = {
  total_ads: results.length,
  advertisers: Object.keys(byAdvertiser),
  top_advertiser: Object.entries(byAdvertiser)
    .sort((a, b) => b[1].length - a[1].length)[0][0],
  common_themes: extractThemes(results),
  platform_distribution: analyzePlatforms(results)
};

return { json: { insights } };
```

## Variabili d'Ambiente n8n

Configura queste variabili nel tuo n8n:

```bash
DRIVENMETRICS_API_TOKEN=dmgt_your_token_here
DRIVENMETRICS_MCP_URL=https://mcp.drivenmetrics.com/mcp-api/sse
DRIVENMETRICS_CALLBACK_URL=https://mcp.drivenmetrics.com/api/deep-marketing/receive-results
```

## Test del Sistema

1. Dalla pagina Deep Marketing, inserisci una query di test
2. Verifica che il webhook n8n riceva la richiesta
3. Controlla che il piano venga creato correttamente
4. Avvia la ricerca e verifica l'esecuzione
5. Controlla che i risultati vengano ricevuti

## Esempi di Query

- "Analizza le campagne Nike degli ultimi 30 giorni"
- "Confronta le strategie pubblicitarie di Apple e Samsung"
- "Mostrami tutti gli annunci di scarpe sportive in Italia"
- "Analizza i competitor nel settore fashion"

## Troubleshooting

### Errore: "Invalid MCP token"
- Verifica che il token API sia corretto nelle variabili d'ambiente

### Errore: "No results found"
- Controlla che le pagine Facebook esistano
- Verifica i filtri di data e paese

### Timeout nelle richieste
- Aumenta il timeout nei nodi HTTP Request
- Riduci il numero di risultati richiesti