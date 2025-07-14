import express from "express";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
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
const supabase = SUPABASE_URL && SUPABASE_KEY && SUPABASE_KEY !== "your-supabase-service-key" 
  ? createClient(SUPABASE_URL, SUPABASE_KEY) 
  : null;

// Demo mode warning
if (!supabase) {
  console.log("⚠️ WARNING: Supabase client not initialized");
  console.log("  - SUPABASE_URL:", SUPABASE_URL ? "Set" : "Missing");
  console.log("  - SUPABASE_KEY:", SUPABASE_KEY === "your-supabase-service-key" ? "Using placeholder" : (SUPABASE_KEY ? "Set" : "Missing"));
  console.log("  - Server will run in DEMO MODE");
  console.log("  - Demo tokens: dmgt_demo_token");
}

// Express app
const app = express();

// Store auth context by session ID
const authContext = new Map<string, { userId: string; token: string }>();

// Database helpers
async function getUserByToken(token: string): Promise<string | null> {
  if (!token) {
    console.log("[DB] getUserByToken: No token provided");
    return null;
  }
  
  // Demo mode - accept demo tokens
  if (!supabase) {
    if (token === "dmgt_demo_token" || token.startsWith("dmgt_demo_")) {
      console.log("[DB] Demo mode: Accepting demo token");
      return "demo_user";
    }
    console.log("[DB] Demo mode: Invalid token");
    return null;
  }
  
  try {
    console.log("[DB] Looking up token in database:", token.substring(0, 10) + "...");
    const { data, error } = await supabase
      .from("api_tokens")
      .select("user_id")
      .eq("token", token)
      .single();
    
    if (error) {
      console.error("[DB] Database error:", error);
      return null;
    }
    
    console.log("[DB] Token lookup result:", data ? "User found" : "User not found");
    return data?.user_id || null;
  } catch (error) {
    console.error("[DB] Error getting user:", error);
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

mcpServer.setRequestHandler(CallToolRequestSchema, async (request, extra) => {
  const { name, arguments: args } = request.params;
  
  console.log("[TOOL] Tool called:", name, "with args:", args);
  console.log("[TOOL] Extra object:", extra ? Object.keys(extra) : "No extra");
  
  // Try multiple ways to get session ID
  let sessionId = null;
  
  // Method 1: From request metadata
  if ((request as any)._meta?.sessionId) {
    sessionId = (request as any)._meta.sessionId;
    console.log("[TOOL] Session ID from _meta:", sessionId);
  }
  
  // Method 2: From extra parameter
  if (!sessionId && (extra as any)?.sessionId) {
    sessionId = (extra as any).sessionId;
    console.log("[TOOL] Session ID from extra:", sessionId);
  }
  
  // Method 3: Get the most recent session from authContext
  if (!sessionId && authContext.size > 0) {
    // Get the last entry
    const entries = Array.from(authContext.entries());
    sessionId = entries[entries.length - 1][0];
    console.log("[TOOL] Using most recent session:", sessionId);
  }
  
  // Get auth from context
  let auth = null;
  if (sessionId) {
    auth = authContext.get(sessionId);
  }
  
  console.log("[TOOL] Auth found:", auth ? { userId: auth.userId, hasToken: !!auth.token } : "No auth");
  
  const userId = auth?.userId || null;
  const fbToken = userId ? await getFacebookToken(userId) : null;
  console.log("[TOOL] Tool execution context:", { userId, hasFbToken: !!fbToken });
  
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
          const params: any = {
            ad_type: "POLITICAL_AND_ISSUE_ADS",
            ad_active_status: "ALL",
            search_terms: args?.keywords || "",
            limit: args?.limit || 10,
          };
          if (args?.country && args.country !== "ALL") {
            params.ad_reached_countries = args.country;
          }
          const fbResult = await fetchAdsFromFacebook(params, fbToken);
          result = fbResult.error ? fbResult : {
            keywords: args?.keywords || "",
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
            search_page_ids: args?.page_id || "",
            limit: args?.limit || 25,
          };
          const fbResult = await fetchAdsFromFacebook(params, fbToken);
          result = fbResult.error ? fbResult : {
            page_id: args?.page_id || "",
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


// Create transport with session management
const transport = new StreamableHTTPServerTransport({
  sessionIdGenerator: () => Math.random().toString(36).substring(2, 15),
});

// Connect server to transport
mcpServer.connect(transport);

// Global CORS handler for OPTIONS requests
app.options("*", (req, res) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.header("Access-Control-Allow-Headers", "Content-Type, Authorization");
  res.header("Access-Control-Allow-Credentials", "true");
  res.status(200).end();
});

// Express routes
app.get("/", (req, res) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.json({ 
    service: "drivenmetrics-mcp",
    status: "running",
    endpoints: {
      mcp: "/mcp-api",
      health: "/health",
      oauth_metadata: "/.well-known/oauth-protected-resource/mcp-api/sse"
    }
  });
});

app.get("/health", (req, res) => {
  res.json({ status: "ok", service: "drivenmetrics-mcp" });
});

// OAuth metadata endpoints
app.get("/.well-known/oauth-protected-resource/mcp-api/sse", (req, res) => {
  console.log("📋 OAuth metadata requested for /mcp-api/sse");
  res.header("Access-Control-Allow-Origin", "*");
  res.json({
    resource: `${process.env.BASE_URL || `https://drivenmetrics-mcp.onrender.com`}/mcp-api/sse`,
    oauth_authorization_server: "https://auth.drivenmetrics.com",
    oauth_scopes_supported: ["mcp"],
    mcp_version: "2024-11-05"
  });
});

app.get("/.well-known/oauth-authorization-server", (req, res) => {
  console.log("📋 OAuth authorization server metadata requested");
  res.header("Access-Control-Allow-Origin", "*");
  res.json({
    issuer: "https://auth.drivenmetrics.com",
    authorization_endpoint: "https://auth.drivenmetrics.com/authorize",
    token_endpoint: "https://auth.drivenmetrics.com/token",
    token_endpoint_auth_methods_supported: ["none"],
    response_types_supported: ["code"],
    scopes_supported: ["mcp"],
    code_challenge_methods_supported: ["S256"],
    grant_types_supported: ["authorization_code"]
  });
});

// Mount the MCP transport handler with authentication
app.use("/mcp-api", express.json(), async (req, res, next) => {
  console.log("[AUTH] MCP Request received:", {
    method: req.method,
    path: req.path,
    headers: {
      authorization: req.headers.authorization ? "Bearer ***" : "None",
      contentType: req.headers["content-type"],
      sessionId: req.headers["mcp-session-id"] || "None"
    }
  });
  
  // Extract session ID
  const sessionId = req.headers["mcp-session-id"] as string;
  
  // Extract auth token from headers
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith("Bearer ")) {
    const token = authHeader.slice(7);
    console.log("[AUTH] Token extracted:", token.substring(0, 10) + "...");
    
    const userId = await getUserByToken(token);
    console.log("[AUTH] User ID from token:", userId || "Not found");
    
    if (userId && sessionId) {
      // Store auth info in global context
      authContext.set(sessionId, { userId, token });
      console.log("[AUTH] Stored auth for session:", sessionId);
    }
  } else {
    console.log("[AUTH] No Bearer token in Authorization header");
  }
  
  // Handle the MCP request
  await transport.handleRequest(req, res, req.body);
});

// Legacy endpoint redirects
app.get("/mcp-api/sse", (req, res) => {
  res.redirect("/mcp-api");
});

// Start server
app.listen(PORT, () => {
  console.log(`🚀 MCP Server running on port ${PORT}`);
  console.log(`📡 MCP endpoint: http://localhost:${PORT}/mcp-api`);
  console.log(`🔐 OAuth server: https://auth.drivenmetrics.com`);
  console.log(`✅ Ready for Claude.ai connections!`);
});