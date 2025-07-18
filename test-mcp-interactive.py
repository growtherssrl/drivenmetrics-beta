#!/usr/bin/env python3
"""
Test interattivo per MCP Facebook Ads Library Server
"""
import requests
import json
import sys

# Configurazione
BASE_URL = "https://mcp.drivenmetrics.com/mcp-api"
TOKEN = "dmgt_db4d72323f564a759d3cabd725a60074"

def make_request(method, params):
    """Fa una richiesta JSON-RPC al server MCP"""
    headers = {
        "Authorization": f"Bearer {TOKEN}",
        "Content-Type": "application/json"
    }
    
    payload = {
        "jsonrpc": "2.0",
        "id": 1,
        "method": method,
        "params": params
    }
    
    try:
        response = requests.post(BASE_URL, json=payload, headers=headers)
        return response.json()
    except Exception as e:
        return {"error": str(e)}

def test_auth():
    """Test autenticazione"""
    print("\n🔐 TEST AUTENTICAZIONE")
    result = make_request("tools/call", {
        "name": "check_auth_status",
        "arguments": {}
    })
    print(json.dumps(result, indent=2))
    return result.get("result", {})

def search_ads(keywords, country="IT", limit=10):
    """Cerca ads per keywords"""
    print(f"\n🔍 RICERCA ADS: '{keywords}' in {country}")
    result = make_request("tools/call", {
        "name": "search_competitor_ads",
        "arguments": {
            "keywords": keywords,
            "country": country,
            "limit": limit
        }
    })
    
    if "result" in result:
        content = result["result"].get("content", [])
        if content and len(content) > 0:
            data = json.loads(content[0].get("text", "{}"))
            if "ads" in data:
                print(f"✅ Trovati {len(data['ads'])} annunci")
                for i, ad in enumerate(data['ads'][:3]):
                    print(f"\nAnnuncio {i+1}:")
                    print(f"  - Pagina: {ad.get('page_name', 'N/A')}")
                    print(f"  - ID: {ad.get('id', 'N/A')}")
                    if 'ad_creative_bodies' in ad and ad['ad_creative_bodies']:
                        print(f"  - Testo: {ad['ad_creative_bodies'][0][:100]}...")
            else:
                print("❌ Nessun annuncio trovato")
                print(json.dumps(data, indent=2))
    else:
        print("❌ Errore nella risposta")
        print(json.dumps(result, indent=2))

def search_by_page(page_id, limit=10):
    """Cerca ads per pagina"""
    print(f"\n📄 RICERCA PER PAGINA: {page_id}")
    result = make_request("tools/call", {
        "name": "search_ads_by_page",
        "arguments": {
            "page_id": page_id,
            "limit": limit
        }
    })
    
    if "result" in result:
        content = result["result"].get("content", [])
        if content and len(content) > 0:
            data = json.loads(content[0].get("text", "{}"))
            if "ads" in data:
                print(f"✅ Trovati {len(data['ads'])} annunci per {page_id}")
            else:
                print("❌ Nessun annuncio trovato")
                print(json.dumps(data, indent=2))
    else:
        print("❌ Errore nella risposta")
        print(json.dumps(result, indent=2))

def main():
    print("🚀 TEST MCP FACEBOOK ADS LIBRARY SERVER")
    print("=" * 50)
    
    # Test autenticazione
    auth_result = test_auth()
    
    if not auth_result.get("authenticated"):
        print("❌ Autenticazione fallita!")
        return
    
    print(f"✅ Autenticato come utente: {auth_result.get('user_id', 'N/A')}")
    print(f"✅ Facebook connesso: {auth_result.get('has_facebook', False)}")
    
    # Menu interattivo
    while True:
        print("\n" + "=" * 50)
        print("OPZIONI:")
        print("1. Cerca ads per keyword")
        print("2. Cerca ads per pagina")
        print("3. Test predefiniti")
        print("4. Esci")
        
        choice = input("\nScegli opzione (1-4): ").strip()
        
        if choice == "1":
            keywords = input("Inserisci keywords: ").strip()
            country = input("Paese (default IT): ").strip() or "IT"
            limit = input("Limite risultati (default 10): ").strip() or "10"
            search_ads(keywords, country, int(limit))
            
        elif choice == "2":
            page_id = input("Inserisci ID o nome pagina: ").strip()
            limit = input("Limite risultati (default 10): ").strip() or "10"
            search_by_page(page_id, int(limit))
            
        elif choice == "3":
            print("\n🧪 ESECUZIONE TEST PREDEFINITI...")
            search_ads("scarpe verdi", "IT", 5)
            search_ads("spray nasale", "IT", 5)
            search_ads("marketing digitale", "IT", 5)
            search_by_page("nike", 5)
            
        elif choice == "4":
            print("\n👋 Arrivederci!")
            break
        
        else:
            print("❌ Opzione non valida")

if __name__ == "__main__":
    main()