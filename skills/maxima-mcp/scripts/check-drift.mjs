#!/usr/bin/env node
/**
 * Detect drift between the server tool schemas (src/tools/*.ts) and the skill's
 * tool reference (references/tools.md).
 *
 * - Extracts every registered tool name and its inputSchema field names from the
 *   TypeScript source (field lines are at 8-space indentation by convention).
 * - Parses `### \`maxima_xxx\`` headings and backtick-quoted field tokens from
 *   references/tools.md.
 * - Fails when a registered tool is undocumented, a documented tool is no longer
 *   registered, or a source input field is missing from the reference.
 *
 * This script only runs where the server source is present (the repository). It
 * exits 0 with a "skipped" notice when src/ is unavailable, so it is safe to run
 * against a copied skill directory.
 *
 * Exit code: 0 on success/skip, 1 on drift.
 */
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const skillDir = resolve(scriptDir, "..");
const repoRoot = resolve(skillDir, "..", "..");
const srcToolsDir = join(repoRoot, "src", "tools");
const toolsDocPath = join(skillDir, "references", "tools.md");

const TOOL_HEADING = /^### `(maxima_[a-z_]+)`\s*$/;
const FIELD_LINE = /^\s{8}([A-Za-z_][A-Za-z0-9_]*)\s*:/;
const INPUT_SCHEMA_EMPTY = /inputSchema:\s*\{\s*\}/;

function extractSourceTools(dir) {
  const tools = new Map();
  for (const file of readdirSync(dir).filter((name) => name.endsWith(".ts"))) {
    const text = readFileSync(join(dir, file), "utf8");
    const register = /server\.registerTool\(\s*"([a-z_]+)"/g;
    let match;
    while ((match = register.exec(text)) !== null) {
      const name = match[1];
      const remainder = text.slice(register.lastIndex);
      const idx = remainder.indexOf("inputSchema:");
      const fields = new Set();
      if (idx !== -1) {
        const block = remainder.slice(idx);
        const firstLine = block.split(/\r?\n/)[0] ?? "";
        if (!INPUT_SCHEMA_EMPTY.test(firstLine)) {
          const lines = block.split(/\r?\n/);
          for (let i = 1; i < lines.length; i += 1) {
            const line = lines[i];
            if (/^\s{6}\}\s*,?\s*$/.test(line)) break;
            const field = line.match(FIELD_LINE);
            if (field) fields.add(field[1]);
          }
        }
      }
      tools.set(name, fields);
    }
  }
  return tools;
}

function parseDocumentedTools(toolsDocPath) {
  const text = readFileSync(toolsDocPath, "utf8");
  const sections = new Map();
  const lines = text.split(/\r?\n/);
  let current = null;
  for (const line of lines) {
    const heading = line.match(TOOL_HEADING);
    if (heading) {
      current = heading[1];
      if (!sections.has(current)) sections.set(current, []);
      continue;
    }
    if (current) sections.get(current).push(line);
  }
  return sections;
}

function main() {
  if (!existsSync(srcToolsDir)) {
    console.log("Drift check skipped: server source not found at", srcToolsDir);
    return 0;
  }
  const source = extractSourceTools(srcToolsDir);
  const documented = parseDocumentedTools(toolsDocPath);

  const errors = [];
  const sourceNames = [...source.keys()].sort();
  const documentedNames = [...documented.keys()].sort();

  for (const name of sourceNames) {
    if (!documented.has(name)) {
      errors.push(`registered tool '${name}' is not documented in references/tools.md`);
    }
  }
  for (const name of documentedNames) {
    if (!source.has(name)) {
      errors.push(`documented tool '${name}' is no longer registered in the server`);
    }
  }

  for (const [name, fields] of source) {
    const section = (documented.get(name) ?? []).join("\n");
    if (!section) continue;
    for (const field of [...fields].sort()) {
      if (!section.includes(`\`${field}\``)) {
        errors.push(`tool '${name}': input field '${field}' is missing from references/tools.md`);
      }
    }
  }

  console.log("Tool-schema drift check");
  console.log(`  source tools:   ${source.size}`);
  console.log(`  documented:     ${documented.size}`);
  console.log(`  fields checked: ${[...source.values()].reduce((n, f) => n + f.size, 0)}`);

  if (errors.length > 0) {
    console.error(`\nDrift detected (${errors.length}):`);
    for (const error of errors) console.error(`  - ${error}`);
    return 1;
  }
  console.log("\nOK: tool reference matches the server schemas.");
  return 0;
}

process.exit(main());
