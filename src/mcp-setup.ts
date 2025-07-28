import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  Tool,
} from "@modelcontextprotocol/sdk/types.js";
import { Request, Response } from "express";
import { createClient } from "@supabase/supabase-js";

// Facebook API configuration
const FB_API_VERSION = process.env.FB_API_VERSION || "v19.0";
const FB_API_BASE = `https://graph.facebook.com/${FB_API_VERSION}`;

// Auth context for storing user info per session
export const authContext = new Map<string, { userId: string; token: string; searchId?: string | null }>();

// Create a single MCP server instance
export const mcpServer = new Server(
  {
    name: "facebook-ad-library-by-growthers",
    version: "1.0.0",
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// Define tools
const TOOLS: Tool[] = [
  {
    name: "set_token",
    description: "Imposta manualmente il Facebook access token",
    inputSchema: {
      type: "object",
      properties: {
        token: {
          type: "string",
          description: "Il Facebook access token da salvare",
        },
      },
      required: ["token"],
    },
  },
  {
    name: "check_token",
    description: "Controlla lo stato del token corrente e testa la connessione",
    inputSchema: {
      type: "object",
      properties: {},
    },
  },
  {
    name: "refresh_facebook_token",
    description: "DEPRECATO - Usa set_token invece. Mantenuto per compatibilità.",
    inputSchema: {
      type: "object",
      properties: {
        scope: {
          type: "string",
          description: "Ignorato - usa set_token",
        },
      },
    },
  },
  {
    name: "get_ad_creative",
    description: "Scarica e mostra la creatività di un annuncio specifico",
    inputSchema: {
      type: "object",
      properties: {
        ad_id: {
          type: "string",
          description: "ID dell'annuncio Facebook (opzionale)",
        },
        ad_snapshot_url: {
          type: "string",
          description: "URL diretto dello snapshot (opzionale)",
        },
      },
    },
  },
  {
    name: "search_ads_by_terms",
    description: "Cerca annunci pubblici nella Facebook Ad Library per termini di ricerca",
    inputSchema: {
      type: "object",
      properties: {
        search_terms: {
          type: "string",
          description: "Termini di ricerca (parole chiave)",
          examples: ["nike", "marketing digitale", "laborability"],
        },
        ad_reached_countries: {
          type: "string",
          description: "Paesi raggiunti dagli ads (codice ISO)",
          examples: ["IT", "US", "GB", "DE"],
        },
        ad_delivery_date_min: {
          type: "string",
          description: "Data minima di pubblicazione (YYYY-MM-DD)",
          examples: ["2024-01-01", "2024-06-01"],
        },
        ad_delivery_date_max: {
          type: "string",
          description: "Data massima di pubblicazione (YYYY-MM-DD)",
          examples: ["2024-12-31", "2024-06-30"],
        },
        limit: {
          type: "integer",
          description: "Numero massimo di risultati",
          minimum: 1,
          maximum: 100,
        },
        include_creatives: {
          type: "boolean",
          description: "Scarica automaticamente le creatività degli annunci",
        },
      },
      required: ["search_terms"],
    },
  },
  {
    name: "search_ads_by_page",
    description: "Cerca tutti gli annunci pubblici di una specifica pagina Facebook",
    inputSchema: {
      type: "object",
      properties: {
        page_id: {
          type: "string",
          description: "ID della pagina Facebook",
          examples: ["123456789", "nike", "laborability"],
        },
        page_url: {
          type: "string",
          description: "URL della pagina Facebook (alternativa al page_id)",
          examples: ["https://facebook.com/nike", "https://facebook.com/laborability"],
        },
        ad_reached_countries: {
          type: "string",
          description: "Paesi raggiunti dagli ads",
        },
        ad_delivery_date_min: {
          type: "string",
          description: "Data minima (YYYY-MM-DD)",
        },
        ad_delivery_date_max: {
          type: "string",
          description: "Data massima (YYYY-MM-DD)",
        },
        limit: {
          type: "integer",
          description: "Numero massimo di risultati",
          maximum: 100,
        },
      },
    },
  },
  {
    name: "analyze_competitor_ads",
    description: "Analizza gli annunci di uno o più competitor",
    inputSchema: {
      type: "object",
      properties: {
        competitor_pages: {
          type: "array",
          description: "Liste di pagine/brand competitor",
          items: {
            type: "string",
          },
          examples: [["nike", "adidas"], ["apple", "samsung"]],
        },
        countries: {
          type: "string",
          description: "Paesi da analizzare",
        },
        analysis_period_days: {
          type: "integer",
          description: "Periodo di analisi in giorni",
          minimum: 1,
          maximum: 365,
        },
        include_creative_analysis: {
          type: "boolean",
          description: "Include analisi dei creativi e messaggi",
        },
      },
      required: ["competitor_pages"],
    },
  },
];

// List tools handler
mcpServer.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: TOOLS,
  };
});

// Helper function to get Facebook token for a user
async function getFacebookToken(userId: string, supabase: any): Promise<string | null> {
  try {
    const { data, error } = await supabase
      .from("facebook_tokens")
      .select("access_token")
      .eq("user_id", userId)
      .eq("service", "competition")
      .single();

    if (error || !data) {
      console.error("[MCP] No Facebook token found for user:", userId);
      return null;
    }

    return data.access_token;
  } catch (error) {
    console.error("[MCP] Error fetching Facebook token:", error);
    return null;
  }
}

// Call tool handler
mcpServer.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  
  console.log(`[MCP] Tool called: ${name}`, args);
  
  // Get session context from transport metadata
  const sessionId = (request as any).sessionId;
  const authInfo = authContext.get(sessionId);
  
  if (!authInfo) {
    console.error("[MCP] No auth context for session:", sessionId);
    throw new Error("Authentication required");
  }

  const { userId, token } = authInfo;
  console.log(`[MCP] Tool ${name} called by user:`, userId);

  // Get Supabase client from global
  const supabase = (global as any).supabase;
  if (!supabase) {
    throw new Error("Database not configured");
  }

  // Execute tool based on name
  switch (name) {
    case "set_token": {
      const { token: fbToken } = args;
      if (!fbToken) {
        throw new Error("Token is required");
      }

      try {
        // Store token in database
        await supabase
          .from("facebook_tokens")
          .upsert({
            user_id: userId,
            access_token: fbToken,
            service: "competition",
            updated_at: new Date().toISOString(),
          });

        return {
          content: [
            {
              type: "text",
              text: "✅ Facebook token salvato con successo",
            },
          ],
        };
      } catch (error) {
        throw new Error(`Failed to save token: ${error}`);
      }
    }

    case "check_token": {
      try {
        const fbToken = await getFacebookToken(userId, supabase);
        
        if (!fbToken) {
          return {
            content: [
              {
                type: "text",
                text: "❌ Nessun token Facebook trovato. Usa set_token per configurarlo.",
              },
            ],
          };
        }

        // Test token with a simple API call
        const response = await fetch(`${FB_API_BASE}/me?access_token=${fbToken}`);
        const data = await response.json();

        if (data.error) {
          return {
            content: [
              {
                type: "text",
                text: `❌ Token non valido: ${data.error.message}`,
              },
            ],
          };
        }

        return {
          content: [
            {
              type: "text",
              text: `✅ Token valido per: ${data.name || data.id}`,
            },
          ],
        };
      } catch (error) {
        throw new Error(`Failed to check token: ${error}`);
      }
    }

    case "search_ads_by_terms": {
      const { 
        search_terms, 
        ad_reached_countries = "ALL",
        ad_delivery_date_min,
        ad_delivery_date_max,
        limit = 25,
        include_creatives = false
      } = args;

      if (!search_terms) {
        throw new Error("search_terms is required");
      }

      try {
        const fbToken = await getFacebookToken(userId, supabase);
        if (!fbToken) {
          throw new Error("No Facebook token found. Use set_token to configure it.");
        }

        // Build API request
        const params = new URLSearchParams({
          access_token: fbToken,
          search_terms: search_terms,
          ad_reached_countries: ad_reached_countries,
          ad_active_status: "ALL",
          limit: limit.toString(),
          fields: "id,ad_creation_time,ad_creative_bodies,ad_creative_link_captions,ad_creative_link_descriptions,ad_creative_link_titles,ad_delivery_start_time,ad_delivery_stop_time,ad_snapshot_url,age_country_gender_reach_breakdown,beneficiary_payers,bylines,currency,delivery_by_region,demographic_distribution,estimated_audience_size,impressions,languages,page_id,page_name,publisher_platforms,spend,target_ages,target_gender,target_locations",
        });

        if (ad_delivery_date_min) {
          params.append("ad_delivery_date_min", ad_delivery_date_min);
        }
        if (ad_delivery_date_max) {
          params.append("ad_delivery_date_max", ad_delivery_date_max);
        }

        const url = `${FB_API_BASE}/ads_archive?${params}`;
        console.log("[MCP] Calling Facebook API:", url);

        const response = await fetch(url);
        const data = await response.json();

        if (data.error) {
          throw new Error(`Facebook API error: ${data.error.message}`);
        }

        const ads = (data.data || []).map((ad: any) => ({
          id: ad.id,
          ad_snapshot_url: ad.ad_snapshot_url,
          ad_creative_bodies: ad.ad_creative_bodies || [],
          ad_creative_link_titles: ad.ad_creative_link_titles || [],
          page_name: ad.page_name,
          ad_delivery_start_time: ad.ad_delivery_start_time,
          ad_delivery_stop_time: ad.ad_delivery_stop_time,
          publisher_platforms: ad.publisher_platforms || [],
          library_url: `https://www.facebook.com/ads/library/?id=${ad.id}`,
          ...(include_creatives ? {
            ad_creative_link_captions: ad.ad_creative_link_captions,
            ad_creative_link_descriptions: ad.ad_creative_link_descriptions,
          } : {}),
        }));

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                search_terms: search_terms,
                ads_found: ads.length,
                ads: ads,
              }, null, 2),
            },
          ],
        };
      } catch (error) {
        throw new Error(`Failed to search ads: ${error}`);
      }
    }

    case "search_ads_by_page":
    case "get_ad_creative":
    case "analyze_competitor_ads":
      // TODO: Implement these tools
      throw new Error(`Tool ${name} not implemented yet`);

    case "refresh_facebook_token":
      return {
        content: [
          {
            type: "text",
            text: "⚠️ refresh_facebook_token è deprecato. Usa set_token invece.",
          },
        ],
      };

    default:
      throw new Error(`Unknown tool: ${name}`);
  }
});

// Create transport handler that integrates with auth
export function createMcpTransport() {
  return new StreamableHTTPServerTransport({
    endpoint: "/mcp-api",
  });
}

// Handle MCP request with auth context
export async function handleMcpRequest(
  req: Request, 
  res: Response, 
  body: any,
  sessionId: string
) {
  try {
    // Create a transport for this request
    const transport = createMcpTransport();
    
    // Set session context in the request
    (body as any).sessionId = sessionId;
    
    // Connect transport to server
    await mcpServer.connect(transport);
    
    // Handle the request
    await transport.handleRequest(req, res, body);
  } catch (error) {
    console.error("[MCP] Error handling request:", error);
    throw error;
  }
}