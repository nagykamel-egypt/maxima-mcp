# Tool reference

This is the complete surface of `maxima-mcp` 1.x. Load it when you need exact
argument names, defaults, return fields, or a safe example.

All tools use MCP `tools/call`. Optional arguments may be omitted. The server
returns text content plus `structuredContent` for most tools. Failures are
returned as MCP `isError` results with a text body of the form:

```text
Error [CODE]: message
Hint: optional recovery hint
This error is retryable.
```

Use [errors](errors.md) for recovery. Use [workflows](workflows.md) for complete
procedures.

## Common arguments and conventions

| Argument     | Meaning                                                                                                                                                          |
| ------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `session_id` | Persistent Maxima session. Omit for the default session. An unknown ID is created on first use. Allowed characters: letters, digits, `_`, `.`, `:`, `-`; max 64. |
| `timeout_ms` | Per-call timeout. Minimum 100 ms; capped by `MAXIMA_MCP_MAX_TIMEOUT_MS` (default 300 000). Omit for the configured default (30 000).                             |
| `terminator` | `auto`, `semicolon`, or `dollar` for `maxima_eval`/`maxima_batch`. `auto` appends `;` when missing so results display; `dollar` suppresses output.               |

**Focused math tools** (`maxima_solve`, `maxima_differentiate`,
`maxima_integrate`, `maxima_limit`, `maxima_series`, `maxima_simplify`,
`maxima_numeric`, `maxima_matrix`) accept a single expression. They reject `;`
and `$` outside strings/comments, reject multiple statements, and validate
bracket/quote balance. Use `maxima_batch` for multiple statements.

**Output envelope for evaluation-style tools:**

```json
{
  "command": "diff(sin(x), x);",
  "output": "cos(x)",
  "is_error": false,
  "session_id": "default",
  "duration_ms": 42,
  "restarted": false
}
```

`maxima_eval` and `maxima_batch` add `results`, `truncated`, and optional
`stderr`.

---

## Evaluation and sessions

### `maxima_eval`

Evaluate one Maxima expression in a persistent session. Supports the full
Maxima language, including programming constructs and loaded packages.

**Input**

| Field        | Type                          | Required | Default         | Notes                                                                    |
| ------------ | ----------------------------- | -------- | --------------- | ------------------------------------------------------------------------ |
| `expression` | string                        | yes      | —               | Maxima source, 1 to `MAXIMA_MCP_MAX_EXPRESSION_CHARS` (default 100 000). |
| `session_id` | string                        | no       | default session | Unknown IDs are created on first use.                                    |
| `timeout_ms` | integer                       | no       | 30 000          | 100 to max timeout.                                                      |
| `terminator` | `auto`\|`semicolon`\|`dollar` | no       | `auto`          | Appends `;` unless a terminator is present.                              |

**Example**

```json
{ "expression": "integrate(x^2*exp(-x), x, 0, inf)" }
```

**Returns** `session_id`, `results[]` (`command`, `output`, `is_error`,
`warnings`), `duration_ms`, `restarted`, optional `stderr`, `truncated`.

**Interpretation**

- The text body is the first result's output, or `(no output)`.
- Notes may say the session was started/restarted or the output was truncated.
- `is_error` is true when the server recognizes a Maxima/Lisp error pattern; it
  can miss unusual error text, so inspect `output` and `warnings` too.
- `restarted: true` means prior definitions are gone.

**Pitfalls**

- A single string containing several statements is not a batch contract. Use
  `maxima_batch` for sequential work.
- `terminator: "dollar"` suppresses display. Use it only when you do not need
  the value echoed.

---

### `maxima_batch`

Evaluate multiple statements in order against one session, preserving
definitions and assignments. Execution stops only on a process crash, timeout,
or cancellation; individual Maxima errors do not stop later statements.

**Input**

| Field        | Type                          | Required | Default         | Notes                                                   |
| ------------ | ----------------------------- | -------- | --------------- | ------------------------------------------------------- |
| `commands`   | string[]                      | yes      | —               | 1 to `MAXIMA_MCP_MAX_COMMANDS` (default 50) statements. |
| `session_id` | string                        | no       | default session | Shared state across statements.                         |
| `timeout_ms` | integer                       | no       | 30 000          | Applies to the entire batch, not each statement.        |
| `terminator` | `auto`\|`semicolon`\|`dollar` | no       | `auto`          | Applied to statements missing a terminator.             |

**Example**

```json
{
  "commands": [
    "assume(a > 0)$",
    "f: exp(-a*x)$",
    "F: integrate(f, x)$",
    "check: diff(F, x) - f;",
    "integrate(f, x, 0, inf);"
  ],
  "session_id": "laplace-demo",
  "timeout_ms": 60000
}
```

**Returns** Same envelope as `maxima_eval`, with one `results[i]` per command.
The text body formats each result as `[n] command\noutput`, followed by
`[stderr]` if present and restart notes.

**Interpretation**

- Inspect every `results[i].is_error` and `warnings`.
- A later statement can succeed after an earlier failure. If an assignment
  failed, later statements may use an unevaluated symbol instead of the intended
  value.
- If `restarted` is true, assume all prior state (including earlier statements
  in the same batch) is unavailable.
- The batch timeout covers the whole list. A long setup plus a long integral may
  need a larger timeout or two batches.

**Pitfalls**

- Do not put independent parallel tasks in one batch; use separate sessions.
- Do not rely on `%` or `%oN` labels across batches. Assign explicit names.

---

### `maxima_session_open`

Create or reuse a persistent session and start its process immediately. If the
requested ID already exists it is reused.

**Input**

| Field        | Type   | Required | Default              | Notes                          |
| ------------ | ------ | -------- | -------------------- | ------------------------------ |
| `session_id` | string | no       | generated `ms_<hex>` | Allowed characters as above.   |
| `name`       | string | no       | —                    | Human-readable label, max 200. |

**Returns** `session` object (`id`, optional `name`, `created_at`,
`last_used_at`, `evaluation_count`, `alive`, optional `pid`, `uptime_ms`,
`restarts`, `busy`, `is_default`) and `created` (boolean).

---

### `maxima_session_list`

List open sessions with process state and usage statistics. No input.

**Returns** `sessions[]`, `default_session`, `max_sessions`.

Use this before assuming a named session exists, or to diagnose `busy`,
`restarts`, and idle state.

---

### `maxima_session_reset`

Terminate the session's Maxima process and start a fresh one with the same ID.
All variables, definitions, assumptions, and loaded packages are discarded.

**Input** `session_id` (required).

**Returns** `session` object and `created: false`.

**Pitfalls**

- Fails with `SESSION_BUSY` if an evaluation is in progress.
- Reset is not a rollback of external effects; Maxima state only.

---

### `maxima_session_close`

Terminate a session and release its process. Closing an unknown session is a
no-op. The default session is recreated automatically on the next evaluation.

**Input** `session_id` (required).

**Returns** `session_id`, `closed` (boolean).

---

## Calculus and algebra

### `maxima_solve`

Solve one equation or a system symbolically with Maxima `solve`. With
`numerical: true`, the command is wrapped in `float(...)`.

**Input**

| Field        | Type               | Required | Default | Notes                                                    |
| ------------ | ------------------ | -------- | ------- | -------------------------------------------------------- |
| `equations`  | string or string[] | yes      | —       | One equation or up to 20 equations. Use `=`; no `;`/`$`. |
| `variables`  | string or string[] | yes      | —       | One variable or up to 10 variables. Simple symbols only. |
| `numerical`  | boolean            | no       | `false` | Convert exact solutions to floating point.               |
| `session_id` | string             | no       | default | —                                                        |
| `timeout_ms` | integer            | no       | 30 000  | —                                                        |

**Examples**

```json
{ "equations": "x^2 - 4 = 0", "variables": "x" }
```

```json
{
  "equations": ["x + y = 3", "x - y = 1"],
  "variables": ["x", "y"]
}
```

**Returns** `command` (for example `solve(x^2-4 = 0, x)`), `output`,
`is_error`, `session_id`, `duration_ms`, `restarted`.

**Interpretation**

- `[x = -2, x = 2]` is an exact solution list.
- `[]` means no solution found by `solve`, not necessarily that none exists.
- A system returns a list of solution lists, for example
  `[[x = 2, y = 1]]`.
- Solutions can contain parameters, `%rN` integration constants, or conditions.
- Always substitute back; `solve` may return extraneous roots or lose branches.

**Pitfalls**

- `solve` is not a numerical root finder for arbitrary transcendental equations.
  Use `find_root`, `allroots`, or a numeric method via `maxima_eval` when
  appropriate.
- The focused tool validates symbols strictly; use `maxima_eval` if you need a
  subscripted or unusual variable form.

---

### `maxima_differentiate`

Compute a symbolic derivative with `diff`, optionally of higher order.

**Input**

| Field        | Type    | Required | Default | Notes                    |
| ------------ | ------- | -------- | ------- | ------------------------ |
| `expression` | string  | yes      | —       | Single expression.       |
| `variable`   | string  | yes      | —       | Simple symbol, e.g. `x`. |
| `order`      | integer | no       | `1`     | 1 to 50.                 |
| `session_id` | string  | no       | default | —                        |
| `timeout_ms` | integer | no       | 30 000  | —                        |

**Example**

```json
{ "expression": "sin(x)*exp(-x)", "variable": "x", "order": 2 }
```

**Returns** `command` (`diff(...)`), `output`, `is_error`, `session_id`,
`duration_ms`, `restarted`.

**Pitfalls**

- `diff` assumes symbols are independent. Use `depends(y, x)` or explicit
  functions for dependent variables.
- For a function defined with `:=`, differentiate the applied form, e.g.
  `diff(f(x), x)`.

---

### `maxima_integrate`

Compute an indefinite or definite integral with `integrate`. With
`numerical: true` and both bounds, uses adaptive quadrature `quad_qags`.

**Input**

| Field        | Type    | Required | Default | Notes                                               |
| ------------ | ------- | -------- | ------- | --------------------------------------------------- |
| `expression` | string  | yes      | —       | Integrand, single expression.                       |
| `variable`   | string  | yes      | —       | Simple symbol.                                      |
| `lower`      | string  | no       | —       | Omit for indefinite. Must be supplied with `upper`. |
| `upper`      | string  | no       | —       | Omit for indefinite. Must be supplied with `lower`. |
| `numerical`  | boolean | no       | `false` | Requires both bounds. Uses `quad_qags`.             |
| `session_id` | string  | no       | default | —                                                   |
| `timeout_ms` | integer | no       | 30 000  | —                                                   |

**Examples**

```json
{ "expression": "x^2", "variable": "x" }
```

```json
{ "expression": "exp(-x^2)", "variable": "x", "lower": "0", "upper": "10", "numerical": true }
```

**Returns** `command`, `output`, `is_error`, `session_id`, `duration_ms`,
`restarted`.

**Interpretation**

- A symbolic definite integral may return a noun form or a conditional
  expression. That is not a completed evaluation.
- `quad_qags` returns `[value, estimated_error, evaluations, error_code]`.
  `error_code = 0` means success; other codes indicate convergence or input
  problems.
- `quad_qags` needs finite bounds. Passing `inf` can return the unevaluated noun
  form; transform the integral to a finite domain or use a limit/asymptotic
  argument.

**Pitfalls**

- Parameterized integrals may hang or ask sign questions without assumptions.
  Run `assume(a > 0)$` (or relevant conditions) before integrating.
- Definite integrals across singularities need explicit splitting and
  `quad_qagp`/`quad_qags` checks; do not trust one automatic result.
- Differentiate the antiderivative back and simplify as a check.

---

### `maxima_limit`

Compute a symbolic limit with `limit`, including one-sided limits.

**Input**

| Field        | Type                    | Required | Default | Notes                                                     |
| ------------ | ----------------------- | -------- | ------- | --------------------------------------------------------- |
| `expression` | string                  | yes      | —       | Single expression.                                        |
| `variable`   | string                  | yes      | —       | Simple symbol.                                            |
| `point`      | string                  | yes      | —       | Number, `inf`, `minf`, `%pi`, `%e`, or simple arithmetic. |
| `direction`  | `both`\|`plus`\|`minus` | no       | `both`  | `plus` is right-sided; `minus` is left-sided.             |
| `session_id` | string                  | no       | default | —                                                         |
| `timeout_ms` | integer                 | no       | 30 000  | —                                                         |

**Example**

```json
{ "expression": "1/x", "variable": "x", "point": "0", "direction": "plus" }
```

**Returns** `command` (`limit(...)`), `output`, `is_error`, `session_id`,
`duration_ms`, `restarted`.

**Pitfalls**

- Two-sided limits can be undefined while one-sided limits exist; request both
  directions.
- `inf` and `minf` are the correct infinity symbols, not `infinity` or `oo`.
- A limit may depend on assumptions about parameters. State them.

---

### `maxima_series`

Expand an expression as a truncated Taylor series with `taylor`.

**Input**

| Field        | Type    | Required | Default | Notes                       |
| ------------ | ------- | -------- | ------- | --------------------------- |
| `expression` | string  | yes      | —       | Single expression.          |
| `variable`   | string  | yes      | —       | Simple symbol.              |
| `point`      | string  | no       | `0`     | Expansion point.            |
| `order`      | integer | no       | `6`     | Truncation order, 1 to 100. |
| `session_id` | string  | no       | default | —                           |
| `timeout_ms` | integer | no       | 30 000  | —                           |

**Example**

```json
{ "expression": "exp(x)*cos(x)", "variable": "x", "point": "0", "order": 8 }
```

**Returns** `command`, `output`, `is_error`, `session_id`, `duration_ms`,
`restarted`.

**Interpretation**

- The result is a truncated series, often with an ellipsis or `+...`. State the
  order and that the remainder is not shown.
- For Laurent or singular expansions, `taylor` may return negative powers; check
  the point is not a branch point for the requested form.

**Pitfalls**

- A series at infinity may need `taylor(f, x, inf, n)` or a substitution such as
  `x = 1/t`; verify the result numerically at large values.
- Do not present a truncated series as an exact identity.

---

### `maxima_simplify`

Apply a chosen simplification strategy to one expression.

**Input**

| Field        | Type    | Required | Default | Notes              |
| ------------ | ------- | -------- | ------- | ------------------ |
| `expression` | string  | yes      | —       | Single expression. |
| `method`     | enum    | no       | `auto`  | See below.         |
| `session_id` | string  | no       | default | —                  |
| `timeout_ms` | integer | no       | 30 000  | —                  |

**Methods**

`auto` (applies `radcan(ratsimp(expr))`), `ratsimp`, `fullratsimp`, `radcan`,
`trigsimp`, `trigexpand`, `trigreduce`, `factor`, `expand`, `logcontract`,
`rootscontract`, `rectform`, `polarform`, `demoivre`, `exponentialize`.

**Example**

```json
{ "expression": "sin(x)^2 + cos(x)^2", "method": "trigsimp" }
```

**Returns** `command`, `output`, `is_error`, `session_id`, `duration_ms`,
`restarted`.

**Choosing a method**

| Goal                                     | Method                     |
| ---------------------------------------- | -------------------------- |
| Rational function to a common form       | `ratsimp` or `fullratsimp` |
| Remove algebraic radicals / rationalize  | `radcan`                   |
| Simplify trigonometric expressions       | `trigsimp`                 |
| Expand trigonometric functions           | `trigexpand`               |
| Reduce powers of trig functions          | `trigreduce`               |
| Factor a polynomial                      | `factor`                   |
| Expand products and powers               | `expand`                   |
| Combine logarithms                       | `logcontract`              |
| Combine roots                            | `rootscontract`            |
| Rectangular form of a complex expression | `rectform`                 |
| Polar form                               | `polarform`                |
| Convert complex exponentials to trig     | `demoivre`                 |
| Convert trig to complex exponentials     | `exponentialize`           |
| General-purpose first attempt            | `auto`                     |

**Pitfalls**

- Simplification is not canonical. A different form may be better for the next
  step; state which form you chose and why.
- `radcan` can change branch behavior. Check the domain and branch cuts.
- `logcontract` and `rootscontract` can be invalid without positivity
  assumptions. Use `assume` and verify numerically.

---

### `maxima_numeric`

Convert a symbolic expression to a floating-point value.

**Input**

| Field        | Type               | Required | Default  | Notes                                                     |
| ------------ | ------------------ | -------- | -------- | --------------------------------------------------------- |
| `expression` | string             | yes      | —        | Single expression.                                        |
| `mode`       | `double`\|`bfloat` | no       | `double` | `double` uses `float`; `bfloat` uses arbitrary precision. |
| `digits`     | integer            | no       | `32`     | 2 to 10 000; used only for `bfloat`.                      |
| `session_id` | string             | no       | default  | —                                                         |
| `timeout_ms` | integer            | no       | 30 000   | —                                                         |

**Examples**

```json
{ "expression": "%pi", "mode": "double" }
```

```json
{ "expression": "%pi", "mode": "bfloat", "digits": 80 }
```

**Returns** `command`, `output`, `is_error`, `session_id`, `duration_ms`,
`restarted`.

**Interpretation**

- `double` output is a machine float (about 15–17 significant digits).
- `bfloat` output uses `b0` notation and `fpprec` digits. It is still a binary
  bigfloat, not exact rational arithmetic.
- The command for `bfloat` is `block([fpprec: N], bfloat(expr))`, so `fpprec`
  does not leak into the session.

**Pitfalls**

- High `digits` does not fix an ill-conditioned expression or a low-precision
  input. Use exact arithmetic until the final conversion where possible.
- `float` of a large exact expression can still lose significance. Compare
  against `bfloat` when precision matters.

---

## Linear algebra

### `maxima_matrix`

Perform one linear-algebra operation on a Maxima matrix expression.

**Input**

| Field        | Type    | Required | Default   | Notes                          |
| ------------ | ------- | -------- | --------- | ------------------------------ |
| `operation`  | enum    | yes      | —         | See below.                     |
| `matrix`     | string  | yes      | —         | Must start with `matrix(...)`. |
| `variable`   | string  | no       | `%lambda` | Variable for `charpoly`.       |
| `session_id` | string  | no       | default   | —                              |
| `timeout_ms` | integer | no       | 30 000    | —                              |

**Operations**

`determinant`, `inverse`, `transpose`, `rank`, `trace`, `eigenvalues`,
`eigenvectors`, `charpoly`, `adjoint`, `nullspace`.

**Example**

```json
{
  "operation": "eigenvalues",
  "matrix": "matrix([2, 0], [0, 3])"
}
```

**Returns** `command`, `output`, `is_error`, `session_id`, `duration_ms`,
`restarted`.

**Interpretation**

- `eigenvalues` returns `[[values], [multiplicities]]`; for example
  `[[2, 3], [1, 1]]`.
- `eigenvectors` returns `[[values], [multiplicities], [vector lists]]`.
- `nullspace` returns a list of basis vectors.
- `inverse` uses `invert`; `trace` is computed as a sum of diagonal entries.
- `charpoly` returns the characteristic polynomial in `variable`.

**Pitfalls**

- The matrix must be a `matrix(...)` expression. A list of lists or a string
  from another system is not accepted.
- Symbolic matrices may produce large expressions or conditional results.
- Verify `A . A^-1 = I` and check the determinant/rank for singular cases.

---

## Plotting

### `maxima_plot`

Render one or more expressions as PNG or SVG using Maxima's gnuplot backend.

**Input**

| Field         | Type         | Required | Default    | Notes                                                         |
| ------------- | ------------ | -------- | ---------- | ------------------------------------------------------------- |
| `expressions` | string[]     | yes      | —          | 1 to 12 expressions in `x` (2D) or `x`, `y` (3D). No `;`/`$`. |
| `x_min`       | number       | yes      | —          | Finite; `x_max > x_min`.                                      |
| `x_max`       | number       | yes      | —          | Range must not exceed `1e9` in width.                         |
| `y_min`       | number       | 3D yes   | —          | Required for 3D.                                              |
| `y_max`       | number       | 3D yes   | —          | Required for 3D.                                              |
| `kind`        | `2d`\|`3d`   | no       | `2d`       | —                                                             |
| `format`      | `png`\|`svg` | no       | `png`      | —                                                             |
| `title`       | string       | no       | —          | Max 500.                                                      |
| `xlabel`      | string       | no       | —          | Max 200.                                                      |
| `ylabel`      | string       | no       | —          | Max 200.                                                      |
| `width`       | integer      | no       | `900`      | 100 to 4000 px.                                               |
| `height`      | integer      | no       | `600`      | 100 to 4000 px.                                               |
| `log_x`       | boolean      | no       | `false`    | —                                                             |
| `log_y`       | boolean      | no       | `false`    | —                                                             |
| `grid`        | boolean      | no       | `true`     | —                                                             |
| `legend`      | boolean      | no       | `true`     | —                                                             |
| `session_id`  | string       | no       | default    | Session whose definitions may be used.                        |
| `timeout_ms`  | integer      | no       | 2× default | Capped by max timeout.                                        |

**Example**

```json
{
  "expressions": ["sin(x)", "cos(x)", "sin(x)*exp(-x/5)"],
  "x_min": 0,
  "x_max": 4,
  "kind": "2d",
  "format": "png",
  "title": "Damped oscillation",
  "xlabel": "x",
  "ylabel": "f(x)",
  "width": 1000,
  "height": 600
}
```

**Returns** a text summary plus an MCP image content item, and structured
`format`, `mime_type`, `bytes`, `duration_ms`, `session_id`, `command`,
`output`.

**Pitfalls**

- 3D requires `y_min` and `y_max`.
- Log axes require positive data in the plotted range; the image may be empty or
  misleading otherwise.
- Expressions are evaluated in the chosen session, so definitions and
  assumptions persist.
- gnuplot must be installed; otherwise expect `PLOT_FAILED`.

---

## Documentation

### `maxima_help`

Look up the official manual entry for a function, variable, operator, or package
symbol.

**Input**

| Field              | Type    | Required | Default  | Notes                                                   |
| ------------------ | ------- | -------- | -------- | ------------------------------------------------------- |
| `symbol`           | string  | yes      | —        | Max 200; e.g. `integrate`, `solve`, `plot2d`, `bfloat`. |
| `include_examples` | boolean | no       | `true`   | Include example blocks.                                 |
| `max_entries`      | integer | no       | `4`      | 1 to 10 overloads/entries.                              |
| `max_chars`        | integer | no       | `16 000` | 200 to 100 000 total description budget.                |

**Returns** `name`, `entries[]` (`name`, `kind`, `signature`, `text`,
`examples`, `categories`, `file`, `section`, `uri`), `related[]`.

**Use it when** the exact signature or option name is uncertain. Do not guess
from memory.

---

### `maxima_search_docs`

Full-text BM25 search across the installed manual, including symbol entries and
sections.

**Input**

| Field   | Type                       | Required | Default | Notes                        |
| ------- | -------------------------- | -------- | ------- | ---------------------------- |
| `query` | string                     | yes      | —       | Max 500; concept or keyword. |
| `limit` | integer                    | no       | `10`    | 1 to 50.                     |
| `type`  | `symbol`\|`section`\|`all` | no       | `all`   | Restrict result type.        |

**Returns** `query`, `results[]` (`type`, optional `name`, `title`, `section`,
`snippet`, `score`, `uri`).

**Use it when** you know the concept but not the function name.

---

### `maxima_examples`

Return example blocks from the manual for a symbol.

**Input** `symbol` (required), `max_examples` (default 8; 1 to 30).

**Returns** `symbol`, `examples[]` (`symbol`, `code`).

**Use it when** you need a canonical usage pattern or expected output.

---

### `maxima_list_symbols`

List documented functions and variables, optionally by prefix.

**Input** `prefix` (default `""`, max 100), `limit` (default 100; 1 to 500).

**Returns** `symbols[]` (`name`, `kind`).

---

### `maxima_doc_sections`

List manual chapters and sections.

**Input** `filter` (default `""`, max 200), `limit` (default 200; 1 to 500).

**Returns** `sections[]` (`file`, `title`, `uri`).

---

### `maxima_doc_read`

Read a full manual section by file name, for example `Integration.html`.

**Input** `file` (required, max 200), `max_chars` (default 120 000; 1 000 to
500 000).

**Returns** `file`, `title`, `text`, `uri`.

---

### `maxima_doc_categories`

List manual categories and entry counts. No input.

**Returns** `categories[]` (`name`, `count`).

---

## Source and packages

### `maxima_source`

Locate the Lisp or Maxima-language implementation of a symbol in the installed
source and share trees.

**Input**

| Field           | Type    | Required | Default | Notes                        |
| --------------- | ------- | -------- | ------- | ---------------------------- |
| `symbol`        | string  | yes      | —       | Max 200.                     |
| `context_lines` | integer | no       | `10`    | 0 to 100 lines before/after. |
| `max_results`   | integer | no       | `3`     | 1 to 20 definitions.         |

**Returns** `symbol`, `definitions[]` (`file`, `line`, `kind`, `language`,
`start_line`, `end_line`, `text`).

**Use it when** behavior is subtle, undocumented, or version-specific. Ground
the observation with a minimal `maxima_eval` test.

---

### `maxima_search_source`

Text or JavaScript-regex search across installed Lisp, package, and demo files.

**Input**

| Field            | Type    | Required | Default | Notes                                     |
| ---------------- | ------- | -------- | ------- | ----------------------------------------- |
| `query`          | string  | yes      | —       | Max 500.                                  |
| `regex`          | boolean | no       | `false` | Interpret as a JavaScript regex.          |
| `case_sensitive` | boolean | no       | `false` | —                                         |
| `limit`          | integer | no       | `50`    | 1 to 200.                                 |
| `context_lines`  | integer | no       | `2`     | 0 to 10.                                  |
| `file_filter`    | string  | no       | `""`    | Substring path filter, e.g. `share/draw`. |

**Returns** `query`, `matches[]` (`file`, `line`, `text`, `before`, `after`),
`truncated`.

---

### `maxima_list_source_files`

List indexed source files.

**Input** `filter` (default `""`), `limit` (default 200; 1 to 1 000).

**Returns** `files[]` (`file`, `language`).

---

### `maxima_read_source_file`

Read an indexed source file by relative path.

**Input** `file` (required, max 500), `max_chars` (default 100 000; 1 000 to
500 000).

**Returns** `file`, `text`.

---

### `maxima_list_packages`

List loadable share packages.

**Input** `filter` (default `""`), `limit` (default 200; 1 to 1 000).

**Returns** `packages[]` (`name`, `path`, `files[]`).

---

### `maxima_package_load`

Load an installed share package into a session by exact name. Arbitrary paths
are rejected. Large packages may compile on first use and can take minutes.

**Input**

| Field        | Type    | Required | Default          | Notes                                                           |
| ------------ | ------- | -------- | ---------------- | --------------------------------------------------------------- |
| `package`    | string  | yes      | —                | Exact name from `maxima_list_packages`, e.g. `draw`, `distrib`. |
| `session_id` | string  | no       | default          | Package state persists in this session.                         |
| `timeout_ms` | integer | no       | 180 000 fallback | Capped by max timeout.                                          |

**Returns** `package`, `session_id`, `output`, `is_error`, `duration_ms`.

**Pitfalls**

- The first load may compile; do not assume a 30 s timeout is enough.
- Load into the same session that will use the package.
- A session reset or restart loses loaded packages.

---

## System

### `maxima_system_info`

Report server health, installed Maxima version, configuration limits, open
sessions, documentation/source index status, memory, and warnings. No input.

**Returns**

| Field      | Contents                                                                                                                             |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `server`   | `name`, `version`, `uptime_seconds`, `node_version`, `pid`                                                                           |
| `maxima`   | `bin`, optional `version`, `available`, `default_session`, `max_sessions`, `default_timeout_ms`, `max_timeout_ms`, `allow_dangerous` |
| `sessions` | `count`, `busy`, `default_session`, `ids[]`                                                                                          |
| `docs`     | `enabled`, `state`, `entries`, `sections`, optional `load_time_ms`, optional `error`, `html_dir`                                     |
| `source`   | `state`, `files`, `symbols`, `packages`, optional `load_time_ms`, optional `error`                                                   |
| `memory`   | `rss_mb`, `heap_used_mb`                                                                                                             |
| `warnings` | configuration warnings                                                                                                               |

Call this first in a new environment or when diagnosing availability.

---

## MCP resources

Resources are addressable documents. Use them when the client supports resource
reads and you want to attach a manual or source document to context without a
tool call.

| URI                            | Content                      |
| ------------------------------ | ---------------------------- |
| `maxima://manual/index`        | Manual table of contents     |
| `maxima://manual/categories`   | Documentation categories     |
| `maxima://docs/symbol/{name}`  | Manual entry for a symbol    |
| `maxima://docs/section/{file}` | Full manual section          |
| `maxima://source/{+path}`      | Installed Maxima source file |

The symbol resource accepts URI-encoded names. Section and source resources
support completion where the client implements it.

---

## MCP prompts

Prompts are reusable instruction templates. They do not compute; they shape the
agent's workflow.

| Prompt                    | Arguments                                                          | Purpose                                                                    |
| ------------------------- | ------------------------------------------------------------------ | -------------------------------------------------------------------------- |
| `maxima_solve_problem`    | `problem` (required), `session_id` (optional)                      | Restate, ground, solve, verify, and present a math problem.                |
| `maxima_explain_symbol`   | `symbol` (required)                                                | Explain a symbol using manual, source, and minimal behavior tests.         |
| `maxima_debug_expression` | `expression` (required), `error` (optional), `expected` (optional) | Diagnose an error or unexpected result and provide a corrected expression. |

Prefer these prompts when the client exposes them; otherwise use the templates in
[prompts](prompts.md).
