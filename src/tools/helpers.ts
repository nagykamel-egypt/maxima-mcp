import { randomUUID } from "node:crypto";
import type { CallToolResult, TextContent } from "@modelcontextprotocol/sdk/types.js";
import type { Runtime } from "../runtime.js";
import { errorResult, isToolError } from "../errors.js";

export function text(value: string): TextContent {
  return { type: "text", text: value };
}

export function jsonBlock(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

export function textResult(value: string, structured?: Record<string, unknown>): CallToolResult {
  return {
    content: [text(value)],
    ...(structured === undefined ? {} : { structuredContent: structured }),
  };
}

/**
 * Execute a tool body with uniform error handling, structured logging and
 * Prometheus metrics. Tool failures are returned as MCP isError results rather
 * than crashing the request loop.
 */
export async function guarded(
  runtime: Runtime,
  tool: string,
  fn: () => Promise<CallToolResult>,
): Promise<CallToolResult> {
  const started = Date.now();
  const traceId = randomUUID();
  const log = runtime.logger.child({ tool, traceId });
  try {
    const result = await fn();
    const status = result.isError ? "error" : "ok";
    runtime.metrics.inc("maxima_mcp_tool_calls_total", { tool, status });
    return result;
  } catch (error) {
    runtime.metrics.inc("maxima_mcp_tool_calls_total", { tool, status: "error" });
    if (isToolError(error)) {
      log.warn({ code: error.code, message: error.message }, "Tool call failed");
    } else {
      log.error({ err: error }, "Tool call threw an unexpected error");
    }
    return errorResult(error);
  } finally {
    runtime.metrics.observeMs("maxima_mcp_tool_duration", Date.now() - started, { tool });
  }
}

export function clampTimeout(
  runtime: Runtime,
  requested: number | undefined,
  fallback?: number,
): number {
  const base = fallback ?? runtime.config.maxima.defaultTimeoutMs;
  if (requested === undefined) return Math.min(base, runtime.config.maxima.maxTimeoutMs);
  return Math.max(100, Math.min(requested, runtime.config.maxima.maxTimeoutMs));
}

export function formatDuration(ms: number): string {
  if (ms < 1_000) return `${ms} ms`;
  return `${(ms / 1_000).toFixed(2)} s`;
}
