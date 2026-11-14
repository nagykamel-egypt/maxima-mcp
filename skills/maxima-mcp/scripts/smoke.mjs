#!/usr/bin/env node
/**
 * Smoke-test a Maxima MCP server over stdio or Streamable HTTP.
 *
 * No external dependencies. It:
 *  - starts or connects to the server,
 *  - initializes MCP and lists tools,
 *  - calls maxima_system_info,
 *  - evaluates integrate(x^2, x) and checks for x^3/3.
 *
 * Usage:
 *   node smoke.mjs --command "maxima-mcp"
 *   node smoke.mjs --command "node /path/to/dist/index.js"
 *   node smoke.mjs --http http://127.0.0.1:7331 --token "$MAXIMA_MCP_AUTH_TOKEN"
 *
 * Options:
 *   --command <cmd>   stdio server command (may contain arguments)
 *   --http <url>      Streamable HTTP base URL
 *   --token <token>   bearer token for HTTP
 *   --timeout <ms>    per-request timeout (default 30000)
 *   --json            print a JSON result
 *   --help            show this help
 */
import { spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const skillDir = resolve(scriptDir, "..");
const repoRoot = resolve(skillDir, "..", "..");

const PROTOCOL_VERSION = "2024-11-05";
const CLIENT_INFO = { name: "maxima-mcp-skill-smoke", version: "1.0.0" };

function usage() {
  console.log(`Maxima MCP smoke test

Usage:
  node smoke.mjs --command "maxima-mcp"
  node smoke.mjs --command "node /path/to/dist/index.js"
  node smoke.mjs --http http://127.0.0.1:7331 --token TOKEN

Options:
  --command <cmd>   stdio server command (may contain arguments)
  --http <url>      Streamable HTTP base URL
  --token <token>   bearer token for HTTP
  --timeout <ms>    per-request timeout (default 30000)
  --json            print a JSON result
  --help            show this help

Environment:
  MAXIMA_MCP_COMMAND   default stdio command
  MAXIMA_MCP_AUTH_TOKEN default HTTP bearer token
`);
}

function parseArgs(argv) {
  const options = {
    command: process.env.MAXIMA_MCP_COMMAND,
    http: undefined,
    token: process.env.MAXIMA_MCP_AUTH_TOKEN,
    timeout: 30_000,
    json: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = argv[i + 1];
    switch (arg) {
      case "--help":
      case "-h":
        options.help = true;
        break;
      case "--command":
        options.command = next;
        i += 1;
        break;
      case "--http":
        options.http = next;
        i += 1;
        break;
      case "--token":
        options.token = next;
        i += 1;
        break;
      case "--timeout":
        options.timeout = Number(next);
        i += 1;
        break;
      case "--json":
        options.json = true;
        break;
      default:
        throw new Error(`Unknown option: ${arg}`);
    }
  }
  if (!Number.isFinite(options.timeout) || options.timeout < 100) {
    throw new Error("--timeout must be a number >= 100");
  }
  return options;
}

/** Split a command line into an executable and arguments, respecting quotes. */
function splitCommand(input) {
  const parts = [];
  let current = "";
  let quote = null;
  for (let i = 0; i < input.length; i += 1) {
    const char = input[i];
    if (quote) {
      if (char === quote) quote = null;
      else if (char === "\\" && quote === '"' && i + 1 < input.length) {
        i += 1;
        current += input[i];
      } else current += char;
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }
    if (/\s/.test(char)) {
      if (current) {
        parts.push(current);
        current = "";
      }
      continue;
    }
    current += char;
  }
  if (quote) throw new Error("Unterminated quote in --command");
  if (current) parts.push(current);
  if (parts.length === 0) throw new Error("Empty --command");
  return { command: parts[0], args: parts.slice(1) };
}

function resolveStdioCommand(explicit) {
  if (explicit) return splitCommand(explicit);
  const which = process.platform === "win32" ? "where" : "which";
  const found = spawnSync(which, ["maxima-mcp"], { encoding: "utf8" });
  if (found.status === 0 && found.stdout.trim()) {
    return { command: "maxima-mcp", args: [] };
  }
  const local = join(repoRoot, "dist", "index.js");
  if (existsSync(local)) {
    return { command: process.execPath, args: [local] };
  }
  throw new Error(
    'No server command found. Pass --command "maxima-mcp" or "node /ABS/PATH/dist/index.js".',
  );
}

function textContent(result) {
  const content = result?.content;
  if (!Array.isArray(content)) return "";
  return content
    .filter((item) => item && item.type === "text" && typeof item.text === "string")
    .map((item) => item.text)
    .join("\n");
}

class StdioClient {
  constructor(command, args, timeoutMs) {
    this.timeoutMs = timeoutMs;
    this.pending = new Map();
    this.nextId = 1;
    this.buffer = "";
    this.stderr = "";
    this.exited = false;
    this.exitError = undefined;
    this.child = spawn(command, args, {
      stdio: ["pipe", "pipe", "pipe"],
      env: {
        ...process.env,
        MAXIMA_MCP_LOG_LEVEL: process.env.MAXIMA_MCP_LOG_LEVEL ?? "error",
      },
    });
    this.child.stdout.setEncoding("utf8");
    this.child.stderr.setEncoding("utf8");
    this.child.stdout.on("data", (chunk) => this.onData(chunk));
    this.child.stderr.on("data", (chunk) => {
      this.stderr += chunk;
      if (this.stderr.length > 20_000) this.stderr = this.stderr.slice(-20_000);
    });
    this.child.on("error", (error) => this.failAll(error));
    this.child.on("exit", (code, signal) => {
      this.exited = true;
      this.exitError = new Error(
        `Server exited (code ${code ?? "null"}, signal ${signal ?? "null"})`,
      );
      this.failAll(this.exitError);
    });
  }

  failAll(error) {
    for (const { reject, timer } of this.pending.values()) {
      clearTimeout(timer);
      reject(error);
    }
    this.pending.clear();
  }

  onData(chunk) {
    this.buffer += chunk;
    let index;
    while ((index = this.buffer.indexOf("\n")) >= 0) {
      const line = this.buffer.slice(0, index).trim();
      this.buffer = this.buffer.slice(index + 1);
      if (!line) continue;
      let message;
      try {
        message = JSON.parse(line);
      } catch {
        continue; // Ignore non-protocol output.
      }
      if (message?.id !== undefined && this.pending.has(message.id)) {
        const entry = this.pending.get(message.id);
        this.pending.delete(message.id);
        clearTimeout(entry.timer);
        if (message.error)
          entry.reject(new Error(`JSON-RPC ${message.error.code}: ${message.error.message}`));
        else entry.resolve(message.result);
      }
    }
  }

  request(method, params) {
    if (this.exited) return Promise.reject(this.exitError ?? new Error("Server exited"));
    const id = this.nextId;
    this.nextId += 1;
    return new Promise((resolvePromise, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Timeout after ${this.timeoutMs} ms waiting for ${method}`));
      }, this.timeoutMs);
      this.pending.set(id, { resolve: resolvePromise, reject, timer });
      this.child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
    });
  }

  notify(method, params) {
    if (this.exited) return;
    this.child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method, params })}\n`);
  }

  async initialize() {
    const result = await this.request("initialize", {
      protocolVersion: PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: CLIENT_INFO,
    });
    this.notify("notifications/initialized", {});
    return result;
  }

  async close() {
    try {
      this.child.stdin.end();
    } catch {
      // Best effort.
    }
    if (!this.exited) {
      this.child.kill("SIGTERM");
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 250));
      if (!this.exited) this.child.kill("SIGKILL");
    }
  }
}

function parseMcpBody(text, contentType) {
  const trimmed = text.trim();
  if (!trimmed) return undefined;
  if (contentType.includes("text/event-stream")) {
    const messages = [];
    for (const line of trimmed.split(/\r?\n/)) {
      if (!line.startsWith("data:")) continue;
      const data = line.slice(5).trim();
      if (!data || data === "[DONE]") continue;
      try {
        messages.push(JSON.parse(data));
      } catch {
        // Ignore non-JSON event data.
      }
    }
    return messages.at(-1);
  }
  try {
    return JSON.parse(trimmed);
  } catch {
    return undefined;
  }
}

class HttpClient {
  constructor(baseUrl, token, timeoutMs) {
    this.base = baseUrl.replace(/\/+$/, "");
    this.token = token;
    this.timeoutMs = timeoutMs;
    this.sessionId = undefined;
    this.nextId = 1;
  }

  headers(extra = {}) {
    return {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
      ...(this.token ? { Authorization: `Bearer ${this.token}` } : {}),
      ...(this.sessionId ? { "Mcp-Session-Id": this.sessionId } : {}),
      ...extra,
    };
  }

  async getJson(path) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await fetch(`${this.base}${path}`, {
        headers: this.token ? { Authorization: `Bearer ${this.token}` } : {},
        signal: controller.signal,
      });
      const text = await response.text();
      let body;
      try {
        body = JSON.parse(text);
      } catch {
        body = text;
      }
      return { status: response.status, ok: response.ok, body };
    } finally {
      clearTimeout(timer);
    }
  }

  async rpc(method, params, id) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await fetch(`${this.base}/mcp`, {
        method: "POST",
        headers: this.headers(),
        body: JSON.stringify({
          jsonrpc: "2.0",
          ...(id === undefined ? {} : { id }),
          method,
          params,
        }),
        signal: controller.signal,
      });
      const sessionId = response.headers.get("mcp-session-id");
      if (sessionId) this.sessionId = sessionId;
      const text = await response.text();
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${text.slice(0, 500)}`);
      }
      if (id === undefined) return undefined;
      const message = parseMcpBody(text, response.headers.get("content-type") ?? "");
      if (!message) throw new Error(`No JSON-RPC response: ${text.slice(0, 500)}`);
      if (message.error) {
        throw new Error(`JSON-RPC ${message.error.code}: ${message.error.message}`);
      }
      return message.result;
    } finally {
      clearTimeout(timer);
    }
  }

  async initialize() {
    const result = await this.rpc(
      "initialize",
      {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: {},
        clientInfo: CLIENT_INFO,
      },
      1,
    );
    await this.rpc("notifications/initialized", {}, undefined);
    this.nextId = 2;
    return result;
  }

  request(method, params) {
    const id = this.nextId;
    this.nextId += 1;
    return this.rpc(method, params, id);
  }

  async close() {
    if (!this.sessionId) return;
    try {
      await fetch(`${this.base}/mcp`, {
        method: "DELETE",
        headers: this.headers(),
      });
    } catch {
      // Best effort.
    }
  }
}

async function run(transport, client) {
  const init = await client.initialize();
  const tools = await client.request("tools/list", {});
  const toolNames = (tools?.tools ?? []).map((tool) => tool.name);
  const required = [
    "maxima_eval",
    "maxima_batch",
    "maxima_solve",
    "maxima_integrate",
    "maxima_plot",
    "maxima_system_info",
  ];
  const missing = required.filter((name) => !toolNames.includes(name));
  if (missing.length > 0) {
    throw new Error(`Missing expected tools: ${missing.join(", ")}`);
  }

  const sys = await client.request("tools/call", {
    name: "maxima_system_info",
    arguments: {},
  });
  const sysStructured = sys?.structuredContent;
  const sysText = textContent(sys);
  const available =
    sysStructured?.maxima?.available ?? (/Available:\s*yes/i.test(sysText) ? true : undefined);
  if (available === false) {
    throw new Error(
      `Maxima is not available. ${sysStructured?.maxima?.bin ?? "Check MAXIMA_BIN."}`,
    );
  }

  const ev = await client.request("tools/call", {
    name: "maxima_eval",
    arguments: { expression: "integrate(x^2, x)" },
  });
  const output = ev?.structuredContent?.output ?? textContent(ev);
  if (!/x\^3\s*\/\s*3/.test(output)) {
    throw new Error(`Unexpected evaluation output: ${output.slice(0, 500)}`);
  }
  const evaluationLine =
    output
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !/^Note:/i.test(line))
      .at(-1) ?? output.trim();

  return {
    transport,
    server: init?.serverInfo ?? sysStructured?.server ?? undefined,
    tools: toolNames.length,
    maxima: sysStructured?.maxima ?? undefined,
    evaluation: evaluationLine,
  };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    usage();
    return;
  }

  let client;
  let transport;
  try {
    if (options.http) {
      transport = "http";
      client = new HttpClient(options.http, options.token, options.timeout);
      const health = await client.getJson("/healthz");
      if (!health.ok) throw new Error(`/healthz returned ${health.status}`);
      const ready = await client.getJson("/readyz");
      if (!ready.ok || ready.body?.status !== "ready") {
        throw new Error(`/readyz returned ${ready.status}: ${JSON.stringify(ready.body)}`);
      }
    } else {
      transport = "stdio";
      const resolved = resolveStdioCommand(options.command);
      client = new StdioClient(resolved.command, resolved.args, options.timeout);
    }

    const summary = await run(transport, client);
    if (options.json) {
      console.log(JSON.stringify({ ok: true, ...summary }, null, 2));
    } else {
      console.log("Maxima MCP smoke test");
      console.log(`  transport: ${summary.transport}`);
      if (summary.server) {
        console.log(
          `  server:    ${summary.server.name ?? "?"} ${summary.server.version ?? ""}`.trimEnd(),
        );
      }
      console.log(`  tools:     ${summary.tools}`);
      if (summary.maxima) {
        console.log(
          `  maxima:    ${summary.maxima.version ?? "unknown"} (available: ${
            summary.maxima.available ? "yes" : "no"
          })`,
        );
      }
      console.log(`  eval:      ${summary.evaluation}`);
      console.log("  result:    OK");
    }
  } catch (error) {
    if (options.json) {
      console.log(JSON.stringify({ ok: false, error: error.message }, null, 2));
    } else {
      console.error(`Smoke test failed: ${error.message}`);
      if (client instanceof StdioClient && client.stderr.trim()) {
        console.error(`\nServer stderr (tail):\n${client.stderr.trim().slice(-4000)}`);
      }
    }
    process.exitCode = 1;
  } finally {
    if (client) {
      try {
        await client.close();
      } catch {
        // Best effort.
      }
    }
  }
}

main();
