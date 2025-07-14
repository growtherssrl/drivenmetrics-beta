import express from "express";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  InitializeRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import dotenv from "dotenv";
import { createClient } from "@supabase/supabase-js";
import axios from "axios";

dotenv.config();

// Configuration
const PORT = process.env.PORT || 3000;
const SUPABASE_URL = process.env.SUPABASE_URL || "";
const SUPABASE_KEY = process.env.SUPABASE_KEY || "";
const FB_GRAPH_VERSION = "v21.0";

// Initialize Supabase
const supabase = SUPABASE_URL && SUPABASE_KEY ? createClient(SUPABASE_URL, SUPABASE_KEY) : null;

// Express app
const app = express();
app.use(express.json());

// MCP Server
const mcpServer = new Server(
  {
    name: "drivenmetrics",
    version: "1.0.0",
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// SSE transport instance
let sseTransport: SSEServerTransport | null = null;

// Database helpers
async function getUserByToken(token: string): Promise<string | null> {
  if (!supabase || !token) return null;
  
  try {
    const { data } = await supabase
      .from("api_tokens")
      .select("user_id")
      .eq("token", token)
      .single();
    
    return data?.user_id || null;
  } catch (error) {
    console.error("Error getting user:", error);
    return null;
  }
}

async function getFacebookToken(userId: string): Promise<string | null> {
  if (!supabase || !userId) return null;
  
  try {
    const { data } = await supabase
      .from("facebook_tokens")
      .select("access_token")
      .eq("user_id", userId)
      .eq("service", "competition")
      .single();
    
    return data?.access_token || null;
  } catch (error) {
    console.error("Error getting FB token:", error);
    return null;
  }
}

// Facebook API helper
async function fetchAdsFromFacebook(params: any, fbToken: string): Promise<any> {
  try {
    const url = `https://graph.facebook.com/${FB_GRAPH_VERSION}/ads_archive`;
    const response = await axios.get(url, {
      params: {
        ...params,
        access_token: fbToken,
        fields: 'id,ad_creative_body,ad_creative_link_caption,ad_creative_link_description,ad_creative_link_title,ad_delivery_start_time,ad_delivery_stop_time,page_id,page_name,impressions,spend',
      },
      timeout: 30000,
    });
    return response.data;
  } catch (error: any) {
    console.error("Facebook API error:", error.response?.data || error.message);
    return { error: error.response?.data?.error?.message || "Facebook API error" };
  }
}

// MCP Handlers
mcpServer.setRequestHandler(InitializeRequestSchema, async () => {
  return {
    protocolVersion: "2024-11-05",
    capabilities: {
      tools: {
        list_changed: true,
      },
    },
    serverInfo: {
      name: "drivenmetrics",
      version: "1.0.0",
    },
  };
});

mcpServer.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: "check_auth_status",
        description: "Check authentication status",
        inputSchema: {
          type: "object",
          properties: {},
        },
      },
      {
        name: "search_competitor_ads",
        description: "Search competitor ads by keywords",
        inputSchema: {
          type: "object",
          properties: {
            keywords: { type: "string", description: "Keywords to search" },
            country: { type: "string", default: "ALL" },
            limit: { type: "number", default: 10 },
          },
          required: ["keywords"],
        },
      },
      {
        name: "search_ads_by_page",
        description: "Get ads from a Facebook page",
        inputSchema: {
          type: "object",
          properties: {
            page_id: { type: "string", description: "Facebook page ID" },
            limit: { type: "number", default: 25 },
          },
          required: ["page_id"],
        },
      },
    ],
  };
});

mcpServer.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  
  // Extract auth from context if available
  const authToken = (request as any)._meta?.authToken;
  const userId = authToken ? await getUserByToken(authToken) : null;
  const fbToken = userId ? await getFacebookToken(userId) : null;
  
  try {
    let result: any;
    
    switch (name) {
      case "check_auth_status":
        result = {
          authenticated: !!userId,
          has_facebook: !!fbToken,
          user_id: userId,
        };
        break;
        
      case "search_competitor_ads":
        if (!fbToken) {
          result = { error: "Facebook authentication required" };
        } else {
          const params = {
            ad_type: "POLITICAL_AND_ISSUE_ADS",
            ad_active_status: "ALL",
            search_terms: args.keywords,
            limit: args.limit || 10,
          };
          if (args.country !== "ALL") {
            params.ad_reached_countries = args.country;
          }
          const fbResult = await fetchAdsFromFacebook(params, fbToken);
          result = fbResult.error ? fbResult : {
            keywords: args.keywords,
            ads_found: fbResult.data?.length || 0,
            ads: fbResult.data || [],
          };
        }
        break;
        
      case "search_ads_by_page":
        if (!fbToken) {
          result = { error: "Facebook authentication required" };
        } else {
          const params = {
            ad_type: "POLITICAL_AND_ISSUE_ADS",
            ad_active_status: "ALL",
            search_page_ids: args.page_id,
            limit: args.limit || 25,
          };
          const fbResult = await fetchAdsFromFacebook(params, fbToken);
          result = fbResult.error ? fbResult : {
            page_id: args.page_id,
            ads_found: fbResult.data?.length || 0,
            ads: fbResult.data || [],
          };
        }
        break;
        
      default:
        result = { error: `Unknown tool: ${name}` };
    }
    
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(result, null, 2),
        },
      ],
    };
  } catch (error) {
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }),
        },
      ],
    };
  }
});

// Express routes
app.get("/health", (req, res) => {
  res.json({ status: "ok", service: "drivenmetrics-mcp" });
});

// SSE endpoint
app.get("/sse", async (req, res) => {
  console.log("📡 SSE connection established");
  
  // Extract auth token from headers
  const authHeader = req.headers.authorization;
  const authToken = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;
  
  sseTransport = new SSEServerTransport("/messages", res);
  await mcpServer.connect(sseTransport);
  
  res.on("close", () => {
    console.log("📡 SSE connection closed");
    sseTransport = null;
  });
});

// Messages endpoint
app.post("/messages", async (req, res) => {
  if (!sseTransport) {
    return res.status(400).json({ error: "No active SSE connection" });
  }
  
  try {
    // Extract auth token and add to metadata
    const authHeader = req.headers.authorization;
    const authToken = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;
    
    const messageWithAuth = {
      ...req.body,
      _meta: {
        authToken,
        timestamp: new Date().toISOString(),
      },
    };
    
    await sseTransport.handlePostMessage(messageWithAuth);
    res.json({ success: true });
  } catch (error) {
    console.error("Message error:", error);
    res.status(500).json({ error: "Failed to process message" });
  }
});

// Start server
app.listen(PORT, () => {
  console.log(`🚀 MCP Server running on port ${PORT}`);
  console.log(`📡 SSE endpoint: http://localhost:${PORT}/sse`);
  console.log(`💬 Messages endpoint: http://localhost:${PORT}/messages`);
});