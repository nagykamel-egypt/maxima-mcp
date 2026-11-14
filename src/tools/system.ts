import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { SERVER_NAME, serverVersion } from "../version.js";
import type { Runtime } from "../runtime.js";
import { guarded, textResult } from "./helpers.js";

const docsStatusSchema = z.object({
  enabled: z.boolean(),
  state: z.string(),
  entries: z.number(),
  sections: z.number(),
  load_time_ms: z.number().optional(),
  error: z.string().optional(),
  html_dir: z.string(),
});

const sourceStatusSchema = z.object({
  state: z.string(),
  files: z.number(),
  symbols: z.number(),
  packages: z.number(),
  load_time_ms: z.number().optional(),
  error: z.string().optional(),
});

export function registerSystemTools(server: McpServer, runtime: Runtime): void {
  server.registerTool(
    "maxima_system_info",
    {
      title: "Maxima MCP server status",
      description:
        "Report server health, the installed Maxima version, configuration limits, open sessions, and documentation/source index status.",
      inputSchema: {},
      annotations: {
        title: "Maxima MCP server status",
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
      outputSchema: z.object({
        server: z.object({
          name: z.string(),
          version: z.string(),
          uptime_seconds: z.number(),
          node_version: z.string(),
          pid: z.number(),
        }),
        maxima: z.object({
          bin: z.string(),
          version: z.string().optional(),
          available: z.boolean(),
          default_session: z.string(),
          max_sessions: z.number(),
          default_timeout_ms: z.number(),
          max_timeout_ms: z.number(),
          allow_dangerous: z.boolean(),
        }),
        sessions: z.object({
          count: z.number(),
          busy: z.number(),
          default_session: z.string(),
          ids: z.array(z.string()),
        }),
        docs: docsStatusSchema,
        source: sourceStatusSchema,
        memory: z.object({ rss_mb: z.number(), heap_used_mb: z.number() }),
        warnings: z.array(z.string()),
      }),
    },
    async (): Promise<CallToolResult> =>
      guarded(runtime, "maxima_system_info", async () => {
        const version = runtime.maximaVersion();
        const sessions = runtime.sessions.list();
        const memory = process.memoryUsage();
        const docs = runtime.docs.status();
        const source = runtime.source.status();
        const data = {
          server: {
            name: SERVER_NAME,
            version: serverVersion(),
            uptime_seconds: Math.round((Date.now() - runtime.startedAt) / 1000),
            node_version: process.version,
            pid: process.pid,
          },
          maxima: {
            bin: runtime.config.maxima.bin,
            ...(version.version === undefined ? {} : { version: version.version }),
            available: version.available,
            default_session: runtime.config.maxima.defaultSession,
            max_sessions: runtime.config.maxima.maxSessions,
            default_timeout_ms: runtime.config.maxima.defaultTimeoutMs,
            max_timeout_ms: runtime.config.maxima.maxTimeoutMs,
            allow_dangerous: runtime.config.maxima.allowDangerous,
          },
          sessions: {
            count: sessions.length,
            busy: sessions.filter((session) => session.busy).length,
            default_session: runtime.sessions.defaultSessionId,
            ids: sessions.map((session) => session.id),
          },
          docs: {
            enabled: docs.enabled,
            state: docs.state,
            entries: docs.entries,
            sections: docs.sections,
            ...(docs.loadTimeMs === undefined ? {} : { load_time_ms: docs.loadTimeMs }),
            ...(docs.error === undefined ? {} : { error: docs.error }),
            html_dir: docs.htmlDir,
          },
          source: {
            state: source.state,
            files: source.files,
            symbols: source.symbols,
            packages: source.packages,
            ...(source.loadTimeMs === undefined ? {} : { load_time_ms: source.loadTimeMs }),
            ...(source.error === undefined ? {} : { error: source.error }),
          },
          memory: {
            rss_mb: Number((memory.rss / 1024 / 1024).toFixed(1)),
            heap_used_mb: Number((memory.heapUsed / 1024 / 1024).toFixed(1)),
          },
          warnings: runtime.config.warnings,
        };

        const text = [
          `# ${SERVER_NAME} ${serverVersion()}`,
          `- Uptime: ${data.server.uptime_seconds}s`,
          `- Node: ${data.server.node_version}`,
          "",
          "## Maxima",
          `- Binary: \`${data.maxima.bin}\``,
          `- Version: ${data.maxima.version ?? "unknown"}`,
          `- Available: ${data.maxima.available ? "yes" : "no"}`,
          `- Default session: ${data.maxima.default_session}`,
          `- Safe mode: ${data.maxima.allow_dangerous ? "disabled (dangerous primitives allowed)" : "enabled"}`,
          `- Sessions: ${data.sessions.count} open, ${data.sessions.busy} busy`,
          "",
          "## Documentation",
          `- State: ${data.docs.state}; ${data.docs.entries} entries in ${data.docs.sections} sections`,
          `- Directory: \`${data.docs.html_dir}\``,
          "",
          "## Source",
          `- State: ${data.source.state}; ${data.source.files} files, ${data.source.symbols} symbols, ${data.source.packages} packages`,
          "",
          "## Memory",
          `- RSS: ${data.memory.rss_mb} MiB; heap: ${data.memory.heap_used_mb} MiB`,
          ...(data.warnings.length > 0
            ? ["", "## Warnings", ...data.warnings.map((warning) => `- ${warning}`)]
            : []),
        ].join("\n");

        return textResult(text, data);
      }),
  );
}
