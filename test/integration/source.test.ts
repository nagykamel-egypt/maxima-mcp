import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { hasSource, hasShare, createTestRuntime, type TestRuntime } from "../helpers.js";

const available = hasSource();

describe.skipIf(!available)("Source index integration", () => {
  let harness: TestRuntime;

  beforeAll(async () => {
    harness = createTestRuntime({ MAXIMA_MCP_DOCS: "true" });
    await harness.runtime.source.ensureLoaded();
  });

  afterAll(async () => {
    await harness?.close();
  });

  it("indexes Lisp and share sources", () => {
    const status = harness.runtime.source.status();
    expect(status.state).toBe("ready");
    expect(status.files).toBeGreaterThan(100);
    expect(status.symbols).toBeGreaterThan(1000);
  });

  it("finds and reads a definition", async () => {
    const refs = await harness.runtime.source.find("integrate");
    expect(refs.length).toBeGreaterThan(0);
    expect(refs[0]?.file.endsWith(".lisp")).toBe(true);
    const snippet = await harness.runtime.source.read(refs[0]!, 3);
    expect(snippet.text).toContain("defmfun $integrate");
    expect(snippet.startLine).toBeLessThanOrEqual(snippet.endLine);
  });

  it("searches source text", async () => {
    const hits = await harness.runtime.source.search("defmfun $integrate", { limit: 5 });
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0]?.file).toContain("simp.lisp");
  });

  it("supports regular expression search", async () => {
    const hits = await harness.runtime.source.search("defmfun \\$integrat", {
      regex: true,
      limit: 5,
    });
    expect(hits.length).toBeGreaterThan(0);
  });

  it("rejects invalid regular expressions", async () => {
    await expect(harness.runtime.source.search("([", { regex: true })).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
    });
  });

  it("lists source files", async () => {
    const files = await harness.runtime.source.listFiles("simp.lisp", 10);
    expect(files.some((file) => file.file.endsWith("simp.lisp"))).toBe(true);
    const content = await harness.runtime.source.readFileByRelativePath(files[0]!.file, 1000);
    expect(content.text.length).toBeGreaterThan(0);
  });

  it.skipIf(!hasShare())("lists share packages", async () => {
    const packages = await harness.runtime.source.listPackages("draw", 10);
    expect(packages.some((pkg) => pkg.name === "draw")).toBe(true);
    const pkg = await harness.runtime.source.resolvePackage("draw");
    expect(pkg.name).toBe("draw");
  });
});
