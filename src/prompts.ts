import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Runtime } from "./runtime.js";

export function registerPrompts(server: McpServer, _runtime: Runtime): void {
  server.registerPrompt(
    "maxima_solve_problem",
    {
      title: "Solve a math problem with Maxima",
      description:
        "Guide a model through solving a symbolic or numerical problem with the Maxima MCP tools.",
      argsSchema: {
        problem: z.string().min(1).describe("The problem to solve."),
        session_id: z
          .string()
          .min(1)
          .max(64)
          .optional()
          .describe("Optional Maxima session to use."),
      },
    },
    (args) => ({
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: [
              `Solve the following problem using Maxima:`,
              "",
              args.problem,
              "",
              "Working method:",
              "1. Restate the problem precisely and identify variables, assumptions and domain.",
              "2. Use maxima_help or maxima_search_docs if you need the exact syntax of a function.",
              "3. Use the most specific tool (maxima_solve, maxima_differentiate, maxima_integrate, maxima_limit, maxima_series, maxima_simplify, maxima_matrix) and maxima_eval for anything else.",
              "4. Check the symbolic result numerically with maxima_numeric or by substitution. Do not claim a result you have not verified.",
              "5. Keep long computations in one session so definitions persist, and use maxima_plot when a visual is useful.",
              "6. Present the final answer with the Maxima commands used and state any assumptions or branches.",
              args.session_id ? `Use session_id '${args.session_id}'.` : "",
            ]
              .filter(Boolean)
              .join("\n"),
          },
        },
      ],
    }),
  );

  server.registerPrompt(
    "maxima_explain_symbol",
    {
      title: "Explain a Maxima function or variable",
      description:
        "Produce a grounded explanation of a Maxima symbol using the manual and source code.",
      argsSchema: {
        symbol: z.string().min(1).describe("Function, variable or operator to explain."),
      },
    },
    (args) => ({
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: [
              `Explain the Maxima symbol '${args.symbol}'.`,
              "",
              "Steps:",
              "1. Call maxima_help for the official signature, description, categories and examples.",
              "2. Call maxima_source to inspect the implementation when behavior is subtle.",
              "3. Run one or two minimal maxima_eval checks to demonstrate the behavior and edge cases.",
              "4. Explain arguments, return value, evaluation semantics, related functions and common pitfalls.",
              "5. Cite the manual section and source location you used.",
            ].join("\n"),
          },
        },
      ],
    }),
  );

  server.registerPrompt(
    "maxima_debug_expression",
    {
      title: "Debug a Maxima expression",
      description: "Diagnose an unexpected Maxima result, error message or evaluation behavior.",
      argsSchema: {
        expression: z.string().min(1).describe("Expression that misbehaves."),
        error: z.string().optional().describe("Observed error or unexpected output."),
        expected: z.string().optional().describe("Expected output or behavior."),
      },
    },
    (args) => ({
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: [
              "Debug the following Maxima expression.",
              "",
              `Expression:\n\`\`\`maxima\n${args.expression}\n\`\`\``,
              args.error ? `Observed error or output:\n${args.error}` : "",
              args.expected ? `Expected behavior:\n${args.expected}` : "",
              "",
              "Steps:",
              "1. Reproduce the expression with maxima_eval and inspect warnings and errors.",
              "2. Check function documentation with maxima_help; verify argument order and evaluation flags.",
              "3. Reduce to a minimal failing example and test intermediate values with maxima_batch.",
              "4. Consider assumptions (assume/declare), simplification flags, and whether a package must be loaded with maxima_package_load.",
              "5. Provide a corrected expression and a short explanation of the root cause.",
            ]
              .filter(Boolean)
              .join("\n"),
          },
        },
      ],
    }),
  );
}
