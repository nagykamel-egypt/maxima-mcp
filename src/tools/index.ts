import type { McpServer } from "@modelcontextprotocol/server";
import type { Runtime } from "../runtime.js";
import { registerAlgebraTools } from "./algebra.js";
import { registerDocsTools } from "./docs.js";
import { registerEvaluateTools } from "./evaluate.js";
import { registerPlotTools } from "./plot.js";
import { registerSessionTools } from "./sessions.js";
import { registerSourceTools } from "./source.js";
import { registerSystemTools } from "./system.js";

export function registerTools(server: McpServer, runtime: Runtime): void {
  registerEvaluateTools(server, runtime);
  registerAlgebraTools(server, runtime);
  registerSessionTools(server, runtime);
  registerDocsTools(server, runtime);
  registerSourceTools(server, runtime);
  registerPlotTools(server, runtime);
  registerSystemTools(server, runtime);
}
