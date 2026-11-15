import { randomUUID, timingSafeEqual } from "node:crypto";
import { createServer as createHttpServer, type Server } from "node:http";
import cors from "cors";
import express, { type NextFunction, type Request, type Response } from "express";
import {
  createMcpHandler,
  isJsonContentType,
  isLegacyRequest,
  type McpServer,
} from "@modelcontextprotocol/server";
import {
  NodeStreamableHTTPServerTransport,
  toNodeHandler,
  toWebRequest,
} from "@modelcontextprotocol/node";
import type { Logger } from "./logger.js";
import type { Runtime } from "./runtime.js";
import { createMcpServer } from "./server.js";
import { SERVER_NAME, serverVersion } from "./version.js";

import { FixedWindowRateLimiter } from "./utils/ratelimit.js";

interface HttpSession {
  id: string;
  server: McpServer;
  transport: NodeStreamableHTTPServerTransport;
  lastUsed: number;
  closed: boolean;
}

export interface HttpServerHandle {
  port: number;
  close: () => Promise<void>;
}

function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

function authMiddleware(token: string) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const header = req.headers.authorization ?? "";
    const match = header.match(/^Bearer\s+(.+)$/i);
    if (!match || !safeEqual(match[1]!.trim(), token)) {
      res.setHeader("WWW-Authenticate", 'Bearer realm="maxima-mcp"');
      res.status(401).json({
        jsonrpc: "2.0",
        error: { code: -32001, message: "Unauthorized" },
        id: null,
      });
      return;
    }
    next();
  };
}

function jsonRpcError(res: Response, status: number, code: number, message: string): void {
  if (res.headersSent) return;
  res.status(status).json({ jsonrpc: "2.0", error: { code, message }, id: null });
}

function sessionIdFrom(req: Request): string | undefined {
  const header = req.headers["mcp-session-id"];
  if (Array.isArray(header)) return header[0];
  return header;
}

/** Convert an Express-style body limit ("2mb") to the byte bound the MCP SDKs expect. */
function parseBodyLimitBytes(value: string, fallback = 4 * 1024 * 1024): number {
  const match = value
    .trim()
    .toLowerCase()
    .match(/^(\d+(?:\.\d+)?)\s*(b|kb|mb|gb)?$/);
  if (!match) return fallback;
  const amount = Number(match[1]);
  const unit = match[2] ?? "b";
  const multiplier =
    unit === "gb" ? 1024 ** 3 : unit === "mb" ? 1024 ** 2 : unit === "kb" ? 1024 : 1;
  return Math.max(1, Math.floor(amount * multiplier));
}

function normaliseHostname(value: string): string {
  const host = value.toLowerCase().trim();
  // Bracketed IPv6 literals, optionally with a port: [::1]:7331 -> ::1
  if (host.startsWith("[")) {
    const end = host.indexOf("]");
    return end >= 0 ? host.slice(1, end) : host.slice(1);
  }
  // Unbracketed IPv6 has more than one colon and carries no port.
  if ((host.match(/:/g) ?? []).length > 1) return host;
  const index = host.indexOf(":");
  if (index >= 0) return host.slice(0, index);
  return host;
}

export async function startHttpServer(runtime: Runtime, logger: Logger): Promise<HttpServerHandle> {
  const { config } = runtime;
  const bodyLimitBytes = parseBodyLimitBytes(config.http.bodyLimit);
  const app = express();
  app.disable("x-powered-by");
  app.set("trust proxy", config.http.trustProxy ? 1 : false);

  // Assign a correlation id to every request, honouring a client-supplied one.
  app.use((req, res, next) => {
    const requestId = (req.headers["x-request-id"] as string | undefined)?.trim() || randomUUID();
    res.locals.requestId = requestId;
    res.setHeader("X-Request-Id", requestId);
    next();
  });

  // Hardening headers for a JSON-RPC API: no sniffing, no embedding, no referrer
  // leakage, and a restrictive default content policy.
  app.use((_req, res, next) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader("Content-Security-Policy", "default-src 'none'; frame-ancestors 'none'");
    next();
  });

  const sessions = new Map<string, HttpSession>();
  const rateLimiter = new FixedWindowRateLimiter(config.http.rateLimit, config.http.rateWindowMs);

  app.use(
    cors({
      origin: config.http.corsOrigins.includes("*") ? "*" : config.http.corsOrigins,
      methods: ["GET", "POST", "DELETE", "OPTIONS"],
      allowedHeaders: [
        "Content-Type",
        "Authorization",
        "Accept",
        "Mcp-Session-Id",
        "Mcp-Protocol-Version",
        "Last-Event-ID",
      ],
      exposedHeaders: ["Mcp-Session-Id", "Mcp-Protocol-Version"],
      maxAge: 600,
    }),
  );

  const allowedHosts = new Set(
    (config.http.allowedHosts.length > 0
      ? config.http.allowedHosts
      : ["127.0.0.1", "localhost", "::1"]
    ).map(normaliseHostname),
  );
  const enforceHost =
    config.http.allowedHosts.length > 0 ||
    ["127.0.0.1", "localhost", "::1", "::"].includes(config.http.host);
  if (enforceHost) {
    app.use((req, res, next) => {
      const hostname = normaliseHostname(req.hostname);
      if (!allowedHosts.has(hostname)) {
        res.status(403).json({
          jsonrpc: "2.0",
          error: { code: -32002, message: `Host '${req.hostname}' is not allowed.` },
          id: null,
        });
        return;
      }
      next();
    });
  }

  if (config.http.authToken) {
    app.use("/mcp", authMiddleware(config.http.authToken));
    app.use("/metrics", authMiddleware(config.http.authToken));
  }

  // Authenticate before parsing request bodies, and parse JSON only for MCP requests.
  app.use("/mcp", express.json({ limit: config.http.bodyLimit }));

  app.use((req, res, next) => {
    const started = Date.now();
    res.on("finish", () => {
      logger.debug(
        {
          method: req.method,
          path: req.path,
          status: res.statusCode,
          durationMs: Date.now() - started,
          requestId: res.locals.requestId,
        },
        "HTTP request",
      );
      runtime.metrics.inc("maxima_mcp_http_requests_total", {
        method: req.method,
        status: String(res.statusCode),
      });
    });
    next();
  });

  app.get("/", (_req, res) => {
    res.json({
      name: SERVER_NAME,
      version: serverVersion(),
      transport: "http",
      endpoints: { mcp: "/mcp", health: "/healthz", readiness: "/readyz", metrics: "/metrics" },
    });
  });

  app.get("/healthz", (_req, res) => {
    res.json({
      status: "ok",
      uptime_seconds: Math.round((Date.now() - runtime.startedAt) / 1000),
    });
  });

  app.get("/readyz", (_req, res) => {
    const version = runtime.maximaVersion();
    const ready = version.available;
    res.status(ready ? 200 : 503).json({
      status: ready ? "ready" : "unavailable",
      maxima: { available: version.available, version: version.version },
      docs: runtime.docs.status().state,
      source: runtime.source.status().state,
      sessions: runtime.sessions.size,
    });
  });

  app.get("/metrics", (_req, res) => {
    res.setHeader("Content-Type", "text/plain; version=0.0.4; charset=utf-8");
    res.send(runtime.metrics.render());
  });

  const destroySession = async (id: string): Promise<void> => {
    const session = sessions.get(id);
    if (!session || session.closed) return;
    session.closed = true;
    sessions.delete(id);
    await session.transport.close().catch((error: unknown) => {
      logger.debug({ err: error, session: id }, "Error closing MCP transport");
    });
    await session.server.close().catch((error: unknown) => {
      logger.debug({ err: error, session: id }, "Error closing MCP server");
    });
    runtime.metrics.gauge("maxima_mcp_http_sessions", sessions.size);
    logger.debug({ session: id }, "MCP HTTP session closed");
  };

  const createSession = async (): Promise<{
    server: McpServer;
    transport: NodeStreamableHTTPServerTransport;
  }> => {
    const server = createMcpServer(runtime);
    const transport: NodeStreamableHTTPServerTransport = new NodeStreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
      enableJsonResponse: config.http.enableJsonResponse,
      onsessioninitialized: (id) => {
        sessions.set(id, {
          id,
          server,
          transport,
          lastUsed: Date.now(),
          closed: false,
        });
        runtime.metrics.gauge("maxima_mcp_http_sessions", sessions.size);
        logger.debug({ session: id }, "MCP HTTP session initialized");
      },
      onsessionclosed: async (id) => {
        await destroySession(id);
      },
    });
    transport.onclose = () => {
      const id = transport.sessionId;
      if (id) void destroySession(id);
    };
    transport.onerror = (error) => {
      logger.warn({ err: error, session: transport.sessionId }, "MCP transport error");
    };
    await server.connect(transport);
    return { server, transport };
  };

  const modernMcp = createMcpHandler(() => createMcpServer(runtime), {
    legacy: "reject",
    onerror: (error) => {
      logger.warn({ err: error }, "MCP modern handler error");
    },
  });
  const handleModernMcp = toNodeHandler(modernMcp, {
    onerror: (error) => {
      logger.error({ err: error }, "MCP modern handler adapter error");
    },
    maxRequestBodySize: bodyLimitBytes,
  });

  const handleMcp = async (req: Request, res: Response): Promise<void> => {
    // The 2026-07-28 entry validates the media type itself; the hand-wired
    // legacy leg needs the same check before either path reads the body.
    if (req.method === "POST" && !isJsonContentType(req.headers["content-type"] ?? "")) {
      jsonRpcError(res, 415, -32000, "Unsupported Media Type");
      return;
    }

    let probe: globalThis.Request;
    try {
      probe = await toWebRequest(req, req.body, {
        maxRequestBodySize: bodyLimitBytes,
      });
    } catch (error) {
      const status =
        typeof error === "object" && error !== null && "status" in error
          ? Number((error as { status?: number }).status)
          : undefined;
      if (status === 413) {
        jsonRpcError(res, 413, -32000, "Request body too large.");
        return;
      }
      throw error;
    }

    // 2026-07-28 clients open with an envelope-bearing server/discover probe and
    // then send per-request envelopes. Everything else keeps the sessionful
    // 2025-era transport below.
    if (!(await isLegacyRequest(probe, req.body, { maxRequestBodySize: bodyLimitBytes }))) {
      await handleModernMcp(req, res, req.body);
      return;
    }

    const sessionId = sessionIdFrom(req);
    if (sessionId) {
      const session = sessions.get(sessionId);
      if (!session) {
        jsonRpcError(res, 404, -32001, "Session not found or expired.");
        return;
      }
      session.lastUsed = Date.now();
      await session.transport.handleRequest(req, res, req.body);
      return;
    }

    if (req.method !== "POST") {
      jsonRpcError(res, 400, -32600, "Mcp-Session-Id header is required.");
      return;
    }

    const { server, transport } = await createSession();
    try {
      await transport.handleRequest(req, res, req.body);
    } finally {
      // An invalid or non-initialize request never establishes a session; avoid leaking it.
      if (!transport.sessionId) {
        await server.close().catch(() => undefined);
      }
    }
  };

  app.post("/mcp", rateLimiter.middleware, (req, res) => {
    void handleMcp(req, res).catch((error: unknown) => {
      logger.error({ err: error }, "Unhandled MCP POST error");
      jsonRpcError(res, 500, -32603, "Internal server error.");
    });
  });

  app.get("/mcp", rateLimiter.middleware, (req, res) => {
    void handleMcp(req, res).catch((error: unknown) => {
      logger.error({ err: error }, "Unhandled MCP GET error");
      jsonRpcError(res, 500, -32603, "Internal server error.");
    });
  });

  app.delete("/mcp", rateLimiter.middleware, (req, res) => {
    void handleMcp(req, res).catch((error: unknown) => {
      logger.error({ err: error }, "Unhandled MCP DELETE error");
      jsonRpcError(res, 500, -32603, "Internal server error.");
    });
  });

  app.use((req, res) => {
    res.status(404).json({ error: "Not found" });
  });

  app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
    const status =
      typeof error === "object" && error !== null && "status" in error
        ? Number((error as { status?: number }).status)
        : 500;
    const message = error instanceof Error ? error.message : "Internal server error";
    if (status === 413 || /entity too large/i.test(message)) {
      jsonRpcError(res, 413, -32000, "Request body too large.");
      return;
    }
    if (status >= 400 && status < 500) {
      jsonRpcError(res, status, -32700, message);
      return;
    }
    logger.error({ err: error }, "Express error");
    jsonRpcError(res, 500, -32603, "Internal server error.");
  });

  const sweeper = setInterval(
    () => {
      const now = Date.now();
      for (const session of [...sessions.values()]) {
        if (now - session.lastUsed > config.http.sessionIdleMs) {
          logger.info({ session: session.id }, "Expiring idle MCP HTTP session");
          void destroySession(session.id);
        }
      }
    },
    Math.min(60_000, Math.max(15_000, Math.floor(config.http.sessionIdleMs / 4))),
  );
  sweeper.unref?.();

  const httpServer: Server = createHttpServer(app);
  await new Promise<void>((resolve, reject) => {
    httpServer.once("error", reject);
    httpServer.listen(config.http.port, config.http.host, () => {
      httpServer.off("error", reject);
      resolve();
    });
  });

  const address = httpServer.address();
  const port = typeof address === "object" && address ? address.port : config.http.port;
  logger.info(
    {
      host: config.http.host,
      port,
      auth: Boolean(config.http.authToken),
      cors: config.http.corsOrigins,
    },
    "MCP HTTP server listening",
  );

  return {
    port,
    close: async () => {
      clearInterval(sweeper);
      rateLimiter.dispose();
      await new Promise<void>((resolve) => {
        httpServer.close(() => resolve());
        // Give keep-alive sockets a moment to drain, then force close.
        setTimeout(() => {
          httpServer.closeAllConnections?.();
          resolve();
        }, 5_000).unref?.();
      });
      await Promise.allSettled([...sessions.keys()].map((id) => destroySession(id)));
      await modernMcp.close().catch((error: unknown) => {
        logger.debug({ err: error }, "Error closing modern MCP handler");
      });
    },
  };
}
