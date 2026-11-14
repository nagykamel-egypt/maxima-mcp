import { describe, expect, it } from "vitest";
import { cleanOutput, isErrorText, mergeStreams } from "../../src/maxima/output.js";

describe("cleanOutput", () => {
  it("detects Maxima errors", () => {
    const result = cleanOutput(
      "expt: undefined: 0 to a negative exponent.\n -- an error. To debug this try: debugmode(true);",
    );
    expect(result.isError).toBe(true);
    expect(result.errorMessage).toContain("expt");
  });

  it("detects syntax errors", () => {
    const result = cleanOutput("incorrect syntax: Premature termination of input at ;.\n1 +;");
    expect(result.isError).toBe(true);
  });

  it("leaves symbolic results untouched", () => {
    const result = cleanOutput("x^3/3\nfoo(bar)");
    expect(result.isError).toBe(false);
    expect(result.text).toBe("x^3/3\nfoo(bar)");
  });

  it("collects warnings without marking the result as an error", () => {
    const result = cleanOutput("Warning: something odd\n42");
    expect(result.isError).toBe(false);
    expect(result.warnings).toEqual(["Warning: something odd"]);
  });

  it("removes protocol markers, prompts, gnuplot noise and trailing spaces", () => {
    const result = cleanOutput(
      [
        "  ",
        "<<<MAXIMA_MCP_BEGIN:abc:0>>> ",
        "(%i1) (%i1) (%i1) [[2,3],[1,1]]   ",
        "<<<MAXIMA_MCP_END:abc:0>>> ",
        "***** Spawning process gnuplot [/tmp/x.gnuplot]",
      ].join("\n"),
    );
    expect(result.text).toBe("[[2,3],[1,1]]");
  });

  it("collapses excess blank lines", () => {
    expect(cleanOutput("a\n\n\n\nb").text).toBe("a\n\nb");
  });

  it("truncates large output", () => {
    const result = cleanOutput("x".repeat(100), 20);
    expect(result.truncated).toBe(true);
    expect(result.text).toContain("truncated");
    expect(result.text.startsWith("x".repeat(20))).toBe(true);
  });
});

describe("isErrorText", () => {
  it("recognises Lisp errors", () => {
    expect(isErrorText("Maxima encountered a Lisp error")).toBe(true);
    expect(isErrorText("all good")).toBe(false);
  });
});

describe("mergeStreams", () => {
  it("appends stderr once", () => {
    expect(mergeStreams("4", "")).toBe("4");
    expect(mergeStreams("", "err")).toBe("err");
    expect(mergeStreams("4", "warning")).toBe("4\nwarning");
  });
});
