import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { maximaString } from "../maxima/expressions.js";
import { isErrorText } from "../maxima/output.js";
import { ToolError } from "../errors.js";
import type { Runtime } from "../runtime.js";
import { clampTimeout, guarded, textResult } from "./helpers.js";

const definitionSchema = z.object({
  file: z.string(),
  line: z.number(),
  kind: z.string(),
  language: z.string(),
  start_line: z.number(),
  end_line: z.number(),
  text: z.string(),
});

const sourceSearchSchema = z.object({
  file: z.string(),
  line: z.number(),
  text: z.string(),
  before: z.array(z.string()),
  after: z.array(z.string()),
});

export function registerSourceTools(server: McpServer, runtime: Runtime): void {
  server.registerTool(
    "maxima_source",
    {
      title: "Find Maxima source definition",
      description:
        "Locate the Lisp or Maxima-language implementation of a symbol in the installed maxima-src and maxima-share trees, with surrounding source lines.",
      inputSchema: {
        symbol: z
          .string()
          .min(1)
          .max(200)
          .describe("Symbol to locate, for example integrate, solve or draw2d."),
        context_lines: z
          .number()
          .int()
          .min(0)
          .max(100)
          .default(10)
          .describe("Lines of context before and after each definition."),
        max_results: z
          .number()
          .int()
          .min(1)
          .max(20)
          .default(3)
          .describe("Maximum number of definitions to return."),
      },
      annotations: {
        title: "Find Maxima source definition",
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
      outputSchema: z.object({
        symbol: z.string(),
        definitions: z.array(definitionSchema),
      }),
    },
    async (args): Promise<CallToolResult> =>
      guarded(runtime, "maxima_source", async () => {
        const refs = await runtime.source.find(args.symbol);
        const definitions = [];
        for (const ref of refs.slice(0, args.max_results)) {
          const snippet = await runtime.source.read(ref, args.context_lines);
          definitions.push({
            file: ref.file,
            line: ref.line,
            kind: ref.kind,
            language: ref.language,
            start_line: snippet.startLine,
            end_line: snippet.endLine,
            text: snippet.text,
          });
        }
        const text = definitions
          .map(
            (definition) =>
              `**${args.symbol}** — \`${definition.file}:${definition.line}\` (${definition.kind}, ${definition.language})\n\n\`\`\`${definition.language === "lisp" ? "lisp" : "maxima"}\n${definition.text}\n\`\`\``,
          )
          .join("\n\n---\n\n");
        return textResult(text, { symbol: args.symbol, definitions });
      }),
  );

  server.registerTool(
    "maxima_search_source",
    {
      title: "Search Maxima source code",
      description:
        "Full-text or regular-expression search across installed Maxima Lisp, Maxima-language package and demo files. Returns matches with context.",
      inputSchema: {
        query: z.string().min(1).max(500).describe("Text or regular expression to search for."),
        regex: z
          .boolean()
          .default(false)
          .describe("Interpret query as a JavaScript regular expression."),
        case_sensitive: z.boolean().default(false).describe("Use case-sensitive matching."),
        limit: z.number().int().min(1).max(200).default(50).describe("Maximum number of matches."),
        context_lines: z
          .number()
          .int()
          .min(0)
          .max(10)
          .default(2)
          .describe("Lines of context before and after each match."),
        file_filter: z
          .string()
          .max(200)
          .default("")
          .describe("Optional substring filter on relative file paths, for example 'share/draw'."),
      },
      annotations: {
        title: "Search Maxima source code",
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
      outputSchema: z.object({
        query: z.string(),
        matches: z.array(sourceSearchSchema),
        truncated: z.boolean(),
      }),
    },
    async (args): Promise<CallToolResult> =>
      guarded(runtime, "maxima_search_source", async () => {
        const hits = await runtime.source.search(args.query, {
          regex: args.regex,
          caseSensitive: args.case_sensitive,
          limit: args.limit,
          contextLines: args.context_lines,
          ...(args.file_filter ? { fileFilter: args.file_filter } : {}),
        });
        const matches = hits.map((hit) => ({
          file: hit.file,
          line: hit.line,
          text: hit.text,
          before: hit.before,
          after: hit.after,
        }));
        const text = hits
          .map(
            (hit) =>
              `**${hit.file}:${hit.line}**\n\`\`\`\n${[...hit.before, hit.text, ...hit.after].join("\n")}\n\`\`\``,
          )
          .join("\n\n");
        return textResult(text || `No source matches for '${args.query}'.`, {
          query: args.query,
          matches,
          truncated: hits.length >= args.limit,
        });
      }),
  );

  server.registerTool(
    "maxima_list_packages",
    {
      title: "List Maxima share packages",
      description:
        "List loadable packages installed in the Maxima share directory (draw, distrib, combinatorics, and many more).",
      inputSchema: {
        filter: z.string().max(200).default("").describe("Optional substring filter."),
        limit: z
          .number()
          .int()
          .min(1)
          .max(1_000)
          .default(200)
          .describe("Maximum number of packages to list."),
      },
      annotations: {
        title: "List Maxima share packages",
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
      outputSchema: z.object({
        packages: z.array(
          z.object({
            name: z.string(),
            path: z.string(),
            files: z.array(z.string()),
          }),
        ),
      }),
    },
    async (args): Promise<CallToolResult> =>
      guarded(runtime, "maxima_list_packages", async () => {
        const packages = await runtime.source.listPackages(args.filter, args.limit);
        const text = packages
          .map((pkg) => `- **${pkg.name}** — ${pkg.files.length} file(s)`)
          .join("\n");
        return textResult(text || "No packages matched.", { packages });
      }),
  );

  server.registerTool(
    "maxima_package_load",
    {
      title: "Load a Maxima share package",
      description:
        "Load an installed share package into a session by exact name. The package must exist in the installed share tree; arbitrary file paths are rejected. Large packages may compile on first use and can take several minutes.",
      inputSchema: {
        package: z
          .string()
          .min(1)
          .max(200)
          .describe("Exact package name from maxima_list_packages, for example draw or distrib."),
        session_id: z
          .string()
          .min(1)
          .max(64)
          .optional()
          .describe(
            "Session to load the package into. Defaults to the configured default session; an unknown id is created on first use.",
          ),
        timeout_ms: z
          .number()
          .int()
          .min(100)
          .max(runtime.config.maxima.maxTimeoutMs)
          .optional()
          .describe("Load timeout in milliseconds."),
      },
      annotations: {
        title: "Load a Maxima share package",
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
      outputSchema: z.object({
        package: z.string(),
        session_id: z.string(),
        output: z.string(),
        is_error: z.boolean(),
        duration_ms: z.number(),
      }),
    },
    async (args, extra): Promise<CallToolResult> =>
      guarded(runtime, "maxima_package_load", async () => {
        const pkg = await runtime.source.resolvePackage(args.package);
        if (!/^[A-Za-z0-9_.:+-]+$/.test(pkg.name)) {
          throw new ToolError({
            code: "PACKAGE_NOT_FOUND",
            message: `Package name '${pkg.name}' contains unsupported characters.`,
          });
        }
        const command = `load(${maximaString(pkg.name)})$`;
        const timeoutMs =
          args.timeout_ms === undefined
            ? clampTimeout(runtime, undefined, 180_000)
            : clampTimeout(runtime, args.timeout_ms);
        const result = await runtime.sessions.run(args.session_id, [command], {
          timeoutMs,
          ...(extra.signal ? { signal: extra.signal } : {}),
        });
        const first = result.outputs[0];
        const output = [first?.output ?? "", result.stderr.trim()]
          .filter(Boolean)
          .join("\n")
          .trim();
        const isError = (first?.isError ?? false) || isErrorText(result.stderr);
        const text = isError
          ? `Failed to load package '${pkg.name}'.\n\n${output}`
          : `Loaded package '${pkg.name}'.${output ? `\n\n${output}` : ""}`;
        return {
          ...textResult(text, {
            package: pkg.name,
            session_id: result.sessionId,
            output,
            is_error: isError,
            duration_ms: result.durationMs,
          }),
          ...(isError ? { isError: true } : {}),
        };
      }),
  );

  server.registerTool(
    "maxima_list_source_files",
    {
      title: "List Maxima source files",
      description: "List indexed Maxima Lisp, package and demo source files.",
      inputSchema: {
        filter: z.string().max(200).default("").describe("Optional substring filter."),
        limit: z
          .number()
          .int()
          .min(1)
          .max(1_000)
          .default(200)
          .describe("Maximum number of files to list."),
      },
      annotations: {
        title: "List Maxima source files",
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
      outputSchema: z.object({
        files: z.array(z.object({ file: z.string(), language: z.string() })),
      }),
    },
    async (args): Promise<CallToolResult> =>
      guarded(runtime, "maxima_list_source_files", async () => {
        const files = await runtime.source.listFiles(args.filter, args.limit);
        const text = files.map((file) => `- ${file.file} (${file.language})`).join("\n");
        return textResult(text || "No source files matched.", { files });
      }),
  );

  server.registerTool(
    "maxima_read_source_file",
    {
      title: "Read a Maxima source file",
      description:
        "Read an indexed Maxima source file by relative path, as returned by maxima_list_source_files.",
      inputSchema: {
        file: z
          .string()
          .min(1)
          .max(500)
          .describe("Relative source path, for example simp.lisp or draw/draw.lisp."),
        max_chars: z
          .number()
          .int()
          .min(1_000)
          .max(500_000)
          .default(100_000)
          .describe("Maximum characters to return."),
      },
      annotations: {
        title: "Read a Maxima source file",
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
      outputSchema: z.object({
        file: z.string(),
        text: z.string(),
      }),
    },
    async (args): Promise<CallToolResult> =>
      guarded(runtime, "maxima_read_source_file", async () => {
        const result = await runtime.source.readFileByRelativePath(args.file, args.max_chars);
        return textResult(result.text, result);
      }),
  );
}
