import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { newSessionId } from "../maxima/sessions.js";
import type { Runtime } from "../runtime.js";
import { guarded, textResult } from "./helpers.js";

const sessionInfoSchema = z.object({
  id: z.string(),
  name: z.string().optional(),
  created_at: z.string(),
  last_used_at: z.string(),
  evaluation_count: z.number(),
  alive: z.boolean(),
  pid: z.number().optional(),
  uptime_ms: z.number(),
  restarts: z.number(),
  busy: z.boolean(),
  is_default: z.boolean(),
});

const sessionListSchema = z.object({
  sessions: z.array(sessionInfoSchema),
  default_session: z.string(),
  max_sessions: z.number(),
});

const sessionOpenSchema = z.object({
  session: sessionInfoSchema,
  created: z.boolean(),
});

const sessionCloseSchema = z.object({
  session_id: z.string(),
  closed: z.boolean(),
});

const sessionIdArg = z
  .string()
  .min(1)
  .max(64)
  .describe("Session identifier (letters, digits, '_', '.', ':' or '-').");

function infoToJson(info: ReturnType<Runtime["sessions"]["list"]>[number]) {
  return {
    id: info.id,
    ...(info.name === undefined ? {} : { name: info.name }),
    created_at: info.createdAt,
    last_used_at: info.lastUsedAt,
    evaluation_count: info.evaluationCount,
    alive: info.alive,
    ...(info.pid === undefined ? {} : { pid: info.pid }),
    uptime_ms: info.uptimeMs,
    restarts: info.restarts,
    busy: info.busy,
    is_default: info.isDefault,
  };
}

export function registerSessionTools(server: McpServer, runtime: Runtime): void {
  server.registerTool(
    "maxima_session_open",
    {
      title: "Open a Maxima session",
      description:
        "Create a persistent Maxima session and start its process. Sessions preserve variables, function definitions and loaded packages across calls. If the requested id already exists it is reused.",
      inputSchema: {
        session_id: z
          .string()
          .min(1)
          .max(64)
          .optional()
          .describe("Optional session id. A random id is generated when omitted."),
        name: z
          .string()
          .min(1)
          .max(200)
          .optional()
          .describe("Human-readable label for the session."),
      },
      annotations: {
        title: "Open a Maxima session",
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
      outputSchema: sessionOpenSchema,
    },
    async (args): Promise<CallToolResult> =>
      guarded(runtime, "maxima_session_open", async () => {
        const id = args.session_id?.trim() || newSessionId();
        const existed = runtime.sessions.list().some((session) => session.id === id);
        const entry = await runtime.sessions.ensure(id, args.name);
        if (args.name) entry.name = args.name;
        if (!existed || !entry.process.alive) {
          // Start the process immediately so configuration and the Maxima binary are validated.
          await runtime.sessions.run(id, ["1+1$"], {
            timeoutMs: Math.min(runtime.config.maxima.defaultTimeoutMs, 30_000),
          });
        }
        const info = runtime.sessions.toInfo(entry);
        const text = [
          `Session '${info.id}' ${existed ? "reused" : "created"}.`,
          `State: ${info.alive ? "running" : "idle"}${info.pid ? ` (pid ${info.pid})` : ""}`,
          info.name ? `Name: ${info.name}` : undefined,
          info.isDefault ? "This is the default session." : undefined,
        ]
          .filter(Boolean)
          .join("\n");
        return textResult(text, { session: infoToJson(info), created: !existed });
      }),
  );

  server.registerTool(
    "maxima_session_list",
    {
      title: "List Maxima sessions",
      description: "List open Maxima sessions with process state and usage statistics.",
      inputSchema: {},
      annotations: {
        title: "List Maxima sessions",
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
      outputSchema: sessionListSchema,
    },
    async (): Promise<CallToolResult> =>
      guarded(runtime, "maxima_session_list", async () => {
        const sessions = runtime.sessions.list();
        const text = sessions.length
          ? sessions
              .map(
                (session) =>
                  `${session.isDefault ? "*" : " "} ${session.id} — ${session.alive ? "running" : "idle"}${
                    session.busy ? ", busy" : ""
                  }, ${session.evaluationCount} evaluations, ${session.restarts} restarts${
                    session.name ? ` (${session.name})` : ""
                  }`,
              )
              .join("\n")
          : "No sessions are open.";
        return textResult(text, {
          sessions: sessions.map(infoToJson),
          default_session: runtime.sessions.defaultSessionId,
          max_sessions: runtime.config.maxima.maxSessions,
        });
      }),
  );

  server.registerTool(
    "maxima_session_close",
    {
      title: "Close a Maxima session",
      description:
        "Terminate a session and release its Maxima process. The default session is recreated automatically on the next evaluation. Closing an unknown session is a no-op.",
      inputSchema: {
        session_id: sessionIdArg,
      },
      annotations: {
        title: "Close a Maxima session",
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: true,
        openWorldHint: false,
      },
      outputSchema: sessionCloseSchema,
    },
    async (args): Promise<CallToolResult> =>
      guarded(runtime, "maxima_session_close", async () => {
        const closed = await runtime.sessions.close(args.session_id);
        return textResult(
          closed
            ? `Session '${args.session_id}' closed.`
            : `Session '${args.session_id}' was not open.`,
          { session_id: args.session_id, closed },
        );
      }),
  );

  server.registerTool(
    "maxima_session_reset",
    {
      title: "Reset a Maxima session",
      description:
        "Discard all variables, definitions and loaded packages by terminating the session's Maxima process and starting a fresh one with the same session id.",
      inputSchema: {
        session_id: sessionIdArg,
      },
      annotations: {
        title: "Reset a Maxima session",
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: true,
        openWorldHint: false,
      },
      outputSchema: sessionOpenSchema,
    },
    async (args): Promise<CallToolResult> =>
      guarded(runtime, "maxima_session_reset", async () => {
        let info = await runtime.sessions.reset(args.session_id);
        // Start the fresh process now so the caller gets a validated, ready session.
        await runtime.sessions.run(args.session_id, ["1+1$"], {
          timeoutMs: Math.min(runtime.config.maxima.defaultTimeoutMs, 30_000),
        });
        info = runtime.sessions.toInfo(runtime.sessions.get(args.session_id));
        return textResult(`Session '${info.id}' reset; previous state was discarded.`, {
          session: infoToJson(info),
          created: false,
        });
      }),
  );
}
