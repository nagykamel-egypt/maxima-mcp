# Errors and recovery

The server converts expected failures into MCP `isError` results. The text body
normally has three parts:

```text
Error [CODE]: message
Hint: optional recovery hint
This error is retryable.
```

`CODE` is stable for the error class. Read the hint before changing the
expression. Do not retry blindly.

## Error codes

| Code                 | Meaning                                                                      | Retryable                   | First action                                                                   |
| -------------------- | ---------------------------------------------------------------------------- | --------------------------- | ------------------------------------------------------------------------------ |
| `BAD_REQUEST`        | Malformed MCP request or missing required data.                              | No                          | Fix the request shape; check tool name and arguments.                          |
| `VALIDATION_ERROR`   | Invalid expression, symbol, bounds, session ID, or argument relationship.    | No                          | Fix the input; focused tools take one expression and no `;`/`$`.               |
| `UNSAFE_EXPRESSION`  | Safe mode blocked a shell/file/unsafe primitive.                             | No                          | Use a dedicated tool or ask the administrator; do not bypass.                  |
| `LIMIT_EXCEEDED`     | Expression, batch, output, plot, or search limit exceeded.                   | No                          | Shorten, split, reduce size, or raise the configured limit.                    |
| `MAXIMA_NOT_FOUND`   | The Maxima binary cannot be executed.                                        | No                          | Install Maxima or set `MAXIMA_BIN`.                                            |
| `MAXIMA_ERROR`       | Maxima reported an error that the server recognized.                         | Sometimes                   | Read the output, check syntax/semantics, fix the expression.                   |
| `MAXIMA_TIMEOUT`     | Evaluation exceeded the timeout; the process was stopped and state was lost. | Yes, after reformulation    | Simplify, split, add assumptions, or raise `timeout_ms` deliberately.          |
| `MAXIMA_CRASHED`     | The Maxima process crashed or became unusable.                               | Yes, in a fresh session     | Re-run in a new session; reduce complexity; check system resources.            |
| `SESSION_NOT_FOUND`  | The requested session does not exist.                                        | No                          | Omit `session_id`, open it, or list sessions.                                  |
| `SESSION_LIMIT`      | Maximum sessions reached and all are busy.                                   | Yes, after freeing capacity | Close an idle session or wait; raise `MAXIMA_MCP_MAX_SESSIONS` if appropriate. |
| `SESSION_CLOSED`     | The session or server is shutting down.                                      | No                          | Open a new session after the server is available.                              |
| `SESSION_BUSY`       | Reset/close attempted while the session is evaluating.                       | Yes                         | Wait for the call to finish, cancel it, or use another session.                |
| `ABORTED`            | The client cancelled the call.                                               | Only if safe                | Check whether the operation is idempotent; retry if appropriate.               |
| `DOCS_UNAVAILABLE`   | Documentation index is disabled or unavailable.                              | No                          | Install `maxima-doc` or set `MAXIMA_MCP_DOC_DIR`; restart the server.          |
| `DOC_NOT_FOUND`      | The requested symbol or section was not found.                               | No                          | Search the manual; check spelling; list sections.                              |
| `SOURCE_UNAVAILABLE` | Source index is disabled or unavailable.                                     | No                          | Install `maxima-src`/`maxima-share` or set the directories.                    |
| `PACKAGE_NOT_FOUND`  | The requested share package is not installed or the name is invalid.         | No                          | List packages; use an exact name; install the package.                         |
| `PLOT_FAILED`        | Gnuplot did not produce a valid image.                                       | Sometimes                   | Install gnuplot, reduce dimensions, use finite ranges, check the expression.   |
| `INTERNAL_ERROR`     | Unexpected server failure.                                                   | Sometimes                   | Retry once; if it persists, check server logs and report the trace/request ID. |

## Retry policy

Retry only when all of the following are true:

1. The error is explicitly retryable or the operation is a pure read.
2. The retry will differ materially (new session, smaller scope, fixed input).
3. Repeating the operation cannot duplicate a side effect.

| Operation                                                        | Safe to retry as-is?             | Notes                                                               |
| ---------------------------------------------------------------- | -------------------------------- | ------------------------------------------------------------------- |
| `maxima_system_info`, `maxima_session_list`, manual/source reads | Yes                              | Pure reads.                                                         |
| `maxima_eval` with a pure expression                             | Usually                          | Maxima state may have changed after a restart.                      |
| `maxima_batch` with assignments                                  | No, not blindly                  | Re-running assignments may duplicate or overwrite state.            |
| `maxima_package_load`                                            | Usually, in a fresh session      | First load may have partially compiled; a fresh session is cleaner. |
| `maxima_session_reset`                                           | Yes, after `SESSION_BUSY` clears | Do not force while busy.                                            |
| `maxima_plot`                                                    | Usually                          | Re-render after fixing the cause.                                   |
| Any write/file/shell operation                                   | No                               | Not allowed in safe mode; do not attempt.                           |

## Recovery playbooks

### `MAXIMA_TIMEOUT`

Symptoms: text contains `Maxima did not finish within ...`, `restarted: true`,
and a hint to increase the timeout.

Do not immediately repeat with a larger timeout. First:

1. Reduce the expression or split the problem.
2. Add assumptions before parameterized integrals or limits.
3. Replace an infinite quadrature bound with a finite cutoff and a convergence
   check.
4. Use a simpler method or a numerical approximation with an explicit error.
5. Only then raise `timeout_ms`, within `maxima.max_timeout_ms`.

After a timeout, the process is restarted. Recreate variables, functions,
assumptions, and loaded packages.

### `MAXIMA_CRASHED` or repeated restarts

1. Call `maxima_system_info` and check memory, version, and warnings.
2. Open a fresh session.
3. Reproduce with a minimal expression.
4. Avoid huge expansions, deep recursion, or pathological symbolic integrals.
5. If the server is unstable for all inputs, check the host resources and the
   `MAXIMA_MCP_MAX_MEMORY_MB` watchdog configuration.
6. Report the failing expression and the server/Maxima versions.

### `UNSAFE_EXPRESSION`

The expression used a blocked symbol or pattern. Examples: `system`, `run`,
`load`, `writefile`, `read`, `:lisp`, `!` shell escape, `?` help, or gnuplot
output/preamble options.

Use:

- `maxima_package_load` to load an installed share package;
- `maxima_plot` to render a plot;
- `maxima_help`/`maxima_search_docs` for documentation;
- `maxima_source`/`maxima_read_source_file` for source inspection.

If the task genuinely requires a dangerous primitive, stop and ask the
administrator. Do not try to obfuscate the call.

### `VALIDATION_ERROR`

Common causes:

- a focused tool received `;` or `$`;
- an equation contains multiple statements;
- unbalanced parentheses, brackets, braces, or quotes;
- a variable is not a simple symbol;
- `lower` supplied without `upper` (or vice versa);
- numerical integration requested without both bounds;
- `matrix` does not start with `matrix(...)`;
- plot range invalid (`x_max <= x_min`, missing 3D `y` range);
- session ID contains invalid characters.

Fix the argument, then retry once.

### `LIMIT_EXCEEDED`

Common causes:

- expression over `MAXIMA_MCP_MAX_EXPRESSION_CHARS` (default 100 000);
- batch over `MAXIMA_MCP_MAX_COMMANDS` (default 50);
- output over `MAXIMA_MCP_MAX_OUTPUT_CHARS` (default 200 000) or
  `MAXIMA_MCP_MAX_OUTPUT_BYTES` (default 1 000 000);
- plot over `MAXIMA_MCP_MAX_PLOT_BYTES` (default 10 000 000);
- search limit above the tool's schema maximum.

Shorten, split, reduce the plot, or ask the administrator to raise the limit.
Do not silently drop terms to make it fit without telling the user.

### `SESSION_NOT_FOUND`, `SESSION_LIMIT`, `SESSION_BUSY`

- `SESSION_NOT_FOUND`: omit `session_id` to use the default, call
  `maxima_session_open`, or `maxima_session_list` to see existing IDs.
- `SESSION_LIMIT`: close an idle session with `maxima_session_close`, wait for a
  busy one, or raise `MAXIMA_MCP_MAX_SESSIONS`.
- `SESSION_BUSY`: a reset/close was attempted during evaluation. Wait or cancel
  the evaluation. Use a separate session for independent work.

### Documentation and source unavailable

If `DOCS_UNAVAILABLE`:

1. Install `maxima-doc` (Debian/Ubuntu: `sudo apt-get install maxima-doc`).
2. Or set `MAXIMA_MCP_DOC_DIR` to the HTML manual directory.
3. Restart the server; indexes are built at startup or on first use.
4. Check `maxima_system_info` → `docs.state`.

If `SOURCE_UNAVAILABLE`, install `maxima-src` and `maxima-share`, or set
`MAXIMA_MCP_SRC_DIR` and `MAXIMA_MCP_SHARE_DIR`.

### `PACKAGE_NOT_FOUND`

1. `maxima_list_packages` with a filter.
2. Use the exact package name.
3. Install the corresponding share package.
4. Load into the session that will use it.
5. Remember that a reset or restart loses the package.

### `PLOT_FAILED`

1. Confirm gnuplot is installed and works in a terminal.
2. Reduce width/height and the number of expressions.
3. Use finite ranges and positive data for log axes.
4. Remove `;`/`$` from expressions.
5. Check that the expression is defined in the session.
6. Verify 3D calls provide `y_min` and `y_max`.

### `ABORTED`

The client cancelled the request. State may be lost if the process was
interrupted. Check `maxima_session_list` and `restarts`; re-create state before
continuing. Retry only if the operation is safe to repeat.

## HTTP and transport errors

| Status                      | Meaning                                            | Action                                                                     |
| --------------------------- | -------------------------------------------------- | -------------------------------------------------------------------------- |
| `401 Unauthorized`          | Missing/invalid bearer token.                      | Send `Authorization: Bearer <token>`; check token rotation.                |
| `403 Forbidden`             | Host validation or CORS rejected the request.      | Add the host to `MAXIMA_MCP_ALLOWED_HOSTS`; fix `MAXIMA_MCP_CORS_ORIGINS`. |
| `404` on `/mcp`             | MCP session ID missing/expired, or wrong endpoint. | Initialize a new session; check `/mcp` path and `Mcp-Session-Id`.          |
| `413 Payload Too Large`     | Body exceeds `MAXIMA_MCP_BODY_LIMIT`.              | Split the request; raise the limit only if appropriate.                    |
| `429 Too Many Requests`     | Rate limit exceeded.                               | Back off; raise `MAXIMA_MCP_RATE_LIMIT` or widen the window if justified.  |
| `500 Internal Server Error` | Unhandled server error.                            | Retry once; check logs; report the request ID.                             |
| `503 Service Unavailable`   | `/readyz` reports Maxima unavailable.              | Install/repair Maxima or fix `MAXIMA_BIN`; restart.                        |

The server sets `X-Request-Id` on HTTP responses. Include it when reporting a
transport failure.

## Maxima text errors

The server flags common patterns (`incorrect syntax`, `Maxima encountered a Lisp
error`, `division by zero`, `Function ... not found`, `Package ... not found`,
`unknown option`, and similar). Some errors can emerge as ordinary output, so:

- read `output` and `warnings`;
- check for `debugmode(true)`;
- check for a returned noun form;
- run the minimal case again in a fresh session.

Common semantic errors and fixes:

| Output symptom                        | Likely cause                                       | Fix                                                    |
| ------------------------------------- | -------------------------------------------------- | ------------------------------------------------------ |
| `incorrect syntax`                    | Missing operator, unbalanced brackets, `2x`, `**`. | Use `2*x`, `^`, check brackets.                        |
| `Function ... not found`              | Typo or package not loaded.                        | `maxima_help`, `maxima_search_docs`, load the package. |
| `Package ... not found`               | Package not installed.                             | `maxima_list_packages`; install or choose another.     |
| `Division by zero`                    | Singular point or missing assumption.              | Exclude the point; use a limit.                        |
| `Is ... positive?` followed by a hang | Parameter sign unknown.                            | `assume(...)$` before the call.                        |
| Noun form `integrate(...)`            | No closed form found.                              | Keep the noun form, use quadrature, or reformulate.    |
| Empty `solve` list                    | No solution found by this method.                  | Verify independently; try another solver.              |
| `eigenvalues` output misread          | It is a nested list.                               | Parse as `[[values], [multiplicities]]`.               |
| `taylor` output has `...`             | Truncated series.                                  | State the order; do not treat as exact.                |
| `quad_qags` returns a noun form       | Infinite bound or invalid input.                   | Use finite bounds and convergence check.               |

## Reporting an unrecoverable failure

Include:

- tool name and arguments (redact secrets);
- exact error code and text;
- `X-Request-Id` for HTTP;
- server and Maxima versions from `maxima_system_info`;
- session ID and `restarted` flag;
- what you already tried;
- whether the failure is reproducible with a minimal expression.

Do not claim the task succeeded when the tool failed or the result was
inconclusive.
