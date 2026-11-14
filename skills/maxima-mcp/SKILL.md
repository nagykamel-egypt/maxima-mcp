---
name: maxima-mcp
description: >-
  Use the Maxima MCP server for exact symbolic mathematics, numerical analysis,
  linear algebra, calculus, plotting, and grounded Maxima documentation/source
  research. Apply this skill whenever an MCP-capable agent has the maxima-mcp
  tools and the task involves solving, simplifying, differentiating, integrating,
  taking limits, expanding series, working with matrices, plotting functions,
  verifying a mathematical result, or writing a reproducible engineering or
  scientific calculation. Also covers computer algebra system (CAS) workloads
  such as ordinary differential equations, Laplace transforms, and numerical
  quadrature. It defines the safe operating loop, session discipline, tool
  selection, verification standards, error recovery, and enterprise controls
  needed to produce trustworthy answers.
license: MIT
metadata:
  version: "1.0.0"
  server: maxima-mcp
  tools: "29"
  transport: "stdio or Streamable HTTP"
  requires: "maxima-mcp server; Node.js >= 20.19; Maxima >= 5.40; optional maxima-doc, maxima-src, maxima-share, gnuplot"
---

# Maxima MCP skill

This skill turns an MCP-capable agent into a careful Maxima operator. It is not a
Maxima manual replacement: it tells the agent **when** to use each tool, **how**
to compose inputs, **how** to verify results, and **when** to stop instead of
guessing.

The skill is portable. It assumes only that the client can call MCP tools. The
tool names below are the stable names exposed by `maxima-mcp` 1.x. If a client
renames tools, map by capability and record the mapping in the final answer.

## Use this skill when

- The user asks for symbolic algebra, calculus, limits, series, simplification,
  equation solving, matrices, eigenvalues, numerical evaluation, or plotting.
- The user asks to check, reproduce, or debug a mathematical result.
- The user asks for a Maxima command, expression, function explanation, package,
  or source-level behavior.
- An engineering or scientific calculation needs a reproducible symbolic or
  numerical core (beam design, thermal loops, circuits, control systems,
  statistics, optimization setup, unit-consistent formulas).
- A previous AI answer contains math that must be independently verified.
- The `maxima_*` tools are present or the user explicitly names the Maxima MCP
  server.

Do **not** use this skill for a task that has no mathematical or Maxima content,
or when the Maxima MCP server is not connected and cannot be connected. Say that
plainly instead of hallucinating tool calls.

## Non-negotiable operating rules

1. **Ground before computing.** If the exact function name, argument order, or
   flag is uncertain, call `maxima_help`, `maxima_search_docs`, or
   `maxima_examples` before writing the expression.
2. **Prefer the narrowest tool.** Use `maxima_solve`, `maxima_differentiate`,
   `maxima_integrate`, `maxima_limit`, `maxima_series`, `maxima_simplify`,
   `maxima_numeric`, `maxima_matrix`, or `maxima_plot` when they match. Use
   `maxima_eval` for everything else and `maxima_batch` for sequential steps.
3. **One expression per focused tool.** The focused math tools reject statement
   terminators (`;` or `$`) and multi-statement input. Use `maxima_batch` for a
   sequence, and leave `;`/`$` to `maxima_eval`/`maxima_batch`.
4. **Keep state intentional.** Variables, functions, assumptions, and loaded
   packages live in a session. Reuse a named session for one coherent task;
   reset or use a new session for unrelated work.
5. **Verify before claiming.** A pretty output is not proof. Substitute back,
   differentiate/integrate back, compare with quadrature, check matrix
   identities, test edge cases, or sample numerically. See
   [verification](references/verification.md).
6. **Never invent output.** Quote the actual tool result. If a call fails,
   times out, returns a noun form, or is inconclusive, report that state.
7. **Respect configured limits.** Defaults are typically 30 s per evaluation,
   300 s maximum, 50 statements per batch, 100 000 characters per expression,
   and 8 sessions. Raise limits only with a reason and only when the server
   configuration allows it.
8. **Stay inside safe mode.** Shell and file primitives are blocked by default.
   Use `maxima_package_load` for packages and `maxima_plot` for plotting. Do not
   try to bypass the controls.
9. **State assumptions and domains.** Maxima can return generic answers that are
   invalid on a branch cut, at a singular point, or without a parameter sign.
   Make assumptions explicit in the session and in the answer.
10. **Treat `restarted: true` as state loss.** After a timeout, crash,
    cancellation, or output-limit violation, the next call starts a fresh
    process. Recreate definitions and assumptions before continuing.
11. **Do not retry blindly.** Retry only idempotent reads or explicitly
    retryable errors. A timed-out heavy computation should be simplified,
    split, or reformulated, not immediately repeated.
12. **Protect data.** Do not send secrets, credentials, personal data, or
    proprietary inputs to a shared remote server unless the deployment is
    approved for that data class. Prefer a local stdio server for sensitive work.

## Operating loop

Use this loop for every non-trivial request.

### 0. Preflight

If this is the first call in the environment, call `maxima_system_info`.
Confirm:

- `maxima.available` is `true`;
- `maxima.version` is present;
- `docs.state` and `source.state` are `ready` when the task needs them;
- `maxima.allow_dangerous` is `false` unless the task is explicitly trusted and
  the deployment permits dangerous primitives;
- session count is below `maxima.max_sessions`.

If the server is unavailable, stop and give the user the connection steps in
[integration](references/integration.md). Do not pretend to compute.

### 1. Frame the problem

Write down, for yourself and eventually the user:

- the goal and the requested form (exact, numeric, approximate, plot, proof);
- variables, parameters, constants, and units;
- domain and assumptions (real/complex, positive, nonzero, branch, range);
- required precision and tolerance;
- what would count as a successful check.

If the request is underspecified, ask one focused clarification rather than
guessing silently. If a reasonable default exists, state it and proceed.

### 2. Route to the right tool

| Task                       | Primary tool                                           | Typical follow-up               |
| -------------------------- | ------------------------------------------------------ | ------------------------------- |
| Evaluate one expression    | `maxima_eval`                                          | `maxima_numeric`, substitution  |
| Run definitions then steps | `maxima_batch`                                         | focused tool for the final step |
| Solve equations/systems    | `maxima_solve`                                         | substitute residuals            |
| Differentiate              | `maxima_differentiate`                                 | numeric finite difference       |
| Integrate                  | `maxima_integrate`                                     | differentiate back, quadrature  |
| Limit                      | `maxima_limit`                                         | one-sided limits, series        |
| Taylor/Laurent expansion   | `maxima_series`                                        | numeric comparison              |
| Simplify/rewrite           | `maxima_simplify`                                      | random numeric sampling         |
| Numeric value              | `maxima_numeric`                                       | precision/error check           |
| Matrix operation           | `maxima_matrix`                                        | identity/residual check         |
| Plot                       | `maxima_plot`                                          | sample points and axis review   |
| Find syntax                | `maxima_help`, `maxima_search_docs`, `maxima_examples` | evaluate a minimal test         |
| Inspect implementation     | `maxima_source`, `maxima_search_source`                | minimal behavioral test         |
| Load a package             | `maxima_list_packages`, `maxima_package_load`          | test one documented call        |
| Manage state               | `maxima_session_open/list/reset/close`                 | continue in the same session    |
| Diagnose environment       | `maxima_system_info`                                   | health/readiness endpoints      |

The complete argument and return reference is
[tools](references/tools.md). Domain workflows are in
[workflows](references/workflows.md).

### 3. Choose a session

| Situation                                              | Session strategy                                                             |
| ------------------------------------------------------ | ---------------------------------------------------------------------------- |
| One short request                                      | Omit `session_id`; use the default session.                                  |
| Multi-step derivation with shared definitions          | `maxima_session_open` a named session, then pass `session_id` to every call. |
| Independent tasks that must not contaminate each other | Separate named sessions.                                                     |
| Parallel branches                                      | One session per branch; calls within a session are serialized.               |
| Stale or unknown state                                 | `maxima_session_reset` before starting.                                      |
| Finished long task                                     | `maxima_session_close` if the state is no longer needed.                     |

Session IDs may contain letters, digits, `_`, `.`, `:`, and `-`, up to 64
characters. Calls to the same session queue; calls to different sessions can run
in parallel.

### 4. Compose the input

**Focused math tools** accept a single expression and reject `;` or `$`:

```json
{
  "expression": "x^2*exp(-x)",
  "variable": "x",
  "lower": "0",
  "upper": "inf",
  "numerical": false
}
```

**`maxima_eval`** accepts one expression and can auto-terminate it:

```json
{ "expression": "integrate(x^2, x)" }
```

**`maxima_batch`** accepts a list and preserves definitions between statements:

```json
{
  "commands": ["assume(a > 0)$", "f: exp(-a*x)$", "integrate(f, x, 0, inf);"],
  "session_id": "heat-equation"
}
```

Use `terminator: "dollar"` when you want to suppress output for assignments and
setup statements. Use `terminator: "semicolon"` (or the default `auto`) when you
need the result displayed.

**Maxima syntax essentials:** `=` is an equation, `:` is assignment, `:=`
defines a function, `^` is exponentiation, `%pi`/`%e`/`%i` are constants,
`inf`/`minf` are infinities, and `/* ... */` is a comment. Lists use `[...]`;
matrices use `matrix([...], [...])`. See
[Maxima language](references/maxima-language.md) for a compact reference and
common traps.

### 5. Execute and read the result

Every tool returns MCP text content, and most also return `structuredContent`.
Read both when available:

- `output` is the human-readable result;
- `is_error` is the server's error classification (also surfaced as an MCP
  `isError` result);
- `warnings` is an array of Maxima warning lines;
- `session_id` tells you where the state lives;
- `duration_ms` tells you whether the call was close to the timeout;
- `restarted` means the process was restarted and prior state is gone;
- `truncated` means output was cut at the configured limit.

For `maxima_batch`, inspect each `results[i]` separately. A later command can
still succeed after an earlier command failed, and an earlier assignment may be
missing if the process restarted. Do not summarize a batch as a single success
without checking every item.

### 6. Verify

Use at least one **independent** check. Re-running the same command is not
verification.

| Result type         | Independent checks                                                                                      |
| ------------------- | ------------------------------------------------------------------------------------------------------- |
| Equation solution   | Substitute each solution into every equation; residual must be zero (or within tolerance).              |
| Indefinite integral | Differentiate the result and simplify; compare with the integrand.                                      |
| Definite integral   | Compare symbolic result with `quad_qags` on a finite interval; check convergence as bounds grow.        |
| Derivative          | Compare with a central finite difference at several interior points.                                    |
| Limit               | Evaluate numerically on both sides; compare with a series expansion when available.                     |
| Series              | Compare the truncated series with the function at small offsets; state the remainder/order.             |
| Simplification      | Evaluate original and simplified forms at several random safe points; compare numerically.              |
| Matrix result       | Multiply back, check `A . A^-1 = I`, verify determinant/rank/eigenvalue identities, or check residuals. |
| Numeric result      | Report the precision mode and digits; compare double vs bfloat or refine the quadrature.                |
| Plot                | Sample the plotted function at known points; check axes, domain, singularities, and labels.             |

The full protocol, tolerance guidance, and evidence template are in
[verification](references/verification.md).

### 7. Report

Use a compact, auditable structure:

```markdown
**Result**
<the answer, with exact and numeric forms when relevant>

**Method**
<tool names and the decisive Maxima commands>

**Assumptions**
<domain, parameter signs, branch choices, units, precision>

**Verification**
<the independent check and its numeric evidence>

**Limitations**
<anything not checked, noun forms, singular cases, or unresolved branches>
```

Do not include raw tool JSON unless the user asks for it. Do include the exact
commands when reproducibility matters. If a result is a noun form, an unevaluated
integral, an empty solution list, or a conditional expression, say so explicitly
and explain what it means.

### 8. Recover

| Symptom                                    | First action                                                                                                              |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------- |
| `MAXIMA_TIMEOUT`                           | Reduce scope, split the problem, add assumptions, or raise `timeout_ms` deliberately. State was lost; re-run definitions. |
| `MAXIMA_CRASHED`                           | Check `maxima_system_info`; re-run in a fresh session; simplify the expression.                                           |
| `restarted: true`                          | Recreate definitions, assumptions, and loaded packages.                                                                   |
| `UNSAFE_EXPRESSION`                        | Use a dedicated tool (`maxima_package_load`, `maxima_plot`) or ask the administrator; do not bypass.                      |
| `VALIDATION_ERROR`                         | Fix the argument shape; focused tools need one expression and no `;`/`$`.                                                 |
| `LIMIT_EXCEEDED`                           | Shorten the expression, split the batch, reduce plot size, or raise the configured limit.                                 |
| `SESSION_NOT_FOUND`                        | Omit `session_id`, open a new session, or list sessions.                                                                  |
| `SESSION_LIMIT`                            | Close an unused session or wait for a busy one.                                                                           |
| `SESSION_BUSY`                             | Wait, cancel, or use a separate session; do not force a reset mid-evaluation.                                             |
| `DOCS_UNAVAILABLE` / `DOC_NOT_FOUND`       | Install `maxima-doc`, set `MAXIMA_MCP_DOC_DIR`, or proceed with `maxima_help` on a known symbol.                          |
| `SOURCE_UNAVAILABLE` / `PACKAGE_NOT_FOUND` | Install `maxima-src`/`maxima-share`, or use an exact package name from `maxima_list_packages`.                            |
| `PLOT_FAILED`                              | Check gnuplot, reduce dimensions, use finite ranges, verify the expression has no forbidden terminator.                   |
| `ABORTED`                                  | The client cancelled the call; retry only if the operation is safe to repeat.                                             |
| HTTP 401/403/404/413/429/503               | Follow the transport recovery matrix in [errors](references/errors.md).                                                   |

### 9. Stay safe

Safe mode is a defense-in-depth control, not a sandbox. Maxima is
Turing-complete. For untrusted users, run the server in a container or VM with
no credentials, a read-only filesystem where possible, CPU/memory limits, and
network egress controls. The child Maxima process receives a minimal
environment, but the MCP server itself still executes expressions by design.

- Never place bearer tokens, API keys, or credentials in expressions.
- Never use Maxima to read or write host files, spawn processes, or exfiltrate
  data, even if safe mode is disabled.
- Do not treat a successful evaluation as approval to execute arbitrary code.
- For multi-tenant use, isolate tenants at the container level, not only by
  `session_id`.
- Log the tool calls and assumptions that materially affect a decision.

See [enterprise](references/enterprise.md) for deployment, observability, and
governance controls.

## Tool map

| Group                | Tools                                                                                                                                            |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| Evaluation           | `maxima_eval`, `maxima_batch`                                                                                                                    |
| Calculus and algebra | `maxima_solve`, `maxima_differentiate`, `maxima_integrate`, `maxima_limit`, `maxima_series`, `maxima_simplify`, `maxima_numeric`                 |
| Linear algebra       | `maxima_matrix`                                                                                                                                  |
| Plotting             | `maxima_plot`                                                                                                                                    |
| Sessions             | `maxima_session_open`, `maxima_session_list`, `maxima_session_reset`, `maxima_session_close`                                                     |
| Manual               | `maxima_help`, `maxima_search_docs`, `maxima_examples`, `maxima_list_symbols`, `maxima_doc_sections`, `maxima_doc_read`, `maxima_doc_categories` |
| Source and packages  | `maxima_source`, `maxima_search_source`, `maxima_list_source_files`, `maxima_read_source_file`, `maxima_list_packages`, `maxima_package_load`    |
| System               | `maxima_system_info`                                                                                                                             |

MCP resources: `maxima://manual/index`, `maxima://manual/categories`,
`maxima://docs/symbol/{name}`, `maxima://docs/section/{file}`,
`maxima://source/{+path}`.

MCP prompts: `maxima_solve_problem`, `maxima_explain_symbol`,
`maxima_debug_expression`.

## Reference map

Load only the references needed for the current task.

| Reference                                        | Use it for                                                                                                                              |
| ------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------- |
| [tools](references/tools.md)                     | Exact arguments, defaults, return shapes, and examples for all 29 tools, resources, and prompts.                                        |
| [workflows](references/workflows.md)             | End-to-end procedures for calculus, algebra, matrices, numerics, plotting, debugging, documentation research, and engineering analysis. |
| [Maxima language](references/maxima-language.md) | Compact syntax and semantics reference, function map, and common traps.                                                                 |
| [verification](references/verification.md)       | Independent checks, tolerances, branch/domain handling, and evidence templates.                                                         |
| [errors](references/errors.md)                   | Error-code meaning, retry policy, and recovery playbooks.                                                                               |
| [cookbook](references/cookbook.md)               | Copy-ready recipes and anti-patterns.                                                                                                   |
| [integration](references/integration.md)         | Server installation, MCP client configuration, skill installation, and smoke tests.                                                     |
| [enterprise](references/enterprise.md)           | Deployment topology, security, observability, capacity, governance, and runbooks.                                                       |
| [prompts](references/prompts.md)                 | System prompts, task templates, and report templates for any agent.                                                                     |
| [eval cases](evals/README.md)                    | Behavioural evaluation suite, scoring rubric, and rollout gate.                                                                         |

## Definition of done

Before you answer, confirm:

- [ ] The problem, variables, domain, assumptions, and requested form are stated.
- [ ] The right tool was used, and any uncertain syntax was grounded in the manual.
- [ ] The exact command or expression is recorded when reproducibility matters.
- [ ] The result is not a silently accepted noun form, empty list, or conditional.
- [ ] At least one independent verification was performed, or the limitation is stated.
- [ ] `restarted`, `warnings`, `is_error`, and `truncated` were checked.
- [ ] Units, precision, and branch choices are explicit.
- [ ] The final answer separates result, method, assumptions, verification, and limitations.
- [ ] No secret, credential, or untrusted host operation was introduced.
