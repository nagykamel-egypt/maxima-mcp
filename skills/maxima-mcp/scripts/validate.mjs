#!/usr/bin/env node
/**
 * Validate the maxima-mcp agent skill without external dependencies.
 *
 * Checks:
 *  - SKILL.md frontmatter and required sections
 *  - required files exist and are non-empty
 *  - all 29 tool names are documented
 *  - relative Markdown links resolve
 *  - asset JSON files parse
 *  - SKILL.md stays within the progressive-disclosure budget
 *
 * Exit code: 0 on success (warnings allowed), 1 on errors.
 */
import { readFileSync, existsSync, statSync } from "node:fs";
import { dirname, join, resolve, relative, extname } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const skillDir = resolve(scriptDir, "..");
const errors = [];
const warnings = [];

function fail(message) {
  errors.push(message);
}

function warn(message) {
  warnings.push(message);
}

function read(path) {
  try {
    return readFileSync(path, "utf8");
  } catch (error) {
    fail(`Cannot read ${relative(skillDir, path)}: ${error.message}`);
    return "";
  }
}

function stripFencedCode(markdown) {
  return markdown.replace(/```[\s\S]*?```/g, "").replace(/~~~[\s\S]*?~~~/g, "");
}

/** Count the evaluation cases, tolerating a missing cases file. */
function evalCaseCount() {
  const path = join(skillDir, "evals", "cases.json");
  if (!existsSync(path)) return 0;
  try {
    const suite = JSON.parse(readFileSync(path, "utf8"));
    return Array.isArray(suite.cases) ? suite.cases.length : 0;
  } catch {
    return 0;
  }
}

/** Read a plain or folded YAML description from the frontmatter text. */
function extractFrontmatterDescription(frontmatter) {
  const lines = frontmatter.split(/\r?\n/);
  const start = lines.findIndex((line) => /^description:\s*/.test(line));
  if (start === -1) return "";
  const first = lines[start].replace(/^description:\s*/, "").trim();
  if (first && first !== ">" && first !== ">-" && first !== "|" && first !== "|-") {
    return first;
  }
  const collected = [];
  for (let i = start + 1; i < lines.length; i += 1) {
    const line = lines[i];
    if (line.trim() === "") {
      collected.push("");
      continue;
    }
    if (!/^\s+/.test(line)) break;
    collected.push(line.trim());
  }
  return collected.join(" ").replace(/\s+/g, " ").trim();
}

const requiredFiles = [
  "SKILL.md",
  "README.md",
  "references/tools.md",
  "references/workflows.md",
  "references/maxima-language.md",
  "references/verification.md",
  "references/errors.md",
  "references/cookbook.md",
  "references/integration.md",
  "references/enterprise.md",
  "references/prompts.md",
  "evals/README.md",
  "evals/cases.json",
  "evals/example-results.jsonl",
  "scripts/validate.mjs",
  "scripts/check-drift.mjs",
  "scripts/eval.mjs",
  "scripts/smoke.mjs",
  "assets/mcp-stdio.json",
  "assets/mcp-stdio-local.json",
  "assets/mcp-http.json",
  "assets/tool-policies.md",
  "assets/AGENTS-snippet.md",
  "assets/logo.svg",
  "assets/logo.png",
  "assets/logo-1024.png",
  "assets/logo-wordmark.svg",
  "assets/logo-wordmark.png",
  "assets/logo-wordmark-dark.svg",
  "assets/logo-wordmark-dark.png",
  "assets/logo-mono.svg",
  "assets/logo-mono-light.svg",
  "LICENSE",
];

for (const file of requiredFiles) {
  const path = join(skillDir, file);
  if (!existsSync(path)) {
    fail(`Missing required file: ${file}`);
    continue;
  }
  if (statSync(path).size === 0) {
    fail(`Empty required file: ${file}`);
  }
}

const skillPath = join(skillDir, "SKILL.md");
const skill = read(skillPath);

// Frontmatter
if (!skill.startsWith("---\n")) {
  fail("SKILL.md must start with YAML frontmatter delimited by ---");
} else {
  const end = skill.indexOf("\n---", 4);
  if (end === -1) {
    fail("SKILL.md frontmatter is not closed with ---");
  } else {
    const frontmatter = skill.slice(4, end);
    const nameMatch = frontmatter.match(/^name:\s*(.+)$/m);
    if (!nameMatch) {
      fail("SKILL.md frontmatter is missing a name");
    } else {
      const name = nameMatch[1].trim().replace(/^["']|["']$/g, "");
      if (name !== "maxima-mcp") {
        fail(`SKILL.md name '${name}' does not match directory 'maxima-mcp'`);
      }
      if (!/^[a-z0-9-]+$/.test(name)) {
        fail(`SKILL.md name '${name}' must use lowercase letters, digits, and hyphens`);
      }
      if (name.length > 64) {
        fail("SKILL.md name exceeds 64 characters");
      }
    }
    const description = extractFrontmatterDescription(frontmatter);
    if (!description) {
      fail("SKILL.md frontmatter is missing a description");
    } else if (description.length < 80) {
      warn(
        `SKILL.md description is short (${description.length} characters); use a specific trigger description`,
      );
    }
  }
}

const requiredSections = [
  "## Use this skill when",
  "## Non-negotiable operating rules",
  "## Operating loop",
  "## Tool map",
  "## Reference map",
  "## Definition of done",
];

for (const section of requiredSections) {
  if (!skill.includes(section)) {
    fail(`SKILL.md is missing required section: ${section}`);
  }
}

const skillLines = skill.split("\n").length;
if (skillLines > 600) {
  fail(`SKILL.md has ${skillLines} lines; keep it under 600 and move detail to references/`);
} else if (skillLines > 500) {
  warn(`SKILL.md has ${skillLines} lines; consider moving more detail to references/`);
}

// Tool coverage
const toolsDoc = read(join(skillDir, "references/tools.md"));
const toolNames = [
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

for (const tool of toolNames) {
  if (!toolsDoc.includes(tool)) {
    fail(`references/tools.md does not document ${tool}`);
  }
}

if (toolNames.length !== 29) {
  fail(`Expected 29 tool names in the validator, found ${toolNames.length}`);
}

// Markdown link resolution
const markdownFiles = requiredFiles.filter((file) => extname(file) === ".md");
const linkPattern = /\[[^\]]*\]\(([^)]+)\)/g;

for (const file of markdownFiles) {
  const path = join(skillDir, file);
  if (!existsSync(path)) continue;
  const text = stripFencedCode(read(path));
  for (const match of text.matchAll(linkPattern)) {
    let target = match[1].trim();
    if (!target) continue;
    if (target.startsWith("#")) continue;
    if (/^(https?:|mailto:|tel:)/i.test(target)) continue;
    if (target.includes("{")) continue; // placeholder
    target = target.split("#")[0];
    if (!target) continue;
    if (target.startsWith("/")) {
      warn(`${file}: absolute link '${match[1]}' is not portable`);
      continue;
    }
    const resolved = resolve(dirname(path), target);
    if (!existsSync(resolved)) {
      fail(`${file}: broken relative link '${match[1]}' -> ${relative(skillDir, resolved)}`);
    }
  }
}

// Asset JSON
for (const file of [
  "assets/mcp-stdio.json",
  "assets/mcp-stdio-local.json",
  "assets/mcp-http.json",
]) {
  const path = join(skillDir, file);
  if (!existsSync(path)) continue;
  try {
    JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    fail(`${file}: invalid JSON (${error.message})`);
  }
}

// Evaluation cases
const casesPath = join(skillDir, "evals/cases.json");
if (existsSync(casesPath)) {
  try {
    const suite = JSON.parse(readFileSync(casesPath, "utf8"));
    if (!Array.isArray(suite.cases) || suite.cases.length < 8) {
      fail("evals/cases.json must contain at least 8 cases");
    } else {
      const ids = new Set();
      for (const testCase of suite.cases) {
        if (!testCase.id || typeof testCase.id !== "string") {
          fail("evals/cases.json: every case needs a string id");
          continue;
        }
        if (ids.has(testCase.id)) {
          fail(`evals/cases.json: duplicate case id '${testCase.id}'`);
        }
        ids.add(testCase.id);
        if (typeof testCase.prompt !== "string" || testCase.prompt.length < 10) {
          fail(`evals/cases.json: case '${testCase.id}' needs a prompt`);
        }
        if (typeof testCase.expect_skill !== "boolean") {
          fail(`evals/cases.json: case '${testCase.id}' needs a boolean expect_skill`);
        }
        if (!Array.isArray(testCase.required_tools)) {
          fail(`evals/cases.json: case '${testCase.id}' needs required_tools[]`);
        } else {
          for (const tool of testCase.required_tools) {
            if (!toolNames.includes(tool)) {
              fail(`evals/cases.json: case '${testCase.id}' references unknown tool '${tool}'`);
            }
          }
        }
        if (!Array.isArray(testCase.required_checks) || testCase.required_checks.length === 0) {
          fail(`evals/cases.json: case '${testCase.id}' needs required_checks[]`);
        }
      }
      if (!suite.cases.some((testCase) => testCase.expect_skill === false)) {
        fail("evals/cases.json must include at least one negative trigger case");
      }
    }

    // Example results fixture must reference known case ids with well-formed lines.
    const examplePath = join(skillDir, "evals", "example-results.jsonl");
    if (existsSync(examplePath)) {
      const caseIds = new Set(suite.cases.map((testCase) => testCase.id));
      const exampleLines = read(examplePath).split(/\r?\n/).filter(Boolean);
      for (const line of exampleLines) {
        try {
          const record = JSON.parse(line);
          if (!record.id) {
            fail("evals/example-results.jsonl: record is missing id");
          } else if (!caseIds.has(record.id)) {
            fail(`evals/example-results.jsonl: unknown case id '${record.id}'`);
          }
          if (!Array.isArray(record.tools_called)) {
            fail(`evals/example-results.jsonl: '${record.id}' needs tools_called[]`);
          }
          if (!Array.isArray(record.checks_passed)) {
            fail(`evals/example-results.jsonl: '${record.id}' needs checks_passed[]`);
          }
        } catch (error) {
          fail(`evals/example-results.jsonl: invalid line (${error.message})`);
        }
      }
    }
  } catch (error) {
    fail(`evals/cases.json: invalid JSON (${error.message})`);
  }
}

// Reference headings
for (const file of markdownFiles) {
  const text = read(join(skillDir, file));
  if (!/^#\s+/m.test(text)) {
    warn(`${file}: no level-1 heading`);
  }
}

// Report
console.log(`Maxima MCP skill validation`);
console.log(`  skill directory: ${skillDir}`);
console.log(`  SKILL.md lines:  ${skillLines}`);
console.log(`  tools checked:   ${toolNames.length}`);
console.log(`  markdown files:  ${markdownFiles.length}`);
console.log(`  eval cases:      ${evalCaseCount()}`);

if (warnings.length > 0) {
  console.log(`\nWarnings (${warnings.length}):`);
  for (const message of warnings) console.log(`  - ${message}`);
}

if (errors.length > 0) {
  console.error(`\nErrors (${errors.length}):`);
  for (const message of errors) console.error(`  - ${message}`);
  process.exit(1);
}

console.log(`\nOK: skill is structurally valid.`);
