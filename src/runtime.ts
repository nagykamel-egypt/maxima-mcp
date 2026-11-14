import type { AppConfig } from "./config.js";
import { DocumentationIndex } from "./docs/indexer.js";
import { SourceIndex } from "./docs/source.js";
import type { Logger } from "./logger.js";
import { Metrics } from "./metrics.js";
import { SessionManager, getMaximaVersion, type MaximaVersionInfo } from "./maxima/sessions.js";

export interface Runtime {
  readonly config: AppConfig;
  readonly logger: Logger;
  readonly metrics: Metrics;
  readonly sessions: SessionManager;
  readonly docs: DocumentationIndex;
  readonly source: SourceIndex;
  readonly startedAt: number;
  maximaVersion(): MaximaVersionInfo;
}

export function createRuntime(config: AppConfig, logger: Logger): Runtime {
  const metrics = new Metrics();
  metrics.describe("maxima_mcp_tool_calls_total", "MCP tool calls by tool and status");
  metrics.describe("maxima_mcp_tool_duration_milliseconds_sum", "Cumulative MCP tool time");
  metrics.describe("maxima_mcp_tool_duration_milliseconds_count", "Number of MCP tool calls");
  metrics.describe("maxima_mcp_evaluations_total", "Maxima evaluations by status");
  metrics.describe("maxima_mcp_evaluation_duration_milliseconds_sum", "Cumulative evaluation time");
  metrics.describe("maxima_mcp_evaluation_duration_milliseconds_count", "Evaluation count");
  metrics.describe("maxima_mcp_sessions", "Open Maxima sessions");
  metrics.describe("maxima_mcp_sessions_busy", "Maxima sessions currently evaluating");
  metrics.describe("maxima_mcp_http_requests_total", "HTTP requests by method and status");
  metrics.describe("maxima_mcp_http_sessions", "Open MCP HTTP sessions");

  const sessions = new SessionManager(config, logger, metrics);
  const docs = new DocumentationIndex(config.docs, logger);
  const source = new SourceIndex(config.docs, logger);

  if (config.docs.prewarm) {
    docs.prewarm();
    source.prewarm();
  }

  return {
    config,
    logger,
    metrics,
    sessions,
    docs,
    source,
    startedAt: Date.now(),
    maximaVersion: () => getMaximaVersion(config.maxima.bin),
  };
}

export async function shutdownRuntime(runtime: Runtime): Promise<void> {
  await runtime.sessions.shutdown();
}
