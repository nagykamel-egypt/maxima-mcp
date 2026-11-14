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
  const client = new Client({ name: "feature-test", version: "1.0.0" });
  await client.connect(
    new StdioClientTransport({
      command: "node",
      args: ["dist/index.js"],
      env: env(),
      stderr: "pipe",
    }),
  );

  const call = async (name: string, args: Record<string, unknown>) => {
    const result = await client.callTool({ name, arguments: args });
    const content = result.content as Array<{ type: string; text?: string }>;
    const text = content.find((item) => item.type === "text")?.text ?? "";
    console.log(`\n### ${name} isError=${Boolean(result.isError)}`);
    console.log(text.slice(0, 500));
    return result;
  };

  await call("maxima_eval", { expression: "1/0" });
  await call("maxima_eval", { expression: 'system("ls")' });
  await call("maxima_eval", { expression: "1 +" });
  await call("maxima_numeric", { expression: "%pi", mode: "bfloat", digits: 60 });
  await call("maxima_numeric", { expression: "sqrt(2)", mode: "double" });
  await call("maxima_matrix", { operation: "determinant", matrix: "matrix([1,2],[3,4])" });
  await call("maxima_matrix", { operation: "trace", matrix: "matrix([1,2],[3,4])" });
  await call("maxima_matrix", { operation: "eigenvalues", matrix: "matrix([2,0],[0,3])" });
  await call("maxima_integrate", {
    expression: "exp(-x^2)",
    variable: "x",
    lower: "0",
    upper: "inf",
  });
  await call("maxima_integrate", {
    expression: "sin(x)",
    variable: "x",
    lower: "0",
    upper: "%pi",
    numerical: true,
  });
  await call("maxima_limit", { expression: "sin(x)/x", variable: "x", point: "0" });
  await call("maxima_series", { expression: "exp(x)", variable: "x", order: 5 });
  await call("maxima_simplify", { expression: "(x^2-1)/(x-1)", method: "ratsimp" });
  await call("maxima_differentiate", { expression: "x^3*sin(x)", variable: "x" });
  await call("maxima_source", { symbol: "integrate", context_lines: 2, max_results: 2 });
  await call("maxima_search_source", { query: "defmfun $integrate", limit: 3 });
  await call("maxima_package_load", { package: "draw" });
  await call("maxima_examples", { symbol: "integrate", max_examples: 2 });
  await call("maxima_doc_read", { file: "Integration.html", max_chars: 2000 });
  await call("maxima_plot", {
    expressions: ["x^2+y^2"],
    kind: "3d",
    x_min: -2,
    x_max: 2,
    y_min: -2,
    y_max: 2,
    format: "png",
    width: 400,
    height: 300,
  });

  const opened = await call("maxima_session_open", { name: "test-session" });
  const sessionId = (opened.structuredContent as { session: { id: string } }).session.id;
  await call("maxima_eval", { expression: "b: 11$", session_id: sessionId });
  await call("maxima_eval", { expression: "b^2;", session_id: sessionId });
  await call("maxima_session_reset", { session_id: sessionId });
  await call("maxima_eval", { expression: "b^2;", session_id: sessionId });
  await call("maxima_session_close", { session_id: sessionId });

  const resource = await client.readResource({ uri: "maxima://source/simp.lisp" });
  console.log("\n### source resource", JSON.stringify(resource.contents).slice(0, 200));

  const resource2 = await client.readResource({ uri: "maxima://docs/section/Integration.html" });
  console.log("### doc resource", JSON.stringify(resource2.contents).slice(0, 200));

  await client.close();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
