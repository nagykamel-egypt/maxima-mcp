import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { ToolError } from "../errors.js";
import { assertSafe, findBalanceProblem, stripStringsAndComments } from "../maxima/expressions.js";
import { isErrorText } from "../maxima/output.js";
import type { Runtime } from "../runtime.js";
import { clampTimeout, guarded, textResult } from "./helpers.js";

const mathOutputSchema = z.object({
  command: z.string(),
  output: z.string(),
  is_error: z.boolean(),
  session_id: z.string(),
  duration_ms: z.number(),
  restarted: z.boolean(),
});

interface MathRun {
  command: string;
  output: string;
  isError: boolean;
  sessionId: string;
  durationMs: number;
  restarted: boolean;
}

function cleanMath(value: string, label: string, maxChars: number): string {
  let result = value.replace(/\r\n?/g, "\n").trim();
  result = result.replace(/^\s*\(%i\d+\)\s*/, "");
  if (!result) {
    throw new ToolError({
      code: "VALIDATION_ERROR",
      message: `${label} is empty.`,
    });
  }
  if (result.length > maxChars) {
    throw new ToolError({
      code: "LIMIT_EXCEEDED",
      message: `${label} exceeds the configured limit of ${maxChars} characters.`,
    });
  }
  result = result.replace(/[;$]\s*$/, "").trim();
  const stripped = stripStringsAndComments(result);
  if (/[;$]/.test(stripped)) {
    throw new ToolError({
      code: "VALIDATION_ERROR",
      message: `${label} must be a single Maxima expression without ';' or '$'.`,
      hint: "Use maxima_batch to run multiple statements.",
    });
  }
  const problem = findBalanceProblem(result);
  if (problem) {
    throw new ToolError({
      code: "VALIDATION_ERROR",
      message: `${label} is malformed: ${problem}.`,
    });
  }
  return result;
}

function cleanIdentifier(value: string, label: string): string {
  const trimmed = value.trim();
  if (!/^[A-Za-z_%][A-Za-z0-9_%]*(?:\[[0-9]+\])?$/.test(trimmed)) {
    throw new ToolError({
      code: "VALIDATION_ERROR",
      message: `Invalid ${label} '${value}'.`,
      hint: "Use a Maxima symbol such as x, y, alpha, %lambda or A[1].",
    });
  }
  return trimmed;
}

function cleanPoint(value: string, label: string): string {
  const trimmed = value.trim();
  if (!/^[A-Za-z0-9_%+\-*/^.]{1,120}$/.test(trimmed)) {
    throw new ToolError({
      code: "VALIDATION_ERROR",
      message: `Invalid ${label} '${value}'.`,
      hint: "Use a number, inf, minf, %pi, %e or a simple arithmetic expression.",
    });
  }
  assertSafe(trimmed, false);
  return trimmed;
}

async function runMath(
  runtime: Runtime,
  sessionId: string | undefined,
  command: string,
  timeoutMs: number | undefined,
  signal?: AbortSignal,
): Promise<MathRun> {
  assertSafe(command, runtime.config.maxima.allowDangerous);
  const statement = /[;$]\s*$/.test(command) ? command : `${command};`;
  const result = await runtime.sessions.run(sessionId, [statement], {
    timeoutMs: clampTimeout(runtime, timeoutMs),
    ...(signal ? { signal } : {}),
  });
  const first = result.outputs[0];
  return {
    command: statement,
    output: [first?.output ?? "", result.stderr.trim()].filter(Boolean).join("\n").trim(),
    isError: (first?.isError ?? false) || isErrorText(result.stderr),
    sessionId: result.sessionId,
    durationMs: result.durationMs,
    restarted: result.restarted,
  };
}

function mathResult(run: MathRun): CallToolResult {
  const body = run.output || "(no output)";
  return {
    ...textResult(body, {
      command: run.command,
      output: run.output,
      is_error: run.isError,
      session_id: run.sessionId,
      duration_ms: run.durationMs,
      restarted: run.restarted,
    }),
    ...(run.isError ? { isError: true } : {}),
  };
}

const sessionArg = z
  .string()
  .min(1)
  .max(64)
  .optional()
  .describe(
    "Session to use. Defaults to the configured default session; an unknown id is created on first use.",
  );

const timeoutArg = (runtime: Runtime) =>
  z
    .number()
    .int()
    .min(100)
    .max(runtime.config.maxima.maxTimeoutMs)
    .optional()
    .describe("Execution timeout in milliseconds.");

export function registerAlgebraTools(server: McpServer, runtime: Runtime): void {
  const maxChars = runtime.config.limits.maxExpressionChars;

  server.registerTool(
    "maxima_solve",
    {
      title: "Solve equations",
      description:
        "Solve one or more equations or systems symbolically with Maxima's solve. Returns exact solutions; set numerical=true to convert them to floating point.",
      inputSchema: {
        equations: z
          .union([z.string().min(1), z.array(z.string().min(1)).min(1).max(20)])
          .describe("An equation such as x^2 - 4 = 0, or a list of equations for a system."),
        variables: z
          .union([z.string().min(1), z.array(z.string().min(1)).min(1).max(10)])
          .describe("The variable or variables to solve for."),
        numerical: z
          .boolean()
          .default(false)
          .describe("Convert exact solutions to floating point numbers."),
        session_id: sessionArg,
        timeout_ms: timeoutArg(runtime),
      },
      annotations: {
        title: "Solve equations",
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
      outputSchema: mathOutputSchema,
    },
    async (args, extra): Promise<CallToolResult> =>
      guarded(runtime, "maxima_solve", async () => {
        const equations = (Array.isArray(args.equations) ? args.equations : [args.equations]).map(
          (equation, index) => cleanMath(equation, `Equation ${index + 1}`, maxChars),
        );
        const variables = (Array.isArray(args.variables) ? args.variables : [args.variables]).map(
          (variable) => cleanIdentifier(variable, "variable"),
        );
        let command =
          equations.length === 1 && variables.length === 1
            ? `solve(${equations[0]}, ${variables[0]})`
            : `solve([${equations.join(", ")}], [${variables.join(", ")}])`;
        if (args.numerical) command = `float(${command})`;
        const run = await runMath(runtime, args.session_id, command, args.timeout_ms, extra.signal);
        return mathResult(run);
      }),
  );

  server.registerTool(
    "maxima_differentiate",
    {
      title: "Differentiate an expression",
      description: "Compute a symbolic derivative with Maxima's diff, optionally of higher order.",
      inputSchema: {
        expression: z.string().min(1).describe("Expression to differentiate."),
        variable: z.string().min(1).describe("Differentiation variable, for example x."),
        order: z.number().int().min(1).max(50).default(1).describe("Derivative order."),
        session_id: sessionArg,
        timeout_ms: timeoutArg(runtime),
      },
      annotations: {
        title: "Differentiate an expression",
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
      outputSchema: mathOutputSchema,
    },
    async (args, extra): Promise<CallToolResult> =>
      guarded(runtime, "maxima_differentiate", async () => {
        const expression = cleanMath(args.expression, "Expression", maxChars);
        const variable = cleanIdentifier(args.variable, "variable");
        const command =
          args.order === 1
            ? `diff(${expression}, ${variable})`
            : `diff(${expression}, ${variable}, ${args.order})`;
        const run = await runMath(runtime, args.session_id, command, args.timeout_ms, extra.signal);
        return mathResult(run);
      }),
  );

  server.registerTool(
    "maxima_integrate",
    {
      title: "Integrate an expression",
      description:
        "Compute an indefinite or definite integral with Maxima's integrate. Set numerical=true with bounds to use adaptive quadrature (quad_qags) instead of symbolic integration.",
      inputSchema: {
        expression: z.string().min(1).describe("Integrand."),
        variable: z.string().min(1).describe("Integration variable, for example x."),
        lower: z
          .string()
          .min(1)
          .optional()
          .describe("Lower bound; omit for an indefinite integral."),
        upper: z
          .string()
          .min(1)
          .optional()
          .describe("Upper bound; omit for an indefinite integral."),
        numerical: z
          .boolean()
          .default(false)
          .describe("Use numerical quadrature (requires both bounds)."),
        session_id: sessionArg,
        timeout_ms: timeoutArg(runtime),
      },
      annotations: {
        title: "Integrate an expression",
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
      outputSchema: mathOutputSchema,
    },
    async (args, extra): Promise<CallToolResult> =>
      guarded(runtime, "maxima_integrate", async () => {
        const expression = cleanMath(args.expression, "Integrand", maxChars);
        const variable = cleanIdentifier(args.variable, "integration variable");
        if ((args.lower === undefined) !== (args.upper === undefined)) {
          throw new ToolError({
            code: "VALIDATION_ERROR",
            message: "Provide both lower and upper bounds, or neither.",
          });
        }
        if (args.numerical && (args.lower === undefined || args.upper === undefined)) {
          throw new ToolError({
            code: "VALIDATION_ERROR",
            message: "Numerical integration requires both lower and upper bounds.",
          });
        }
        let command: string;
        if (args.lower !== undefined && args.upper !== undefined) {
          const lower = cleanPoint(args.lower, "lower bound");
          const upper = cleanPoint(args.upper, "upper bound");
          command = args.numerical
            ? `quad_qags(${expression}, ${variable}, ${lower}, ${upper})`
            : `integrate(${expression}, ${variable}, ${lower}, ${upper})`;
        } else {
          command = `integrate(${expression}, ${variable})`;
        }
        const run = await runMath(runtime, args.session_id, command, args.timeout_ms, extra.signal);
        return mathResult(run);
      }),
  );

  server.registerTool(
    "maxima_limit",
    {
      title: "Compute a limit",
      description: "Compute a symbolic limit with Maxima's limit, including one-sided limits.",
      inputSchema: {
        expression: z.string().min(1).describe("Expression whose limit is computed."),
        variable: z.string().min(1).describe("Limit variable, for example x."),
        point: z.string().min(1).describe("Limit point, for example 0, inf, minf or %pi."),
        direction: z
          .enum(["both", "plus", "minus"])
          .default("both")
          .describe("Two-sided, right-sided (plus) or left-sided (minus) limit."),
        session_id: sessionArg,
        timeout_ms: timeoutArg(runtime),
      },
      annotations: {
        title: "Compute a limit",
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
      outputSchema: mathOutputSchema,
    },
    async (args, extra): Promise<CallToolResult> =>
      guarded(runtime, "maxima_limit", async () => {
        const expression = cleanMath(args.expression, "Expression", maxChars);
        const variable = cleanIdentifier(args.variable, "limit variable");
        const point = cleanPoint(args.point, "limit point");
        const suffix =
          args.direction === "plus" ? ", plus" : args.direction === "minus" ? ", minus" : "";
        const command = `limit(${expression}, ${variable}, ${point}${suffix})`;
        const run = await runMath(runtime, args.session_id, command, args.timeout_ms, extra.signal);
        return mathResult(run);
      }),
  );

  server.registerTool(
    "maxima_series",
    {
      title: "Taylor series expansion",
      description: "Expand an expression as a truncated Taylor series with Maxima's taylor.",
      inputSchema: {
        expression: z.string().min(1).describe("Expression to expand."),
        variable: z.string().min(1).describe("Expansion variable."),
        point: z.string().min(1).default("0").describe("Expansion point (default 0)."),
        order: z.number().int().min(1).max(100).default(6).describe("Truncation order."),
        session_id: sessionArg,
        timeout_ms: timeoutArg(runtime),
      },
      annotations: {
        title: "Taylor series expansion",
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
      outputSchema: mathOutputSchema,
    },
    async (args, extra): Promise<CallToolResult> =>
      guarded(runtime, "maxima_series", async () => {
        const expression = cleanMath(args.expression, "Expression", maxChars);
        const variable = cleanIdentifier(args.variable, "expansion variable");
        const point = cleanPoint(args.point, "expansion point");
        const command = `taylor(${expression}, ${variable}, ${point}, ${args.order})`;
        const run = await runMath(runtime, args.session_id, command, args.timeout_ms, extra.signal);
        return mathResult(run);
      }),
  );

  server.registerTool(
    "maxima_simplify",
    {
      title: "Simplify an expression",
      description:
        "Apply a chosen simplification strategy to an expression. Methods include ratsimp, fullratsimp, radcan, trigsimp, trigexpand, factor, expand, logcontract, rootscontract, rectform and polarform.",
      inputSchema: {
        expression: z.string().min(1).describe("Expression to simplify."),
        method: z
          .enum([
            "auto",
            "ratsimp",
            "fullratsimp",
            "radcan",
            "trigsimp",
            "trigexpand",
            "trigreduce",
            "factor",
            "expand",
            "logcontract",
            "rootscontract",
            "rectform",
            "polarform",
            "demoivre",
            "exponentialize",
          ])
          .default("auto")
          .describe("Simplification strategy. 'auto' applies radcan(ratsimp(expr))."),
        session_id: sessionArg,
        timeout_ms: timeoutArg(runtime),
      },
      annotations: {
        title: "Simplify an expression",
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
      outputSchema: mathOutputSchema,
    },
    async (args, extra): Promise<CallToolResult> =>
      guarded(runtime, "maxima_simplify", async () => {
        const expression = cleanMath(args.expression, "Expression", maxChars);
        const method = args.method;
        const command =
          method === "auto" ? `radcan(ratsimp(${expression}))` : `${method}(${expression})`;
        const run = await runMath(runtime, args.session_id, command, args.timeout_ms, extra.signal);
        return mathResult(run);
      }),
  );

  server.registerTool(
    "maxima_numeric",
    {
      title: "Numerically evaluate an expression",
      description:
        "Convert a symbolic expression to a floating-point value using double precision or arbitrary-precision bigfloats.",
      inputSchema: {
        expression: z.string().min(1).describe("Expression to evaluate numerically."),
        mode: z
          .enum(["double", "bfloat"])
          .default("double")
          .describe("double uses IEEE doubles; bfloat uses arbitrary precision."),
        digits: z
          .number()
          .int()
          .min(2)
          .max(10_000)
          .default(32)
          .describe("Precision in decimal digits for bfloat mode."),
        session_id: sessionArg,
        timeout_ms: timeoutArg(runtime),
      },
      annotations: {
        title: "Numerically evaluate an expression",
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
      outputSchema: mathOutputSchema,
    },
    async (args, extra): Promise<CallToolResult> =>
      guarded(runtime, "maxima_numeric", async () => {
        const expression = cleanMath(args.expression, "Expression", maxChars);
        const command =
          args.mode === "bfloat"
            ? `block([fpprec: ${args.digits}], bfloat(${expression}))`
            : `float(${expression})`;
        const run = await runMath(runtime, args.session_id, command, args.timeout_ms, extra.signal);
        return mathResult(run);
      }),
  );

  server.registerTool(
    "maxima_matrix",
    {
      title: "Matrix operation",
      description:
        "Perform a linear-algebra operation on a Maxima matrix expression: determinant, inverse, transpose, rank, trace, eigenvalues, eigenvectors, characteristic polynomial, adjoint or nullspace.",
      inputSchema: {
        operation: z
          .enum([
            "determinant",
            "inverse",
            "transpose",
            "rank",
            "trace",
            "eigenvalues",
            "eigenvectors",
            "charpoly",
            "adjoint",
            "nullspace",
          ])
          .describe("Operation to perform."),
        matrix: z.string().min(1).describe("A matrix expression, for example matrix([1,2],[3,4])."),
        variable: z
          .string()
          .min(1)
          .default("%lambda")
          .describe("Variable for charpoly (default %lambda)."),
        session_id: sessionArg,
        timeout_ms: timeoutArg(runtime),
      },
      annotations: {
        title: "Matrix operation",
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
      outputSchema: mathOutputSchema,
    },
    async (args, extra): Promise<CallToolResult> =>
      guarded(runtime, "maxima_matrix", async () => {
        const matrix = cleanMath(args.matrix, "Matrix expression", maxChars);
        if (!/^\s*matrix\s*\(/i.test(matrix)) {
          throw new ToolError({
            code: "VALIDATION_ERROR",
            message: "matrix must be a matrix(...) expression.",
            hint: "Example: matrix([1,2],[3,4]).",
          });
        }
        const variable = cleanIdentifier(args.variable, "charpoly variable");
        const operation = args.operation;
        const command =
          operation === "charpoly"
            ? `charpoly(${matrix}, ${variable})`
            : operation === "determinant"
              ? `determinant(${matrix})`
              : operation === "inverse"
                ? `invert(${matrix})`
                : operation === "trace"
                  ? `block([m: ${matrix}], sum(m[i,i], i, 1, length(m)))`
                  : `${operation}(${matrix})`;
        const run = await runMath(runtime, args.session_id, command, args.timeout_ms, extra.signal);
        return mathResult(run);
      }),
  );
}
