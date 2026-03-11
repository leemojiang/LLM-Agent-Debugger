import express from "express";
import { createServer as createViteServer } from "vite";
import { Server } from "socket.io";
import http from "http";
import dotenv from "dotenv";
import Database from "better-sqlite3";
import { v4 as uuidv4 } from "uuid";

dotenv.config();

const app = express();
const server = http.createServer(app);
const io = new Server(server);
const PORT = process.env.PORT || 3000;

// Database Setup
const db = new Database("debugger.db");
db.exec(`
  CREATE TABLE IF NOT EXISTS logs (
    id TEXT PRIMARY KEY,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
    method TEXT,
    url TEXT,
    request_headers TEXT,
    request_body TEXT,
    response_headers TEXT,
    response_body TEXT,
    status_code INTEGER,
    session_id TEXT,
    is_sse BOOLEAN DEFAULT 0
  )
`);

// State
let autoMode = process.env.AUTO_MODE === "true";
let UPSTREAM_URL = process.env.UPSTREAM_URL || "http://127.0.0.1:8832";
const PROXY_URL = process.env.APP_URL || "http://localhost:3000";
const pendingRequests = new Map<string, (modifiedBody?: any) => void>();

// Health check for upstream
let upstreamStatus: 'online' | 'offline' = 'offline';

async function checkUpstream() {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 2000);
    
    await fetch(UPSTREAM_URL, { 
      method: 'HEAD', 
      signal: controller.signal,
      headers: { 'Connection': 'close' }
    }).catch(() => {
      // If HEAD fails, try a simple GET to the root
      return fetch(UPSTREAM_URL, { method: 'GET', signal: controller.signal });
    });
    
    clearTimeout(timeoutId);
    upstreamStatus = 'online';
  } catch (err) {
    upstreamStatus = 'offline';
  }
  io.emit('status_update', { 
    upstream: upstreamStatus,
    upstreamUrl: UPSTREAM_URL
  });
}

// Check every 5 seconds
setInterval(checkUpstream, 5000);

// Socket.io
io.on("connection", (socket) => {
  console.log("Client connected");
  
  socket.emit('status_update', { 
    upstream: upstreamStatus,
    upstreamUrl: UPSTREAM_URL,
    proxyUrl: PROXY_URL
  });
  
  // Send current state
  socket.emit("config_update", {
    autoMode,
    upstreamUrl: UPSTREAM_URL,
    proxyUrl: PROXY_URL,
    bypassUrl: process.env.BYPASS_URL
  });

  socket.on("update_config", (data) => {
    if (data.upstreamUrl) {
      UPSTREAM_URL = data.upstreamUrl;
      console.log(`Upstream URL updated to: ${UPSTREAM_URL}`);
      checkUpstream(); // Immediate check
    }
    if (data.autoMode !== undefined) {
      autoMode = data.autoMode;
    }
    io.emit("config_update", { 
      autoMode, 
      upstreamUrl: UPSTREAM_URL,
      proxyUrl: PROXY_URL
    });
  });
  socket.on("release_request", ({ id, modifiedBody }) => {
    const resolver = pendingRequests.get(id);
    if (resolver) {
      resolver(modifiedBody);
      pendingRequests.delete(id);
    }
  });

  socket.on("toggle_auto_mode", (val: boolean) => {
    autoMode = val;
    io.emit("config_update", { autoMode });
  });

  socket.on("clear_logs", () => {
    db.prepare("DELETE FROM logs").run();
    io.emit("logs_cleared");
  });
});

// Middleware for JSON parsing (only for non-proxy routes if any, 
// but we'll need it to inspect payloads for proxying)
app.use(express.json({ limit: '50mb' }));

// Helper to send to bypass proxy
async function sendToBypass(data: any) {
  const bypassUrl = process.env.BYPASS_URL;
  if (!bypassUrl) return;
  try {
    await fetch(bypassUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data)
    });
  } catch (err) {
    console.error("Bypass proxy error:", err);
  }
}

// Proxy Logic
app.all("*", async (req, res, next) => {
  // 1. Skip Vite internal requests and static assets
  if (
    req.url.startsWith("/@") || 
    req.url.startsWith("/src") || 
    req.url.startsWith("/node_modules") || 
    req.url.includes("vite") ||
    req.url.includes(".") // Static files like .svg, .png, .js
  ) {
    return next();
  }

  // 2. If it's a browser request for the root or an HTML page, serve the UI
  if (req.url === "/" || (req.headers.accept && req.headers.accept.includes("text/html"))) {
    return next();
  }

  // 3. Skip API routes for the debugger UI itself
  if (req.url.startsWith("/api/debugger")) {
    return next();
  }

  const id = uuidv4();
  const targetUrl = `${UPSTREAM_URL}${req.url}`;
  
  // Extract session ID if possible (common in LLM APIs)
  const sessionId = req.body?.session_id || req.body?.user || "default";

  const logEntry = {
    id,
    method: req.method,
    url: req.url,
    request_headers: JSON.stringify(req.headers),
    request_body: JSON.stringify(req.body),
    session_id: sessionId,
    status_code: 0,
    response_headers: "",
    response_body: "",
    is_sse: false
  };

  // Notify frontend
  io.emit("request_received", logEntry);

  // Step-through logic
  let finalBody = req.body;
  if (!autoMode && req.method !== "GET") {
    finalBody = await new Promise((resolve) => {
      pendingRequests.set(id, resolve);
    });
  }

  try {
    const headers: any = { ...req.headers };
    
    // Remove hop-by-hop headers that fetch/undici forbids or manages itself
    const forbiddenHeaders = [
      'host',
      'connection',
      'keep-alive',
      'proxy-authenticate',
      'proxy-authorization',
      'te',
      'trailers',
      'transfer-encoding',
      'upgrade',
      'content-length'
    ];
    
    forbiddenHeaders.forEach(h => delete headers[h]);

    const response = await fetch(targetUrl, {
      method: req.method,
      headers,
      body: req.method !== "GET" ? JSON.stringify(finalBody) : undefined
    }).catch(err => {
      if (err.code === 'ECONNREFUSED' || err.cause?.code === 'ECONNREFUSED') {
        throw new Error(`Upstream connection refused at ${targetUrl}. Please check if your target service is running.`);
      }
      throw err;
    });

    const isSSE = response.headers.get("content-type")?.includes("text/event-stream");
    logEntry.status_code = response.status;
    logEntry.response_headers = JSON.stringify(Object.fromEntries(response.headers.entries()));
    logEntry.is_sse = !!isSSE;

    // Set response headers
    response.headers.forEach((value, key) => {
      res.setHeader(key, value);
    });
    res.status(response.status);

    if (isSSE) {
      console.log(`Streaming SSE for request ${id}`);
      io.emit("response_started", { id, isSSE: true });
      
      const reader = response.body!.getReader();
      const decoder = new TextDecoder();

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        
        const text = decoder.decode(value, { stream: true });
        res.write(value);
        io.emit("sse_chunk", { id, chunk: text });
      }

      res.end();
      io.emit("response_finished", { id });
      
      // Save to DB (simplified for SSE)
      db.prepare(`
        INSERT INTO logs (id, method, url, request_headers, request_body, response_headers, status_code, session_id, is_sse)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(id, logEntry.method, logEntry.url, logEntry.request_headers, logEntry.request_body, logEntry.response_headers, logEntry.status_code, logEntry.session_id, 1);
      
      sendToBypass({ ...logEntry, type: "sse_complete" });
    } else {
      const bodyText = await response.text();
      logEntry.response_body = bodyText;
      res.send(bodyText);
      
      io.emit("response_received", { id, status: response.status, body: bodyText });

      // Save to DB
      db.prepare(`
        INSERT INTO logs (id, method, url, request_headers, request_body, response_headers, response_body, status_code, session_id, is_sse)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(id, logEntry.method, logEntry.url, logEntry.request_headers, logEntry.request_body, logEntry.response_headers, logEntry.response_body, logEntry.status_code, logEntry.session_id, 0);

      sendToBypass(logEntry);
    }
  } catch (err: any) {
    const isConnRefused = err.code === 'ECONNREFUSED' || err.message.includes('fetch failed');
    const errorMessage = isConnRefused 
      ? `Upstream connection refused at ${UPSTREAM_URL}. Please check if your target service is running.`
      : err.message;

    console.error("Proxy error:", errorMessage);
    
    res.status(502).json({ 
      error: "Bad Gateway", 
      message: errorMessage 
    });

    io.emit("response_error", { 
      id, 
      error: errorMessage,
      isConnectionError: isConnRefused
    });
  }
});

// Vite Integration
async function startServer() {
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static("dist"));
  }

  server.listen(PORT, "0.0.0.0", () => {
    console.log(`Debugger Proxy running on http://localhost:${PORT}`);
    console.log(`Upstream: ${process.env.UPSTREAM_URL}`);
  });
}

startServer();
