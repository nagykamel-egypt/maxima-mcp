#!/usr/bin/env node
/**
 * Executable runner for the maxima-mcp behavioural evaluation suite.
 *
 * Modes:
 *   node eval.mjs emit                       print a JSONL run sheet (prompts + expectations)
 *   node eval.mjs score <results.jsonl>      score recorded agent traces against cases.json
 *   node eval.mjs self-test                  validate the suite and prove the scorer works
 *
 * A results line is:
 *   {"id":"<case>","tools_called":["maxima_eval"],"checks_passed":[true,true],"notes":"..."}
 *
 * Scoring:
 *   - positive case: every required_tool must appear in tools_called;
 *   - negative case: no maxima_* tool may appear;
 *   - checks_passed must have one boolean per required_check and all must be true.
 *
 * Exit code 0 when at least --min-pass cases pass (default 11), else 1.
 */
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const skillDir = resolve(scriptDir, "..");
const casesPath = join(skillDir, "evals", "cases.json");
const toolsDocPath = join(skillDir, "references", "tools.md");

function usage() {
  console.log(`Usage:
  node eval.mjs emit
  node eval.mjs score <results.jsonl> [--min-pass N]
  node eval.mjs self-test
`);
}

function parseArgs(argv) {
  const args = { mode: argv[0], file: undefined, minPass: 11 };
  for (let i = 1; i < argv.length; i += 1) {
    if (argv[i] === "--min-pass") {
      args.minPass = Number(argv[i + 1]);
      i += 1;
    } else if (!args.file && argv[i] && !argv[i].startsWith("--")) {
      args.file = argv[i];
    } else {
      throw new Error(`Unknown argument: ${argv[i]}`);
    }
  }
  return args;
}

function knownTools() {
  const text = readFileSync(toolsDocPath, "utf8");
  const tools = new Set();
  for (const line of text.split(/\r?\n/)) {
    const match = line.match(/^### `(maxima_[a-z_]+)`\s*$/);
    if (match) tools.add(match[1]);
  }
  return tools;
}

function loadCases() {
  const suite = JSON.parse(readFileSync(casesPath, "utf8"));
  if (!Array.isArray(suite.cases) || suite.cases.length === 0) {
    throw new Error("evals/cases.json has no cases");
  }
  return suite.cases;
}

function validateCases(cases, tools) {
  const errors = [];
  const ids = new Set();
  let negative = 0;
  for (const testCase of cases) {
    if (!testCase.id || ids.has(testCase.id)) errors.push(`duplicate/missing id`);
    ids.add(testCase.id);
    if (typeof testCase.expect_skill !== "boolean") errors.push(`${testCase.id}: expect_skill`);
    if (!Array.isArray(testCase.required_checks) || testCase.required_checks.length === 0) {
      errors.push(`${testCase.id}: required_checks`);
    }
    if (!Array.isArray(testCase.required_tools)) {
      errors.push(`${testCase.id}: required_tools`);
    } else {
      for (const tool of testCase.required_tools) {
        if (!tools.has(tool)) errors.push(`${testCase.id}: unknown tool '${tool}'`);
      }
    }
    if (testCase.expect_skill === false) negative += 1;
  }
  if (negative === 0) errors.push("suite needs at least one negative trigger case");
  return errors;
}

function scoreCase(testCase, result, tools) {
  const toolsCalled = result?.tools_called ?? [];
  const checks = result?.checks_passed ?? [];

  let toolOk;
  if (testCase.expect_skill) {
    const missing = testCase.required_tools.filter((tool) => !toolsCalled.includes(tool));
    toolOk = missing.length === 0;
  } else {
    toolOk = !toolsCalled.some((tool) => tools.has(tool));
  }

  const checksOk =
    checks.length === testCase.required_checks.length && checks.every((value) => value === true);

  return { toolOk, checksOk, pass: toolOk && checksOk };
}

function score(results, cases, tools, minPass) {
  const byId = new Map();
  for (const result of results) {
    if (!result?.id) throw new Error("result line missing id");
    if (byId.has(result.id)) throw new Error(`duplicate result for '${result.id}'`);
    byId.set(result.id, result);
  }

  const rows = [];
  for (const testCase of cases) {
    const result = byId.get(testCase.id);
    if (!result) {
      rows.push({ id: testCase.id, pass: false, reason: "no result recorded" });
      continue;
    }
    const verdict = scoreCase(testCase, result, tools);
    rows.push({
      id: testCase.id,
      pass: verdict.pass,
      reason: verdict.pass
        ? "ok"
        : [
            verdict.toolOk ? "" : "required tools not called",
            verdict.checksOk ? "" : "checks not satisfied",
          ]
            .filter(Boolean)
            .join("; "),
    });
  }

  const passed = rows.filter((row) => row.pass).length;
  const total = rows.length;
  return { rows, passed, total, threshold: minPass, ok: passed >= minPass };
}

function emit(cases) {
  const lines = cases.map((testCase) =>
    JSON.stringify({
      id: testCase.id,
      expect_skill: testCase.expect_skill,
      prompt: testCase.prompt,
      required_tools: testCase.required_tools,
      required_checks: testCase.required_checks,
    }),
  );
  process.stdout.write(`${lines.join("\n")}\n`);
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const tools = knownTools();
  const cases = loadCases();

  if (!args.mode || args.mode === "--help" || args.mode === "-h") {
    usage();
    return 0;
  }

  if (args.mode === "self-test") {
    const errors = validateCases(cases, tools);
    if (errors.length > 0) {
      console.error("Suite validation failed:");
      for (const error of errors) console.error(`  - ${error}`);
      return 1;
    }
    // Prove the scorer detects failures using an in-memory all-pass and all-fail run.
    const good = cases.map((testCase) => ({
      id: testCase.id,
      tools_called: testCase.expect_skill ? testCase.required_tools : [],
      checks_passed: testCase.required_checks.map(() => true),
    }));
    const goodRun = score(good, cases, tools, cases.length);
    if (!goodRun.ok || goodRun.passed !== cases.length) {
      console.error("self-test: expected an all-pass run to pass");
      return 1;
    }
    const bad = cases.map((testCase) => ({
      id: testCase.id,
      tools_called: testCase.expect_skill ? [] : ["maxima_eval"],
      checks_passed: testCase.required_checks.map(() => false),
    }));
    const badRun = score(bad, cases, tools, 1);
    if (badRun.ok || badRun.passed !== 0) {
      console.error("self-test: expected an all-fail run to fail");
      return 1;
    }
    console.log("Eval suite self-test");
    console.log(`  cases:       ${cases.length}`);
    console.log(`  tools known: ${tools.size}`);
    console.log("  scorer:      detects pass and fail correctly");
    console.log("OK: eval runner is operational.");
    return 0;
  }

  if (args.mode === "emit") {
    emit(cases);
    return 0;
  }

  if (args.mode === "score") {
    if (!args.file) {
      usage();
      return 1;
    }
    const text = readFileSync(args.file, "utf8").trim();
    const results = text ? text.split(/\r?\n/).map((line) => JSON.parse(line)) : [];
    const report = score(results, cases, tools, args.minPass);
    console.log(`Eval scoring (${args.file})`);
    for (const row of report.rows) {
      console.log(
        `  ${row.pass ? "PASS" : "FAIL"}  ${row.id}${row.pass ? "" : ` — ${row.reason}`}`,
      );
    }
    console.log(`\n${report.passed}/${report.total} passed (threshold ${report.threshold})`);
    return report.ok ? 0 : 1;
  }

  console.error(`Unknown mode: ${args.mode}`);
  usage();
  return 1;
}

process.exit(main());
