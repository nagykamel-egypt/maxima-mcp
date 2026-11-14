# Tool reference

All tools return MCP content blocks. Most also return `structuredContent` validated against a Zod
output schema. Semantic Maxima failures (syntax errors, unsupported integrals, division by zero) are
returned with `isError: true` and the original Maxima text; protocol/validation failures return an
`Error [CODE]` message.

Common conventions:

- `session_id` is optional. Omitted means the configured default session.
- An unknown `session_id` is created on first use (subject to session limits).
- `timeout_ms` is clamped to `MAXIMA_MCP_MAX_TIMEOUT_MS`.
- Unless stated otherwise, symbolic results are returned exactly as Maxima prints them.

## Evaluation

### `maxima_eval`

Evaluate one statement in a persistent session.

| Argument     | Type                              | Default         | Notes                                       |
| ------------ | --------------------------------- | --------------- | ------------------------------------------- |
| `expression` | string                            | required        | Maxima source; `;` is appended when missing |
| `session_id` | string                            | default session |                                             |
| `timeout_ms` | integer                           | `30000`         |                                             |
| `terminator` | `auto` \| `semicolon` \| `dollar` | `auto`          | `dollar` suppresses the value               |

Example:

```json
{ "expression": "integrate(x^2, x)" }
```

```text
x^3/3
```

Structured result:

```json
{
  "session_id": "default",
  "results": [
    {
      "command": "integrate(x^2, x);\n",
      "output": "x^3/3",
      "is_error": false,
      "warnings": []
    }
  ],
  "duration_ms": 12,
  "restarted": false,
  "truncated": false
}
```

### `maxima_batch`

Evaluate up to `MAXIMA_MCP_MAX_COMMANDS` statements in order against one session. Each statement is
framed separately, so output is attributed per command. Maxima continues after a statement error.

| Argument     | Type                              | Default             |
| ------------ | --------------------------------- | ------------------- |
| `commands`   | string[]                          | required            |
| `session_id` | string                            | default             |
| `timeout_ms` | integer                           | total batch timeout |
| `terminator` | `auto` \| `semicolon` \| `dollar` | `auto`              |

## Mathematics

### `maxima_solve`

| Argument                   | Type               | Default  |
| -------------------------- | ------------------ | -------- |
| `equations`                | string \| string[] | required |
| `variables`                | string \| string[] | required |
| `numerical`                | boolean            | `false`  |
| `session_id`, `timeout_ms` |                    |          |

Builds `solve(eq, var)` or `solve([eqs], [vars])`; `numerical` wraps the result in `float(...)`.

### `maxima_differentiate`

`expression`, `variable`, `order` (1–50, default 1). Builds `diff(expr, var[, order])`.

### `maxima_integrate`

`expression`, `variable`, optional `lower`/`upper`, `numerical` (default false).

- Without bounds: `integrate(expr, var)`.
- With bounds: `integrate(expr, var, lo, hi)`.
- `numerical: true` requires bounds and uses `quad_qags`, returning `[value, error, ...]`.

### `maxima_limit`

`expression`, `variable`, `point` (`0`, `inf`, `minf`, `%pi`, simple arithmetic), `direction`
(`both` | `plus` | `minus`).

### `maxima_series`

`expression`, `variable`, `point` (default `0`), `order` (1–100, default 6). Uses `taylor`.

### `maxima_simplify`

`expression`, `method` (default `auto`):
`auto` (`radcan(ratsimp(...))`), `ratsimp`, `fullratsimp`, `radcan`, `trigsimp`, `trigexpand`,
`trigreduce`, `factor`, `expand`, `logcontract`, `rootscontract`, `rectform`, `polarform`,
`demoivre`, `exponentialize`.

### `maxima_numeric`

`expression`, `mode` (`double` | `bfloat`, default `double`), `digits` (2–10000, default 32 for
`bfloat`). `bfloat` uses `block([fpprec: digits], bfloat(expr))`.

### `maxima_matrix`

`matrix` must be a `matrix(...)` expression.

| `operation`    | Maxima command                                |
| -------------- | --------------------------------------------- |
| `determinant`  | `determinant(M)`                              |
| `inverse`      | `invert(M)`                                   |
| `transpose`    | `transpose(M)`                                |
| `rank`         | `rank(M)`                                     |
| `trace`        | `block([m: M], sum(m[i,i], i, 1, length(m)))` |
| `eigenvalues`  | `eigenvalues(M)`                              |
| `eigenvectors` | `eigenvectors(M)`                             |
| `charpoly`     | `charpoly(M, variable)`                       |
| `adjoint`      | `adjoint(M)`                                  |
| `nullspace`    | `nullspace(M)`                                |

## Sessions

### `maxima_session_open`

Arguments: `session_id` (optional; random `ms_<hex>` when omitted), `name` (optional). Starts the
Maxima process immediately to validate the environment. Returns `created: true/false`.

### `maxima_session_list`

No arguments. Returns ids, names, timestamps, evaluation counts, liveness, PIDs, uptime, restart
counts, busy state and which session is the default.

### `maxima_session_close`

`session_id`. Terminates the process and removes the session. Closing an unknown session is a
no-op (`closed: false`).

### `maxima_session_reset`

`session_id`. Kills the process and creates a fresh one with the same id. All definitions and loaded
packages are discarded.

## Documentation

### `maxima_help`

| Argument           | Type       | Default  |
| ------------------ | ---------- | -------- |
| `symbol`           | string     | required |
| `include_examples` | boolean    | `true`   |
| `max_entries`      | 1–10       | `4`      |
| `max_chars`        | 200–100000 | `16000`  |

Returns formatted Markdown plus structured entries (kind, signature, description, examples,
categories, section, URI). Unknown names return `DOC_NOT_FOUND` with prefix/related suggestions.

### `maxima_search_docs`

`query`, `limit` (1–50, default 10), `type` (`symbol` | `section` | `all`, default `all`). BM25
results include type, name/title, section, snippet, score and resource URI.

### `maxima_examples`

`symbol`, `max_examples` (1–30, default 8). Returns manual example blocks as code.

### `maxima_doc_sections`

`filter` (substring), `limit` (1–500, default 200). Lists manual chapter/section files and titles.

### `maxima_doc_read`

`file` (for example `Integration.html`), `max_chars` (default 120000). Returns the full section text.

### `maxima_list_symbols`

`prefix`, `limit` (1–500, default 100). Lists documented symbols with kind.

### `maxima_doc_categories`

No arguments. Returns category names and entry counts.

## Source and packages

### `maxima_source`

`symbol`, `context_lines` (0–100, default 10), `max_results` (1–20, default 3). Returns definitions
with file, line, kind, language and numbered context.

### `maxima_search_source`

`query`, `regex` (default false), `case_sensitive` (default false), `limit` (1–200, default 50),
`context_lines` (0–10, default 2), `file_filter` (substring). Invalid regexes return
`VALIDATION_ERROR`.

### `maxima_list_source_files`

`filter`, `limit` (default 200). Lists indexed Lisp, `.mac` and demo files.

### `maxima_read_source_file`

`file` (relative path from the index), `max_chars` (default 100000). Paths are resolved against the
configured source roots; traversal is rejected.

### `maxima_list_packages`

`filter`, `limit` (default 200). Lists share packages with their `.mac` files.

### `maxima_package_load`

`package` (exact name from the package index), `session_id`, `timeout_ms` (default 180s, capped by
`MAXIMA_MCP_MAX_TIMEOUT_MS`). Executes `load("name")$` only after the name is validated against the
installed share tree. Large packages such as `draw` may compile on first use; the persistent
Maxima userdir keeps the compiled artifacts.

## Plotting

### `maxima_plot`

| Argument                    | Type            | Default         |
| --------------------------- | --------------- | --------------- |
| `expressions`               | string[] (1–12) | required        |
| `x_min`, `x_max`            | number          | required        |
| `y_min`, `y_max`            | number          | required for 3D |
| `kind`                      | `2d` \| `3d`    | `2d`            |
| `format`                    | `png` \| `svg`  | `png`           |
| `title`, `xlabel`, `ylabel` | string          | —               |
| `width`, `height`           | 100–4000        | 900×600         |
| `log_x`, `log_y`            | boolean         | `false`         |
| `grid`, `legend`            | boolean         | `true`          |
| `session_id`, `timeout_ms`  |                 |                 |

Returns a text summary plus an MCP `image` content block (`image/png` or `image/svg+xml`). The
structured result contains format, MIME type, byte size, duration, session id and Maxima output.

## System

### `maxima_system_info`

No arguments. Reports:

- server name/version, uptime, Node version, PID;
- Maxima binary, detected version, availability, limits, safe-mode state;
- session count, busy count, ids, default session;
- documentation and source index state/counts/load times;
- RSS and heap usage;
- configuration warnings.

Use `GET /readyz` for Kubernetes-style readiness and `GET /metrics` for Prometheus scraping.
