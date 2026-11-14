import { describe, expect, it } from "vitest";
import { ToolError } from "../../src/errors.js";
import {
  assertSafe,
  findBalanceProblem,
  maximaNumber,
  maximaString,
  normalizeCommand,
  normalizeCommands,
  stripStringsAndComments,
} from "../../src/maxima/expressions.js";

function expectToolError(fn: () => unknown, code: string): void {
  try {
    fn();
  } catch (error) {
    expect(error).toBeInstanceOf(ToolError);
    expect((error as ToolError).code).toBe(code);
    return;
  }
  throw new Error("Expected a ToolError");
}

describe("normalizeCommand", () => {
  it("appends a semicolon by default", () => {
    expect(normalizeCommand("1+1")).toBe("1+1;\n");
  });

  it("honours the dollar terminator", () => {
    expect(normalizeCommand("a: 5", { terminator: "dollar" })).toBe("a: 5$\n");
  });

  it("keeps an existing terminator", () => {
    expect(normalizeCommand("1+1$")).toBe("1+1$\n");
    expect(normalizeCommand("1+1;")).toBe("1+1;\n");
  });

  it("strips a copied input prompt", () => {
    expect(normalizeCommand("(%i12) integrate(x^2, x)")).toBe("integrate(x^2, x);\n");
  });

  it("does not treat a trailing dollar inside a string as a terminator", () => {
    expect(normalizeCommand('s: "cost$"')).toBe('s: "cost$";\n');
  });

  it("rejects empty input", () => {
    expectToolError(() => normalizeCommand("   "), "VALIDATION_ERROR");
  });

  it("rejects NUL bytes", () => {
    expectToolError(() => normalizeCommand("1+\0"), "VALIDATION_ERROR");
  });

  it("rejects oversized input", () => {
    expectToolError(() => normalizeCommand("1+1", { maxChars: 2 }), "LIMIT_EXCEEDED");
  });

  it("rejects unbalanced brackets, strings and comments", () => {
    expectToolError(() => normalizeCommand("f(x"), "VALIDATION_ERROR");
    expectToolError(() => normalizeCommand('"abc'), "VALIDATION_ERROR");
    expectToolError(() => normalizeCommand("1 /* comment"), "VALIDATION_ERROR");
    expectToolError(() => normalizeCommand("(]"), "VALIDATION_ERROR");
  });
});

describe("findBalanceProblem", () => {
  it("accepts balanced constructs", () => {
    expect(findBalanceProblem("f([1,2], {a: 3})")).toBeUndefined();
    expect(findBalanceProblem('"a ) string" /* ) comment */ (x)')).toBeUndefined();
  });

  it("reports mismatched delimiters", () => {
    expect(findBalanceProblem("(]")).toMatch(/mismatched/);
    expect(findBalanceProblem(")")).toMatch(/unexpected/);
  });
});

describe("stripStringsAndComments", () => {
  it("blanks strings and comments while preserving length", () => {
    const input = 'a + "system(x)" /* load(y) */ + b';
    const stripped = stripStringsAndComments(input);
    expect(stripped).toHaveLength(input.length);
    expect(stripped).not.toContain("system");
    expect(stripped).not.toContain("load");
    expect(stripped).toContain("a +");
  });
});

describe("assertSafe", () => {
  it("allows ordinary mathematics", () => {
    expect(() => assertSafe("integrate(sin(x), x)", false)).not.toThrow();
    expect(() => assertSafe("matrix([1,2],[3,4])", false)).not.toThrow();
    expect(() => assertSafe('print("system is blocked")', false)).not.toThrow();
  });

  it("blocks shell and file-system primitives", () => {
    for (const command of [
      'system("ls")',
      'load("draw")',
      'writefile("x", "y")',
      'batch("file")',
      'eval_string("system(\\"ls\\")")',
      "gnuplot_preamble \"system('ls')\"",
      ":lisp (print 1)",
      "quit()",
    ]) {
      expectToolError(() => assertSafe(command, false), "UNSAFE_EXPRESSION");
    }
  });

  it("allows dangerous primitives when explicitly enabled", () => {
    expect(() => assertSafe('system("true")', true)).not.toThrow();
  });
});

describe("normalizeCommands", () => {
  it("normalizes a batch", () => {
    expect(normalizeCommands(["a: 1", "b: 2$"], {})).toEqual(["a: 1;\n", "b: 2$\n"]);
  });

  it("enforces batch size limits", () => {
    expectToolError(() => normalizeCommands(["1", "2", "3"], { maxCommands: 2 }), "LIMIT_EXCEEDED");
  });
});

describe("Maxima literal helpers", () => {
  it("escapes strings", () => {
    expect(maximaString('a"b\\c\n')).toBe('"a\\"b\\\\c\\n"');
  });

  it("rejects non-finite numbers", () => {
    expect(maximaNumber(1.5)).toBe("1.5");
    expectToolError(() => maximaNumber(Number.POSITIVE_INFINITY), "VALIDATION_ERROR");
    expectToolError(() => maximaNumber(Number.NaN), "VALIDATION_ERROR");
  });
});
