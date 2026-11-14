import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** Repository root, derived from this file's location (test/). */
export const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** The agent skill under test. */
export const skillDir = join(repoRoot, "skills", "maxima-mcp");
export const referencesDir = join(skillDir, "references");
export const evalsDir = join(skillDir, "evals");
export const assetsDir = join(skillDir, "assets");
export const scriptsDir = join(skillDir, "scripts");
export const distIndex = join(repoRoot, "dist", "index.js");

/** All tool names exposed by the maxima-mcp 1.x server. */
export const TOOL_NAMES: string[] = [
  "maxima_eval",
  "maxima_batch",
  "maxima_session_open",
  "maxima_session_list",
  "maxima_session_reset",
  "maxima_session_close",
  "maxima_solve",
  "maxima_differentiate",
  "maxima_integrate",
  "maxima_limit",
  "maxima_series",
  "maxima_simplify",
  "maxima_numeric",
  "maxima_matrix",
  "maxima_plot",
  "maxima_help",
  "maxima_search_docs",
  "maxima_examples",
  "maxima_list_symbols",
  "maxima_doc_sections",
  "maxima_doc_read",
  "maxima_doc_categories",
  "maxima_source",
  "maxima_search_source",
  "maxima_list_source_files",
  "maxima_read_source_file",
  "maxima_list_packages",
  "maxima_package_load",
  "maxima_system_info",
];

/** Reference documents expected in skills/maxima-mcp/references/. */
export const REFERENCE_FILES: string[] = [
  "tools.md",
  "workflows.md",
  "maxima-language.md",
  "verification.md",
  "errors.md",
  "cookbook.md",
  "integration.md",
  "enterprise.md",
  "prompts.md",
];

/** MCP resources documented in references/tools.md. */
export const RESOURCE_URIS: string[] = [
  "maxima://manual/index",
  "maxima://manual/categories",
  "maxima://docs/symbol/{name}",
  "maxima://docs/section/{file}",
  "maxima://source/{+path}",
];

/** MCP prompts documented in references/tools.md. */
export const PROMPT_NAMES: string[] = [
  "maxima_solve_problem",
  "maxima_explain_symbol",
  "maxima_debug_expression",
];
