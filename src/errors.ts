import type { CallToolResult } from "@modelcontextprotocol/server";

export type ErrorCode =
  | "BAD_REQUEST"
  | "VALIDATION_ERROR"
  | "UNSAFE_EXPRESSION"
  | "LIMIT_EXCEEDED"
  | "MAXIMA_NOT_FOUND"
  | "MAXIMA_ERROR"
  | "MAXIMA_TIMEOUT"
  | "MAXIMA_CRASHED"
  | "SESSION_NOT_FOUND"
  | "SESSION_LIMIT"
  | "SESSION_CLOSED"
  | "SESSION_BUSY"
  | "ABORTED"
  | "DOCS_UNAVAILABLE"
  | "DOC_NOT_FOUND"
  | "SOURCE_UNAVAILABLE"
  | "PACKAGE_NOT_FOUND"
  | "PLOT_FAILED"
  | "INTERNAL_ERROR";

export interface ToolErrorOptions {
  code: ErrorCode;
  message: string;
  hint?: string;
  retryable?: boolean;
  details?: Record<string, unknown>;
  cause?: unknown;
}

/** Error type suitable for surfacing to MCP clients. */
export class ToolError extends Error {
  override readonly name = "ToolError";
  readonly code: ErrorCode;
  readonly hint?: string;
  readonly retryable: boolean;
  readonly details?: Record<string, unknown>;

  constructor(options: ToolErrorOptions) {
    super(options.message, options.cause === undefined ? undefined : { cause: options.cause });
    this.code = options.code;
    this.hint = options.hint;
    this.retryable = options.retryable ?? false;
    this.details = options.details;
  }
}

export function isToolError(error: unknown): error is ToolError {
  return error instanceof ToolError;
}

/** Convert any thrown value into an MCP tool result with isError set. */
export function errorResult(error: unknown): CallToolResult {
  if (isToolError(error)) {
    const lines = [`Error [${error.code}]: ${error.message}`];
    if (error.hint) lines.push(`Hint: ${error.hint}`);
    if (error.retryable) lines.push("This error is retryable.");
    return {
      isError: true,
      content: [{ type: "text", text: lines.join("\n") }],
    };
  }

  const message = error instanceof Error ? error.message : String(error);
  return {
    isError: true,
    content: [{ type: "text", text: `Error [INTERNAL_ERROR]: ${message}` }],
  };
}

export function asError(value: unknown): Error {
  return value instanceof Error ? value : new Error(String(value));
}
