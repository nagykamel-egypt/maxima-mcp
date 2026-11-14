import { describe, expect, it } from "vitest";
import { load, type CheerioAPI } from "cheerio";
import {
  decodeTexinfo,
  escapeAttribute,
  extractExamples,
  htmlToText,
} from "../../src/docs/html.js";

describe("decodeTexinfo", () => {
  it("decodes escaped characters", () => {
    expect(decodeTexinfo("Command_002dline")).toBe("Command-line");
    expect(decodeTexinfo("augmented_005flagrangian")).toBe("augmented_lagrangian");
    expect(decodeTexinfo("index-%pi")).toBe("index-%pi");
  });
});

describe("htmlToText", () => {
  const $: CheerioAPI = load(`
    <html><body>
      <div class="nav-panel">Navigation</div>
      <h2>Title</h2>
      <p>First <code>integrate</code> paragraph.</p>
      <pre class="example-preformatted">(%i1) 1+1;
(%o1) 2</pre>
      <ul><li>one</li><li>two</li></ul>
    </body></html>
  `);

  it("extracts readable text and skips navigation", () => {
    const text = htmlToText($, $("body").get(0)!);
    expect(text).toContain("Title");
    expect(text).toContain("First integrate paragraph.");
    expect(text).toContain("(%i1) 1+1;");
    expect(text).toContain("one");
    expect(text).not.toContain("Navigation");
  });

  it("extracts examples", () => {
    const examples = extractExamples($, $("body").get(0)!);
    expect(examples).toHaveLength(1);
    expect(examples[0]).toContain("(%o1) 2");
  });
});

describe("escapeAttribute", () => {
  it("escapes quotes and backslashes", () => {
    expect(escapeAttribute('a"b\\c')).toBe('a\\"b\\\\c');
  });
});
