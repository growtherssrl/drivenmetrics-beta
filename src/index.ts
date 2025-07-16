import express from "express";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  InitializeRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import dotenv from "dotenv";
import { createClient } from "@supabase/supabase-js";
import axios from "axios";
import crypto from "crypto";
import path from "path";
import cookieParser from "cookie-parser";

dotenv.config();

// Configuration
const PORT = process.env.PORT || 3000;
const SUPABASE_URL = process.env.SUPABASE_URL || "";
const SUPABASE_KEY = process.env.SUPABASE_KEY || "";
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || "";
const FB_APP_ID = process.env.FB_APP_ID || "";
const FB_APP_SECRET = process.env.FB_APP_SECRET || "";
const FB_GRAPH_VERSION = "v21.0";

// Initialize Supabase
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error("❌ ERROR: Supabase configuration missing!");
  console.error("  - SUPABASE_URL:", SUPABASE_URL ? "Set" : "Missing");
  console.error("  - SUPABASE_KEY:", SUPABASE_KEY ? "Set" : "Missing");
  console.error("  - Server requires proper Supabase configuration");
}

// Express app
const app = express();

// IMPORTANT: Body parsers must come FIRST before any middleware that might read the body
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

// Add request logging middleware AFTER body parsers
app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
  if (req.url.includes('well-known') || req.url.includes('authorize') || req.url.includes('token')) {
    console.log('Headers:', req.headers);
    console.log('Query:', req.query);
  }
  next();
});

app.set('view engine', 'ejs');
// Find the root directory (where package.json is)
// In dev: src/index.ts -> go up one level
// In prod: dist/index.js -> go up one level
const rootDir = path.join(__dirname, '..');
const templatesDir = path.join(rootDir, 'templates');
const publicDir = path.join(rootDir, 'public');

console.log('🔍 Directory paths:');
console.log('  - __dirname:', __dirname);
console.log('  - rootDir:', rootDir);
console.log('  - templatesDir:', templatesDir);
console.log('  - NODE_ENV:', process.env.NODE_ENV);

app.set('views', templatesDir);
app.use(express.static(publicDir));

// Store auth context by session ID
const authContext = new Map<string, { userId: string; token: string }>();

// OAuth state storage
const oauthStates = new Map<string, any>();

// Active sessions
const sessions = new Map<string, any>();

// Database helpers
async function getUserByToken(token: string): Promise<string | null> {
  if (!token) {
    console.log("[DB] getUserByToken: No token provided");
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

// Define base URL for all routes
const baseUrl = process.env.BASE_URL || (process.env.NODE_ENV === 'production' ? `https://mcp.drivenmetrics.com` : `http://localhost:${PORT}`);
console.log("🔗 Base URL configured as:", baseUrl);

// Global CORS handler for OPTIONS requests
app.options("*", (req, res) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.header("Access-Control-Allow-Headers", "Content-Type, Authorization");
  res.header("Access-Control-Allow-Credentials", "true");
  res.status(200).end();
});

// Health check endpoint
app.get("/health", (req, res) => {
  res.json({ status: "ok", service: "drivenmetrics-mcp" });
});

// Test authentication endpoint
app.get("/test-auth", async (req, res) => {
  const authHeader = req.headers.authorization;
  
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).json({ error: "No Bearer token provided" });
  }
  
  const token = authHeader.slice(7);
  const userId = await getUserByToken(token);
  
  if (!userId) {
    return res.status(401).json({ error: "Invalid token" });
  }
  
  res.json({ 
    authenticated: true, 
    user_id: userId,
    token: token.substring(0, 10) + "..."
  });
});

// Test OAuth flow endpoint
app.get("/test-oauth", (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html>
    <head>
      <title>Test OAuth Flow</title>
      <style>
        body { font-family: sans-serif; padding: 20px; background: #0a0a0a; color: #fff; }
        pre { background: #1a1a1a; padding: 15px; border-radius: 8px; overflow-x: auto; }
        button { background: #0066ff; color: white; border: none; padding: 10px 20px; border-radius: 5px; cursor: pointer; margin: 5px; }
        button:hover { background: #0052cc; }
      </style>
    </head>
    <body>
      <h1>Test OAuth Flow</h1>
      <button onclick="testNoAuth()">1. Test Without Auth</button>
      <button onclick="testWithAuth()">1b. Test With Auth</button>
      <button onclick="testMetadata()">2. Get OAuth Metadata</button>
      <button onclick="testAuthServer()">3. Get Auth Server Metadata</button>
      <button onclick="startOAuth()">4. Start OAuth Flow</button>
      <pre id="output"></pre>
      
      <script>
        const output = document.getElementById('output');
        const baseUrl = window.location.origin;
        
        async function testNoAuth() {
          const res = await fetch(baseUrl + '/mcp-api');
          const headers = {};
          res.headers.forEach((v, k) => headers[k] = v);
          output.textContent = 'Status: ' + res.status + '\\n' +
            'Headers: ' + JSON.stringify(headers, null, 2) + '\\n' +
            'Body: ' + await res.text();
        }
        
        async function testWithAuth() {
          const token = prompt('Enter your API token (dmgt_...):', 'dmgt_18c71aa09bed43e4ac9bad927516c44d');
          if (!token) return;
          
          const res = await fetch(baseUrl + '/mcp-api', {
            headers: {
              'Authorization': 'Bearer ' + token
            }
          });
          const headers = {};
          res.headers.forEach((v, k) => headers[k] = v);
          output.textContent = 'Status: ' + res.status + '\\n' +
            'Headers: ' + JSON.stringify(headers, null, 2) + '\\n' +
            'Body: ' + await res.text();
        }
        
        async function testMetadata() {
          const res = await fetch(baseUrl + '/.well-known/oauth-protected-resource/mcp-api');
          output.textContent = 'OAuth Metadata:\\n' + JSON.stringify(await res.json(), null, 2);
        }
        
        async function testAuthServer() {
          const res = await fetch(baseUrl + '/.well-known/oauth-authorization-server');
          output.textContent = 'Auth Server Metadata:\\n' + JSON.stringify(await res.json(), null, 2);
        }
        
        function startOAuth() {
          const state = Math.random().toString(36).substring(7);
          const challenge = Math.random().toString(36).substring(7);
          const params = new URLSearchParams({
            response_type: 'code',
            client_id: 'test-client',
            redirect_uri: baseUrl + '/test-oauth',
            state: state,
            scope: 'mcp',
            code_challenge: challenge,
            code_challenge_method: 'S256'
          });
          window.location.href = baseUrl + '/authorize?' + params;
        }
      </script>
    </body>
    </html>
  `);
});

// API info endpoint
app.get("/api/info", (req, res) => {
  res.json({ 
    service: "Drivenmetrics MCP Server",
    version: "1.0.0",
    endpoints: {
      mcp: "/mcp-api",
      oauth: {
        authorize: "/authorize",
        token: "/token"
      }
    }
  });
});

// OAuth metadata endpoint for root resource
app.get("/.well-known/oauth-protected-resource", (req, res) => {
  console.log("📋 OAuth metadata requested for root resource");
  res.header("Access-Control-Allow-Origin", "*");
  res.json({
    resource: baseUrl,
    oauth_authorization_server: baseUrl,
    oauth_scopes_supported: ["mcp"]
  });
});

// OAuth metadata endpoints
app.get("/.well-known/oauth-protected-resource/mcp-api/sse", (req, res) => {
  console.log("📋 OAuth metadata requested for /mcp-api/sse");
  res.header("Access-Control-Allow-Origin", "*");
  res.json({
    resource: `${baseUrl}/mcp-api/sse`,
    oauth_authorization_server: baseUrl,
    oauth_scopes_supported: ["mcp"],
    mcp_version: "2024-11-05"
  });
});

// OAuth metadata for /mcp-api endpoint
app.get("/.well-known/oauth-protected-resource/mcp-api", (req, res) => {
  console.log("📋 OAuth metadata requested for /mcp-api");
  console.log("Request headers:", req.headers);
  console.log("Request URL:", req.url);
  console.log("Base URL:", baseUrl);
  
  const response = {
    resource: `${baseUrl}/mcp-api`,
    oauth_authorization_server: baseUrl,
    oauth_scopes_supported: ["mcp"]
  };
  
  console.log("Sending OAuth metadata response:", response);
  
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.header("Access-Control-Allow-Headers", "Content-Type, Authorization");
  res.json(response);
});

app.get("/.well-known/oauth-authorization-server", (req, res) => {
  console.log("📋 OAuth authorization server metadata requested");
  console.log("Request headers:", req.headers);
  console.log("Base URL:", baseUrl);
  
  const response = {
    issuer: baseUrl,
    authorization_endpoint: `${baseUrl}/authorize`,
    token_endpoint: `${baseUrl}/token`,
    token_endpoint_auth_methods_supported: ["none"],
    response_types_supported: ["code"],
    scopes_supported: ["mcp"],
    code_challenge_methods_supported: ["S256"],
    grant_types_supported: ["authorization_code"]
  };
  
  console.log("Sending authorization server metadata:", response);
  
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.header("Access-Control-Allow-Headers", "Content-Type, Authorization");
  res.header("Content-Type", "application/json");
  
  res.json(response);
});

// Remove this endpoint - it might be confusing Claude
// OAuth authorization server should only be at the root

// Store active SSE transports by session ID  
const sseTransports = new Map<string, SSEServerTransport>();

// SSE endpoint for n8n and other SSE clients - MUST BE BEFORE the general /mcp-api handler
app.get("/mcp-api/sse", async (req, res) => {
  console.log("[SSE] New SSE connection request");
  
  // Extract auth token
  const authHeader = req.headers.authorization;
  let userId: string | null = null;
  
  if (authHeader && authHeader.startsWith("Bearer ")) {
    const token = authHeader.slice(7);
    userId = await getUserByToken(token);
    
    if (!userId) {
      console.log("[SSE] Invalid token - allowing anonymous connection");
      userId = null; // Allow connection but mark as anonymous
    }
  } else {
    console.log("[SSE] No authorization header - allowing anonymous connection");
    userId = null; // Allow connection but mark as anonymous
  }
  
  console.log("[SSE] Connection established for user:", userId || "anonymous");
  
  try {
    // IMPORTANT: Do NOT set any headers before creating the transport
    // The SSEServerTransport will handle all SSE headers
    
    // Create SSE transport with messages endpoint
    const transport = new SSEServerTransport('/mcp-api/messages', res);
    
    // Get the session ID generated by the transport
    const sessionId = (transport as any).sessionId;
    console.log("[SSE] Transport session ID:", sessionId);
    
    // Store the transport for message handling
    sseTransports.set(sessionId, transport);
    
    // Store auth info for this transport
    authContext.set(sessionId, { userId: userId || 'anonymous', token: authHeader?.slice(7) || '' });
    
    // Connect the transport to our MCP server
    await mcpServer.connect(transport);
    
    console.log("[SSE] MCP server connected for user:", userId || 'anonymous', "session:", sessionId);
    
    // Send initial notifications like the old server
    setTimeout(async () => {
      try {
        // Send initialized notification
        console.log("[SSE] Sending notifications/initialized");
        await transport.send({
          jsonrpc: "2.0",
          method: "notifications/initialized",
          params: {
            meta: {
              serverName: "drivenmetrics-mcp",
              serverVersion: "1.0.0"
            }
          }
        });
        
        // Small delay between notifications
        await new Promise(resolve => setTimeout(resolve, 100));
        
        // Send tools/list_changed notification
        console.log("[SSE] Sending notifications/tools/list_changed");
        await transport.send({
          jsonrpc: "2.0",
          method: "notifications/tools/list_changed",
          params: {}
        });
        
        console.log("[SSE] Initial notifications sent");
      } catch (error) {
        console.error("[SSE] Error sending initial notifications:", error);
      }
    }, 100); // Small delay to ensure connection is fully established
    
    // Handle connection close
    req.on('close', () => {
      const transportSessionId = (transport as any).sessionId;
      console.log("[SSE] Client disconnected, session:", transportSessionId);
      authContext.delete(transportSessionId);
      sseTransports.delete(transportSessionId);
      if (typeof (transport as any).close === 'function') {
        (transport as any).close();
      }
    });
    
  } catch (error) {
    console.error("[SSE] Error setting up transport:", error);
    // Even in error cases, check if headers were sent
    if (!res.headersSent) {
      res.status(500).json({ error: "Internal server error" });
    }
  }
});

// Handle SSE messages POST endpoint
app.post("/mcp-api/messages", express.json(), async (req, res, next) => {
  const sessionId = req.query.sessionId as string;
  
  if (!sessionId) {
    console.error("[SSE] No session ID in messages request");
    return res.status(400).json({
      jsonrpc: "2.0",
      error: { code: -32600, message: "Missing sessionId parameter" },
      id: req.body?.id || null
    });
  }
  
  const transport = sseTransports.get(sessionId);
  if (!transport) {
    console.error("[SSE] No transport found for session:", sessionId);
    return res.status(404).json({
      jsonrpc: "2.0", 
      error: { code: -32601, message: "Session not found" },
      id: req.body?.id || null
    });
  }
  
  console.log("[SSE] Forwarding message to transport for session:", sessionId);
  
  // Let the SSE transport handle the request
  // The transport expects handlePostMessage with body as third parameter
  try {
    await (transport as any).handlePostMessage(req, res, req.body);
  } catch (error) {
    console.error("[SSE] Error handling message:", error);
    if (!res.headersSent) {
      res.status(500).json({
        jsonrpc: "2.0",
        error: { code: -32603, message: "Internal error" },
        id: req.body?.id || null
      });
    }
  }
});

// IMPORTANT: Don't handle /mcp-api/messages manually - let SSE transport handle it

// Mount the MCP transport handler with authentication
app.use("/mcp-api", express.json(), async (req, res, next) => {
  // Skip authentication for SSE endpoints - they handle their own auth
  if ((req.path === '/sse' && req.method === 'GET') || 
      (req.path === '/messages' && req.method === 'POST')) {
    console.log("[MCP] Skipping auth middleware for SSE endpoints");
    return; // Don't call next() - let the specific handlers above handle these
  }
  
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
  let isAuthenticated = false;
  
  if (authHeader && authHeader.startsWith("Bearer ")) {
    const token = authHeader.slice(7);
    console.log("[AUTH] Token extracted:", token.substring(0, 10) + "...");
    
    const userId = await getUserByToken(token);
    console.log("[AUTH] User ID from token:", userId || "Not found");
    
    if (userId) {
      isAuthenticated = true;
      // Store auth info in global context if session ID is provided
      if (sessionId) {
        authContext.set(sessionId, { userId, token });
        console.log("[AUTH] Stored auth for session:", sessionId);
      } else {
        console.log("[AUTH] No session ID provided, but user authenticated");
      }
    }
  } else {
    console.log("[AUTH] No Bearer token in Authorization header");
  }
  
  // If not authenticated, return 401 with OAuth info
  if (!isAuthenticated) {
    console.log("[AUTH] Returning 401 Unauthorized with OAuth metadata link");
    res.status(401);
    res.header("WWW-Authenticate", `Bearer realm="${baseUrl}/mcp-api", error="invalid_token"`);
    res.header("Link", `<${baseUrl}/.well-known/oauth-protected-resource/mcp-api>; rel="oauth-protected-resource"`);
    res.header("Access-Control-Allow-Origin", "*");
    res.header("Access-Control-Expose-Headers", "Link, WWW-Authenticate");
    res.json({
      jsonrpc: "2.0",
      error: {
        code: -32001,
        message: "Authentication required"
      },
      id: null
    });
    return;
  }
  
  // Check if this is an OPTIONS request
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  
  // Handle GET requests differently - return server info
  if (req.method === 'GET') {
    console.log("[MCP] GET request - returning server info");
    res.json({
      name: "Drivenmetrics MCP Server",
      version: "1.0.0",
      protocol_version: "2025-06-18",
      capabilities: {
        tools: {
          listChanged: true
        }
      }
    });
    return;
  }
  
  // For POST requests, ensure we have a valid JSON-RPC body
  if (req.method === 'POST') {
    if (!req.body || typeof req.body !== 'object') {
      console.log("[MCP] Invalid request body:", req.body);
      res.status(400).json({
        jsonrpc: "2.0",
        error: {
          code: -32700,
          message: "Parse error"
        },
        id: null
      });
      return;
    }
    
    // Set session context for the transport
    const sessionId = req.headers["mcp-session-id"] as string || crypto.randomBytes(16).toString('hex');
    const userId = await getUserByToken(authHeader?.slice(7) || '');
    
    if (userId) {
      // Store auth context for this session
      authContext.set(sessionId, { userId, token: authHeader?.slice(7) || '' });
      
      // Set the session ID header for the transport
      req.headers["mcp-session-id"] = sessionId;
    }
  }
  
  // Handle the MCP request
  try {
    console.log("[MCP] Passing authenticated request to transport");
    console.log("[MCP] Method:", req.method);
    console.log("[MCP] Headers:", {
      'content-type': req.headers['content-type'],
      'mcp-session-id': req.headers['mcp-session-id']
    });
    console.log("[MCP] Request body:", JSON.stringify(req.body));
    
    await transport.handleRequest(req, res, req.body);
  } catch (error) {
    console.error("[MCP] Error handling request:", error);
    console.error("[MCP] Error stack:", error instanceof Error ? error.stack : 'No stack');
    
    if (!res.headersSent) {
      res.status(500).json({ 
        jsonrpc: "2.0", 
        error: { 
          code: -32603, 
          message: "Internal error",
          data: error instanceof Error ? error.message : "Unknown error"
        },
        id: null 
      });
    }
  }
});

// OAuth Authorization endpoint
app.get("/authorize", (req, res) => {
  const { 
    response_type,
    client_id,
    redirect_uri,
    state,
    code_challenge,
    code_challenge_method,
    scope
  } = req.query;
  
  console.log("🔐 OAuth authorize request:", { 
    response_type,
    client_id, 
    redirect_uri, 
    state,
    code_challenge: code_challenge ? "present" : "missing",
    code_challenge_method,
    scope
  });
  
  // Check for existing session
  const sessionId = req.cookies?.session_id;
  if (sessionId && sessions.has(sessionId)) {
    // User already logged in, generate code immediately
    const session = sessions.get(sessionId);
    const authCode = crypto.randomBytes(32).toString('hex');
    
    oauthStates.set(authCode, {
      client_id,
      redirect_uri,
      code_challenge,
      code_challenge_method,
      scope: scope || "mcp",
      user_id: session.user_id,
      created_at: Date.now()
    });
    
    // Redirect back with code
    const redirectUrl = new URL(redirect_uri as string);
    redirectUrl.searchParams.set('code', authCode);
    redirectUrl.searchParams.set('state', state as string);
    
    console.log("✅ User already authenticated, redirecting with code");
    return res.redirect(redirectUrl.toString());
  }
  
  // Store OAuth state for after login
  const stateId = crypto.randomBytes(16).toString('hex');
  oauthStates.set(stateId, {
    response_type,
    client_id,
    redirect_uri,
    state,
    code_challenge,
    code_challenge_method,
    scope
  });
  
  // Show login page using template or fallback
  try {
    res.render('login_oauth', {
      oauth_state: stateId,
      next_url: null,
      error: null,
      supabase: !!supabase
    });
  } catch (err) {
    console.error('OAuth login template error:', err);
    // Fallback HTML for OAuth flow
    res.send(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>Authorize - Drivenmetrics</title>
        <style>
          body { font-family: sans-serif; background: #0a0a0a; color: white; display: flex; justify-content: center; align-items: center; height: 100vh; margin: 0; }
          .login-box { background: #1a1a1a; padding: 2rem; border-radius: 12px; width: 300px; }
          h2 { text-align: center; }
          input { width: 100%; padding: 0.75rem; margin: 0.5rem 0; border: 1px solid #333; background: #0a0a0a; color: white; border-radius: 4px; box-sizing: border-box; }
          button { width: 100%; padding: 0.75rem; background: #0066ff; color: white; border: none; border-radius: 4px; cursor: pointer; }
          .info { text-align: center; margin-top: 1rem; color: #666; font-size: 0.9rem; }
        </style>
      </head>
      <body>
        <div class="login-box">
          <h2>Sign in to Drivenmetrics</h2>
          <p style="text-align: center; color: #999;">Authorize Claude.ai to access your account</p>
          <form method="POST" action="/login">
            <input type="hidden" name="state" value="${stateId}">
            <input type="email" name="email" placeholder="Email" required>
            <input type="password" name="password" placeholder="Password" required>
            <button type="submit">Authorize</button>
          </form>
          ${!supabase ? '<div class="info">Demo mode: Use any email/password</div>' : ''}
        </div>
      </body>
      </html>
    `);
  }
});

// Login endpoint
app.post("/login", express.urlencoded({ extended: true }), async (req, res) => {
  const { email, password, state, mode } = req.body;
  
  console.log("🔐 Auth attempt:", { email, state, mode: mode || 'login' });
  
  // In demo mode or with Supabase
  let userId = null;
  let isNewUser = false;
  
  if (supabase) {
    // Real authentication with Supabase
    try {
      if (mode === 'register') {
        // Registration
        const { data, error } = await supabase.auth.signUp({ 
          email, 
          password,
          options: {
            emailRedirectTo: `${baseUrl}/auth/confirm`
          }
        });
        if (error) {
          console.error("Registration error:", error);
          return res.render('login_oauth', {
            oauth_state: state,
            next_url: req.body.next_url,
            error: error.message,
            supabase: !!supabase
          });
        }
        if (data?.user) {
          userId = data.user.id;
          isNewUser = true;
          
          // Create user in our users table
          try {
            await supabase
              .from("users")
              .insert({
                user_id: userId,
                email: email,
                created_at: new Date().toISOString(),
                updated_at: new Date().toISOString()
              });
          } catch (err) {
            console.error("Error creating user:", err);
          }
        }
      } else {
        // Login
        const { data, error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) {
          console.error("Login error:", error);
          return res.render('login_oauth', {
            oauth_state: state,
            next_url: req.body.next_url,
            error: error.message,
            supabase: !!supabase
          });
        }
        if (data?.user) {
          userId = data.user.id;
          
          // Ensure user exists in our users table
          try {
            await supabase
              .from("users")
              .upsert({
                user_id: userId,
                email: email,
                updated_at: new Date().toISOString()
              }, {
                onConflict: 'user_id'
              });
          } catch (err) {
            console.error("Error upserting user:", err);
          }
        }
      }
    } catch (error) {
      console.error("Auth error:", error);
      return res.render('login_oauth', {
        oauth_state: state,
        next_url: req.body.next_url,
        error: "Authentication failed",
        supabase: !!supabase
      });
    }
  }
  
  if (!userId) {
    return res.render('login_oauth', {
      oauth_state: state,
      next_url: req.body.next_url,
      error: "Invalid credentials",
      supabase: !!supabase
    });
  }
  
  // If registration and confirmation required
  if (isNewUser && supabase) {
    return res.render('login_oauth', {
      oauth_state: state,
      next_url: req.body.next_url,
      message: "Registration successful! Please check your email to confirm your account.",
      supabase: !!supabase
    });
  }
  
  // Create session
  const sessionId = crypto.randomBytes(32).toString('hex');
  sessions.set(sessionId, {
    user_id: userId,
    email: email,
    created_at: Date.now()
  });
  
  // Set session cookie
  res.cookie('session_id', sessionId, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    maxAge: 24 * 60 * 60 * 1000 // 24 hours
  });
  
  // Get OAuth state
  const oauthState = oauthStates.get(state);
  if (!oauthState) {
    // Regular login without OAuth flow
    return res.redirect(req.body.next_url || '/dashboard');
  }
  
  // Generate authorization code
  const authCode = crypto.randomBytes(32).toString('hex');
  oauthStates.set(authCode, {
    ...oauthState,
    user_id: userId,
    created_at: Date.now()
  });
  
  // Clean up state
  oauthStates.delete(state);
  
  // Redirect back with code
  const redirectUrl = new URL(oauthState.redirect_uri);
  redirectUrl.searchParams.set('code', authCode);
  redirectUrl.searchParams.set('state', oauthState.state);
  
  console.log("✅ Auth successful, redirecting with code");
  res.redirect(redirectUrl.toString());
});

// Token endpoint
app.post("/token", express.urlencoded({ extended: true }), async (req, res) => {
  const { grant_type, code, redirect_uri, code_verifier } = req.body;
  
  console.log("🔐 Token request:", { grant_type, code: code?.substring(0, 10) + "..." });
  
  if (grant_type !== "authorization_code") {
    return res.status(400).json({ error: "unsupported_grant_type" });
  }
  
  const codeData = oauthStates.get(code);
  if (!codeData) {
    return res.status(400).json({ error: "invalid_grant" });
  }
  
  // Verify code challenge if present
  if (codeData.code_challenge && codeData.code_challenge_method === "S256") {
    const verifier = crypto.createHash('sha256').update(code_verifier).digest('base64url');
    if (verifier !== codeData.code_challenge) {
      return res.status(400).json({ error: "invalid_grant" });
    }
  }
  
  // Get the API token from the code data
  const accessToken = codeData.api_token || `dmgt_${crypto.randomBytes(32).toString('hex')}`;
  
  // If token wasn't stored in code data, save it to database
  if (!codeData.api_token && supabase && codeData.user_id) {
    try {
      await supabase
        .from("api_tokens")
        .insert({
          token: accessToken,
          user_id: codeData.user_id,
          scopes: [codeData.scope || "mcp"],
          created_at: new Date().toISOString()
        });
    } catch (error) {
      console.error("Error saving token:", error);
    }
  }
  
  // Clean up code
  oauthStates.delete(code);
  
  res.json({
    access_token: accessToken,
    token_type: "Bearer",
    expires_in: 7200,
    scope: codeData.scope || "mcp"
  });
});

// Standalone login page
app.get("/login", (req, res) => {
  try {
    res.render('login_oauth', {
      oauth_state: null,
      next_url: req.query.next || '/',
      error: null,
      supabase: !!supabase
    });
  } catch (err) {
    console.error('Template render error:', err);
    // Fallback HTML if template fails
    res.send(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>Login - Drivenmetrics</title>
        <style>
          body { font-family: sans-serif; background: #0a0a0a; color: white; display: flex; justify-content: center; align-items: center; height: 100vh; margin: 0; }
          .login-box { background: #1a1a1a; padding: 2rem; border-radius: 12px; width: 300px; }
          input { width: 100%; padding: 0.75rem; margin: 0.5rem 0; border: 1px solid #333; background: #0a0a0a; color: white; border-radius: 4px; }
          button { width: 100%; padding: 0.75rem; background: #0066ff; color: white; border: none; border-radius: 4px; cursor: pointer; }
          button:hover { background: #0052cc; }
          .info { text-align: center; margin-top: 1rem; color: #666; font-size: 0.9rem; }
        </style>
      </head>
      <body>
        <div class="login-box">
          <h2>Login to Drivenmetrics</h2>
          <form method="POST" action="/login">
            <input type="hidden" name="state" value="">
            <input type="hidden" name="next_url" value="${req.query.next || '/'}">
            <input type="email" name="email" placeholder="Email" required>
            <input type="password" name="password" placeholder="Password" required>
            <button type="submit">Sign In</button>
          </form>
          ${!supabase ? '<div class="info">Demo mode: Use any email/password</div>' : ''}
        </div>
      </body>
      </html>
    `);
  }
});

// Home page
app.get("/", (req, res) => {
  const sessionId = req.cookies?.session_id;
  const session = sessionId ? sessions.get(sessionId) : null;
  
  // Redirect logged-in users to dashboard
  if (session) {
    return res.redirect('/dashboard');
  }
  
  try {
    res.render('index', {
      user: session
    });
  } catch (err) {
    // Fallback to JSON response if template fails
    res.json({
      service: "drivenmetrics-mcp",
      status: "running",
      endpoints: {
        mcp: "/mcp-api",
        health: "/health",
        oauth_metadata: "/.well-known/oauth-protected-resource/mcp-api/sse"
      },
      user: session ? { email: session.email } : null
    });
  }
});

// Dashboard page
app.get("/dashboard", async (req, res) => {
  console.log("[DASHBOARD] Request received");
  console.log("[DASHBOARD] Cookies:", req.cookies);
  
  const sessionId = req.cookies?.session_id;
  console.log("[DASHBOARD] Session ID:", sessionId);
  console.log("[DASHBOARD] Active sessions:", Array.from(sessions.keys()));
  
  if (!sessionId || !sessions.has(sessionId)) {
    console.log("[DASHBOARD] No valid session, redirecting to login");
    return res.redirect('/login');
  }
  
  const session = sessions.get(sessionId);
  const userId = session.user_id;
  
  // Check integrations status
  let hasFacebook = false;
  let hasClaude = false;
  let apiCalls = 0;
  let apiToken = null;
  
  if (supabase) {
    try {
      // Check Facebook connection
      const { data: fbData } = await supabase
        .from("facebook_tokens")
        .select("access_token")
        .eq("user_id", userId)
        .eq("service", "competition")
        .single();
      hasFacebook = !!fbData;
      
      // Check Claude connection (API tokens)
      const { data: tokenData } = await supabase
        .from("api_tokens")
        .select("token")
        .eq("user_id", userId)
        .order("created_at", { ascending: false })
        .limit(1);
      hasClaude = !!(tokenData && tokenData.length > 0);
      
      // Get the actual token to display
      if (tokenData && tokenData.length > 0) {
        apiToken = tokenData[0].token;
      }
      
      // Get API call count (if table exists)
      try {
        const today = new Date().toISOString().split('T')[0];
        const { data: callData } = await supabase
          .from("api_usage")
          .select("count")
          .eq("user_id", userId)
          .eq("date", today)
          .single();
        apiCalls = callData?.count || 0;
      } catch (e) {
        // API usage table might not exist
      }
    } catch (error) {
      console.log("Error fetching integration status:", error);
    }
  }
  
  try {
    res.render('dashboard', {
      user: session,
      has_facebook: hasFacebook,
      has_claude: hasClaude,
      api_calls: apiCalls,
      api_token: apiToken
    });
  } catch (err) {
    console.error('Dashboard template error:', err);
    // Fallback HTML
    res.send(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>Dashboard - Drivenmetrics</title>
        <style>
          body { font-family: sans-serif; background: #0a0a0a; color: white; padding: 20px; }
          .container { max-width: 800px; margin: 0 auto; }
          .header { background: #1a1a1a; padding: 20px; border-radius: 12px; margin-bottom: 20px; }
          .card { background: #1a1a1a; padding: 20px; border-radius: 12px; margin: 20px 0; }
          a { color: #0066ff; text-decoration: none; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1>Dashboard</h1>
            <p>Welcome back, ${session.email}</p>
          </div>
          <div class="card">
            <h2>Integration Status</h2>
            <p>Facebook: ${hasFacebook ? '✅ Connected' : '❌ Not Connected'}</p>
            <p>Claude.ai: ${hasClaude ? '✅ Connected' : '❌ Not Connected'}</p>
          </div>
          <div class="card">
            <a href="/setup/integrations">Manage Integrations</a> | 
            <a href="/logout">Logout</a>
          </div>
        </div>
      </body>
      </html>
    `);
  }
});

// Logout route
app.get("/logout", (req, res) => {
  const sessionId = req.cookies?.session_id;
  if (sessionId) {
    sessions.delete(sessionId);
    res.clearCookie('session_id');
  }
  res.redirect('/');
});

// Generate API token endpoint
app.post("/api/generate-token", async (req, res) => {
  const sessionId = req.cookies?.session_id;
  if (!sessionId || !sessions.has(sessionId)) {
    return res.status(401).json({ error: "Not authenticated" });
  }
  
  const session = sessions.get(sessionId);
  const userId = session.user_id;
  
  // Generate a new API token
  const apiToken = `dmgt_${crypto.randomBytes(32).toString('hex')}`;
  
  // Save token to database
  if (supabase) {
    try {
      await supabase
        .from("api_tokens")
        .insert({
          token: apiToken,
          user_id: userId,
          scopes: ["mcp"],
          created_at: new Date().toISOString()
        });
      console.log("✅ API token generated for user:", userId);
    } catch (error) {
      console.error("Error saving token:", error);
      return res.status(500).json({ error: "Failed to save token" });
    }
  }
  
  res.json({ 
    token: apiToken,
    message: "Token generated successfully. Use this token in Claude.ai when adding the Drivenmetrics server."
  });
});

// Setup integrations page
app.get("/setup/integrations", async (req, res) => {
  const sessionId = req.cookies?.session_id;
  if (!sessionId || !sessions.has(sessionId)) {
    return res.redirect('/login?next=/setup/integrations');
  }
  
  const session = sessions.get(sessionId);
  const userId = session.user_id;
  
  // Check if user has Facebook token
  let hasFacebook = false;
  if (supabase) {
    try {
      const { data } = await supabase
        .from("facebook_tokens")
        .select("access_token")
        .eq("user_id", userId)
        .eq("service", "competition")
        .single();
      hasFacebook = !!data;
    } catch (error) {
      console.log("No Facebook token found");
    }
  } else {
    // Demo mode - simulate Facebook connected
    hasFacebook = true;
  }
  
  const fbRedirectUri = `${baseUrl}/api/authorise/facebook/callback`;
  
  try {
    res.render('setup_integrations', {
      user: session,
      has_facebook: hasFacebook,
      oauth_state: req.query.oauth_state,
      success: req.query.success,
      error: req.query.error,
      fb_app_id: FB_APP_ID,
      fb_redirect_uri: fbRedirectUri
    });
  } catch (err) {
    console.error('Template render error:', err);
    // Fallback HTML
    res.send(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>Integrations - Drivenmetrics</title>
        <style>
          body { font-family: sans-serif; background: #0a0a0a; color: white; padding: 20px; }
          .container { max-width: 800px; margin: 0 auto; }
          .card { background: #1a1a1a; padding: 20px; border-radius: 12px; margin: 20px 0; }
          button { background: #0066ff; color: white; border: none; padding: 10px 20px; border-radius: 8px; cursor: pointer; }
          .success { color: #4ade80; }
        </style>
      </head>
      <body>
        <div class="container">
          <h1>Integrations</h1>
          ${req.query.oauth_state ? `
            <div class="card">
              <h2>✅ Ready to Connect with Claude.ai</h2>
              <p>Your account is set up. Click below to complete the connection.</p>
              <button onclick="window.location.href='/api/complete-oauth/${req.query.oauth_state}'">
                Continue with Claude AI
              </button>
            </div>
          ` : ''}
          <div class="card">
            <h2>Facebook Ads ${hasFacebook ? '<span class="success">✓ Connected</span>' : '❌ Not Connected'}</h2>
            ${!hasFacebook && FB_APP_ID ? `
              <button onclick="window.location.href='/api/authorise/facebook/start'">
                Connect Facebook
              </button>
            ` : ''}
          </div>
        </div>
      </body>
      </html>
    `);
  }
});

// Facebook OAuth start
app.get("/api/authorise/facebook/start", (req, res) => {
  const sessionId = req.cookies?.session_id;
  if (!sessionId || !sessions.has(sessionId)) {
    return res.redirect('/login?next=/api/authorise/facebook/start');
  }
  
  if (!FB_APP_ID) {
    return res.status(500).send("Facebook App ID not configured");
  }
  
  // Generate state for CSRF protection
  const fbState = crypto.randomBytes(16).toString('hex');
  
  // Store state linked to session, including any pending OAuth state
  oauthStates.set(fbState, {
    session_id: sessionId,
    type: 'facebook',
    created_at: Date.now(),
    pending_oauth_state: req.query.oauth_state // Preserve OAuth state for Claude.ai
  });
  
  // Build Facebook OAuth URL
  const params = new URLSearchParams({
    client_id: FB_APP_ID,
    redirect_uri: `${baseUrl}/api/authorise/facebook/callback`,
    scope: 'public_profile,email',
    state: fbState,
    response_type: 'code'
  });
  
  const fbAuthUrl = `https://www.facebook.com/v${FB_GRAPH_VERSION}/dialog/oauth?${params}`;
  console.log("🔐 Redirecting to Facebook OAuth:", fbAuthUrl);
  
  res.redirect(fbAuthUrl);
});

// Facebook OAuth callback
app.get("/api/authorise/facebook/callback", async (req, res) => {
  const { code, state, error } = req.query;
  
  // Verify state
  const stateData = oauthStates.get(state as string);
  if (!stateData || stateData.type !== 'facebook') {
    console.error("Invalid Facebook OAuth state");
    return res.redirect("/setup/integrations?error=invalid_state");
  }
  
  const sessionId = req.cookies?.session_id;
  if (!sessionId || !sessions.has(sessionId)) {
    return res.redirect('/login');
  }
  
  const session = sessions.get(sessionId);
  const userId = session.user_id;
  
  // Clean up state
  oauthStates.delete(state as string);
  
  if (error) {
    console.error("Facebook auth error:", error);
    return res.redirect("/setup/integrations?error=facebook_denied");
  }
  
  if (code && FB_APP_ID && FB_APP_SECRET) {
    try {
      // Exchange code for token
      const tokenResponse = await axios.get(
        `https://graph.facebook.com/${FB_GRAPH_VERSION}/oauth/access_token`,
        {
          params: {
            client_id: FB_APP_ID,
            client_secret: FB_APP_SECRET,
            redirect_uri: `${baseUrl}/api/authorise/facebook/callback`,
            code: code
          }
        }
      );
      
      const { access_token } = tokenResponse.data;
      
      if (access_token && supabase) {
        // Save Facebook token
        await supabase
          .from("facebook_tokens")
          .upsert({
            user_id: userId,
            access_token: access_token,
            service: "competition",
            updated_at: new Date().toISOString()
          });
        
        console.log("✅ Facebook token saved for user:", userId);
      }
      
      // Check if there's a pending OAuth flow from the original state
      const pendingOauth = stateData.pending_oauth_state;
      if (pendingOauth) {
        return res.redirect(`/setup/integrations?success=facebook&oauth_state=${pendingOauth}`);
      }
      
      return res.redirect("/setup/integrations?success=facebook");
    } catch (error) {
      console.error("Facebook token exchange error:", error);
      return res.redirect("/setup/integrations?error=facebook_failed");
    }
  }
  
  return res.redirect("/setup/integrations");
});

// Disconnect Facebook
app.post("/api/disconnect-facebook", async (req, res) => {
  const sessionId = req.cookies?.session_id;
  if (!sessionId || !sessions.has(sessionId)) {
    return res.status(401).json({ error: "Not authenticated" });
  }
  
  const session = sessions.get(sessionId);
  const userId = session.user_id;
  
  if (supabase) {
    try {
      await supabase
        .from("facebook_tokens")
        .delete()
        .eq("user_id", userId)
        .eq("service", "competition");
      console.log("✅ Facebook token deleted for user:", userId);
    } catch (error) {
      console.error("Error deleting Facebook token:", error);
      return res.status(500).json({ error: "Failed to disconnect Facebook" });
    }
  }
  
  res.json({ success: true, message: "Facebook disconnected successfully" });
});

// Complete OAuth flow from integrations page
app.get("/api/complete-oauth/:oauth_state", async (req, res) => {
  const { oauth_state } = req.params;
  
  const sessionId = req.cookies?.session_id;
  if (!sessionId || !sessions.has(sessionId)) {
    return res.redirect('/login');
  }
  
  const session = sessions.get(sessionId);
  const userId = session.user_id;
  const oauthData = oauthStates.get(oauth_state);
  
  if (!oauthData) {
    return res.status(400).send("Invalid OAuth state");
  }
  
  // Check if user has an API token
  let apiToken = null;
  try {
    const { data: tokenData } = await supabase
      .from("api_tokens")
      .select("token")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(1);
    
    if (tokenData && tokenData.length > 0) {
      apiToken = tokenData[0].token;
    }
  } catch (error) {
    console.error("Error fetching token:", error);
  }
  
  if (!apiToken) {
    // Generate a new token if user doesn't have one
    apiToken = `dmgt_${crypto.randomBytes(32).toString('hex')}`;
    try {
      await supabase
        .from("api_tokens")
        .insert({
          token: apiToken,
          user_id: userId,
          scopes: ["mcp"],
          created_at: new Date().toISOString()
        });
      console.log("✅ API token auto-generated for OAuth flow");
    } catch (error) {
      console.error("Error saving token:", error);
      return res.status(500).send("Error generating API token");
    }
  }
  
  // Generate authorization code for Claude
  const authCode = crypto.randomBytes(32).toString('hex');
  
  // Store auth code with user info
  oauthStates.set(authCode, {
    ...oauthData,
    user_id: userId,
    api_token: apiToken,
    created_at: Date.now()
  });
  
  // Clean up original state
  oauthStates.delete(oauth_state);
  
  // Redirect back to Claude with auth code
  const redirectUrl = new URL(oauthData.redirect_uri);
  redirectUrl.searchParams.set('code', authCode);
  redirectUrl.searchParams.set('state', oauthData.state);
  
  console.log("✅ Completing OAuth flow, redirecting to Claude.ai");
  res.redirect(redirectUrl.toString());
});

// Error handling middleware
app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
  console.error('Error:', err);
  res.status(500).send(`
    <html>
      <body style="font-family: sans-serif; padding: 20px;">
        <h1>Server Error</h1>
        <p>Sorry, something went wrong.</p>
        ${process.env.NODE_ENV !== 'production' ? `<pre>${err.stack}</pre>` : ''}
      </body>
    </html>
  `);
});

// Start server
app.listen(PORT, () => {
  console.log(`🚀 MCP Server running on port ${PORT}`);
  console.log(`📡 MCP HTTP endpoint: http://localhost:${PORT}/mcp-api`);
  console.log(`📡 MCP SSE endpoint: http://localhost:${PORT}/mcp-api/sse`);
  console.log(`🔐 OAuth server: ${baseUrl}`);
  console.log(`📁 Template directory: ${templatesDir}`);
  console.log(`✅ Ready for Claude.ai and n8n connections!`);
});