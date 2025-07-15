"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const index_js_1 = require("@modelcontextprotocol/sdk/server/index.js");
const streamableHttp_js_1 = require("@modelcontextprotocol/sdk/server/streamableHttp.js");
const types_js_1 = require("@modelcontextprotocol/sdk/types.js");
const dotenv_1 = __importDefault(require("dotenv"));
const supabase_js_1 = require("@supabase/supabase-js");
const axios_1 = __importDefault(require("axios"));
const crypto_1 = __importDefault(require("crypto"));
const path_1 = __importDefault(require("path"));
const cookie_parser_1 = __importDefault(require("cookie-parser"));
dotenv_1.default.config();
// Configuration
const PORT = process.env.PORT || 3000;
const SUPABASE_URL = process.env.SUPABASE_URL || "";
const SUPABASE_KEY = process.env.SUPABASE_KEY || "";
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || "";
const FB_APP_ID = process.env.FB_APP_ID || "";
const FB_APP_SECRET = process.env.FB_APP_SECRET || "";
const FB_GRAPH_VERSION = "v21.0";
// Initialize Supabase
const supabase = SUPABASE_URL && SUPABASE_KEY && SUPABASE_KEY !== "your-supabase-service-key"
    ? (0, supabase_js_1.createClient)(SUPABASE_URL, SUPABASE_KEY)
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
const app = (0, express_1.default)();
app.use((0, cookie_parser_1.default)());
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
// Facebook API helper
async function fetchAdsFromFacebook(params, fbToken) {
    try {
        const url = `https://graph.facebook.com/${FB_GRAPH_VERSION}/ads_archive`;
        const response = await axios_1.default.get(url, {
            params: {
                ...params,
                access_token: fbToken,
                fields: 'id,ad_creative_body,ad_creative_link_caption,ad_creative_link_description,ad_creative_link_title,ad_delivery_start_time,ad_delivery_stop_time,page_id,page_name,impressions,spend',
            },
            timeout: 30000,
        });
        return response.data;
    }
    catch (error) {
        console.error("Facebook API error:", error.response?.data || error.message);
        return { error: error.response?.data?.error?.message || "Facebook API error" };
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
    const fbToken = userId ? await getFacebookToken(userId) : null;
    console.log("[TOOL] Tool execution context:", { userId, hasFbToken: !!fbToken });
    try {
        let result;
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
                }
                else {
                    const params = {
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
                }
                else {
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
        resource: `${baseUrl}/mcp-api/sse`,
        oauth_authorization_server: baseUrl,
        oauth_scopes_supported: ["mcp"],
        mcp_version: "2024-11-05"
    });
});
app.get("/.well-known/oauth-authorization-server", (req, res) => {
    console.log("📋 OAuth authorization server metadata requested");
    res.header("Access-Control-Allow-Origin", "*");
    res.json({
        issuer: baseUrl,
        authorization_endpoint: `${baseUrl}/authorize`,
        token_endpoint: `${baseUrl}/token`,
        token_endpoint_auth_methods_supported: ["none"],
        response_types_supported: ["code"],
        scopes_supported: ["mcp"],
        code_challenge_methods_supported: ["S256"],
        grant_types_supported: ["authorization_code"]
    });
});
// Mount the MCP transport handler with authentication
app.use("/mcp-api", express_1.default.json(), async (req, res, next) => {
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
    }
    else {
        console.log("[AUTH] No Bearer token in Authorization header");
    }
    // Handle the MCP request
    await transport.handleRequest(req, res, req.body);
});
// OAuth Authorization endpoint
app.get("/authorize", (req, res) => {
    const { response_type, client_id, redirect_uri, state, code_challenge, code_challenge_method, scope } = req.query;
    console.log("🔐 OAuth authorize request:", { client_id, redirect_uri, state });
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
app.post("/login", express_1.default.urlencoded({ extended: true }), async (req, res) => {
    const { email, password, state } = req.body;
    console.log("🔐 Login attempt:", { email, state });
    // In demo mode or with Supabase
    let userId = null;
    if (supabase) {
        // Real authentication with Supabase
        try {
            const { data, error } = await supabase.auth.signInWithPassword({ email, password });
            if (data?.user) {
                userId = data.user.id;
            }
        }
        catch (error) {
            console.error("Login error:", error);
        }
    }
    else {
        // Demo mode - accept any credentials
        userId = `demo_${email}`;
        console.log("🎮 Demo mode login:", userId);
    }
    if (!userId) {
        return res.status(401).send("Invalid credentials");
    }
    // Create session
    const sessionId = crypto_1.default.randomBytes(32).toString('hex');
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
        return res.redirect(req.body.next_url || '/');
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
    console.log("✅ Login successful, redirecting with code");
    res.redirect(redirectUrl.toString());
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
    // Generate access token
    const accessToken = `dmgt_${crypto_1.default.randomBytes(32).toString('hex')}`;
    // Save token to database if available
    if (supabase && codeData.user_id) {
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
// Legacy endpoint redirects
app.get("/mcp-api/sse", (req, res) => {
    res.redirect("/mcp-api");
});
// Define base URL for all routes
const baseUrl = process.env.BASE_URL || (process.env.NODE_ENV === 'production' ? `https://drivenmetrics-mcp.onrender.com` : `http://localhost:${PORT}`);
// Home page
app.get("/", (req, res) => {
    const sessionId = req.cookies?.session_id;
    const session = sessionId ? sessions.get(sessionId) : null;
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
// Setup integrations page
app.get("/setup/integrations", async (req, res) => {
    const sessionId = req.cookies?.session_id;
    if (!sessionId || !sessions.has(sessionId)) {
        return res.redirect('/login');
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
    const fbRedirectUri = `${baseUrl}/api/authorise/facebook/callback`;
    res.render('setup_integrations', {
        user: session,
        has_facebook: hasFacebook,
        oauth_state: req.query.oauth_state,
        pending_oauth: false,
        fb_app_id: FB_APP_ID,
        fb_redirect_uri: fbRedirectUri
    });
});
// Facebook OAuth callback
app.get("/api/authorise/facebook/callback", async (req, res) => {
    const { code, state, error } = req.query;
    const sessionId = req.cookies?.session_id;
    if (!sessionId || !sessions.has(sessionId)) {
        return res.redirect('/login');
    }
    const session = sessions.get(sessionId);
    const userId = session.user_id;
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
            return res.redirect("/setup/integrations?success=facebook");
        }
        catch (error) {
            console.error("Facebook token exchange error:", error);
            return res.redirect("/setup/integrations?error=facebook_failed");
        }
    }
    return res.redirect("/setup/integrations");
});
// Complete OAuth flow from integrations page
app.post("/api/oauth/complete", express_1.default.urlencoded({ extended: true }), async (req, res) => {
    const { oauth_state } = req.body;
    const sessionId = req.cookies?.session_id;
    if (!sessionId || !sessions.has(sessionId)) {
        return res.status(401).json({ error: "Not authenticated" });
    }
    const oauthData = oauthStates.get(oauth_state);
    if (!oauthData) {
        return res.status(400).json({ error: "Invalid OAuth state" });
    }
    // Redirect back to authorize to complete the OAuth flow
    res.redirect(`/authorize?state=${oauth_state}`);
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
    console.log(`📡 MCP endpoint: http://localhost:${PORT}/mcp-api`);
    console.log(`🔐 OAuth server: ${baseUrl}`);
    console.log(`📁 Template directory: ${templatesDir}`);
    console.log(`✅ Ready for Claude.ai connections!`);
});
