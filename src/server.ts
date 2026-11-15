import { McpServer } from "@modelcontextprotocol/server";
import type { Runtime } from "./runtime.js";
import { registerPrompts } from "./prompts.js";
import { registerResources } from "./resources.js";
import { registerTools } from "./tools/index.js";
import { SERVER_NAME, SERVER_TITLE, serverVersion } from "./version.js";

export const SERVER_INSTRUCTIONS = `Maxima MCP Server provides a persistent, stateful interface to Maxima, a full computer algebra system.

Tool selection:
- Use maxima_eval for a single expression and maxima_batch for multiple sequential statements.
- Prefer the focused tools (maxima_solve, maxima_differentiate, maxima_integrate, maxima_limit, maxima_series, maxima_simplify, maxima_numeric, maxima_matrix, maxima_plot) when they match the task; they construct correct Maxima syntax for you.
- Use maxima_help, maxima_search_docs and maxima_examples to ground syntax in the installed manual before guessing.
- Use maxima_source and maxima_search_source to inspect implementation details, and maxima_list_packages / maxima_package_load to load share packages.
- Use maxima_session_open, maxima_session_list, maxima_session_reset and maxima_session_close to manage persistent sessions.

Session semantics:
- Calls that omit session_id use the configured default session.
- Variables, function definitions and loaded packages persist within a session.
- A timeout, cancellation or crash terminates the Maxima process; the next call restarts it and previously defined state is lost. Results report restarted=true in that case.
- Reset a session explicitly with maxima_session_reset when starting unrelated work.

Correctness guidance:
- Do not invent Maxima syntax. Check the manual when unsure.
- Verify symbolic results numerically when practical (maxima_numeric) and state assumptions.
- Maxima is case-sensitive for user symbols in the usual way; built-in flags are typically lowercase.
- Safe mode blocks shell and arbitrary file-system primitives (system, load, writefile, etc.). Use maxima_package_load and maxima_plot for the supported equivalents.

Resources:
- maxima://manual/index lists manual sections.
- maxima://docs/symbol/{name} exposes a symbol's manual entry.
- maxima://docs/section/{file} exposes a full manual section.
- maxima://source/{path} exposes installed source files.`;

export interface CreateServerOptions {
  instructions?: string;
}

/** Build a fully registered MCP server. Each HTTP session gets its own instance. */
export function createMcpServer(runtime: Runtime, options: CreateServerOptions = {}): McpServer {
  const server = new McpServer(
    {
      name: SERVER_NAME,
      version: serverVersion(),
      title: SERVER_TITLE,
    },
    {
      instructions: options.instructions ?? SERVER_INSTRUCTIONS,
    },
  );
  registerTools(server, runtime);
  registerResources(server, runtime);
  registerPrompts(server, runtime);
  return server;
}
