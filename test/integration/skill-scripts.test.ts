import { spawn, spawnSync, type SpawnSyncReturns } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startHttpServer, type HttpServerHandle } from "../../src/http.js";
import { createTestRuntime, hasMaxima, type TestRuntime } from "../helpers.js";
import { distIndex, evalsDir, repoRoot, scriptsDir } from "../skill-helpers.js";

function runNode(script: string, args: string[] = [], timeout = 120_000): SpawnSyncReturns<string> {
  return spawnSync(process.execPath, [script, ...args], {
    encoding: "utf8",
    timeout,
    cwd: repoRoot,
    env: { ...process.env, MAXIMA_MCP_LOG_LEVEL: "silent" },
  });
}

/**
 * Run a script asynchronously so the host process keeps its event loop free.
 * Required when the HTTP server under test runs in-process (spawnSync would
 * block its event loop and deadlock the smoke test).
 */
function runNodeAsync(
  script: string,
  args: string[] = [],
  timeout = 120_000,
): Promise<{ status: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [script, ...args], {
      cwd: repoRoot,
      env: { ...process.env, MAXIMA_MCP_LOG_LEVEL: "silent" },
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    const timer = setTimeout(() => child.kill("SIGKILL"), timeout);
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ status: code, stdout, stderr });
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      resolve({ status: null, stdout, stderr: `${stderr}${error.message}` });
    });
  });
}

const validateScript = join(scriptsDir, "validate.mjs");
const driftScript = join(scriptsDir, "check-drift.mjs");
const evalScript = join(scriptsDir, "eval.mjs");
const smokeScript = join(scriptsDir, "smoke.mjs");

describe("skill scripts", () => {
  it("validate.mjs passes", () => {
    const result = runNode(validateScript);
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain("OK: skill is structurally valid.");
    expect(result.stdout).toContain("tools checked:   29");
  });

  it("check-drift.mjs reports no drift", () => {
    const result = runNode(driftScript);
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain("OK: tool reference matches the server schemas.");
    expect(result.stdout).toContain("source tools:   29");
    expect(result.stdout).toContain("documented:     29");
  });

  it("eval.mjs self-test passes", () => {
    const result = runNode(evalScript, ["self-test"]);
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain("OK: eval runner is operational.");
    expect(result.stdout).toContain("cases:       13");
  });

  it("eval.mjs scores the passing fixture as a pass", () => {
    const result = runNode(evalScript, [
      "score",
      join(evalsDir, "example-results.jsonl"),
      "--min-pass",
      "11",
    ]);
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain("13/13 passed");
  });

  it("eval.mjs fails a below-threshold run", () => {
    const tempDir = mkdtempSync(join(tmpdir(), "maxima-skill-eval-"));
    const failing = join(tempDir, "failing.jsonl");
    // A positive case with no tools called and no checks satisfied must fail.
    writeFileSync(
      failing,
      `${JSON.stringify({ id: "trigger-symbolic-integral", tools_called: [], checks_passed: [] })}\n`,
    );
    try {
      const result = runNode(evalScript, ["score", failing, "--min-pass", "1"]);
      expect(result.status).toBe(1);
      expect(result.stdout).toContain("FAIL");
      expect(result.stdout).toContain("trigger-symbolic-integral");
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });
});

describe.skipIf(!hasMaxima() || !existsSync(distIndex))("skill smoke test (stdio)", () => {
  it("runs a full MCP session over stdio", () => {
    const result = runNode(smokeScript, ["--command", `node ${distIndex}`, "--timeout", "60000"]);
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain("transport: stdio");
    expect(result.stdout).toContain("tools:     29");
    expect(result.stdout).toContain("eval:      x^3/3");
    expect(result.stdout).toContain("result:    OK");
  });
});

describe.skipIf(!hasMaxima())("skill smoke test (Streamable HTTP)", () => {
  let harness: TestRuntime;
  let handle: HttpServerHandle;
  let baseUrl: string;
  const token = "skill-smoke-token";

  beforeAll(async () => {
    harness = createTestRuntime();
    harness.config.http.port = 0;
    harness.config.http.host = "127.0.0.1";
    harness.config.http.authToken = token;
    harness.config.http.rateLimit = 0;
    harness.config.http.allowedHosts = [];
    handle = await startHttpServer(harness.runtime, harness.runtime.logger);
    baseUrl = `http://127.0.0.1:${handle.port}`;
  });

  afterAll(async () => {
    await handle?.close();
    await harness?.close();
  });

  it("runs a full MCP session over Streamable HTTP", async () => {
    const result = await runNodeAsync(smokeScript, [
      "--http",
      baseUrl,
      "--token",
      token,
      "--timeout",
      "60000",
    ]);
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain("transport: http");
    expect(result.stdout).toContain("tools:     29");
    expect(result.stdout).toContain("eval:      x^3/3");
    expect(result.stdout).toContain("result:    OK");
  });
});
