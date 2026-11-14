import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { hasDocs, createTestRuntime, type TestRuntime } from "../helpers.js";

const available = hasDocs();

describe.skipIf(!available)("Documentation index integration", () => {
  let harness: TestRuntime;

  beforeAll(async () => {
    harness = createTestRuntime({
      MAXIMA_MCP_DOCS: "true",
      MAXIMA_MCP_DOCS_PREWARM: "false",
    });
    await harness.runtime.docs.ensureLoaded();
  });

  afterAll(async () => {
    await harness?.close();
  });

  it("indexes the manual", () => {
    const status = harness.runtime.docs.status();
    expect(status.state).toBe("ready");
    expect(status.entries).toBeGreaterThan(1000);
    expect(status.sections).toBeGreaterThan(50);
  });

  it("looks up a function", async () => {
    const help = await harness.runtime.docs.help("integrate");
    expect(help.entries.length).toBeGreaterThan(0);
    const entry = help.entries[0]!;
    expect(entry.name).toBe("integrate");
    expect(entry.kind.toLowerCase()).toContain("function");
    expect(entry.signature).toContain("integrate");
    expect(entry.text).toContain("integral");
    expect(entry.examples.length).toBeGreaterThan(0);
    expect(help.related.length).toBeGreaterThan(0);
  });

  it("returns helpful suggestions for prefixes", async () => {
    await expect(harness.runtime.docs.help("integ")).rejects.toMatchObject({
      code: "DOC_NOT_FOUND",
    });
    try {
      await harness.runtime.docs.help("integ");
    } catch (error) {
      expect((error as { hint?: string }).hint).toContain("integrate");
    }
  });

  it("searches entries and sections", async () => {
    const results = await harness.runtime.docs.search("definite integral");
    expect(results.length).toBeGreaterThan(0);
    expect(results.some((hit) => hit.name === "defint" || hit.name === "integrate")).toBe(true);

    const sections = await harness.runtime.docs.search("eigenvalues", { type: "section" });
    expect(sections.every((hit) => hit.type === "section")).toBe(true);
  });

  it("lists symbols, sections and categories", async () => {
    const symbols = await harness.runtime.docs.listSymbols("int", 25);
    expect(symbols.length).toBeGreaterThan(0);
    expect(symbols.every((symbol) => symbol.name.toLowerCase().startsWith("int"))).toBe(true);

    const sections = await harness.runtime.docs.listSections();
    expect(sections.some((section) => section.file === "Integration.html")).toBe(true);

    const categories = harness.runtime.docs.listCategories();
    expect(categories.length).toBeGreaterThan(0);
  });

  it("reads a section and examples", async () => {
    const section = await harness.runtime.docs.readSection("Integration.html");
    expect(section.title.toLowerCase()).toContain("integration");
    expect(section.text).toContain("integrate");

    const examples = await harness.runtime.docs.examples("integrate");
    expect(examples.entries.some((entry) => entry.examples.length > 0)).toBe(true);
  });
});
