import { z } from "zod";
import type { CallToolResult, McpServer } from "@modelcontextprotocol/server";
import { normalizeCommands } from "../maxima/expressions.js";
import { isErrorText } from "../maxima/output.js";
import type { RunOptions } from "../maxima/process.js";
import type { Runtime } from "../runtime.js";
import { clampTimeout, guarded, textResult } from "./helpers.js";

const commandResultSchema = z.object({
  command: z.string(),
  output: z.string(),
  is_error: z.boolean(),
  warnings: z.array(z.string()),
});

const evalOutputSchema = z.object({
  session_id: z.string(),
  results: z.array(commandResultSchema),
  duration_ms: z.number(),
  restarted: z.boolean(),
  stderr: z.string().optional(),
  truncated: z.boolean(),
});

function combineOutput(output: string, stderr: string): string {
  const trimmedErr = stderr.trim();
  if (!trimmedErr) return output;
  if (output.includes(trimmedErr)) return output;
  return output ? `${output}\n\n[stderr]\n${trimmedErr}` : trimmedErr;
}

export function registerEvaluateTools(server: McpServer, runtime: Runtime): void {
  const { config } = runtime;

  server.registerTool(
    "maxima_eval",
    {
      title: "Evaluate Maxima expression",
      description:
        "Evaluate one Maxima expression in a persistent session and return the result. Supports the full Maxima language: symbolic algebra, calculus, matrices, programming constructs, and share packages. Use maxima_batch for several sequential statements.",
      inputSchema: {
        expression: z
          .string()
          .min(1)
          .max(config.limits.maxExpressionChars)
          .describe("Maxima source to evaluate, for example integrate(x^2, x) or diff(sin(x), x)."),
        session_id: z
          .string()
          .min(1)
          .max(64)
          .optional()
          .describe(
            "Session to use. Defaults to the configured default session; an unknown id is created on first use.",
          ),
        timeout_ms: z
          .number()
          .int()
          .min(100)
          .max(config.maxima.maxTimeoutMs)
          .optional()
          .describe(`Execution timeout in milliseconds (max ${config.maxima.maxTimeoutMs}).`),
        terminator: z
          .enum(["auto", "semicolon", "dollar"])
          .default("auto")
          .describe(
            "Statement terminator to append when missing. 'auto' uses ';' so results are displayed; 'dollar' suppresses output.",
          ),
      },
      annotations: {
        title: "Evaluate Maxima expression",
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
      outputSchema: evalOutputSchema,
    },
    async (args, ctx): Promise<CallToolResult> =>
      guarded(runtime, "maxima_eval", async () => {
        const commands = normalizeCommands([args.expression], {
          terminator: args.terminator,
          maxChars: config.limits.maxExpressionChars,
          maxCommands: 1,
          allowDangerous: config.maxima.allowDangerous,
        });
        const runOptions: RunOptions = {
          timeoutMs: clampTimeout(runtime, args.timeout_ms),
          ...(ctx.mcpReq.signal ? { signal: ctx.mcpReq.signal } : {}),
        };
        const result = await runtime.sessions.run(args.session_id, commands, runOptions);
        const first = result.outputs[0];
        const output = combineOutput(first?.output ?? "", result.stderr);
        const isError = (first?.isError ?? false) || isErrorText(result.stderr);
        const truncated = output.includes("[output truncated");

        const body = output || "(no output)";
        const notes: string[] = [];
        if (result.restarted)
          notes.push("Note: the session was started or restarted for this call.");
        if (truncated) notes.push("Note: output was truncated.");
        const text = notes.length > 0 ? `${body}\n\n${notes.join("\n")}` : body;

        return {
          ...textResult(text, {
            session_id: result.sessionId,
            results: (result.outputs ?? []).map((item) => ({
              command: item.command,
              output: item.output,
              is_error: item.isError,
              warnings: item.warnings,
            })),
            duration_ms: result.durationMs,
            restarted: result.restarted,
            ...(result.stderr ? { stderr: result.stderr } : {}),
            truncated,
          }),
          ...(isError ? { isError: true } : {}),
        };
      }),
  );

  server.registerTool(
    "maxima_batch",
    {
      title: "Run sequential Maxima commands",
      description:
        "Evaluate multiple Maxima statements in order against the same session, preserving definitions and assignments between statements. Returns per-command output. Execution stops early only if the Maxima process crashes or times out.",
      inputSchema: {
        commands: z
          .array(z.string().min(1))
          .min(1)
          .max(config.limits.maxCommands)
          .describe("Statements to evaluate in order."),
        session_id: z
          .string()
          .min(1)
          .max(64)
          .optional()
          .describe(
            "Session to use. Defaults to the configured default session; an unknown id is created on first use.",
          ),
        timeout_ms: z
          .number()
          .int()
          .min(100)
          .max(config.maxima.maxTimeoutMs)
          .optional()
          .describe("Timeout for the entire batch in milliseconds."),
        terminator: z
          .enum(["auto", "semicolon", "dollar"])
          .default("auto")
          .describe("Terminator to append to statements that do not end with ';' or '$'."),
      },
      annotations: {
        title: "Run sequential Maxima commands",
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
      outputSchema: evalOutputSchema,
    },
    async (args, ctx): Promise<CallToolResult> =>
      guarded(runtime, "maxima_batch", async () => {
        const commands = normalizeCommands(args.commands, {
          terminator: args.terminator,
          maxChars: config.limits.maxExpressionChars,
          maxCommands: config.limits.maxCommands,
          allowDangerous: config.maxima.allowDangerous,
        });
        const result = await runtime.sessions.run(args.session_id, commands, {
          timeoutMs: clampTimeout(runtime, args.timeout_ms),
          ...(ctx.mcpReq.signal ? { signal: ctx.mcpReq.signal } : {}),
        });
        const isError = result.outputs.some((item) => item.isError) || isErrorText(result.stderr);
        const truncated = result.outputs.some((item) => item.output.includes("[output truncated"));
        const sections = result.outputs.map((item, index) => {
          const output = item.output || "(no output)";
          const command = item.command.trim().replace(/[;$]$/, "");
          return `[${index + 1}] ${command}\n${output}`;
        });
        if (result.stderr.trim()) sections.push(`[stderr]\n${result.stderr.trim()}`);
        if (result.restarted) {
          sections.push("Note: the session was started or restarted for this batch.");
        }
        return {
          ...textResult(sections.join("\n\n"), {
            session_id: result.sessionId,
            results: result.outputs.map((item) => ({
              command: item.command,
              output: item.output,
              is_error: item.isError,
              warnings: item.warnings,
            })),
            duration_ms: result.durationMs,
            restarted: result.restarted,
            ...(result.stderr ? { stderr: result.stderr } : {}),
            truncated,
          }),
          ...(isError ? { isError: true } : {}),
        };
      }),
  );
}
