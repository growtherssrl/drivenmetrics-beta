#!/bin/bash

# Verifica completa del server MCP Facebook Ads Library
# Questo script testa tutte le funzionalità e identifica eventuali problemi

echo "🚀 VERIFICA MCP FACEBOOK ADS LIBRARY SERVER"
echo "============================================="

# Token fornito dall'utente
TOKEN="dmgt_db4d72323f564a759d3cabd725a60074"

# 1. VERIFICA CONNESSIONE BASE
echo -e "\n1. 📡 TEST CONNESSIONE MCP SERVER"
echo "Testing SSE endpoint..."
curl -X GET "https://mcp.drivenmetrics.com/mcp-api/sse" \
  -H "Authorization: Bearer $TOKEN" \
  -N --max-time 5 2>&1 | head -20

# 2. TEST AUTENTICAZIONE
echo -e "\n\n2. 🔐 TEST STATO AUTENTICAZIONE"
# Usando l'endpoint HTTP standard per i messaggi
curl -X POST "https://mcp.drivenmetrics.com/mcp-api" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "id": 1,
    "method": "tools/call",
    "params": {
      "name": "check_auth_status",
      "arguments": {}
    }
  }' 2>/dev/null | jq '.'

# 3. TEST RICERCA BASE - SCARPE VERDI
echo -e "\n\n3. 🔍 TEST RICERCA SCARPE VERDI IN ITALIA"
curl -X POST "https://mcp.drivenmetrics.com/mcp-api" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "id": 2,
    "method": "tools/call",
    "params": {
      "name": "search_competitor_ads",
      "arguments": {
        "keywords": "scarpe verdi",
        "country": "IT",
        "limit": 5
      }
    }
  }' 2>/dev/null | jq '.'

# 4. TEST RICERCA SPRAY NASALI
echo -e "\n\n4. 🔍 TEST RICERCA SPRAY NASALI"
curl -X POST "https://mcp.drivenmetrics.com/mcp-api" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "id": 3,
    "method": "tools/call",
    "params": {
      "name": "search_competitor_ads",
      "arguments": {
        "keywords": "spray nasale",
        "country": "IT",
        "limit": 10
      }
    }
  }' 2>/dev/null | jq '.'

# 5. TEST RICERCA PER PAGINA
echo -e "\n\n5. 📄 TEST RICERCA PER PAGINA NIKE"
curl -X POST "https://mcp.drivenmetrics.com/mcp-api" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "id": 4,
    "method": "tools/call",
    "params": {
      "name": "search_ads_by_page",
      "arguments": {
        "page_id": "nike",
        "limit": 5
      }
    }
  }' 2>/dev/null | jq '.'

# 6. TEST CON n8n STYLE
echo -e "\n\n6. 🤖 TEST FORMATO n8n"
# Simulazione di una chiamata in stile n8n
curl -X POST "https://mcp.drivenmetrics.com/mcp-api" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "id": 5,
    "method": "tools/call",
    "params": {
      "name": "search_competitor_ads",
      "arguments": {
        "keywords": "marketing digitale",
        "country": "IT",
        "limit": 3
      }
    }
  }' 2>/dev/null | jq '.result'

echo -e "\n\n✅ VERIFICA COMPLETATA!"
echo -e "\n📋 RISULTATI DEL TEST:"
echo "- Server endpoint: https://mcp.drivenmetrics.com/mcp-api"
echo "- Token utilizzato: ${TOKEN:0:20}..."
echo "- Formato richieste: JSON-RPC 2.0"
echo -e "\n🔧 CONFIGURAZIONE PER n8n:"
echo "- URL: https://mcp.drivenmetrics.com/mcp-api/sse"
echo "- Header: Authorization: Bearer $TOKEN"
echo "- Method: Server-Sent Events (SSE)"

echo -e "\n📝 TOOLS DISPONIBILI:"
echo "1. check_auth_status - Verifica stato autenticazione"
echo "2. search_competitor_ads - Cerca ads per keywords"
echo "3. search_ads_by_page - Cerca ads per pagina Facebook"