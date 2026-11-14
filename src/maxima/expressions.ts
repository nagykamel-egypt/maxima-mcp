import { ToolError } from "../errors.js";

export type Terminator = "auto" | "semicolon" | "dollar";

export interface NormalizeOptions {
  terminator?: Terminator;
  /** Maximum length in characters. */
  maxChars?: number;
}

const DANGEROUS_SYMBOLS = [
  "system",
  "run",
  "batch",
  "batchload",
  "load",
  "save",
  "writefile",
  "appendfile",
  "read",
  "openw",
  "opena",
  "stringout",
  "file_search",
  "gnuplot_out_file",
  "gnuplot_preamble",
  "gnuplot_term",
  "eval_string",
  "parse_string",
  "to_lisp",
  "quit",
  "exit",
  "lisp",
  "texput_file",
] as const;

const DANGEROUS_PATTERNS: Array<{ name: string; pattern: RegExp }> = [
  { name: ":lisp", pattern: /(^|[\s(]):lisp\b/i },
  { name: "? (interactive help)", pattern: /(^|[\s;])\?[A-Za-z_]/ },
  { name: "! (shell escape)", pattern: /(^|[\s;])!{1,2}\s*[A-Za-z_./]/ },
];

/**
 * Replace string literals and comments with spaces while preserving offsets so
 * that keyword scanning cannot be tricked by content inside strings.
 */
export function stripStringsAndComments(input: string): string {
  let output = "";
  let i = 0;
  while (i < input.length) {
    const char = input[i];
    const next = input[i + 1];
    if (char === '"') {
      output += " ";
      i += 1;
      while (i < input.length) {
        if (input[i] === "\\" && i + 1 < input.length) {
          output += "  ";
          i += 2;
          continue;
        }
        if (input[i] === '"') {
          output += " ";
          i += 1;
          break;
        }
        output += " ";
        i += 1;
      }
      continue;
    }
    if (char === "/" && next === "*") {
      output += "  ";
      i += 2;
      while (i < input.length && !(input[i] === "*" && input[i + 1] === "/")) {
        output += " ";
        i += 1;
      }
      if (i < input.length) {
        output += "  ";
        i += 2;
      }
      continue;
    }
    output += char;
    i += 1;
  }
  return output;
}

/** Validate bracket and quote balance, returning a human readable problem if any. */
export function findBalanceProblem(input: string): string | undefined {
  const stack: Array<{ char: string; index: number }> = [];
  const pairs: Record<string, string> = { ")": "(", "]": "[", "}": "{" };
  let inString = false;
  let inComment = false;

  for (let i = 0; i < input.length; i += 1) {
    const char = input[i];
    const next = input[i + 1];
    if (inComment) {
      if (char === "*" && next === "/") {
        inComment = false;
        i += 1;
      }
      continue;
    }
    if (inString) {
      if (char === "\\") {
        i += 1;
      } else if (char === '"') {
        inString = false;
      }
      continue;
    }
    if (char === '"') {
      inString = true;
      continue;
    }
    if (char === "/" && next === "*") {
      inComment = true;
      i += 1;
      continue;
    }
    if (char === "(" || char === "[" || char === "{") {
      stack.push({ char, index: i });
      continue;
    }
    if (char === ")" || char === "]" || char === "}") {
      const open = stack.pop();
      if (!open) return `unexpected '${char}' at offset ${i}`;
      if (open.char !== pairs[char]) {
        return `mismatched '${open.char}' at offset ${open.index} and '${char}' at offset ${i}`;
      }
    }
  }

  if (inString) return "unterminated string literal";
  if (inComment) return "unterminated comment (missing */)";
  if (stack.length > 0) {
    const open = stack[stack.length - 1]!;
    return `unclosed '${open.char}' at offset ${open.index}`;
  }
  return undefined;
}

/**
 * Normalize a Maxima command:
 *  - trims surrounding whitespace and strips a leading input label such as `(%i3)`
 *  - appends a statement terminator when missing (default `;`)
 *  - rejects empty commands, NUL bytes, unbalanced brackets and oversized input
 */
export function normalizeCommand(command: string, options: NormalizeOptions = {}): string {
  const terminator = options.terminator ?? "auto";
  const maxChars = options.maxChars ?? 100_000;
  let value = command.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  value = value.replace(/^\s*\(%i\d+\)\s*/, "").trim();

  if (!value) {
    throw new ToolError({
      code: "VALIDATION_ERROR",
      message: "Command is empty.",
      hint: "Provide a Maxima expression such as integrate(x^2, x).",
    });
  }
  if (value.includes("\0")) {
    throw new ToolError({
      code: "VALIDATION_ERROR",
      message: "Command contains a NUL byte.",
    });
  }
  if (value.length > maxChars) {
    throw new ToolError({
      code: "LIMIT_EXCEEDED",
      message: `Command length ${value.length} exceeds the configured limit of ${maxChars} characters.`,
      hint: "Split the work into smaller commands or raise MAXIMA_MCP_MAX_EXPRESSION_CHARS.",
    });
  }

  value = value.replace(/^;(?=\s|$)/, "").trim();
  value = value.replace(/^\$(?=\s|$)/, "").trim();
  if (!value) {
    throw new ToolError({
      code: "VALIDATION_ERROR",
      message: "Command is empty.",
    });
  }

  const problem = findBalanceProblem(value);
  if (problem) {
    throw new ToolError({
      code: "VALIDATION_ERROR",
      message: `Malformed Maxima expression: ${problem}.`,
      hint: "Check parentheses, brackets, braces, string quotes and /* comments */.",
    });
  }

  const endsWithTerminator = /[;$]\s*$/.test(stripStringsAndComments(value));
  if (!endsWithTerminator) {
    value += terminator === "dollar" ? "$\n" : ";\n";
  } else if (!value.endsWith("\n")) {
    value += "\n";
  }

  return value;
}

/** Throw when a command uses a blocked primitive while safe mode is enabled. */
export function assertSafe(command: string, allowDangerous: boolean): void {
  if (allowDangerous) return;

  const stripped = stripStringsAndComments(command);
  for (const symbol of DANGEROUS_SYMBOLS) {
    const escaped = symbol.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const pattern = new RegExp(`(^|[^A-Za-z0-9_$])${escaped}\\s*(?:\\(|\\b)`, "i");
    if (pattern.test(stripped)) {
      throw new ToolError({
        code: "UNSAFE_EXPRESSION",
        message: `The command uses '${symbol}', which is disabled in safe mode.`,
        hint: "Set MAXIMA_MCP_ALLOW_DANGEROUS=true to enable shell and file-system primitives, or use a dedicated tool such as maxima_package_load or maxima_plot.",
      });
    }
  }
  for (const { name, pattern } of DANGEROUS_PATTERNS) {
    if (pattern.test(stripped)) {
      throw new ToolError({
        code: "UNSAFE_EXPRESSION",
        message: `The command uses ${name}, which is disabled in safe mode.`,
        hint: "Set MAXIMA_MCP_ALLOW_DANGEROUS=true to enable this primitive.",
      });
    }
  }
}

/** Validate a list of commands and return normalized text. */
export function normalizeCommands(
  commands: string[],
  options: {
    terminator?: Terminator;
    maxChars?: number;
    maxCommands?: number;
    allowDangerous?: boolean;
  } = {},
): string[] {
  const maxCommands = options.maxCommands ?? 50;
  if (!Array.isArray(commands) || commands.length === 0) {
    throw new ToolError({
      code: "VALIDATION_ERROR",
      message: "At least one command is required.",
    });
  }
  if (commands.length > maxCommands) {
    throw new ToolError({
      code: "LIMIT_EXCEEDED",
      message: `Received ${commands.length} commands but the limit is ${maxCommands}.`,
      hint: "Split the batch into smaller batches or raise MAXIMA_MCP_MAX_COMMANDS.",
    });
  }
  return commands.map((command) => {
    const normalized = normalizeCommand(command, {
      terminator: options.terminator,
      maxChars: options.maxChars,
    });
    assertSafe(normalized, options.allowDangerous ?? false);
    return normalized;
  });
}

/** Escape a string for use as a Maxima string literal. */
export function maximaString(value: string): string {
  return `"${value
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\n/g, "\\n")
    .replace(/\r/g, "\\r")
    .replace(/\t/g, "\\t")}"`;
}

/** Render a number safely for Maxima source. */
export function maximaNumber(value: number): string {
  if (!Number.isFinite(value)) {
    throw new ToolError({
      code: "VALIDATION_ERROR",
      message: `Expected a finite number, received ${String(value)}.`,
    });
  }
  return Object.is(value, -0) ? "0" : String(value);
}
