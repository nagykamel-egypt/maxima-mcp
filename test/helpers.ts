import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { detectMaximaRoot, loadConfig, type AppConfig } from "../src/config.js";
import { createLogger } from "../src/logger.js";
import { createRuntime, shutdownRuntime, type Runtime } from "../src/runtime.js";

export function hasBinary(command: string, args: string[] = ["--version"]): boolean {
  const result = spawnSync(command, args, { stdio: "ignore", timeout: 10_000 });
  return result.status === 0;
}

export function hasMaxima(): boolean {
  return hasBinary(process.env.MAXIMA_BIN ?? "maxima", ["--version"]);
}

export function hasGnuplot(): boolean {
  return hasBinary("gnuplot", ["--version"]);
}

export function docDir(): string {
  return process.env.MAXIMA_MCP_DOC_DIR ?? "/usr/share/doc/maxima-doc/html";
}

export function hasDocs(): boolean {
  return existsSync(join(docDir(), "index.html"));
}

export function hasSource(): boolean {
  const root = detectMaximaRoot();
  return Boolean(root && existsSync(join(root, "src")));
}

export function hasShare(): boolean {
  const root = detectMaximaRoot();
  return Boolean(root && existsSync(join(root, "share")));
}

export interface TestRuntime {
  runtime: Runtime;
  config: AppConfig;
  cacheDir: string;
  close: () => Promise<void>;
}

export function createTestRuntime(extra: Record<string, string> = {}): TestRuntime {
  const cacheDir = mkdtempSync(join(tmpdir(), "maxima-mcp-test-"));
  const env: NodeJS.ProcessEnv = {
    PATH: process.env.PATH,
    HOME: process.env.HOME,
    MAXIMA_MCP_LOG_LEVEL: "silent",
    MAXIMA_MCP_DOCS: "false",
    MAXIMA_MCP_DOCS_PREWARM: "false",
    MAXIMA_MCP_CACHE_DIR: cacheDir,
    MAXIMA_MCP_SESSION_IDLE_MS: "3600000",
    ...extra,
  };
  const config = loadConfig(env);
  const runtime = createRuntime(config, createLogger(config.logging));
  return {
    runtime,
    config,
    cacheDir,
    close: async () => {
      await shutdownRuntime(runtime);
      rmSync(cacheDir, { recursive: true, force: true });
    },
  };
}

export function readEnv(name: string, fallback: string): string {
  return process.env[name] ?? fallback;
}
