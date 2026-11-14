import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Variables } from "@modelcontextprotocol/sdk/shared/uriTemplate.js";
import { ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { DocEntry } from "./docs/indexer.js";
import type { Runtime } from "./runtime.js";

function firstVariable(variables: Variables, key: string): string {
  const value = variables[key];
  if (Array.isArray(value)) return value[0] ?? "";
  return value ?? "";
}

function formatEntry(entry: DocEntry): string {
  const parts = [`# ${entry.name}`, `**${entry.kind}**`];
  if (entry.signature && entry.signature !== entry.name) {
    parts.push(`\`${entry.signature.replace(/\s+/g, " ").trim()}\``);
  }
  parts.push(entry.text);
  if (entry.examples.length > 0) {
    parts.push("## Examples");
    for (const example of entry.examples.slice(0, 5)) {
      parts.push(`\`\`\`maxima\n${example}\n\`\`\``);
    }
  }
  parts.push(`**Section:** ${entry.sectionTitle}`);
  parts.push(`**URI:** ${entry.uri}`);
  return parts.join("\n\n");
}

function truncate(value: string, maxChars: number): string {
  return value.length <= maxChars
    ? value
    : `${value.slice(0, maxChars)}\n\n... [truncated ${value.length - maxChars} characters]`;
}

/**
 * MCP resources expose the manual and source tree as addressable documents so
 * clients can attach them to context without invoking a tool.
 */
export function registerResources(server: McpServer, runtime: Runtime): void {
  server.registerResource(
    "maxima-manual-index",
    "maxima://manual/index",
    {
      title: "Maxima manual index",
      description: "Table of contents for the installed Maxima manual.",
      mimeType: "text/markdown",
    },
    async (uri) => {
      const sections = await runtime.docs.listSections();
      const text = [
        "# Maxima manual",
        "",
        ...sections.map((section) => `- [${section.title}](${section.uri}) — \`${section.file}\``),
      ].join("\n");
      return { contents: [{ uri: uri.href, mimeType: "text/markdown", text }] };
    },
  );

  server.registerResource(
    "maxima-manual-categories",
    "maxima://manual/categories",
    {
      title: "Maxima documentation categories",
      description: "Documentation categories and entry counts from the Maxima manual.",
      mimeType: "text/markdown",
    },
    async (uri) => {
      await runtime.docs.ensureLoaded();
      const categories = runtime.docs.listCategories();
      const text = [
        "# Maxima documentation categories",
        "",
        ...categories.map((category) => `- ${category.name}: ${category.count}`),
      ].join("\n");
      return { contents: [{ uri: uri.href, mimeType: "text/markdown", text }] };
    },
  );

  server.registerResource(
    "maxima-doc-symbol",
    new ResourceTemplate("maxima://docs/symbol/{name}", {
      list: undefined,
      complete: {
        name: async (value) => {
          await runtime.docs.ensureLoaded().catch(() => undefined);
          return runtime.docs.suggest(value, 25);
        },
      },
    }),
    {
      title: "Maxima symbol documentation",
      description: "Manual entry for a Maxima function, variable or operator.",
      mimeType: "text/markdown",
    },
    async (uri, variables) => {
      const name = decodeURIComponent(firstVariable(variables, "name"));
      const result = await runtime.docs.help(name, 6);
      const text = truncate(result.entries.map(formatEntry).join("\n\n---\n\n"), 120_000);
      return { contents: [{ uri: uri.href, mimeType: "text/markdown", text }] };
    },
  );

  server.registerResource(
    "maxima-doc-section",
    new ResourceTemplate("maxima://docs/section/{file}", {
      list: async () => {
        const sections = await runtime.docs.listSections().catch(() => []);
        return {
          resources: sections.map((section) => ({
            uri: section.uri,
            name: section.title,
            title: section.title,
            description: `Maxima manual section ${section.file}`,
            mimeType: "text/markdown",
          })),
        };
      },
      complete: {
        file: async (value) => {
          await runtime.docs.ensureLoaded().catch(() => undefined);
          const sections = await runtime.docs.listSections().catch(() => []);
          const lower = value.toLowerCase();
          return sections
            .map((section) => section.file)
            .filter((file) => file.toLowerCase().startsWith(lower))
            .slice(0, 50);
        },
      },
    }),
    {
      title: "Maxima manual section",
      description: "Full text of a Maxima manual chapter or section.",
      mimeType: "text/markdown",
    },
    async (uri, variables) => {
      const file = decodeURIComponent(firstVariable(variables, "file"));
      const section = await runtime.docs.readSection(file, 400_000);
      return {
        contents: [
          {
            uri: uri.href,
            mimeType: "text/markdown",
            text: `# ${section.title}\n\n${section.text}`,
          },
        ],
      };
    },
  );

  server.registerResource(
    "maxima-source-file",
    new ResourceTemplate("maxima://source/{+path}", {
      list: async () => {
        const files = await runtime.source.listFiles("", 200).catch(() => []);
        return {
          resources: files.map((file) => ({
            uri: `maxima://source/${file.file.split("/").map(encodeURIComponent).join("/")}`,
            name: file.file,
            title: file.file,
            description: `Maxima ${file.language} source file`,
            mimeType: "text/plain",
          })),
        };
      },
      complete: {
        path: async (value) => {
          await runtime.source.ensureLoaded().catch(() => undefined);
          const files = await runtime.source.listFiles(value, 50).catch(() => []);
          return files.map((file) => file.file);
        },
      },
    }),
    {
      title: "Maxima source file",
      description: "Text of an indexed Maxima Lisp or Maxima-language source file.",
      mimeType: "text/plain",
    },
    async (uri, variables) => {
      const path = decodeURIComponent(firstVariable(variables, "path"));
      const result = await runtime.source.readFileByRelativePath(path, 400_000);
      return { contents: [{ uri: uri.href, mimeType: "text/plain", text: result.text }] };
    },
  );
}
