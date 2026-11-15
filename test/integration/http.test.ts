import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { startHttpServer, type HttpServerHandle } from "../../src/http.js";
import { createTestRuntime, hasMaxima, type TestRuntime } from "../helpers.js";

const available = hasMaxima();
const token = "test-token-123";

describe.skipIf(!available)("HTTP transport integration", () => {
  let harness: TestRuntime;
  let handle: HttpServerHandle;
  let baseUrl: string;

  beforeAll(async () => {
    harness = createTestRuntime();
    harness.config.http.port = 0;
    harness.config.http.host = "127.0.0.1";
    harness.config.http.authToken = token;
    harness.config.http.rateLimit = 0;
    harness.config.http.enableJsonResponse = true;
    harness.config.http.allowedHosts = [];
    handle = await startHttpServer(harness.runtime, harness.runtime.logger);
    baseUrl = `http://127.0.0.1:${handle.port}`;
  });

  afterAll(async () => {
    await handle?.close();
    await harness?.close();
  });

  it("serves health and readiness without authentication", async () => {
    const health = await fetch(`${baseUrl}/healthz`);
    expect(health.status).toBe(200);
    expect(((await health.json()) as { status: string }).status).toBe("ok");

    const ready = await fetch(`${baseUrl}/readyz`);
    expect(ready.status).toBe(200);
    const body = (await ready.json()) as { status: string; maxima: { available: boolean } };
    expect(body.status).toBe("ready");
    expect(body.maxima.available).toBe(true);
  });

  it("echoes a client-supplied request correlation id", async () => {
    const response = await fetch(`${baseUrl}/healthz`, {
      headers: { "x-request-id": "test-corr-123" },
    });
    expect(response.status).toBe(200);
    expect(response.headers.get("x-request-id")).toBe("test-corr-123");
  });

  it("generates a request correlation id when none is supplied", async () => {
    const response = await fetch(`${baseUrl}/healthz`);
    expect(response.status).toBe(200);
    expect(response.headers.get("x-request-id")).toBeTruthy();
  });

  it("requires a bearer token for MCP endpoints", async () => {
    const response = await fetch(`${baseUrl}/mcp`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2025-06-18",
          capabilities: {},
          clientInfo: { name: "test", version: "1.0.0" },
        },
      }),
    });
    expect(response.status).toBe(401);
    expect(response.headers.get("www-authenticate")).toContain("Bearer");
  });

  it("runs a full MCP session over Streamable HTTP", async () => {
    const client = new Client({ name: "http-test", version: "1.0.0" });
    const transport = new StreamableHTTPClientTransport(new URL(`${baseUrl}/mcp`), {
      requestInit: { headers: { Authorization: `Bearer ${token}` } },
    });
    await client.connect(transport);

    const tools = await client.listTools();
    expect(tools.tools.length).toBeGreaterThan(10);

    const result = await client.callTool({
      name: "maxima_eval",
      arguments: { expression: "factor(x^2 - 1)" },
    });
    const content = result.content as Array<{ text?: string }>;
    expect(content[0]?.text).toContain("x-1");

    const metrics = await fetch(`${baseUrl}/metrics`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(metrics.status).toBe(200);
    const text = await metrics.text();
    expect(text).toContain("maxima_mcp_tool_calls_total");
    expect(text).toContain("maxima_mcp_evaluations_total");

    await client.close();
  });

  it("serves the 2026-07-28 revision to negotiating clients", async () => {
    const client = new Client(
      { name: "http-modern-test", version: "1.0.0" },
      { versionNegotiation: { mode: "auto" } },
    );
    const transport = new StreamableHTTPClientTransport(new URL(`${baseUrl}/mcp`), {
      requestInit: { headers: { Authorization: `Bearer ${token}` } },
    });
    await client.connect(transport);
    expect(client.getProtocolEra()).toBe("modern");

    const tools = await client.listTools();
    expect(tools.tools.length).toBeGreaterThan(10);

    const result = await client.callTool({
      name: "maxima_integrate",
      arguments: { expression: "x^2 + 3*x + 5", variable: "x" },
    });
    const structured = result.structuredContent as { output?: string };
    expect(structured.output).toContain("x^3/3");
    expect(structured.output).toContain("5*x");

    await client.close();
  });

  it("rejects requests with an unknown session id", async () => {
    const response = await fetch(`${baseUrl}/mcp`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        "mcp-session-id": "does-not-exist",
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} }),
    });
    expect(response.status).toBe(404);
  });

  it("enforces the JSON body limit", async () => {
    const response = await fetch(`${baseUrl}/mcp`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
      },
      body: JSON.stringify({ padding: "x".repeat(3 * 1024 * 1024) }),
    });
    expect(response.status).toBe(413);
  });
});
