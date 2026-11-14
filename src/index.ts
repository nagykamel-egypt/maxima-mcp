#!/usr/bin/env node
import { config as loadDotenv } from "dotenv";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { ConfigError, loadConfig } from "./config.js";
import { startHttpServer, type HttpServerHandle } from "./http.js";
import { createLogger, flushLogger } from "./logger.js";
import { createRuntime, shutdownRuntime } from "./runtime.js";
import { createMcpServer } from "./server.js";
import { SERVER_NAME, serverVersion } from "./version.js";

loadDotenv({ quiet: true });

function printHelp(): void {
  process.stdout.write(`\
${SERVER_NAME} ${serverVersion()} — Model Context Protocol server for Maxima

Usage:
  maxima-mcp [--help] [--version]

The server is configured with environment variables. Common options:

  MAXIMA_MCP_TRANSPORT=stdio|http     Transport (default: stdio)
  MAXIMA_BIN=maxima                   Maxima executable
  MAXIMA_MCP_DEFAULT_TIMEOUT_MS=30000 Default evaluation timeout
  MAXIMA_MCP_MAX_TIMEOUT_MS=300000    Maximum allowed timeout
  MAXIMA_MCP_ALLOW_DANGEROUS=false    Allow system(), load(), writefile(), ...
  MAXIMA_MCP_DOC_DIR=...              Maxima HTML manual directory
  MAXIMA_MCP_SRC_DIR=...              Maxima source directory
  MAXIMA_MCP_SHARE_DIR=...            Maxima share directory

HTTP transport:
  MAXIMA_MCP_HOST=127.0.0.1
  MAXIMA_MCP_PORT=7331
  MAXIMA_MCP_AUTH_TOKEN=<token>       Bearer token for /mcp and /metrics
  MAXIMA_MCP_CORS_ORIGINS=*
  MAXIMA_MCP_ALLOWED_HOSTS=host1,host2
  MAXIMA_MCP_JSON_RESPONSE=false      Return JSON instead of SSE streams

Endpoints (HTTP): /mcp, /healthz, /readyz, /metrics, /

MCP client configuration (stdio):
  {
    "mcpServers": {
      "maxima": {
        "command": "npx",
        "args": ["-y", "maxima-mcp"]
      }
    }
  }

Documentation: https://github.com/maxima-project/maxima-mcp
`);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.includes("--help") || args.includes("-h")) {
    printHelp();
    return;
  }
  if (args.includes("--version") || args.includes("-v")) {
    process.stdout.write(`${serverVersion()}\n`);
    return;
  }

  let config;
  try {
    config = loadConfig();
  } catch (error) {
    if (error instanceof ConfigError) {
      process.stderr.write(`Configuration error: ${error.message}\n`);
      process.exitCode = 1;
      return;
    }
    throw error;
  }

  const logger = createLogger(config.logging);
  for (const warning of config.warnings) logger.warn(warning);

  const runtime = createRuntime(config, logger);
  const version = runtime.maximaVersion();
  logger.info(
    {
      version: serverVersion(),
      transport: config.transport,
      maxima: version.version ?? "unknown",
      maximaAvailable: version.available,
      docs: config.docs.enabled,
      safeMode: !config.maxima.allowDangerous,
    },
    `${SERVER_NAME} starting`,
  );

  let shuttingDown = false;
  const handles: { http?: HttpServerHandle } = {};
  let stdioServer: ReturnType<typeof createMcpServer> | undefined;

  const shutdown = async (reason: string, exitCode = 0): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info({ reason }, "Shutting down");
    try {
      if (handles.http) await handles.http.close();
      if (stdioServer) await stdioServer.close();
      await shutdownRuntime(runtime);
    } catch (error) {
      logger.error({ err: error }, "Error during shutdown");
      exitCode = 1;
    } finally {
      await flushLogger(logger);
      process.exitCode = exitCode;
      // Allow pending stderr writes to flush before the process exits.
      setTimeout(() => process.exit(exitCode), 100).unref?.();
    }
  };

  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("uncaughtException", (error) => {
    logger.fatal({ err: error }, "Uncaught exception");
    void shutdown("uncaughtException", 1);
  });
  process.on("unhandledRejection", (reason) => {
    logger.fatal({ err: reason }, "Unhandled rejection");
    void shutdown("unhandledRejection", 1);
  });

  if (config.transport === "stdio") {
    stdioServer = createMcpServer(runtime);
    const transport = new StdioServerTransport();
    await stdioServer.connect(transport);
    logger.info("MCP server connected over stdio");
    process.stdin.on("end", () => void shutdown("stdin closed"));
    process.stdin.on("close", () => void shutdown("stdin closed"));
    return;
  }

  handles.http = await startHttpServer(runtime, logger);
  logger.info(
    {
      port: handles.http.port,
      endpoint: `http://${config.http.host}:${handles.http.port}/mcp`,
    },
    "MCP server ready",
  );
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? (error.stack ?? error.message) : String(error);
  process.stderr.write(`${SERVER_NAME} failed to start: ${message}\n`);
  process.exit(1);
});
