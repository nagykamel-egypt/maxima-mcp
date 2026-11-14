import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  evalsDir,
  referencesDir,
  repoRoot,
  skillDir,
  TOOL_NAMES,
  PROMPT_NAMES,
  REFERENCE_FILES,
  RESOURCE_URIS,
} from "../skill-helpers.js";

function read(path: string): string {
  return readFileSync(path, "utf8");
}

function readMarkdownFiles(root: string): string[] {
  return (readdirSync(root, { recursive: true }) as string[])
    .filter((file) => file.endsWith(".md"))
    .map((file) => join(root, file));
}

function stripFencedCode(markdown: string): string {
  return markdown.replace(/```[\s\S]*?```/g, "").replace(/~~~[\s\S]*?~~~/g, "");
}

interface EvalCase {
  id: string;
  expect_skill: boolean;
  prompt: string;
  required_tools: string[];
  required_checks: string[];
}

interface EvalSuite {
  cases: EvalCase[];
}

function loadEvalCases(): EvalSuite {
  return JSON.parse(read(join(evalsDir, "cases.json"))) as EvalSuite;
}

function sourceToolNames(): Set<string> {
  const names = new Set<string>();
  const dir = readdirSync(join(repoRoot, "src", "tools")) as string[];
  for (const file of dir.filter((name) => name.endsWith(".ts"))) {
    const text = read(join(repoRoot, "src", "tools", file));
    const register = /server\.registerTool\(\s*"([a-z_]+)"/g;
    let match;
    while ((match = register.exec(text)) !== null) {
      const name = match[1];
      if (name !== undefined) names.add(name);
    }
  }
  return names;
}

function documentedToolSections(): Map<string, string> {
  const toolsDoc = read(join(referencesDir, "tools.md"));
  const sections = new Map<string, string>();
  let current: string | null = null;
  for (const line of toolsDoc.split(/\r?\n/)) {
    const heading = line.match(/^### `(maxima_[a-z_]+)`\s*$/);
    if (heading) {
      const name = heading[1];
      if (name !== undefined) {
        current = name;
        sections.set(current, "");
      }
      continue;
    }
    if (current) sections.set(current, `${sections.get(current) ?? ""}${line}\n`);
  }
  return sections;
}

describe("skill structure", () => {
  it("has a valid SKILL.md frontmatter", () => {
    const skill = read(join(skillDir, "SKILL.md"));
    expect(skill.startsWith("---\n")).toBe(true);
    expect(skill).toMatch(/^name:\s*maxima-mcp\s*$/m);
    expect(skill).toMatch(/^description:\s*>-?/m);
    expect(skill).toMatch(/^license:\s*MIT\s*$/m);
    expect(skill).toMatch(/^metadata:\s*$/m);
    expect(skill).toMatch(/^ {2}version:\s*"\d+\.\d+\.\d+"\s*$/m);
  });

  it("contains the required operating sections", () => {
    const skill = read(join(skillDir, "SKILL.md"));
    const sections = [
      "## Use this skill when",
      "## Non-negotiable operating rules",
      "## Operating loop",
      "## Tool map",
      "## Reference map",
      "## Definition of done",
    ];
    for (const section of sections) {
      expect(skill).toContain(section);
    }
  });

  it("stays within the progressive-disclosure budget", () => {
    const lines = read(join(skillDir, "SKILL.md")).split("\n").length;
    expect(lines).toBeLessThanOrEqual(600);
  });

  it("documents all 29 tools as headings", () => {
    const sections = documentedToolSections();
    expect(sections.size).toBe(29);
    for (const tool of TOOL_NAMES) {
      expect(sections.has(tool)).toBe(true);
    }
  });

  it("gives every tool an Input section or an explicit no-input note", () => {
    const sections = documentedToolSections();
    for (const tool of TOOL_NAMES) {
      const section = sections.get(tool) ?? "";
      expect(section.length).toBeGreaterThan(0);
      expect(section).toMatch(/\*\*Input\*\*|No input/);
    }
  });

  it("documents all MCP resources and prompts", () => {
    const toolsDoc = read(join(referencesDir, "tools.md"));
    for (const uri of RESOURCE_URIS) expect(toolsDoc).toContain(uri);
    for (const prompt of PROMPT_NAMES) expect(toolsDoc).toContain(prompt);
  });

  it("matches the server tool surface (no drift)", () => {
    const source = sourceToolNames();
    const documented = new Set(documentedToolSections().keys());
    expect([...source].sort()).toEqual([...documented].sort());
    expect(source.size).toBe(29);
  });
});

describe("skill references", () => {
  it("ships all expected reference documents", () => {
    for (const file of REFERENCE_FILES) {
      const path = join(referencesDir, file);
      expect(existsSync(path)).toBe(true);
      expect(read(path).length).toBeGreaterThan(0);
    }
  });

  it("resolves all relative Markdown links", () => {
    const files = readMarkdownFiles(skillDir);
    expect(files.length).toBeGreaterThan(10);
    const linkPattern = /\[[^\]]*\]\(([^)]+)\)/g;
    for (const file of files) {
      const text = stripFencedCode(read(file));
      for (const match of text.matchAll(linkPattern)) {
        const raw = match[1];
        if (raw === undefined) continue;
        let target = raw.trim();
        if (!target || target.startsWith("#")) continue;
        if (/^(https?:|mailto:|tel:)/i.test(target)) continue;
        if (target.includes("{")) continue; // URI template placeholder
        target = target.split("#")[0] ?? "";
        if (!target) continue;
        if (target.startsWith("/")) continue;
        const resolved = resolve(dirname(file), target);
        expect(existsSync(resolved), `${file} -> ${target}`).toBe(true);
      }
    }
  });

  it("has valid MCP config assets", () => {
    for (const file of ["mcp-stdio.json", "mcp-stdio-local.json", "mcp-http.json"]) {
      const config = JSON.parse(read(join(skillDir, "assets", file))) as {
        mcpServers: Record<string, { command?: string; url?: string }>;
      };
      expect(config.mcpServers.maxima).toBeDefined();
    }
  });
});

describe("skill evaluation suite", () => {
  it("is well-formed with unique ids and a negative case", () => {
    const suite = loadEvalCases();
    expect(suite.cases.length).toBeGreaterThanOrEqual(13);
    const ids = new Set(suite.cases.map((testCase) => testCase.id));
    expect(ids.size).toBe(suite.cases.length);
    expect(suite.cases.some((testCase) => testCase.expect_skill === false)).toBe(true);

    const tools = new Set(TOOL_NAMES);
    for (const testCase of suite.cases) {
      expect(testCase.prompt.length).toBeGreaterThanOrEqual(10);
      expect(testCase.required_checks.length).toBeGreaterThan(0);
      for (const tool of testCase.required_tools) expect(tools.has(tool)).toBe(true);
    }
  });

  it("has a valid example-results fixture covering every case", () => {
    const suite = loadEvalCases();
    const caseIds = new Set(suite.cases.map((testCase) => testCase.id));
    const lines = read(join(evalsDir, "example-results.jsonl")).split(/\r?\n/).filter(Boolean);
    expect(lines.length).toBe(suite.cases.length);

    const seen = new Set<string>();
    for (const line of lines) {
      const record = JSON.parse(line) as {
        id: string;
        tools_called: string[];
        checks_passed: boolean[];
      };
      expect(caseIds.has(record.id)).toBe(true);
      expect(seen.has(record.id)).toBe(false);
      seen.add(record.id);
      expect(Array.isArray(record.tools_called)).toBe(true);
      expect(Array.isArray(record.checks_passed)).toBe(true);
    }
    expect(seen.size).toBe(caseIds.size);
  });
});
