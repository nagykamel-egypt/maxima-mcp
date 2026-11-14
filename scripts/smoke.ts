import { loadConfig } from "../src/config.js";
import { createLogger } from "../src/logger.js";
import { createRuntime, shutdownRuntime } from "../src/runtime.js";
import { renderPlot } from "../src/maxima/plot.js";

async function main(): Promise<void> {
  const config = loadConfig({
    ...process.env,
    MAXIMA_MCP_LOG_LEVEL: process.env.MAXIMA_MCP_LOG_LEVEL ?? "silent",
    MAXIMA_MCP_DOCS_PREWARM: "false",
  });
  const logger = createLogger(config.logging);
  const runtime = createRuntime(config, logger);
  console.log("version:", runtime.maximaVersion());

  const t0 = Date.now();
  const result = await runtime.sessions.run(undefined, ["2+2;", "integrate(x^2,x);", "foo(bar);"], {
    timeoutMs: 15000,
  });
  console.log("eval ms:", Date.now() - t0, "restarted:", result.restarted);
  for (const output of result.outputs) {
    console.log("---", JSON.stringify(output.output), "error:", output.isError);
  }

  const withState = await runtime.sessions.run(undefined, ["a:5$", "a^2;"]);
  console.log(
    "state:",
    withState.outputs.map((o) => o.output),
  );

  const t1 = Date.now();
  await runtime.docs.ensureLoaded();
  console.log("docs loaded in", Date.now() - t1, "ms", runtime.docs.status());
  const help = await runtime.docs.help("integrate");
  console.log(
    "help:",
    help.entries[0]?.name,
    help.entries[0]?.kind,
    help.entries[0]?.examples.length,
    help.entries[0]?.text.slice(0, 120),
  );
  const search = await runtime.docs.search("definite integral");
  console.log(
    "search:",
    search.slice(0, 5).map((hit) => `${hit.name ?? hit.title}(${hit.score})`),
  );
  const sections = await runtime.docs.listSections();
  console.log("sections:", sections.length, sections[0]);

  const t2 = Date.now();
  await runtime.source.ensureLoaded();
  console.log("source loaded in", Date.now() - t2, "ms", runtime.source.status());
  const refs = await runtime.source.find("integrate");
  console.log("refs:", refs.slice(0, 3));
  const hits = await runtime.source.search("defun $integrate", { limit: 3 });
  console.log(
    "source search:",
    hits.map((hit) => `${hit.file}:${hit.line}`),
  );

  const plot = await renderPlot(config, runtime.sessions, {
    expressions: ["sin(x)"],
    xMin: -5,
    xMax: 5,
    format: "png",
  });
  console.log("plot:", plot.bytes, plot.mimeType);

  const timeout = await runtime.sessions
    .run(undefined, ["for i:1 thru 100000000 do i$"], { timeoutMs: 300 })
    .then(() => "unexpected success")
    .catch((error: Error) => `${error.name}: ${error.message}`);
  console.log("timeout:", timeout);

  const after = await runtime.sessions.run(undefined, ["1+1;"]);
  console.log("after timeout:", after.outputs[0]?.output, "restarted:", after.restarted);

  await shutdownRuntime(runtime);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
