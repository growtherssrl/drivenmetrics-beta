"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const index_js_1 = require("@modelcontextprotocol/sdk/server/index.js");
const streamableHttp_js_1 = require("@modelcontextprotocol/sdk/server/streamableHttp.js");
const sse_js_1 = require("@modelcontextprotocol/sdk/server/sse.js");
const types_js_1 = require("@modelcontextprotocol/sdk/types.js");
const dotenv_1 = __importDefault(require("dotenv"));
const supabase_js_1 = require("@supabase/supabase-js");
const axios_1 = __importDefault(require("axios"));
const crypto_1 = __importDefault(require("crypto"));
const path_1 = __importDefault(require("path"));
const cookie_parser_1 = __importDefault(require("cookie-parser"));
dotenv_1.default.config();
// Helper function to detect Supabase key type
function getSupabaseKeyType(key) {
    if (!key || !key.startsWith('eyJ')) {
        return 'unknown';
    }
    try {
        // JWT tokens have 3 parts separated by dots: header.payload.signature
        const parts = key.split('.');
        if (parts.length !== 3) {
            return 'unknown';
        }
        // Decode the payload (second part)
        const payload = JSON.parse(Buffer.from(parts[1], 'base64').toString('utf-8'));
        // Check the role claim
        if (payload.role === 'anon') {
            return 'anon';
        }
        else if (payload.role === 'service_role') {
            return 'service_role';
        }
        return 'unknown';
    }
    catch (error) {
        console.error('Error decoding JWT:', error);
        return 'unknown';
    }
}
// Configuration
const PORT = process.env.PORT || 3000;
const SUPABASE_URL = process.env.SUPABASE_URL || "";
const SUPABASE_KEY = process.env.SUPABASE_KEY || "";
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || "";
const FB_APP_ID = process.env.FB_APP_ID || "";
const FB_APP_SECRET = process.env.FB_APP_SECRET || "";
const FB_GRAPH_VERSION = "v21.0";
const DEFAULT_AD_COUNTRY = process.env.DEFAULT_AD_COUNTRY || "IT"; // Default country for ad searches
// Initialize Supabase with service role key
const supabase = (0, supabase_js_1.createClient)(SUPABASE_URL, SUPABASE_KEY, {
    auth: {
        autoRefreshToken: false,
        persistSession: false
    },
    db: {
        schema: 'public'
    },
    global: {
        headers: {
            'apikey': SUPABASE_KEY
        }
    }
});
if (!SUPABASE_URL || !SUPABASE_KEY) {
    console.error("❌ ERROR: Supabase configuration missing!");
    console.error("  - SUPABASE_URL:", SUPABASE_URL ? "Set" : "Missing");
    console.error("  - SUPABASE_KEY:", SUPABASE_KEY ? "Set" : "Missing");
    console.error("  - Server requires proper Supabase configuration");
}
else {
    // Log key type for debugging (first 20 chars only for security)
    const keyType = getSupabaseKeyType(SUPABASE_KEY);
    console.log("✅ Supabase initialized with key starting:", SUPABASE_KEY.substring(0, 20) + "...");
    console.log("  - Key length:", SUPABASE_KEY.length);
    console.log("  - Key type detected:", keyType.toUpperCase());
    if (keyType === 'anon') {
        console.error("  - ⚠️  WARNING: You are using an ANON key! This will cause RLS permission errors.");
        console.error("  - ⚠️  You MUST use the SERVICE ROLE key for this server to work properly.");
        console.error("  - ⚠️  Find your service role key in Supabase Dashboard > Settings > API > service_role (secret)");
    }
    else if (keyType === 'service_role') {
        console.log("  - ✅ Correct key type! Using SERVICE ROLE key as required.");
    }
    else {
        console.log("  - ⚠️  Could not determine key type. Make sure you're using the SERVICE ROLE key!");
    }
    // Test database access
    (async () => {
        try {
            // Test read access
            const { data: readData, error: readError } = await supabase
                .from("api_tokens")
                .select("token")
                .limit(1);
            if (readError) {
                console.error("❌ Database READ test failed:", readError);
            }
            else {
                console.log("✅ Database connection verified - can read api_tokens table");
            }
            // Test write access to facebook_tokens
            const testData = {
                user_id: "test-user-" + Date.now(),
                access_token: "test-token",
                service: "test",
                updated_at: new Date().toISOString()
            };
            console.log("🧪 Testing write access to facebook_tokens table...");
            // First try to delete any existing test data
            await supabase
                .from("facebook_tokens")
                .delete()
                .eq("user_id", testData.user_id)
                .eq("service", testData.service);
            // Now try to insert
            const { data: writeData, error: writeError } = await supabase
                .from("facebook_tokens")
                .insert(testData);
            if (writeError) {
                console.error("❌ Facebook tokens WRITE test failed:", writeError);
                console.error("   Full error details:", {
                    code: writeError.code,
                    message: writeError.message,
                    details: writeError.details,
                    hint: writeError.hint
                });
                if (writeError.code === '42501') {
                    console.error("   → RLS policy is blocking writes even with service role key!");
                    console.error("   → This suggests the RLS policy needs to be updated in the database");
                    console.error("   → Run this SQL in Supabase SQL Editor:");
                    console.error("   → ALTER TABLE facebook_tokens DISABLE ROW LEVEL SECURITY;");
                }
            }
            else {
                console.log("✅ Can write to facebook_tokens table");
                // Clean up test data
                await supabase
                    .from("facebook_tokens")
                    .delete()
                    .eq("user_id", testData.user_id);
            }
        }
        catch (e) {
            console.error("❌ Database test error:", e);
        }
    })();
}
// Express app
const app = (0, express_1.default)();
// IMPORTANT: Body parsers must come FIRST before any middleware that might read the body
app.use(express_1.default.json());
app.use(express_1.default.urlencoded({ extended: true }));
app.use((0, cookie_parser_1.default)());
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
const rootDir = path_1.default.join(__dirname, '..');
const templatesDir = path_1.default.join(rootDir, 'templates');
const publicDir = path_1.default.join(rootDir, 'public');
console.log('🔍 Directory paths:');
console.log('  - __dirname:', __dirname);
console.log('  - rootDir:', rootDir);
console.log('  - templatesDir:', templatesDir);
console.log('  - NODE_ENV:', process.env.NODE_ENV);
app.set('views', templatesDir);
app.use(express_1.default.static(publicDir));
// Store auth context by session ID
const authContext = new Map();
// OAuth state storage
const oauthStates = new Map();
// Active sessions
const sessions = new Map();
// Database helpers
async function getUserByToken(token) {
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
    }
    catch (error) {
        console.error("[DB] Error getting user:", error);
        return null;
    }
}
async function getFacebookToken(userId) {
    if (!supabase || !userId)
        return null;
    try {
        const { data } = await supabase
            .from("facebook_tokens")
            .select("access_token")
            .eq("user_id", userId)
            .eq("service", "competition")
            .single();
        return data?.access_token || null;
    }
    catch (error) {
        console.error("Error getting FB token:", error);
        return null;
    }
}
// Get Facebook App Access Token
async function getAppAccessToken() {
    if (!FB_APP_ID || !FB_APP_SECRET) {
        console.error("Facebook App ID or Secret not configured");
        return null;
    }
    try {
        console.log("Requesting App Access Token with App ID:", FB_APP_ID);
        const response = await axios_1.default.get(`https://graph.facebook.com/${FB_GRAPH_VERSION}/oauth/access_token`, {
            params: {
                client_id: FB_APP_ID,
                client_secret: FB_APP_SECRET,
                grant_type: 'client_credentials'
            }
        });
        console.log("App Access Token received successfully");
        return response.data.access_token;
    }
    catch (error) {
        console.error("Error getting app access token:", error.response?.data || error.message);
        return null;
    }
}
// Facebook API helper
async function fetchAdsFromFacebook(params, fbToken) {
    try {
        // For public Ad Library, we can use app access token
        let accessToken = fbToken;
        if (!accessToken) {
            console.log("No user token provided, getting App Access Token...");
            accessToken = await getAppAccessToken();
            if (!accessToken) {
                return { error: "Failed to get Facebook access token" };
            }
            console.log("Using App Access Token for Ad Library search");
        }
        else {
            console.log("Using user token for Ad Library search");
        }
        const url = `https://graph.facebook.com/${FB_GRAPH_VERSION}/ads_archive`;
        const response = await axios_1.default.get(url, {
            params: {
                ...params,
                access_token: accessToken,
                fields: 'id,ad_creation_time,ad_creative_bodies,ad_creative_link_captions,ad_creative_link_descriptions,ad_creative_link_titles,ad_delivery_start_time,ad_delivery_stop_time,ad_snapshot_url,age_country_gender_reach_breakdown,beneficiary_payers,br_total_reach,currency,demographic_distribution,estimated_audience_size,eu_total_reach,impressions,languages,page_id,page_name,publisher_platforms,spend,target_ages,target_gender,target_locations,total_reach_by_location',
            },
            timeout: 30000,
        });
        return response.data;
    }
    catch (error) {
        console.error("Facebook API error:", error.response?.data || error.message);
        // Check if it's a permission error
        if (error.response?.data?.error?.code === 10) {
            const errorMsg = error.response.data.error;
            return {
                error: "Facebook Ad Library API Access Required",
                message: "To use the Facebook Ad Library API, you need to request access at: https://www.facebook.com/ads/library/api",
                details: errorMsg.error_user_msg || errorMsg.message,
                instructions: [
                    "1. Visit https://www.facebook.com/ads/library/api",
                    "2. Click 'Get Started' and follow the verification process",
                    "3. Once approved, reconnect your Facebook account in the integrations page",
                    "4. Make sure your Facebook account has ads_read permission"
                ]
            };
        }
        return {
            error: error.response?.data?.error?.message || "Facebook API error",
            details: error.response?.data || error.message
        };
    }
}
// MCP Server
const mcpServer = new index_js_1.Server({
    name: "drivenmetrics",
    version: "1.0.0",
}, {
    capabilities: {
        tools: {},
    },
});
// MCP Handlers
mcpServer.setRequestHandler(types_js_1.InitializeRequestSchema, async () => {
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
mcpServer.setRequestHandler(types_js_1.ListToolsRequestSchema, async () => {
    return {
        tools: [
            {
                name: "search_ads_by_terms",
                description: "Search ads in Facebook Ad Library by search terms",
                inputSchema: {
                    type: "object",
                    properties: {
                        search_terms: { type: "string", description: "Search terms (keywords)" },
                        ad_reached_countries: { type: "string", description: "Country code (e.g., IT, US, GB)" },
                        limit: { type: "number", default: 25, description: "Maximum number of results" },
                        include_creatives: { type: "boolean", description: "Include creative assets" },
                        ad_delivery_date_min: { type: "string", description: "Minimum delivery date (YYYY-MM-DD)" },
                        ad_delivery_date_max: { type: "string", description: "Maximum delivery date (YYYY-MM-DD)" },
                    },
                    required: ["search_terms"],
                },
            },
            {
                name: "search_ads_by_page",
                description: "Get all ads from a specific Facebook page",
                inputSchema: {
                    type: "object",
                    properties: {
                        page_id: { type: "string", description: "Facebook page ID" },
                        ad_reached_countries: { type: "string", description: "Country code filter" },
                        limit: { type: "number", default: 25 },
                        ad_delivery_date_min: { type: "string", description: "Minimum delivery date (YYYY-MM-DD)" },
                        ad_delivery_date_max: { type: "string", description: "Maximum delivery date (YYYY-MM-DD)" },
                    },
                    required: ["page_id"],
                },
            },
            {
                name: "analyze_competitor_ads",
                description: "Analyze ads from multiple competitor pages",
                inputSchema: {
                    type: "object",
                    properties: {
                        competitor_pages: {
                            type: "array",
                            items: { type: "string" },
                            description: "List of competitor page IDs or names"
                        },
                        analysis_period_days: { type: "number", default: 30, description: "Analysis period in days" },
                        countries: { type: "string", description: "Country code filter" },
                        include_creative_analysis: { type: "boolean", description: "Include creative analysis" },
                    },
                    required: ["competitor_pages"],
                },
            },
            {
                name: "get_ad_creative",
                description: "Download and display creative assets for a specific ad",
                inputSchema: {
                    type: "object",
                    properties: {
                        ad_id: { type: "string", description: "Facebook ad ID" },
                        ad_snapshot_url: { type: "string", description: "Direct snapshot URL" },
                    },
                },
            },
        ],
    };
});
mcpServer.setRequestHandler(types_js_1.CallToolRequestSchema, async (request, extra) => {
    const { name, arguments: args } = request.params;
    console.log("[TOOL] Tool called:", name, "with args:", args);
    console.log("[TOOL] Extra object:", extra ? Object.keys(extra) : "No extra");
    // Try multiple ways to get session ID
    let sessionId = null;
    // Method 1: From request metadata
    if (request._meta?.sessionId) {
        sessionId = request._meta.sessionId;
        console.log("[TOOL] Session ID from _meta:", sessionId);
    }
    // Method 2: From extra parameter
    if (!sessionId && extra?.sessionId) {
        sessionId = extra.sessionId;
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
    // Get user's Facebook token if available
    const fbToken = userId ? await getFacebookToken(userId) : null;
    console.log("[TOOL] Tool execution context:", { userId, hasFbToken: !!fbToken });
    try {
        let result;
        switch (name) {
            case "search_ads_by_terms":
                // Build params for Facebook Ad Library
                const searchParams = {
                    ad_type: "ALL",
                    ad_active_status: "ALL",
                    search_terms: args?.search_terms || "",
                    limit: args?.limit || 25,
                };
                // Add optional filters
                if (args?.ad_reached_countries) {
                    searchParams.ad_reached_countries = args.ad_reached_countries;
                }
                if (args?.ad_delivery_date_min) {
                    searchParams.ad_delivery_date_min = args.ad_delivery_date_min;
                }
                if (args?.ad_delivery_date_max) {
                    searchParams.ad_delivery_date_max = args.ad_delivery_date_max;
                }
                const searchResult = await fetchAdsFromFacebook(searchParams, fbToken);
                if (searchResult.error) {
                    result = searchResult;
                }
                else {
                    // Format response according to requirements
                    const ads = (searchResult.data || []).map((ad) => ({
                        id: ad.id,
                        ad_snapshot_url: ad.ad_snapshot_url,
                        ad_creative_bodies: ad.ad_creative_bodies || [],
                        ad_creative_link_titles: ad.ad_creative_link_titles || [],
                        page_name: ad.page_name,
                        ad_delivery_start_time: ad.ad_delivery_start_time,
                        ad_delivery_stop_time: ad.ad_delivery_stop_time,
                        publisher_platforms: ad.publisher_platforms || [],
                        library_url: `https://www.facebook.com/ads/library/?id=${ad.id}`,
                        // Include additional fields if requested
                        ...(args?.include_creatives ? {
                            ad_creative_link_captions: ad.ad_creative_link_captions,
                            ad_creative_link_descriptions: ad.ad_creative_link_descriptions,
                        } : {}),
                    }));
                    result = {
                        search_terms: args?.search_terms,
                        ads_found: ads.length,
                        ads: ads,
                    };
                }
                break;
            case "search_ads_by_page":
                const pageParams = {
                    ad_type: "ALL",
                    ad_active_status: "ALL",
                    search_page_ids: args?.page_id || "",
                    limit: args?.limit || 25,
                };
                // Add optional filters
                if (args?.ad_reached_countries) {
                    pageParams.ad_reached_countries = args.ad_reached_countries;
                }
                if (args?.ad_delivery_date_min) {
                    pageParams.ad_delivery_date_min = args.ad_delivery_date_min;
                }
                if (args?.ad_delivery_date_max) {
                    pageParams.ad_delivery_date_max = args.ad_delivery_date_max;
                }
                const pageResult = await fetchAdsFromFacebook(pageParams, fbToken);
                if (pageResult.error) {
                    result = pageResult;
                }
                else {
                    // Format response according to requirements
                    const ads = (pageResult.data || []).map((ad) => ({
                        id: ad.id,
                        ad_snapshot_url: ad.ad_snapshot_url,
                        ad_creative_bodies: ad.ad_creative_bodies || [],
                        ad_creative_link_titles: ad.ad_creative_link_titles || [],
                        page_name: ad.page_name,
                        ad_delivery_start_time: ad.ad_delivery_start_time,
                        ad_delivery_stop_time: ad.ad_delivery_stop_time,
                        publisher_platforms: ad.publisher_platforms || [],
                        library_url: `https://www.facebook.com/ads/library/?id=${ad.id}`,
                    }));
                    result = {
                        page_id: args?.page_id,
                        ads_found: ads.length,
                        ads: ads,
                    };
                }
                break;
            case "analyze_competitor_ads":
                const competitors = Array.isArray(args?.competitor_pages) ? args.competitor_pages : [];
                const periodDays = typeof args?.analysis_period_days === 'number' ? args.analysis_period_days : 30;
                const countries = args?.countries;
                // Calculate date range
                const endDate = new Date();
                const startDate = new Date();
                startDate.setDate(startDate.getDate() - periodDays);
                const competitorResults = [];
                // Fetch ads for each competitor
                for (const competitor of competitors) {
                    const competitorParams = {
                        ad_type: "ALL",
                        ad_active_status: "ALL",
                        search_page_ids: competitor,
                        limit: 50,
                        ad_delivery_date_min: startDate.toISOString().split('T')[0],
                        ad_delivery_date_max: endDate.toISOString().split('T')[0],
                    };
                    if (countries) {
                        competitorParams.ad_reached_countries = countries;
                    }
                    const competitorResult = await fetchAdsFromFacebook(competitorParams, fbToken);
                    if (!competitorResult.error) {
                        competitorResults.push({
                            page: competitor,
                            ads_count: competitorResult.data?.length || 0,
                            ads: competitorResult.data || [],
                        });
                    }
                }
                // Analyze results
                result = {
                    competitors_analyzed: competitors.length,
                    analysis_period: `${startDate.toISOString().split('T')[0]} to ${endDate.toISOString().split('T')[0]}`,
                    results: competitorResults,
                    summary: {
                        total_ads: competitorResults.reduce((sum, c) => sum + c.ads_count, 0),
                        most_active: competitorResults.sort((a, b) => b.ads_count - a.ads_count)[0]?.page || null,
                    },
                };
                break;
            case "get_ad_creative":
                if (!args?.ad_id && !args?.ad_snapshot_url) {
                    result = { error: "Either ad_id or ad_snapshot_url is required" };
                }
                else if (args?.ad_snapshot_url) {
                    // Return the snapshot URL for the user to view
                    result = {
                        snapshot_url: args.ad_snapshot_url,
                        message: "Visit the snapshot URL to view the ad creative",
                    };
                }
                else {
                    // Fetch ad details to get snapshot URL
                    const adParams = {
                        ad_type: "ALL",
                        ad_active_status: "ALL",
                        search_terms: args.ad_id,
                        limit: 1,
                    };
                    const adResult = await fetchAdsFromFacebook(adParams, fbToken);
                    if (adResult.error) {
                        result = adResult;
                    }
                    else if (adResult.data && adResult.data.length > 0) {
                        const ad = adResult.data[0];
                        result = {
                            ad_id: ad.id,
                            snapshot_url: ad.ad_snapshot_url,
                            creative_bodies: ad.ad_creative_bodies || [],
                            creative_link_titles: ad.ad_creative_link_titles || [],
                            message: "Visit the snapshot URL to view the full ad creative",
                        };
                    }
                    else {
                        result = { error: "Ad not found" };
                    }
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
    }
    catch (error) {
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
const transport = new streamableHttp_js_1.StreamableHTTPServerTransport({
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
const sseTransports = new Map();
// SSE endpoint for n8n and other SSE clients - MUST BE BEFORE the general /mcp-api handler
app.get("/mcp-api/sse", async (req, res) => {
    console.log("[SSE] New SSE connection request");
    // Extract auth token
    const authHeader = req.headers.authorization;
    let userId = null;
    if (authHeader && authHeader.startsWith("Bearer ")) {
        const token = authHeader.slice(7);
        userId = await getUserByToken(token);
        if (!userId) {
            console.log("[SSE] Invalid token - allowing anonymous connection");
            userId = null; // Allow connection but mark as anonymous
        }
    }
    else {
        console.log("[SSE] No authorization header - allowing anonymous connection");
        userId = null; // Allow connection but mark as anonymous
    }
    console.log("[SSE] Connection established for user:", userId || "anonymous");
    try {
        // IMPORTANT: Do NOT set any headers before creating the transport
        // The SSEServerTransport will handle all SSE headers
        // Create SSE transport with messages endpoint
        const transport = new sse_js_1.SSEServerTransport('/mcp-api/messages', res);
        // Get the session ID generated by the transport
        const sessionId = transport.sessionId;
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
            }
            catch (error) {
                console.error("[SSE] Error sending initial notifications:", error);
            }
        }, 100); // Small delay to ensure connection is fully established
        // Handle connection close
        req.on('close', () => {
            const transportSessionId = transport.sessionId;
            console.log("[SSE] Client disconnected, session:", transportSessionId);
            authContext.delete(transportSessionId);
            sseTransports.delete(transportSessionId);
            if (typeof transport.close === 'function') {
                transport.close();
            }
        });
    }
    catch (error) {
        console.error("[SSE] Error setting up transport:", error);
        // Even in error cases, check if headers were sent
        if (!res.headersSent) {
            res.status(500).json({ error: "Internal server error" });
        }
    }
});
// Handle SSE messages POST endpoint
app.post("/mcp-api/messages", express_1.default.json(), async (req, res, next) => {
    const sessionId = req.query.sessionId;
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
        await transport.handlePostMessage(req, res, req.body);
    }
    catch (error) {
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
app.use("/mcp-api", express_1.default.json(), async (req, res, next) => {
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
    const sessionId = req.headers["mcp-session-id"];
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
            }
            else {
                console.log("[AUTH] No session ID provided, but user authenticated");
            }
        }
    }
    else {
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
        const sessionId = req.headers["mcp-session-id"] || crypto_1.default.randomBytes(16).toString('hex');
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
    }
    catch (error) {
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
    const { response_type, client_id, redirect_uri, state, code_challenge, code_challenge_method, scope } = req.query;
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
        const authCode = crypto_1.default.randomBytes(32).toString('hex');
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
        const redirectUrl = new URL(redirect_uri);
        redirectUrl.searchParams.set('code', authCode);
        redirectUrl.searchParams.set('state', state);
        console.log("✅ User already authenticated, redirecting with code");
        return res.redirect(redirectUrl.toString());
    }
    // Store OAuth state for after login
    const stateId = crypto_1.default.randomBytes(16).toString('hex');
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
    }
    catch (err) {
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
          .forgot-link { text-align: center; margin-top: 1rem; }
          .forgot-link a { color: #0066ff; text-decoration: none; font-size: 0.9rem; }
          .forgot-link a:hover { text-decoration: underline; }
          #resetMessage { text-align: center; margin-top: 1rem; }
          .footer { text-align: center; margin-top: 2rem; color: #666; font-size: 0.85rem; }
          .footer .heart { color: #ff4444; }
        </style>
      </head>
      <body>
        <div class="login-box">
          <h2>Sign in to Drivenmetrics</h2>
          <p style="text-align: center; color: #999;">Sign in to your account</p>
          <form method="POST" action="/login">
            <input type="hidden" name="state" value="${stateId}">
            <input type="email" name="email" id="email" placeholder="Email" required>
            <input type="password" name="password" placeholder="Password" required>
            <button type="submit">Authorize</button>
          </form>
          <div class="forgot-link">
            <a href="#" onclick="resetPassword(); return false;">Forgot your password?</a>
          </div>
          <div id="resetMessage"></div>
          <div class="footer">
            Crafted with <span class="heart">❤️</span>  e AI  by Growthers
          </div>
          <script>
            async function resetPassword() {
              const email = document.getElementById('email').value;
              const messageDiv = document.getElementById('resetMessage');
              
              if (!email) {
                messageDiv.style.color = '#ff4444';
                messageDiv.textContent = 'Please enter your email first';
                return;
              }
              
              try {
                const res = await fetch('/reset-password', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ email })
                });
                
                const data = await res.json();
                if (res.ok) {
                  messageDiv.style.color = '#44ff44';
                  messageDiv.textContent = data.message;
                } else {
                  messageDiv.style.color = '#ff4444';
                  messageDiv.textContent = data.error || 'Failed to send reset email';
                }
              } catch (error) {
                messageDiv.style.color = '#ff4444';
                messageDiv.textContent = 'Network error';
              }
            }
          </script>
        </div>
      </body>
      </html>
    `);
    }
});
// Login endpoint
app.post("/login", express_1.default.urlencoded({ extended: true }), async (req, res) => {
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
                        emailRedirectTo: `https://mcp.drivenmetrics.com/auth/confirm`
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
                    }
                    catch (err) {
                        console.error("Error creating user:", err);
                    }
                }
            }
            else {
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
                    }
                    catch (err) {
                        console.error("Error upserting user:", err);
                    }
                }
            }
        }
        catch (error) {
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
    // Get user info including admin status
    let isAdmin = false;
    if (supabase && userId) {
        try {
            console.log("[LOGIN] Fetching admin status for user:", userId);
            const { data: userData, error } = await supabase
                .from("users")
                .select("is_admin, email")
                .eq("user_id", userId)
                .single();
            console.log("[LOGIN] User data from DB:", userData);
            console.log("[LOGIN] Query error:", error);
            isAdmin = userData?.is_admin || false;
            console.log("[LOGIN] Is admin:", isAdmin);
        }
        catch (error) {
            console.log("Error fetching admin status:", error);
        }
    }
    else {
        console.log("[LOGIN] No supabase or userId - demo mode");
    }
    // Create session
    const sessionId = crypto_1.default.randomBytes(32).toString('hex');
    const sessionData = {
        user_id: userId,
        email: email,
        is_admin: isAdmin,
        created_at: Date.now()
    };
    console.log("[LOGIN] Creating session with data:", sessionData);
    sessions.set(sessionId, sessionData);
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
    const authCode = crypto_1.default.randomBytes(32).toString('hex');
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
// Password reset endpoint
app.post("/reset-password", async (req, res) => {
    const { email } = req.body;
    if (!email) {
        return res.status(400).json({ error: "Email is required" });
    }
    if (supabase) {
        try {
            const { error } = await supabase.auth.resetPasswordForEmail(email, {
                redirectTo: `https://mcp.drivenmetrics.com/update-password`
            });
            if (error) {
                console.error("Password reset error:", error);
                return res.status(400).json({ error: "Failed to send reset email" });
            }
            return res.json({
                success: true,
                message: "Password reset email sent. Please check your inbox."
            });
        }
        catch (error) {
            console.error("Reset password error:", error);
            return res.status(500).json({ error: "Internal server error" });
        }
    }
    else {
        return res.status(503).json({ error: "Password reset not available" });
    }
});
// Email confirmation handler
app.get("/auth/confirm", async (req, res) => {
    // Supabase sends the token in the fragment, but we can handle it client-side
    res.send(`
    <!DOCTYPE html>
    <html>
    <head>
      <title>Email Confirmed - Drivenmetrics</title>
      <style>
        body { font-family: sans-serif; background: #0a0a0a; color: white; display: flex; justify-content: center; align-items: center; height: 100vh; margin: 0; }
        .message-box { background: #1a1a1a; padding: 2rem; border-radius: 12px; width: 400px; text-align: center; }
        h2 { color: #44ff44; }
        a { color: #0066ff; text-decoration: none; }
        a:hover { text-decoration: underline; }
      </style>
    </head>
    <body>
      <div class="message-box">
        <h2>✓ Email Confirmed!</h2>
        <p>Your email has been successfully confirmed.</p>
        <p>You can now <a href="/login">login to your account</a>.</p>
      </div>
      <script>
        // Handle the hash fragment from Supabase
        if (window.location.hash) {
          const params = new URLSearchParams(window.location.hash.substring(1));
          const type = params.get('type');
          if (type === 'signup' || type === 'recovery') {
            // Email confirmed or password recovery
            console.log('Auth confirmed:', type);
          }
        }
      </script>
    </body>
    </html>
  `);
});
// Update password page
app.get("/update-password", (req, res) => {
    try {
        res.render('update_password', {});
    }
    catch (err) {
        res.send(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>Update Password - Drivenmetrics</title>
        <style>
          body { font-family: sans-serif; background: #0a0a0a; color: white; display: flex; justify-content: center; align-items: center; height: 100vh; margin: 0; }
          .form-box { background: #1a1a1a; padding: 2rem; border-radius: 12px; width: 300px; }
          h2 { text-align: center; }
          input { width: 100%; padding: 0.75rem; margin: 0.5rem 0; border: 1px solid #333; background: #0a0a0a; color: white; border-radius: 4px; box-sizing: border-box; }
          button { width: 100%; padding: 0.75rem; background: #0066ff; color: white; border: none; border-radius: 4px; cursor: pointer; }
          .error { color: #ff4444; text-align: center; margin: 1rem 0; }
          .success { color: #44ff44; text-align: center; margin: 1rem 0; }
        </style>
      </head>
      <body>
        <div class="form-box">
          <h2>Update Password</h2>
          <form id="updateForm">
            <input type="password" id="password" placeholder="New Password" required minlength="6">
            <input type="password" id="confirmPassword" placeholder="Confirm Password" required>
            <button type="submit">Update Password</button>
            <div id="message"></div>
          </form>
          <script>
            // Extract access token from URL hash
            let accessToken = null;
            if (window.location.hash) {
              const params = new URLSearchParams(window.location.hash.substring(1));
              accessToken = params.get('access_token');
              if (!accessToken) {
                document.getElementById('message').className = 'error';
                document.getElementById('message').textContent = 'Invalid or expired reset link';
              }
            }
            
            document.getElementById('updateForm').onsubmit = async (e) => {
              e.preventDefault();
              const password = document.getElementById('password').value;
              const confirmPassword = document.getElementById('confirmPassword').value;
              const messageDiv = document.getElementById('message');
              
              if (password !== confirmPassword) {
                messageDiv.className = 'error';
                messageDiv.textContent = 'Passwords do not match';
                return;
              }
              
              if (!accessToken) {
                messageDiv.className = 'error';
                messageDiv.textContent = 'Invalid or expired reset link';
                return;
              }
              
              try {
                const res = await fetch('/api/update-password', {
                  method: 'POST',
                  headers: { 
                    'Content-Type': 'application/json',
                    'Authorization': 'Bearer ' + accessToken
                  },
                  body: JSON.stringify({ password })
                });
                
                const data = await res.json();
                if (res.ok) {
                  messageDiv.className = 'success';
                  messageDiv.textContent = 'Password updated! Redirecting...';
                  setTimeout(() => window.location.href = '/login', 2000);
                } else {
                  messageDiv.className = 'error';
                  messageDiv.textContent = data.error || 'Failed to update password';
                }
              } catch (error) {
                messageDiv.className = 'error';
                messageDiv.textContent = 'Network error';
              }
            };
          </script>
        </div>
      </body>
      </html>
    `);
    }
});
// API endpoint for updating password
app.post("/api/update-password", async (req, res) => {
    const { password } = req.body;
    if (!password || password.length < 6) {
        return res.status(400).json({ error: "Password must be at least 6 characters" });
    }
    // Get access token from hash (this would be sent from client)
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
        return res.status(401).json({ error: "No access token provided" });
    }
    const accessToken = authHeader.slice(7);
    if (SUPABASE_URL && SUPABASE_ANON_KEY) {
        try {
            console.log("Attempting password update with token:", accessToken.substring(0, 20) + "...");
            // Use the Supabase REST API directly with the recovery token
            const response = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${accessToken}`,
                    'apikey': SUPABASE_ANON_KEY
                },
                body: JSON.stringify({ password })
            });
            const responseData = await response.json();
            if (!response.ok) {
                console.error("Supabase API error:", response.status, responseData);
                return res.status(400).json({
                    error: responseData.message || responseData.msg || responseData.error_description || "Failed to update password"
                });
            }
            console.log("Password update successful");
            return res.json({ success: true, message: "Password updated successfully" });
        }
        catch (error) {
            console.error("Update password error:", error);
            return res.status(500).json({ error: "Internal server error" });
        }
    }
    else {
        return res.status(503).json({ error: "Password update not available" });
    }
});
// Facebook OAuth callback endpoint
app.get("/api/authorise/facebook/callback", async (req, res) => {
    const { code, state, error } = req.query;
    console.log("🔐 Facebook OAuth callback:", { code: code ? "present" : "missing", state, error });
    if (error) {
        console.error("Facebook OAuth error:", error);
        return res.redirect(`/login?error=${encodeURIComponent("Facebook login failed")}`);
    }
    if (!code || typeof code !== 'string') {
        return res.redirect("/login?error=Missing%20authorization%20code");
    }
    try {
        // Exchange code for access token
        const tokenUrl = `https://graph.facebook.com/${FB_GRAPH_VERSION}/oauth/access_token`;
        const tokenParams = {
            client_id: FB_APP_ID,
            client_secret: FB_APP_SECRET,
            redirect_uri: `https://mcp.drivenmetrics.com/api/authorise/facebook/callback`,
            code: code
        };
        console.log("Exchanging Facebook code for token...");
        const tokenResponse = await axios_1.default.get(tokenUrl, { params: tokenParams });
        const { access_token } = tokenResponse.data;
        if (!access_token) {
            throw new Error("No access token received from Facebook");
        }
        // Get user info from Facebook
        const userUrl = `https://graph.facebook.com/${FB_GRAPH_VERSION}/me`;
        const userParams = {
            fields: 'id,email,name',
            access_token: access_token
        };
        const userResponse = await axios_1.default.get(userUrl, { params: userParams });
        const fbUser = userResponse.data;
        console.log("Facebook user info:", { id: fbUser.id, email: fbUser.email, name: fbUser.name });
        if (!fbUser.email) {
            return res.redirect("/login?error=No%20email%20permission%20from%20Facebook");
        }
        // Get the logged-in user from the session
        const sessionId = req.cookies?.session_id;
        if (!sessionId || !sessions.has(sessionId)) {
            console.error("No valid session found for Facebook callback");
            return res.redirect("/login?error=Session%20expired");
        }
        const session = sessions.get(sessionId);
        const userId = session.user_id;
        console.log("Facebook callback for existing user:", userId);
        // Update user's Facebook info in database
        if (supabase && userId) {
            const { error: updateError } = await supabase
                .from("users")
                .update({
                facebook_id: fbUser.id,
                name: fbUser.name || session.name, // Keep existing name if Facebook doesn't provide one
                updated_at: new Date().toISOString()
            })
                .eq("user_id", userId);
            if (updateError) {
                console.error("Error updating user Facebook info:", updateError);
            }
            // Store Facebook token in facebook_tokens table
            console.log("Storing Facebook token for user:", userId);
            // Log the exact data being saved
            const tokenData = {
                user_id: userId,
                access_token: access_token,
                service: 'competition',
                updated_at: new Date().toISOString()
            };
            console.log("Facebook token data to be saved:", {
                user_id: tokenData.user_id,
                access_token: `${tokenData.access_token.substring(0, 10)}...${tokenData.access_token.substring(tokenData.access_token.length - 10)}`, // Log partial token for security
                service: tokenData.service,
                updated_at: tokenData.updated_at,
                token_length: tokenData.access_token.length
            });
            // Delete existing token first to work around RLS issues
            const { error: deleteError } = await supabase
                .from("facebook_tokens")
                .delete()
                .eq("user_id", userId)
                .eq("service", "competition");
            if (deleteError && deleteError.code !== 'PGRST116') { // PGRST116 = no rows to delete, which is fine
                console.error("Error deleting existing Facebook token:", deleteError);
            }
            // Now insert the new token
            const { error: tokenError } = await supabase
                .from("facebook_tokens")
                .insert(tokenData);
            if (tokenError) {
                // Check for RLS error (insufficient permissions)
                if (tokenError.code === '42501') {
                    console.error("❌ RLS PERMISSION ERROR: Cannot store Facebook token", {
                        error: "Row Level Security (RLS) is blocking the operation",
                        solution: "You need to use the SERVICE ROLE key, not the ANON key!",
                        details: "The SUPABASE_KEY environment variable must be set to your service role key",
                        current_key_type: `Using ${getSupabaseKeyType(SUPABASE_KEY)} key`,
                        help: "Find your service role key in Supabase Dashboard > Settings > API > service_role (secret)",
                        user_id: userId,
                        service: 'competition'
                    });
                }
                else {
                    console.error("Error storing Facebook token - Full error details:", {
                        message: tokenError.message,
                        details: tokenError.details,
                        hint: tokenError.hint,
                        code: tokenError.code,
                        user_id: userId,
                        service: 'competition',
                        timestamp: new Date().toISOString()
                    });
                }
            }
            else {
                console.log("✅ Facebook token stored successfully", {
                    user_id: userId,
                    service: 'competition',
                    timestamp: new Date().toISOString()
                });
            }
        }
        // Don't create a new session - user should already be logged in
        // Redirect to dashboard or original OAuth flow
        if (state) {
            // This was part of an OAuth flow
            const oauthState = oauthStates.get(state);
            if (oauthState) {
                // Check if this is a Facebook-only auth or part of Claude.ai OAuth
                if (oauthState.type === 'facebook') {
                    // Facebook-only auth, clean up and redirect
                    oauthStates.delete(state);
                    // Facebook token already stored above, no need to duplicate
                    // Check if there was a pending OAuth state
                    if (oauthState.pending_oauth_state) {
                        return res.redirect(`/setup/integrations?oauth_state=${oauthState.pending_oauth_state}&success=facebook`);
                    }
                    else {
                        return res.redirect('/setup/integrations?success=facebook');
                    }
                }
                else if (oauthState.redirect_uri) {
                    // This is part of a full OAuth flow
                    // Generate authorization code
                    const authCode = crypto_1.default.randomBytes(32).toString('hex');
                    oauthStates.set(authCode, {
                        ...oauthState,
                        user_id: userId || fbUser.id,
                        created_at: Date.now()
                    });
                    // Clean up state
                    oauthStates.delete(state);
                    // Redirect back with code
                    const redirectUrl = new URL(oauthState.redirect_uri);
                    redirectUrl.searchParams.set('code', authCode);
                    redirectUrl.searchParams.set('state', oauthState.state);
                    return res.redirect(redirectUrl.toString());
                }
            }
        }
        // Regular login, redirect to dashboard
        res.redirect('/dashboard');
    }
    catch (error) {
        console.error("Facebook OAuth error:", error);
        const errorMessage = error instanceof Error ? error.message : "Facebook login failed";
        res.redirect(`/login?error=${encodeURIComponent(errorMessage)}`);
    }
});
// Token endpoint
app.post("/token", express_1.default.urlencoded({ extended: true }), async (req, res) => {
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
        const verifier = crypto_1.default.createHash('sha256').update(code_verifier).digest('base64url');
        if (verifier !== codeData.code_challenge) {
            return res.status(400).json({ error: "invalid_grant" });
        }
    }
    // Get the API token from the code data
    const accessToken = codeData.api_token || `dmgt_${crypto_1.default.randomBytes(32).toString('hex')}`;
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
        }
        catch (error) {
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
    }
    catch (err) {
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
    }
    catch (err) {
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
    let facebookToken = null;
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
            if (fbData) {
                facebookToken = fbData.access_token;
            }
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
            }
            catch (e) {
                // API usage table might not exist
            }
        }
        catch (error) {
            console.log("Error fetching integration status:", error);
        }
    }
    try {
        res.render('dashboard', {
            user: session,
            has_facebook: hasFacebook,
            has_claude: hasClaude,
            api_calls: apiCalls,
            api_token: apiToken,
            facebook_token: facebookToken
        });
    }
    catch (err) {
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
    const apiToken = `dmgt_${crypto_1.default.randomBytes(32).toString('hex')}`;
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
        }
        catch (error) {
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
        }
        catch (error) {
            console.log("No Facebook token found");
        }
    }
    else {
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
    }
    catch (err) {
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
    const fbState = crypto_1.default.randomBytes(16).toString('hex');
    // Store state linked to session, including any pending OAuth state
    const session = sessions.get(sessionId);
    oauthStates.set(fbState, {
        session_id: sessionId,
        user_id: session.user_id,
        type: 'facebook',
        created_at: Date.now(),
        pending_oauth_state: req.query.oauth_state // Preserve OAuth state for Claude.ai
    });
    // Build Facebook OAuth URL
    const params = new URLSearchParams({
        client_id: FB_APP_ID,
        redirect_uri: `${baseUrl}/api/authorise/facebook/callback`,
        scope: 'public_profile,email,business_management',
        state: fbState,
        response_type: 'code'
    });
    const fbAuthUrl = `https://www.facebook.com/${FB_GRAPH_VERSION}/dialog/oauth?${params}`;
    console.log("🔐 Redirecting to Facebook OAuth:", fbAuthUrl);
    res.redirect(fbAuthUrl);
});
// Facebook OAuth callback
app.get("/api/authorise/facebook/callback", async (req, res) => {
    const { code, state, error } = req.query;
    // Verify state
    const stateData = oauthStates.get(state);
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
    oauthStates.delete(state);
    if (error) {
        console.error("Facebook auth error:", error);
        return res.redirect("/setup/integrations?error=facebook_denied");
    }
    if (code && FB_APP_ID && FB_APP_SECRET) {
        try {
            // Exchange code for token
            const tokenResponse = await axios_1.default.get(`https://graph.facebook.com/${FB_GRAPH_VERSION}/oauth/access_token`, {
                params: {
                    client_id: FB_APP_ID,
                    client_secret: FB_APP_SECRET,
                    redirect_uri: `${baseUrl}/api/authorise/facebook/callback`,
                    code: code
                }
            });
            const { access_token } = tokenResponse.data;
            if (access_token && supabase) {
                // Save Facebook token
                // Delete existing token first to work around RLS issues
                const { error: deleteError } = await supabase
                    .from("facebook_tokens")
                    .delete()
                    .eq("user_id", userId)
                    .eq("service", "competition");
                if (deleteError && deleteError.code !== 'PGRST116') { // PGRST116 = no rows to delete, which is fine
                    console.error("Error deleting existing Facebook token:", deleteError);
                }
                // Now insert the new token
                const { error: tokenError } = await supabase
                    .from("facebook_tokens")
                    .insert({
                    user_id: userId,
                    access_token: access_token,
                    service: "competition",
                    updated_at: new Date().toISOString()
                });
                if (tokenError) {
                    // Check for RLS error (insufficient permissions)
                    if (tokenError.code === '42501') {
                        console.error("❌ RLS PERMISSION ERROR: Cannot store Facebook token", {
                            error: "Row Level Security (RLS) is blocking the operation",
                            solution: "You need to use the SERVICE ROLE key, not the ANON key!",
                            details: "The SUPABASE_KEY environment variable must be set to your service role key",
                            current_key_type: `Using ${getSupabaseKeyType(SUPABASE_KEY)} key`,
                            help: "Find your service role key in Supabase Dashboard > Settings > API > service_role (secret)",
                            user_id: userId,
                            service: 'competition'
                        });
                    }
                    else {
                        console.error("Error storing Facebook token:", tokenError);
                    }
                }
                else {
                    console.log("✅ Facebook token saved for user:", userId);
                }
            }
            // Check if there's a pending OAuth flow from the original state
            const pendingOauth = stateData.pending_oauth_state;
            if (pendingOauth) {
                return res.redirect(`/setup/integrations?success=facebook&oauth_state=${pendingOauth}`);
            }
            return res.redirect("/setup/integrations?success=facebook");
        }
        catch (error) {
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
        }
        catch (error) {
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
    }
    catch (error) {
        console.error("Error fetching token:", error);
    }
    if (!apiToken) {
        // Generate a new token if user doesn't have one
        apiToken = `dmgt_${crypto_1.default.randomBytes(32).toString('hex')}`;
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
        }
        catch (error) {
            console.error("Error saving token:", error);
            return res.status(500).send("Error generating API token");
        }
    }
    // Generate authorization code for Claude
    const authCode = crypto_1.default.randomBytes(32).toString('hex');
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
// Force refresh session from database
app.get("/refresh-session", async (req, res) => {
    const sessionId = req.cookies?.session_id;
    if (!sessionId || !sessions.has(sessionId)) {
        return res.redirect('/login');
    }
    const session = sessions.get(sessionId);
    if (supabase && session.user_id) {
        try {
            const { data: userData, error } = await supabase
                .from("users")
                .select("is_admin, email")
                .eq("user_id", session.user_id)
                .single();
            if (userData) {
                // Update session with fresh data
                session.is_admin = userData.is_admin || false;
                sessions.set(sessionId, session);
                console.log("[REFRESH] Updated session for", session.email, "is_admin:", session.is_admin);
            }
        }
        catch (error) {
            console.error("[REFRESH] Error:", error);
        }
    }
    res.redirect(req.query.next || '/dashboard');
});
// Debug route to check session
app.get("/debug/session", (req, res) => {
    const sessionId = req.cookies?.session_id;
    if (!sessionId) {
        return res.json({ error: "No session cookie found" });
    }
    const session = sessions.get(sessionId);
    if (!session) {
        return res.json({
            error: "Session not found in memory",
            sessionId: sessionId,
            activeSessions: Array.from(sessions.keys()).length
        });
    }
    res.json({
        session: session,
        sessionId: sessionId,
        cookieFound: true,
        hasIsAdminField: 'is_admin' in session,
        isAdminValue: session.is_admin,
        allSessionIds: Array.from(sessions.keys())
    });
});
// Admin webhook configuration route
app.get("/admin/webhooks", async (req, res) => {
    const sessionId = req.cookies?.session_id;
    if (!sessionId || !sessions.has(sessionId)) {
        return res.redirect('/login?next=/admin/webhooks');
    }
    const session = sessions.get(sessionId);
    console.log("[ADMIN] Session data:", session);
    // Check if user is admin
    if (!session.is_admin) {
        console.log("[ADMIN] Access denied for non-admin user:", session.email);
        return res.status(403).send(`Access denied. Admin privileges required.`);
    }
    try {
        let webhooks = [];
        if (supabase) {
            const { data, error } = await supabase
                .from("webhook_config")
                .select("*")
                .order("service_name");
            if (data) {
                webhooks = data;
            }
        }
        else {
            // Default webhooks for demo
            webhooks = [
                {
                    service_name: 'deep_marketing_create_plan',
                    webhook_url: 'https://your-n8n.com/webhook/xxx',
                    description: 'Creates search plan from user query',
                    is_active: true
                },
                {
                    service_name: 'deep_marketing_execute_search',
                    webhook_url: 'https://your-n8n.com/webhook/yyy',
                    description: 'Executes the search plan',
                    is_active: true
                }
            ];
        }
        res.render('admin_webhooks', {
            user: session,
            webhooks: webhooks
        });
    }
    catch (err) {
        console.error('Admin webhooks page error:', err);
        res.status(500).send('Error loading admin page');
    }
});
// Helper function to get webhook URL from database
async function getWebhookUrl(serviceName) {
    if (!supabase) {
        // Return default URLs for demo
        const defaults = {
            'deep_marketing_create_plan': process.env.N8N_WEBHOOK_URL || 'https://your-n8n.com/webhook/xxx',
            'deep_marketing_execute_search': process.env.N8N_WEBHOOK_URL_EXECUTE || 'https://your-n8n.com/webhook/yyy'
        };
        return defaults[serviceName] || null;
    }
    try {
        const { data, error } = await supabase
            .from("webhook_config")
            .select("webhook_url")
            .eq("service_name", serviceName)
            .eq("is_active", true)
            .single();
        return data?.webhook_url || null;
    }
    catch (error) {
        console.error("Error fetching webhook URL:", error);
        return null;
    }
}
// Deep Marketing routes
app.get("/deep-marketing", async (req, res) => {
    const sessionId = req.cookies?.session_id;
    if (!sessionId || !sessions.has(sessionId)) {
        return res.redirect('/login?next=/deep-marketing');
    }
    const session = sessions.get(sessionId);
    try {
        res.render('deep_marketing', {
            user: session,
            n8n_webhook_url: process.env.N8N_WEBHOOK_URL || ''
        });
    }
    catch (err) {
        console.error('Deep Marketing page error:', err);
        res.status(500).send('Error loading Deep Marketing page');
    }
});
// Store active searches
const activeSearches = new Map();
// Admin API endpoints
app.post("/api/admin/webhooks/update", async (req, res) => {
    const sessionId = req.cookies?.session_id;
    if (!sessionId || !sessions.has(sessionId)) {
        return res.status(401).json({ error: "Not authenticated" });
    }
    const session = sessions.get(sessionId);
    if (!session.is_admin) {
        return res.status(403).json({ error: "Admin access required" });
    }
    const { service_name, webhook_url } = req.body;
    if (!service_name || !webhook_url) {
        return res.status(400).json({ error: "Missing required fields" });
    }
    try {
        if (supabase) {
            const { error } = await supabase
                .from("webhook_config")
                .update({
                webhook_url: webhook_url,
                updated_at: new Date().toISOString()
            })
                .eq("service_name", service_name);
            if (error)
                throw error;
        }
        res.json({ success: true });
    }
    catch (error) {
        console.error("Error updating webhook:", error);
        res.status(500).json({ error: "Failed to update webhook" });
    }
});
app.post("/api/admin/webhooks/test", async (req, res) => {
    const sessionId = req.cookies?.session_id;
    if (!sessionId || !sessions.has(sessionId)) {
        return res.status(401).json({ error: "Not authenticated" });
    }
    const session = sessions.get(sessionId);
    if (!session.is_admin) {
        return res.status(403).json({ error: "Admin access required" });
    }
    const { webhook_url } = req.body;
    try {
        const startTime = Date.now();
        const testResponse = await axios_1.default.post(webhook_url, {
            test: true,
            timestamp: new Date().toISOString(),
            source: 'drivenmetrics_admin_panel'
        }, {
            timeout: 5000
        });
        const responseTime = Date.now() - startTime;
        res.json({
            success: true,
            responseTime: responseTime,
            status: testResponse.status
        });
    }
    catch (error) {
        res.json({
            success: false,
            error: error.message || "Connection failed"
        });
    }
});
app.post("/api/admin/webhooks/toggle", async (req, res) => {
    const sessionId = req.cookies?.session_id;
    if (!sessionId || !sessions.has(sessionId)) {
        return res.status(401).json({ error: "Not authenticated" });
    }
    const session = sessions.get(sessionId);
    if (!session.is_admin) {
        return res.status(403).json({ error: "Admin access required" });
    }
    const { service_name, is_active } = req.body;
    try {
        if (supabase) {
            const { error } = await supabase
                .from("webhook_config")
                .update({
                is_active: is_active,
                updated_at: new Date().toISOString()
            })
                .eq("service_name", service_name);
            if (error)
                throw error;
        }
        res.json({ success: true });
    }
    catch (error) {
        console.error("Error toggling webhook:", error);
        res.status(500).json({ error: "Failed to toggle webhook" });
    }
});
// Create search endpoint (modified to use webhook from DB)
app.post("/api/deep-marketing/create-search", async (req, res) => {
    const sessionId = req.cookies?.session_id;
    if (!sessionId || !sessions.has(sessionId)) {
        return res.status(401).json({ error: "Not authenticated" });
    }
    const { query, user_id } = req.body;
    if (!query) {
        return res.status(400).json({ error: "Missing query" });
    }
    // Get webhook URL from database
    const n8n_webhook = await getWebhookUrl('deep_marketing_create_plan');
    if (!n8n_webhook) {
        return res.status(503).json({ error: "Webhook not configured. Please contact admin." });
    }
    const searchId = crypto_1.default.randomBytes(16).toString('hex');
    try {
        console.log("[CREATE-SEARCH] Calling n8n webhook:", n8n_webhook);
        console.log("[CREATE-SEARCH] Request data:", {
            action: 'create_plan',
            search_id: searchId,
            query: query,
            user_id: user_id
        });
        // Forward to n8n webhook for plan creation
        const n8nResponse = await axios_1.default.post(n8n_webhook, {
            action: 'create_plan',
            search_id: searchId,
            query: query,
            user_id: user_id,
            timestamp: new Date().toISOString()
        }, {
            timeout: 30000, // 30 secondi timeout
            headers: {
                'Content-Type': 'application/json'
            }
        });
        console.log("[CREATE-SEARCH] n8n response status:", n8nResponse.status);
        console.log("[CREATE-SEARCH] n8n response data:", JSON.stringify(n8nResponse.data));
        // Extract plan from n8n response
        // n8n returns an array with the plan object
        let planData = {};
        // Check if response has data
        if (!n8nResponse.data || (typeof n8nResponse.data === 'string' && n8nResponse.data.trim() === '')) {
            console.error("[CREATE-SEARCH] Empty response from n8n");
            throw new Error("n8n webhook returned empty response. Please check n8n workflow configuration.");
        }
        if (Array.isArray(n8nResponse.data) && n8nResponse.data.length > 0) {
            planData = n8nResponse.data[0].plan || n8nResponse.data[0];
        }
        else if (n8nResponse.data.plan) {
            planData = n8nResponse.data.plan;
        }
        else if (typeof n8nResponse.data === 'object') {
            planData = n8nResponse.data;
        }
        else {
            console.error("[CREATE-SEARCH] Unexpected response format:", n8nResponse.data);
            throw new Error("Invalid response format from n8n webhook");
        }
        // Validate plan data
        if (!planData || Object.keys(planData).length === 0) {
            console.error("[CREATE-SEARCH] Plan data is empty");
            throw new Error("n8n webhook did not return a valid plan");
        }
        console.log("[CREATE-SEARCH] Extracted plan data:", JSON.stringify(planData));
        // Store search info
        activeSearches.set(searchId, {
            id: searchId,
            query: query,
            user_id: user_id,
            status: 'planning',
            plan: planData,
            created_at: new Date().toISOString()
        });
        // If using Supabase, store in database
        if (supabase && user_id !== 'anonymous') {
            try {
                await supabase
                    .from("deep_marketing_searches")
                    .insert({
                    id: searchId,
                    user_id: user_id,
                    query: query,
                    status: 'planning',
                    plan: planData,
                    created_at: new Date().toISOString()
                });
            }
            catch (dbError) {
                console.error("Error saving search to database:", dbError);
            }
        }
        res.json({
            search_id: searchId,
            plan: planData,
            status: 'planning'
        });
    }
    catch (error) {
        console.error("Error creating search plan:", error);
        res.status(500).json({ error: "Failed to create search plan" });
    }
});
// Execute search endpoint (modified to use webhook from DB)
app.post("/api/deep-marketing/execute-search", async (req, res) => {
    const sessionId = req.cookies?.session_id;
    if (!sessionId || !sessions.has(sessionId)) {
        return res.status(401).json({ error: "Not authenticated" });
    }
    const { search_id } = req.body;
    if (!search_id) {
        return res.status(400).json({ error: "Missing search_id" });
    }
    const search = activeSearches.get(search_id);
    if (!search) {
        return res.status(404).json({ error: "Search not found" });
    }
    // Get webhook URL from database
    const n8n_webhook = await getWebhookUrl('deep_marketing_execute_search');
    if (!n8n_webhook) {
        return res.status(503).json({ error: "Execute webhook not configured. Please contact admin." });
    }
    try {
        // Update search status
        search.status = 'executing';
        activeSearches.set(search_id, search);
        // Forward to n8n webhook for execution
        axios_1.default.post(n8n_webhook, {
            action: 'execute_search',
            search_id: search_id,
            plan: search.plan,
            user_id: search.user_id,
            mcp_endpoint: `${baseUrl}/mcp-api/sse`,
            callback_url: `${baseUrl}/api/deep-marketing/receive-results`,
            timestamp: new Date().toISOString()
        }).catch(error => {
            console.error("Error executing search in n8n:", error);
            // Update search status on error
            search.status = 'error';
            search.error = error.message;
            activeSearches.set(search_id, search);
        });
        res.json({
            search_id: search_id,
            status: 'executing',
            message: 'Search execution started'
        });
    }
    catch (error) {
        console.error("Error executing search:", error);
        res.status(500).json({ error: "Failed to execute search" });
    }
});
// Receive results from n8n
app.post("/api/deep-marketing/receive-results", async (req, res) => {
    const { search_id, results, status, error } = req.body;
    if (!search_id) {
        return res.status(400).json({ error: "Missing search_id" });
    }
    const search = activeSearches.get(search_id);
    if (!search) {
        return res.status(404).json({ error: "Search not found" });
    }
    // Update search with results
    search.status = status || 'completed';
    search.results = results;
    search.error = error;
    search.completed_at = new Date().toISOString();
    activeSearches.set(search_id, search);
    // Save to database if available
    if (supabase && search.user_id !== 'anonymous') {
        try {
            await supabase
                .from("deep_marketing_searches")
                .update({
                status: search.status,
                results: results,
                error: error,
                completed_at: search.completed_at
            })
                .eq("id", search_id);
        }
        catch (dbError) {
            console.error("Error updating search in database:", dbError);
        }
    }
    res.json({
        success: true,
        message: "Results received",
        search_id: search_id
    });
});
// Get search results
app.get("/api/deep-marketing/results/:searchId", async (req, res) => {
    const sessionId = req.cookies?.session_id;
    if (!sessionId || !sessions.has(sessionId)) {
        return res.status(401).json({ error: "Not authenticated" });
    }
    const { searchId } = req.params;
    const search = activeSearches.get(searchId);
    if (!search) {
        // Try to load from database
        if (supabase) {
            try {
                const { data, error } = await supabase
                    .from("deep_marketing_searches")
                    .select("*")
                    .eq("id", searchId)
                    .single();
                if (data) {
                    return res.json(data);
                }
            }
            catch (dbError) {
                console.error("Error loading search from database:", dbError);
            }
        }
        return res.status(404).json({ error: "Search not found" });
    }
    res.json(search);
});
// Error handling middleware
app.use((err, req, res, next) => {
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
