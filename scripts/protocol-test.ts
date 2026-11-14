import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

function env(): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (typeof value === "string") result[key] = value;
  }
  result.MAXIMA_MCP_LOG_LEVEL = "silent";
  result.MAXIMA_MCP_DOCS_PREWARM = "false";
  return result;
}

async function main(): Promise<void> {
  const transport = new StdioClientTransport({
    command: "node",
    args: ["dist/index.js"],
    env: env(),
    stderr: "pipe",
  });
  const client = new Client({ name: "protocol-test", version: "1.0.0" });
  await client.connect(transport);

  const tools = await client.listTools();
  console.log("tools:", tools.tools.length, tools.tools.map((tool) => tool.name).join(", "));

  const evalResult = await client.callTool({
    name: "maxima_eval",
    arguments: { expression: "integrate(x^2, x)" },
  });
  console.log("eval:", JSON.stringify(evalResult).slice(0, 400));

  const batch = await client.callTool({
    name: "maxima_batch",
    arguments: { commands: ["a: 7$", "a^2;", "expand((a+1)^2);"] },
  });
  console.log("batch text:", batch.content);

  const solve = await client.callTool({
    name: "maxima_solve",
    arguments: { equations: "x^2 - 5*x + 6 = 0", variables: "x" },
  });
  console.log("solve:", JSON.stringify(solve.content));

  const help = await client.callTool({
    name: "maxima_help",
    arguments: { symbol: "integrate", max_entries: 1 },
  });
  console.log("help:", JSON.stringify(help.content).slice(0, 300));

  const search = await client.callTool({
    name: "maxima_search_docs",
    arguments: { query: "eigenvalues", limit: 3 },
  });
  console.log("search:", JSON.stringify(search.content).slice(0, 300));

  const source = await client.callTool({
    name: "maxima_source",
    arguments: { symbol: "integrate", context_lines: 2, max_results: 1 },
  });
  console.log("source:", JSON.stringify(source.content).slice(0, 300));

  const packages = await client.callTool({
    name: "maxima_list_packages",
    arguments: { filter: "draw", limit: 5 },
  });
  console.log("packages:", JSON.stringify(packages.content).slice(0, 300));

  const plot = await client.callTool({
    name: "maxima_plot",
    arguments: {
      expressions: ["sin(x)"],
      x_min: -6,
      x_max: 6,
      format: "svg",
      width: 400,
      height: 300,
    },
  });
  const plotContent = plot.content as Array<{ type: string; mimeType?: string; data?: string }>;
  console.log(
    "plot:",
    JSON.stringify(
      plotContent.map((item) => ({
        type: item.type,
        mimeType: item.mimeType,
        bytes: item.data?.length,
      })),
    ),
  );

  const info = await client.callTool({ name: "maxima_system_info", arguments: {} });
  console.log("info:", JSON.stringify(info.content).slice(0, 300));

  const sessions = await client.callTool({ name: "maxima_session_list", arguments: {} });
  console.log("sessions:", JSON.stringify(sessions.structuredContent));

  const resources = await client.listResources();
  console.log(
    "resources:",
    resources.resources.map((resource) => resource.uri),
  );

  const resource = await client.readResource({ uri: "maxima://docs/symbol/integrate" });
  console.log("resource read:", JSON.stringify(resource.contents).slice(0, 200));

  const prompts = await client.listPrompts();
  console.log(
    "prompts:",
    prompts.prompts.map((prompt) => prompt.name),
  );

  const prompt = await client.getPrompt({
    name: "maxima_explain_symbol",
    arguments: { symbol: "integrate" },
  });
  console.log("prompt:", JSON.stringify(prompt).slice(0, 200));

  await client.close();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
