import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { DocEntry } from "../docs/indexer.js";
import type { Runtime } from "../runtime.js";
import { guarded, textResult } from "./helpers.js";

const docEntrySchema = z.object({
  name: z.string(),
  kind: z.string(),
  signature: z.string(),
  text: z.string(),
  examples: z.array(z.string()),
  categories: z.array(z.string()),
  file: z.string(),
  section: z.string(),
  uri: z.string(),
});

const helpOutputSchema = z.object({
  name: z.string(),
  entries: z.array(docEntrySchema),
  related: z.array(z.string()),
});

const searchResultSchema = z.object({
  type: z.enum(["symbol", "section"]),
  name: z.string().optional(),
  title: z.string(),
  section: z.string(),
  snippet: z.string(),
  score: z.number(),
  uri: z.string(),
});

function truncate(value: string, maxChars: number): string {
  if (value.length <= maxChars) return value;
  return `${value.slice(0, maxChars)}\n... [truncated ${value.length - maxChars} characters]`;
}

function formatEntry(entry: DocEntry, options: { examples: boolean; budget: number }): string {
  const parts: string[] = [`# ${entry.name}`, `**${entry.kind}**`];
  if (entry.signature && entry.signature !== entry.name) {
    parts.push(`\`${entry.signature.replace(/\s+/g, " ").trim()}\``);
  }
  parts.push(truncate(entry.text, options.budget));
  if (options.examples && entry.examples.length > 0) {
    parts.push("## Examples");
    for (const example of entry.examples.slice(0, 3)) {
      parts.push(`\`\`\`maxima\n${truncate(example, 2_000)}\n\`\`\``);
    }
  }
  if (entry.categories.length > 0) {
    parts.push(`**Categories:** ${entry.categories.join(", ")}`);
  }
  parts.push(`**Section:** ${entry.sectionTitle}`);
  parts.push(`**Source:** ${entry.uri}`);
  return parts.join("\n\n");
}

function entryToJson(entry: DocEntry) {
  return {
    name: entry.name,
    kind: entry.kind,
    signature: entry.signature,
    text: entry.text,
    examples: entry.examples,
    categories: entry.categories,
    file: entry.file,
    section: entry.sectionTitle,
    uri: entry.uri,
  };
}

export function registerDocsTools(server: McpServer, runtime: Runtime): void {
  server.registerTool(
    "maxima_help",
    {
      title: "Maxima function documentation",
      description:
        "Look up the official Maxima manual entry for a function, variable, operator or package symbol. Returns signatures, description, categories and examples from the installed maxima-doc manual.",
      inputSchema: {
        symbol: z
          .string()
          .min(1)
          .max(200)
          .describe("Symbol to look up, for example integrate, solve, plot2d or bfloat."),
        include_examples: z
          .boolean()
          .default(true)
          .describe("Include example blocks from the manual."),
        max_entries: z
          .number()
          .int()
          .min(1)
          .max(10)
          .default(4)
          .describe("Maximum number of matching manual entries (overloads) to return."),
        max_chars: z
          .number()
          .int()
          .min(200)
          .max(100_000)
          .default(16_000)
          .describe("Maximum characters of description text."),
      },
      annotations: {
        title: "Maxima function documentation",
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
      outputSchema: helpOutputSchema,
    },
    async (args): Promise<CallToolResult> =>
      guarded(runtime, "maxima_help", async () => {
        const result = await runtime.docs.help(args.symbol, args.max_entries);
        const perEntry = Math.max(500, Math.floor(args.max_chars / result.entries.length));
        const blocks = result.entries.map((entry) =>
          formatEntry(entry, { examples: args.include_examples, budget: perEntry }),
        );
        if (result.related.length > 0) {
          blocks.push(`## Related symbols\n\n${result.related.join(", ")}`);
        }
        return textResult(blocks.join("\n\n---\n\n"), {
          name: result.name,
          entries: result.entries.map(entryToJson),
          related: result.related,
        });
      }),
  );

  server.registerTool(
    "maxima_search_docs",
    {
      title: "Search the Maxima manual",
      description:
        "Full-text BM25 search across the installed Maxima manual, including function entries and manual sections. Use this to discover functions when the exact name is unknown.",
      inputSchema: {
        query: z
          .string()
          .min(1)
          .max(500)
          .describe("Concept or keyword, for example 'definite integral' or 'eigenvalues'."),
        limit: z.number().int().min(1).max(50).default(10).describe("Maximum number of results."),
        type: z
          .enum(["symbol", "section", "all"])
          .default("all")
          .describe("Restrict results to symbol entries, manual sections, or both."),
      },
      annotations: {
        title: "Search the Maxima manual",
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
      outputSchema: z.object({
        query: z.string(),
        results: z.array(searchResultSchema),
      }),
    },
    async (args): Promise<CallToolResult> =>
      guarded(runtime, "maxima_search_docs", async () => {
        const hits = await runtime.docs.search(args.query, {
          limit: args.limit,
          ...(args.type === "all" ? {} : { type: args.type }),
        });
        const json = hits.map((hit) => ({
          type: hit.type,
          ...(hit.name === undefined ? {} : { name: hit.name }),
          title: hit.title,
          section: hit.section,
          snippet: hit.snippet,
          score: hit.score,
          uri: hit.uri,
        }));
        if (hits.length === 0) {
          return textResult(`No documentation matches for '${args.query}'.`, {
            query: args.query,
            results: [],
          });
        }
        const text = hits
          .map(
            (hit, index) =>
              `${index + 1}. ${hit.name ? `**${hit.name}**` : hit.title} (${hit.type}, score ${hit.score})\n   ${hit.section}\n   ${hit.snippet}\n   ${hit.uri}`,
          )
          .join("\n\n");
        return textResult(text, { query: args.query, results: json });
      }),
  );

  server.registerTool(
    "maxima_examples",
    {
      title: "Maxima manual examples",
      description:
        "Return example blocks from the manual for a symbol, useful for learning usage patterns and expected output.",
      inputSchema: {
        symbol: z.string().min(1).max(200).describe("Symbol whose examples should be returned."),
        max_examples: z
          .number()
          .int()
          .min(1)
          .max(30)
          .default(8)
          .describe("Maximum number of examples to return."),
      },
      annotations: {
        title: "Maxima manual examples",
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
      outputSchema: z.object({
        symbol: z.string(),
        examples: z.array(z.object({ symbol: z.string(), code: z.string() })),
      }),
    },
    async (args): Promise<CallToolResult> =>
      guarded(runtime, "maxima_examples", async () => {
        const result = await runtime.docs.examples(args.symbol);
        const examples: Array<{ symbol: string; code: string }> = [];
        for (const entry of result.entries) {
          for (const code of entry.examples) {
            examples.push({ symbol: entry.name, code });
            if (examples.length >= args.max_examples) break;
          }
          if (examples.length >= args.max_examples) break;
        }
        const text = examples
          .map(
            (example, index) =>
              `${index + 1}. ${example.symbol}\n\`\`\`maxima\n${example.code}\n\`\`\``,
          )
          .join("\n\n");
        return textResult(text, { symbol: result.name, examples });
      }),
  );

  server.registerTool(
    "maxima_doc_sections",
    {
      title: "List Maxima manual sections",
      description: "List the chapters and sections available in the installed Maxima manual.",
      inputSchema: {
        filter: z
          .string()
          .max(200)
          .default("")
          .describe("Optional case-insensitive substring filter on section titles or file names."),
        limit: z
          .number()
          .int()
          .min(1)
          .max(500)
          .default(200)
          .describe("Maximum number of sections to list."),
      },
      annotations: {
        title: "List Maxima manual sections",
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
      outputSchema: z.object({
        sections: z.array(z.object({ file: z.string(), title: z.string(), uri: z.string() })),
      }),
    },
    async (args): Promise<CallToolResult> =>
      guarded(runtime, "maxima_doc_sections", async () => {
        const all = await runtime.docs.listSections();
        const filter = args.filter.trim().toLowerCase();
        const sections = all
          .filter(
            (section) =>
              !filter ||
              section.title.toLowerCase().includes(filter) ||
              section.file.toLowerCase().includes(filter),
          )
          .slice(0, args.limit);
        const text = sections
          .map((section) => `- **${section.title}** — ${section.file}`)
          .join("\n");
        return textResult(text || "No sections matched.", { sections });
      }),
  );

  server.registerTool(
    "maxima_doc_read",
    {
      title: "Read a Maxima manual section",
      description:
        "Read the full text of a Maxima manual chapter or section by file name (for example Integration.html).",
      inputSchema: {
        file: z
          .string()
          .min(1)
          .max(200)
          .describe("Manual section file name, for example Integration.html."),
        max_chars: z
          .number()
          .int()
          .min(1_000)
          .max(500_000)
          .default(120_000)
          .describe("Maximum characters to return."),
      },
      annotations: {
        title: "Read a Maxima manual section",
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
      outputSchema: z.object({
        file: z.string(),
        title: z.string(),
        text: z.string(),
        uri: z.string(),
      }),
    },
    async (args): Promise<CallToolResult> =>
      guarded(runtime, "maxima_doc_read", async () => {
        const section = await runtime.docs.readSection(args.file, args.max_chars);
        return textResult(`# ${section.title}\n\n${section.text}`, {
          file: section.file,
          title: section.title,
          text: section.text,
          uri: section.uri,
        });
      }),
  );

  server.registerTool(
    "maxima_list_symbols",
    {
      title: "List documented Maxima symbols",
      description:
        "List documented functions and variables, optionally filtered by name prefix. Use maxima_help for details on a symbol.",
      inputSchema: {
        prefix: z.string().max(100).default("").describe("Optional name prefix."),
        limit: z
          .number()
          .int()
          .min(1)
          .max(500)
          .default(100)
          .describe("Maximum number of symbols to return."),
      },
      annotations: {
        title: "List documented Maxima symbols",
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
      outputSchema: z.object({
        symbols: z.array(z.object({ name: z.string(), kind: z.string() })),
      }),
    },
    async (args): Promise<CallToolResult> =>
      guarded(runtime, "maxima_list_symbols", async () => {
        const symbols = await runtime.docs.listSymbols(args.prefix, args.limit);
        const text = symbols.map((symbol) => `- ${symbol.name} — ${symbol.kind}`).join("\n");
        return textResult(text || "No symbols matched.", { symbols });
      }),
  );

  server.registerTool(
    "maxima_doc_categories",
    {
      title: "List Maxima documentation categories",
      description:
        "List the documentation categories used by the Maxima manual and their entry counts.",
      inputSchema: {},
      annotations: {
        title: "List Maxima documentation categories",
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
      outputSchema: z.object({
        categories: z.array(z.object({ name: z.string(), count: z.number() })),
      }),
    },
    async (): Promise<CallToolResult> =>
      guarded(runtime, "maxima_doc_categories", async () => {
        await runtime.docs.ensureLoaded();
        const categories = runtime.docs.listCategories();
        return textResult(
          categories.map((category) => `- ${category.name}: ${category.count}`).join("\n"),
          { categories },
        );
      }),
  );
}
