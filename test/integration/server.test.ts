import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/client";
import { InMemoryTransport, type McpServer } from "@modelcontextprotocol/server";
import { createMcpServer } from "../../src/server.js";
import { createTestRuntime, hasMaxima, type TestRuntime } from "../helpers.js";

const available = hasMaxima();

describe.skipIf(!available)("MCP server over in-memory transport", () => {
  let harness: TestRuntime;
  let server: McpServer;
  let client: Client;

  beforeAll(async () => {
    harness = createTestRuntime();
    server = createMcpServer(harness.runtime);
    client = new Client({ name: "test-client", version: "1.0.0" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    await client.connect(clientTransport);
  });

  afterAll(async () => {
    await client?.close();
    await server?.close();
    await harness?.close();
  });

  it("advertises the tool surface", async () => {
    const { tools } = await client.listTools();
    const names = tools.map((tool) => tool.name);
    expect(names).toContain("maxima_eval");
    expect(names).toContain("maxima_batch");
    expect(names).toContain("maxima_solve");
    expect(names).toContain("maxima_help");
    expect(names).toContain("maxima_plot");
    expect(names).toContain("maxima_system_info");
    expect(names).toHaveLength(29);
  });

  it("evaluates through the MCP protocol with structured output", async () => {
    const result = await client.callTool({
      name: "maxima_eval",
      arguments: { expression: "integrate(x^2, x)" },
    });
    expect(result.isError).toBeFalsy();
    const structured = result.structuredContent as {
      session_id: string;
      results: Array<{ output: string; is_error: boolean }>;
      duration_ms: number;
    };
    expect(structured.session_id).toBe("default");
    expect(structured.results[0]?.output).toBe("x^3/3");
    expect(structured.results[0]?.is_error).toBe(false);
    expect(structured.duration_ms).toBeGreaterThanOrEqual(0);
  });

  it("runs a batch and preserves state", async () => {
    const result = await client.callTool({
      name: "maxima_batch",
      arguments: { commands: ["a: 3$", "a^3;"] },
    });
    const content = result.content as Array<{ type: string; text?: string }>;
    expect(content[0]?.text).toContain("27");
  });

  it("returns errors as tool errors", async () => {
    const result = await client.callTool({
      name: "maxima_eval",
      arguments: { expression: 'system("echo unsafe")' },
    });
    expect(result.isError).toBe(true);
    const content = result.content as Array<{ text?: string }>;
    expect(content[0]?.text).toContain("UNSAFE_EXPRESSION");
  });

  it("manages sessions", async () => {
    const opened = await client.callTool({
      name: "maxima_session_open",
      arguments: { session_id: "protocol-session", name: "Protocol session" },
    });
    expect(opened.isError).toBeFalsy();
    const structured = opened.structuredContent as { created: boolean; session: { id: string } };
    expect(structured.created).toBe(true);
    expect(structured.session.id).toBe("protocol-session");

    const list = await client.callTool({ name: "maxima_session_list", arguments: {} });
    const sessions = list.structuredContent as { sessions: Array<{ id: string }> };
    expect(sessions.sessions.some((session) => session.id === "protocol-session")).toBe(true);

    const closed = await client.callTool({
      name: "maxima_session_close",
      arguments: { session_id: "protocol-session" },
    });
    expect((closed.structuredContent as { closed: boolean }).closed).toBe(true);
  });

  it("exposes prompts and resources", async () => {
    const { prompts } = await client.listPrompts();
    expect(prompts.map((prompt) => prompt.name)).toEqual(
      expect.arrayContaining([
        "maxima_solve_problem",
        "maxima_explain_symbol",
        "maxima_debug_expression",
      ]),
    );

    const prompt = await client.getPrompt({
      name: "maxima_explain_symbol",
      arguments: { symbol: "integrate" },
    });
    expect(JSON.stringify(prompt)).toContain("maxima_help");

    const { resources } = await client.listResources();
    expect(resources.some((resource) => resource.uri === "maxima://manual/index")).toBe(true);
  });

  it("reports server information", async () => {
    const result = await client.callTool({ name: "maxima_system_info", arguments: {} });
    const info = result.structuredContent as {
      maxima: { available: boolean; version?: string };
      sessions: { count: number };
    };
    expect(info.maxima.available).toBe(true);
    expect(info.maxima.version).toBeTruthy();
    expect(info.sessions.count).toBeGreaterThanOrEqual(0);
  });
});
