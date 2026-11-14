import { existsSync, readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";
import { z } from "zod";

export type TransportMode = "stdio" | "http";

export interface MaximaConfig {
  bin: string;
  /** Extra command line arguments passed to Maxima. */
  extraArgs: string[];
  /** Maxima expressions executed when a session starts. */
  initCommands: string[];
  defaultTimeoutMs: number;
  maxTimeoutMs: number;
  maxOutputBytes: number;
  /** Per-process RSS ceiling for the Maxima child in MiB; 0 disables enforcement. */
  maxMemoryMb: number;
  maxSessions: number;
  sessionIdleMs: number;
  /** Persistent Maxima user directory used for compiled package caches. */
  userDir: string;
  /** Allow shell/file-system access primitives such as system(), load() and writefile(). */
  allowDangerous: boolean;
  /** Session used when a tool call omits session_id. */
  defaultSession: string;
}

export interface DocsConfig {
  enabled: boolean;
  prewarm: boolean;
  htmlDir: string;
  srcDir: string;
  shareDir: string;
  cacheDir: string;
  maxSearchResults: number;
  /** Byte budget for the in-memory source file content cache; 0 disables it. */
  sourceCacheBytes: number;
}

export interface HttpConfig {
  host: string;
  port: number;
  authToken?: string;
  corsOrigins: string[];
  allowedHosts: string[];
  rateLimit: number;
  rateWindowMs: number;
  bodyLimit: string;
  enableJsonResponse: boolean;
  /** Trust X-Forwarded-* headers from a reverse proxy. */
  trustProxy: boolean;
  /** Idle timeout for MCP HTTP transports. */
  sessionIdleMs: number;
}

export interface LimitsConfig {
  maxExpressionChars: number;
  maxCommands: number;
  maxOutputChars: number;
  maxPlotBytes: number;
}

export interface LoggingConfig {
  level: string;
  format: "json" | "pretty";
}

export interface AppConfig {
  transport: TransportMode;
  maxima: MaximaConfig;
  docs: DocsConfig;
  http: HttpConfig;
  limits: LimitsConfig;
  logging: LoggingConfig;
  warnings: string[];
}

const numberFromEnv = (name: string, fallback: number, opts: { min?: number; max?: number } = {}) =>
  z.coerce
    .number({ error: `${name} must be a number` })
    .int()
    .min(opts.min ?? 0)
    .max(opts.max ?? Number.MAX_SAFE_INTEGER)
    .default(fallback);

const boolFromEnv = (name: string, fallback: boolean) =>
  z
    .enum(["1", "0", "true", "false", "yes", "no", "on", "off"], {
      error: `${name} must be one of true/false/1/0/yes/no/on/off`,
    })
    .default(fallback ? "true" : "false")
    .transform((value) => ["1", "true", "yes", "on"].includes(value));

const envSchema = z.object({
  MAXIMA_MCP_TRANSPORT: z.enum(["stdio", "http"]).default("stdio"),
  MAXIMA_MCP_LOG_LEVEL: z
    .enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"])
    .default("info"),
  MAXIMA_MCP_LOG_FORMAT: z.enum(["json", "pretty", "auto"]).default("auto"),

  MAXIMA_BIN: z.string().min(1).default("maxima"),
  MAXIMA_MCP_EXTRA_ARGS: z.string().default(""),
  MAXIMA_MCP_INIT: z.string().default(""),
  MAXIMA_MCP_DEFAULT_TIMEOUT_MS: numberFromEnv("MAXIMA_MCP_DEFAULT_TIMEOUT_MS", 30_000, {
    min: 100,
  }),
  MAXIMA_MCP_MAX_TIMEOUT_MS: numberFromEnv("MAXIMA_MCP_MAX_TIMEOUT_MS", 300_000, { min: 100 }),
  MAXIMA_MCP_MAX_OUTPUT_BYTES: numberFromEnv("MAXIMA_MCP_MAX_OUTPUT_BYTES", 1_000_000, {
    min: 1_024,
  }),
  MAXIMA_MCP_MAX_MEMORY_MB: numberFromEnv("MAXIMA_MCP_MAX_MEMORY_MB", 0, { min: 0 }),
  MAXIMA_MCP_MAX_SESSIONS: numberFromEnv("MAXIMA_MCP_MAX_SESSIONS", 8, { min: 1, max: 128 }),
  MAXIMA_MCP_SESSION_IDLE_MS: numberFromEnv("MAXIMA_MCP_SESSION_IDLE_MS", 900_000, {
    min: 10_000,
  }),
  MAXIMA_MCP_USERDIR: z.string().default(""),
  MAXIMA_MCP_ALLOW_DANGEROUS: boolFromEnv("MAXIMA_MCP_ALLOW_DANGEROUS", false),
  MAXIMA_MCP_DEFAULT_SESSION: z
    .string()
    .min(1)
    .max(128)
    .regex(/^[A-Za-z0-9_.:-]+$/, "must contain only letters, digits, '_', '.', ':' or '-'")
    .default("default"),

  MAXIMA_MCP_DOCS: boolFromEnv("MAXIMA_MCP_DOCS", true),
  MAXIMA_MCP_DOCS_PREWARM: boolFromEnv("MAXIMA_MCP_DOCS_PREWARM", true),
  MAXIMA_MCP_DOC_DIR: z.string().default("/usr/share/doc/maxima-doc/html"),
  MAXIMA_MCP_SRC_DIR: z.string().default(""),
  MAXIMA_MCP_SHARE_DIR: z.string().default(""),
  MAXIMA_MCP_CACHE_DIR: z.string().default(join(homedir(), ".cache", "maxima-mcp")),
  MAXIMA_MCP_MAX_SEARCH_RESULTS: numberFromEnv("MAXIMA_MCP_MAX_SEARCH_RESULTS", 20, {
    min: 1,
    max: 100,
  }),
  MAXIMA_MCP_SOURCE_CACHE_BYTES: numberFromEnv("MAXIMA_MCP_SOURCE_CACHE_BYTES", 64 * 1024 * 1024, {
    min: 0,
  }),

  MAXIMA_MCP_HOST: z.string().default("127.0.0.1"),
  MAXIMA_MCP_PORT: numberFromEnv("MAXIMA_MCP_PORT", 7331, { min: 1, max: 65_535 }),
  MAXIMA_MCP_AUTH_TOKEN: z.string().min(1).optional(),
  MAXIMA_MCP_CORS_ORIGINS: z.string().default("*"),
  MAXIMA_MCP_ALLOWED_HOSTS: z.string().default(""),
  MAXIMA_MCP_RATE_LIMIT: numberFromEnv("MAXIMA_MCP_RATE_LIMIT", 120, { min: 0 }),
  MAXIMA_MCP_RATE_WINDOW_MS: numberFromEnv("MAXIMA_MCP_RATE_WINDOW_MS", 60_000, { min: 1_000 }),
  MAXIMA_MCP_BODY_LIMIT: z.string().default("2mb"),
  MAXIMA_MCP_JSON_RESPONSE: boolFromEnv("MAXIMA_MCP_JSON_RESPONSE", false),
  MAXIMA_MCP_TRUST_PROXY: boolFromEnv("MAXIMA_MCP_TRUST_PROXY", false),
  MAXIMA_MCP_HTTP_SESSION_IDLE_MS: numberFromEnv("MAXIMA_MCP_HTTP_SESSION_IDLE_MS", 1_800_000, {
    min: 30_000,
  }),

  MAXIMA_MCP_MAX_EXPRESSION_CHARS: numberFromEnv("MAXIMA_MCP_MAX_EXPRESSION_CHARS", 100_000, {
    min: 1,
  }),
  MAXIMA_MCP_MAX_COMMANDS: numberFromEnv("MAXIMA_MCP_MAX_COMMANDS", 50, { min: 1, max: 1_000 }),
  MAXIMA_MCP_MAX_OUTPUT_CHARS: numberFromEnv("MAXIMA_MCP_MAX_OUTPUT_CHARS", 200_000, { min: 1 }),
  MAXIMA_MCP_MAX_PLOT_BYTES: numberFromEnv("MAXIMA_MCP_MAX_PLOT_BYTES", 10_000_000, {
    min: 1_024,
  }),
});

export class ConfigError extends Error {
  override readonly name = "ConfigError";
}

function expandHome(value: string): string {
  if (value === "~") return homedir();
  if (value.startsWith("~/")) return join(homedir(), value.slice(2));
  return value;
}

function absolute(value: string, cwd = process.cwd()): string {
  const expanded = expandHome(value);
  return isAbsolute(expanded) ? resolve(expanded) : resolve(cwd, expanded);
}

/** Locate the newest installed Maxima share directory (e.g. /usr/share/maxima/5.49.0). */
export function detectMaximaRoot(): string | undefined {
  const candidates = [
    process.env.MAXIMA_ROOT,
    "/usr/share/maxima",
    "/usr/local/share/maxima",
    "/opt/maxima/share/maxima",
  ].filter((value): value is string => Boolean(value));

  for (const base of candidates) {
    if (!existsSync(base)) continue;
    if (existsSync(join(base, "src")) && existsSync(join(base, "share"))) return base;
    let entries: string[] = [];
    try {
      entries = readdirSync(base).filter((entry) => {
        try {
          return statSync(join(base, entry)).isDirectory();
        } catch {
          return false;
        }
      });
    } catch {
      continue;
    }
    const versions = entries
      .filter((entry) => /^\d+(?:\.\d+)+/.test(entry))
      .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
    const newest = versions.at(-1);
    if (newest && existsSync(join(base, newest, "share"))) return join(base, newest);
  }
  return undefined;
}

function isDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

function splitList(value: string): string[] {
  return value
    .split(/\r?\n|;;/)
    .map((item) => item.trim())
    .filter(Boolean);
}

/**
 * Parse configuration from environment variables. Throws ConfigError for invalid input.
 * Missing documentation directories are reported as warnings and disable documentation features.
 */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    const details = parsed.error.issues
      .map((issue) => `${issue.path.join(".") || "env"}: ${issue.message}`)
      .join("; ");
    throw new ConfigError(`Invalid configuration: ${details}`);
  }
  const e = parsed.data;
  const warnings: string[] = [];

  if (e.MAXIMA_MCP_DEFAULT_TIMEOUT_MS > e.MAXIMA_MCP_MAX_TIMEOUT_MS) {
    warnings.push(
      "MAXIMA_MCP_DEFAULT_TIMEOUT_MS exceeds MAXIMA_MCP_MAX_TIMEOUT_MS; calls may be capped unexpectedly.",
    );
  }

  let maximaRoot: string | undefined;
  try {
    maximaRoot = detectMaximaRoot();
  } catch (error) {
    warnings.push(`Could not detect Maxima installation: ${(error as Error).message}`);
  }

  const docDir = absolute(e.MAXIMA_MCP_DOC_DIR);
  const docsAvailable = isDirectory(docDir) && existsSync(join(docDir, "index.html"));
  if (e.MAXIMA_MCP_DOCS && !docsAvailable) {
    warnings.push(
      `Maxima HTML documentation not found at ${docDir}; documentation tools and resources are disabled. Install maxima-doc or set MAXIMA_MCP_DOC_DIR.`,
    );
  }

  let srcDir = e.MAXIMA_MCP_SRC_DIR ? absolute(e.MAXIMA_MCP_SRC_DIR) : "";
  if (!srcDir && maximaRoot) srcDir = join(maximaRoot, "src");
  if (srcDir && !isDirectory(srcDir)) {
    warnings.push(`Maxima source directory not found at ${srcDir}; source lookup is disabled.`);
    srcDir = "";
  }

  let shareDir = e.MAXIMA_MCP_SHARE_DIR ? absolute(e.MAXIMA_MCP_SHARE_DIR) : "";
  if (!shareDir && maximaRoot) shareDir = join(maximaRoot, "share");
  if (shareDir && !isDirectory(shareDir)) {
    warnings.push(`Maxima share directory not found at ${shareDir}; package tools are limited.`);
    shareDir = "";
  }

  const logFormat: "json" | "pretty" =
    e.MAXIMA_MCP_LOG_FORMAT === "auto"
      ? process.stderr.isTTY
        ? "pretty"
        : "json"
      : e.MAXIMA_MCP_LOG_FORMAT;

  const cacheDir = absolute(e.MAXIMA_MCP_CACHE_DIR);
  const userDir = e.MAXIMA_MCP_USERDIR
    ? absolute(e.MAXIMA_MCP_USERDIR)
    : join(cacheDir, "maxima-user");

  const corsOrigins = e.MAXIMA_MCP_CORS_ORIGINS.split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
  const allowedHosts = e.MAXIMA_MCP_ALLOWED_HOSTS.split(",")
    .map((host) => host.trim().toLowerCase())
    .filter(Boolean);

  if (e.MAXIMA_MCP_TRANSPORT === "http" && !e.MAXIMA_MCP_AUTH_TOKEN) {
    const loopback = ["127.0.0.1", "::1", "localhost"].includes(e.MAXIMA_MCP_HOST);
    if (!loopback) {
      warnings.push(
        "HTTP transport is bound to a non-loopback address without MAXIMA_MCP_AUTH_TOKEN. Set a token before exposing this server.",
      );
    }
  }
  if (e.MAXIMA_MCP_AUTH_TOKEN && e.MAXIMA_MCP_AUTH_TOKEN.length < 16) {
    warnings.push(
      "MAXIMA_MCP_AUTH_TOKEN is shorter than 16 characters; use a long random token for production.",
    );
  }

  const config: AppConfig = {
    transport: e.MAXIMA_MCP_TRANSPORT,
    maxima: {
      bin: e.MAXIMA_BIN,
      extraArgs: splitList(e.MAXIMA_MCP_EXTRA_ARGS),
      initCommands: splitList(e.MAXIMA_MCP_INIT),
      defaultTimeoutMs: e.MAXIMA_MCP_DEFAULT_TIMEOUT_MS,
      maxTimeoutMs: e.MAXIMA_MCP_MAX_TIMEOUT_MS,
      maxOutputBytes: e.MAXIMA_MCP_MAX_OUTPUT_BYTES,
      maxMemoryMb: e.MAXIMA_MCP_MAX_MEMORY_MB,
      maxSessions: e.MAXIMA_MCP_MAX_SESSIONS,
      sessionIdleMs: e.MAXIMA_MCP_SESSION_IDLE_MS,
      userDir,
      allowDangerous: e.MAXIMA_MCP_ALLOW_DANGEROUS,
      defaultSession: e.MAXIMA_MCP_DEFAULT_SESSION,
    },
    docs: {
      enabled: e.MAXIMA_MCP_DOCS && docsAvailable,
      prewarm: e.MAXIMA_MCP_DOCS_PREWARM,
      htmlDir: docDir,
      srcDir,
      shareDir,
      cacheDir: absolute(e.MAXIMA_MCP_CACHE_DIR),
      maxSearchResults: e.MAXIMA_MCP_MAX_SEARCH_RESULTS,
      sourceCacheBytes: e.MAXIMA_MCP_SOURCE_CACHE_BYTES,
    },
    http: {
      host: e.MAXIMA_MCP_HOST,
      port: e.MAXIMA_MCP_PORT,
      authToken: e.MAXIMA_MCP_AUTH_TOKEN,
      corsOrigins,
      allowedHosts,
      rateLimit: e.MAXIMA_MCP_RATE_LIMIT,
      rateWindowMs: e.MAXIMA_MCP_RATE_WINDOW_MS,
      bodyLimit: e.MAXIMA_MCP_BODY_LIMIT,
      enableJsonResponse: e.MAXIMA_MCP_JSON_RESPONSE,
      trustProxy: e.MAXIMA_MCP_TRUST_PROXY,
      sessionIdleMs: e.MAXIMA_MCP_HTTP_SESSION_IDLE_MS,
    },
    limits: {
      maxExpressionChars: e.MAXIMA_MCP_MAX_EXPRESSION_CHARS,
      maxCommands: e.MAXIMA_MCP_MAX_COMMANDS,
      maxOutputChars: e.MAXIMA_MCP_MAX_OUTPUT_CHARS,
      maxPlotBytes: e.MAXIMA_MCP_MAX_PLOT_BYTES,
    },
    logging: {
      level: e.MAXIMA_MCP_LOG_LEVEL,
      format: logFormat,
    },
    warnings,
  };

  return config;
}
