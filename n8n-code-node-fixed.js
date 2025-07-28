// Nodo Code per n8n - Formattazione risultati Deep Marketing Analysis CON SESSIONID

// Estrai i dati dal nodo precedente E dal Chat Trigger
const items = $input.all();
const data = items[0].json;

// IMPORTANTE: Estrai il sessionId dal metadata del Chat Trigger
// Assumendo che il Chat Trigger sia il primo nodo o che il sessionId sia passato lungo la catena
const sessionId = items[0].json.metadata?.sessionId || 
                 $('Chat Trigger').item.json.metadata?.sessionId ||
                 'session-default';

// Verifica se data è un array o un oggetto
const analysisData = Array.isArray(data) ? data[0] : data;

// Estrai il report principale
const mainReport = analysisData.output || '';

// Estrai le query eseguite e i risultati
const intermediateSteps = analysisData.intermediateSteps || [];

// Conta gli annunci totali trovati
let totalAds = 0;
let adsByQuery = [];
let allAds = [];
let brandsSet = new Set();

// Analizza gli step intermedi per estrarre i dati delle query
intermediateSteps.forEach(step => {
  if (step.action && step.action.tool === 'search_ads_by_terms') {
    const searchTerms = step.action.toolInput.search_terms;
    const observation = step.observation;

    // Cerca di parsare il JSON dalla stringa di observation
    try {
      // L'observation potrebbe già essere un oggetto o una stringa
      let resultData;
      if (typeof observation === 'string') {
        const match = observation.match(/\{[\s\S]*\}/);
        if (match) {
          resultData = JSON.parse(match[0]);
        }
      } else if (observation && observation[0] && observation[0].text) {
        // Formato con array di oggetti text
        const match = observation[0].text.match(/\{[\s\S]*\}/);
        if (match) {
          resultData = JSON.parse(match[0]);
        }
      }

      if (resultData) {
        totalAds += resultData.ads_found || 0;

        adsByQuery.push({
          query: searchTerms,
          adsFound: resultData.ads_found,
          message: resultData.message
        });

        // Aggiungi tutti gli annunci alla lista
        if (resultData.ads) {
          allAds = allAds.concat(resultData.ads);
          // Estrai i brand unici
          resultData.ads.forEach(ad => {
            if (ad.page_name) brandsSet.add(ad.page_name);
          });
        }
      }
    } catch (e) {
      console.error('Error parsing observation:', e);
    }
  }
});

// Estrai le sezioni principali dal report
const sections = {
  panoramica: extractSection(mainReport, '📊 PANORAMICA DEL SETTORE', '🏢 PLAYER DEL SETTORE'),
  players: extractSection(mainReport, '🏢 PLAYER DEL SETTORE', '💬 ANALISI MESSAGING SETTORIALE'),
  messaging: extractSection(mainReport, '💬 ANALISI MESSAGING SETTORIALE', '🎨 CREATIVE STRATEGY INSIGHTS'),
  creative: extractSection(mainReport, '🎨 CREATIVE STRATEGY INSIGHTS', '📱 ANNUNCI DETTAGLIATI'),
  annunci: extractSection(mainReport, '📱 ANNUNCI DETTAGLIATI', '💡 INSIGHTS STRATEGICI OSSERVABILI'),
  insights: extractSection(mainReport, '💡 INSIGHTS STRATEGICI OSSERVABILI', '🎯 RACCOMANDAZIONI STRATEGICHE'),
  raccomandazioni: extractSection(mainReport, '🎯 RACCOMANDAZIONI STRATEGICHE', null)
};

// Funzione helper per estrarre sezioni
function extractSection(text, startMarker, endMarker) {
  if (!text || !startMarker) return '';

  const startIndex = text.indexOf(startMarker);
  if (startIndex === -1) return '';

  const endIndex = endMarker ? text.indexOf(endMarker) : text.length;

  return text.substring(startIndex, endIndex > startIndex ? endIndex : text.length).trim();
}

// Estrai informazioni chiave dal report
const keyInsights = {
  brandUfficiali: extractBrands(sections.players, '🥇 BRAND UFFICIALI'),
  retailer: extractBrands(sections.players, '🏪 RETAILER E RIVENDITORI'),
  pmi: extractBrands(sections.players, '🏬 PMI E NEGOZI LOCALI'),
  segnalazioni: extractBrands(sections.players, '🚨 SEGNALAZIONI')
};

// Funzione per estrarre liste di brand
function extractBrands(text, marker) {
  if (!text || !marker) return [];

  const startIndex = text.indexOf(marker);
  if (startIndex === -1) return [];

  const endMarkers = ['🥇', '🏪', '🏬', '🚨', '💬', '📱'];
  let endIndex = text.length;

  for (const endMarker of endMarkers) {
    const idx = text.indexOf(endMarker, startIndex + marker.length);
    if (idx > -1 && idx < endIndex) {
      endIndex = idx;
    }
  }

  const section = text.substring(startIndex + marker.length, endIndex);
  const lines = section.split('\n').filter(line => line.trim().startsWith('-'));

  return lines.map(line => line.replace(/^-\s*/, '').trim());
}

// Crea output strutturato CON SESSIONID
const formattedOutput = {
  // IMPORTANTE: Includi sempre il sessionId nell'output
  sessionId: sessionId,
  
  summary: {
    title: "🎯 ANALISI COMPETITIVA FACEBOOK ADS",
    totalAdsAnalyzed: totalAds,
    brandsCount: brandsSet.size,
    queries: adsByQuery,
    timestamp: new Date().toISOString()
  },

  keyInsights: keyInsights,

  sections: {
    marketOverview: {
      title: "📊 PANORAMICA DEL SETTORE",
      content: sections.panoramica
    },

    competitors: {
      title: "🏢 PLAYER IDENTIFICATI",
      content: sections.players
    },

    messagingAnalysis: {
      title: "💬 ANALISI MESSAGING",
      content: sections.messaging
    },

    creativeStrategy: {
      title: "🎨 STRATEGIA CREATIVA",
      content: sections.creative
    },

    detailedAds: {
      title: "📱 ANNUNCI DETTAGLIATI",
      content: sections.annunci
    },

    strategicInsights: {
      title: "💡 INSIGHTS STRATEGICI",
      content: sections.insights
    },

    recommendations: {
      title: "🎯 RACCOMANDAZIONI",
      content: sections.raccomandazioni
    }
  },

  // Dati per il webhook dashboard update
  dashboardData: {
    adsCount: totalAds,
    brandsCount: brandsSet.size,
    queriesCount: adsByQuery.length,
    campaigns: allAds.slice(0, 10).map(ad => ({
      brand: ad.page_name || 'Unknown',
      name: ad.ad_creative_bodies ? ad.ad_creative_bodies[0] : 'Campaign',
      description: ad.ad_creative_link_descriptions ? ad.ad_creative_link_descriptions[0] : '',
      spend: ad.spend || 'N/A'
    }))
  },

  rawData: {
    adsFound: allAds,
    totalCount: allAds.length
  },

  fullReport: mainReport
};

// Output formattato per n8n
return [{
  json: formattedOutput,
  pairedItem: { item: 0 }
}];