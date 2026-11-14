import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { ConfigError, loadConfig } from "../../src/config.js";

const cacheDir = mkdtempSync(join(tmpdir(), "maxima-mcp-config-"));

afterAll(() => {
  rmSync(cacheDir, { recursive: true, force: true });
});

function env(extra: Record<string, string> = {}): NodeJS.ProcessEnv {
  return {
    PATH: process.env.PATH,
    HOME: process.env.HOME,
    MAXIMA_MCP_CACHE_DIR: cacheDir,
    MAXIMA_MCP_DOCS: "false",
    MAXIMA_MCP_LOG_LEVEL: "silent",
    ...extra,
  };
}

describe("loadConfig", () => {
  it("applies documented defaults", () => {
    const config = loadConfig(env());
    expect(config.transport).toBe("stdio");
    expect(config.maxima.bin).toBe("maxima");
    expect(config.maxima.defaultTimeoutMs).toBe(30_000);
    expect(config.maxima.maxTimeoutMs).toBe(300_000);
    expect(config.maxima.allowDangerous).toBe(false);
    expect(config.maxima.defaultSession).toBe("default");
    expect(config.limits.maxCommands).toBe(50);
    expect(config.docs.enabled).toBe(false);
    expect(config.maxima.userDir).toBe(join(cacheDir, "maxima-user"));
  });

  it("parses booleans and numbers", () => {
    const config = loadConfig(
      env({
        MAXIMA_MCP_ALLOW_DANGEROUS: "yes",
        MAXIMA_MCP_MAX_SESSIONS: "3",
        MAXIMA_MCP_DEFAULT_TIMEOUT_MS: "1234",
        MAXIMA_MCP_TRANSPORT: "http",
        MAXIMA_MCP_AUTH_TOKEN: "secret",
        MAXIMA_MCP_PORT: "9000",
      }),
    );
    expect(config.maxima.allowDangerous).toBe(true);
    expect(config.maxima.maxSessions).toBe(3);
    expect(config.maxima.defaultTimeoutMs).toBe(1234);
    expect(config.transport).toBe("http");
    expect(config.http.authToken).toBe("secret");
    expect(config.http.port).toBe(9000);
  });

  it("rejects invalid enum values", () => {
    expect(() => loadConfig(env({ MAXIMA_MCP_TRANSPORT: "carrier-pigeon" }))).toThrow(ConfigError);
  });

  it("rejects invalid session ids", () => {
    expect(() => loadConfig(env({ MAXIMA_MCP_DEFAULT_SESSION: "bad session!" }))).toThrow(
      ConfigError,
    );
  });

  it("reports missing documentation as a warning and disables docs", () => {
    const config = loadConfig(
      env({ MAXIMA_MCP_DOCS: "true", MAXIMA_MCP_DOC_DIR: "/nonexistent/maxima-doc" }),
    );
    expect(config.docs.enabled).toBe(false);
    expect(config.warnings.some((warning) => warning.includes("documentation"))).toBe(true);
  });

  it("warns when HTTP is exposed without a token", () => {
    const config = loadConfig(env({ MAXIMA_MCP_TRANSPORT: "http", MAXIMA_MCP_HOST: "0.0.0.0" }));
    expect(config.warnings.some((warning) => warning.includes("AUTH_TOKEN"))).toBe(true);
  });

  it("parses comma-separated lists", () => {
    const config = loadConfig(
      env({
        MAXIMA_MCP_CORS_ORIGINS: "https://a.example, https://b.example",
        MAXIMA_MCP_ALLOWED_HOSTS: "a.example,b.example",
        MAXIMA_MCP_EXTRA_ARGS: "--lisp=acl",
        MAXIMA_MCP_INIT: "a:1$\n;;\nb:2$",
      }),
    );
    expect(config.http.corsOrigins).toEqual(["https://a.example", "https://b.example"]);
    expect(config.http.allowedHosts).toEqual(["a.example", "b.example"]);
    expect(config.maxima.extraArgs).toEqual(["--lisp=acl"]);
    expect(config.maxima.initCommands).toEqual(["a:1$", "b:2$"]);
  });

  it("defaults the memory limit to disabled and source cache to 64 MiB", () => {
    const config = loadConfig(env());
    expect(config.maxima.maxMemoryMb).toBe(0);
    expect(config.docs.sourceCacheBytes).toBe(64 * 1024 * 1024);
  });

  it("parses memory and source-cache limits", () => {
    const config = loadConfig(
      env({
        MAXIMA_MCP_MAX_MEMORY_MB: "1024",
        MAXIMA_MCP_SOURCE_CACHE_BYTES: "1048576",
      }),
    );
    expect(config.maxima.maxMemoryMb).toBe(1024);
    expect(config.docs.sourceCacheBytes).toBe(1048576);
  });
});
