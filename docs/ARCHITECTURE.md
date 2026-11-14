# Architecture

## Overview

`maxima-mcp` is a TypeScript/Node.js process that speaks MCP over stdio or Streamable HTTP and
drives one or more persistent Maxima REPL processes.

```
                    ┌──────────────────────────────────────────────┐
 MCP client ───────►│ transport layer                              │
 (stdio/HTTP)       │  stdio.ts | http.ts (sessions, auth, metrics)│
                    └───────────────┬──────────────────────────────┘
                                    │ tool/resource/prompt calls
                    ┌───────────────▼──────────────────────────────┐
                    │ Runtime (one per server process)             │
                    │  SessionManager  DocumentationIndex          │
                    │  SourceIndex     Metrics      Config         │
                    └───────┬─────────────────────┬────────────────┘
                            │ framed commands     │ file reads
                    ┌───────▼───────┐     ┌───────▼────────────────┐
                    │ MaximaProcess │     │ maxima-doc HTML        │
                    │ (N sessions)  │     │ maxima-src / share     │
                    └───────┬───────┘     └────────────────────────┘
                            │ stdin/stdout
                    ┌───────▼───────┐
                    │ maxima binary │───► gnuplot (plots)
                    └───────────────┘
```

The runtime is shared by every MCP connection in one Node process. A single-server deployment
therefore shares the session pool between clients; HTTP sessions are protocol sessions, not Maxima
sessions.

## Maxima process layer

`src/maxima/process.ts` implements a crash-resilient REPL driver.

### Startup

```
maxima --very-quiet --disable-readline --userdir=<persistent userdir> [extra args]
```

Initialization:

1. `:lisp (setf *error-output* *standard-output*)` — routes Maxima/Lisp errors to stdout so they
   stay ordered with results.
2. `display2d:false$` — machine-readable one-dimensional output.
3. `ratprint:false$` — suppress rational-conversion spam.
4. `linel:10000$` — avoid aggressive line wrapping.
5. `MAXIMA_MCP_INIT` statements.

The child process receives a **minimal environment** (`PATH`, `HOME`, locale, `TMPDIR`, `DISPLAY`)
so bearer tokens and cloud credentials cannot be read with `getenv`. It runs in a temporary working
directory. The Maxima userdir is persistent (under the cache directory) so compiled share-package
artifacts survive restarts.

### Request framing

Each statement is wrapped in randomized sentinels printed by Maxima itself:

```
print("<<<MAXIMA_MCP_BEGIN:<nonce>:<index>>>")$
<normalized statement>
print("<<<MAXIMA_MCP_END:<nonce>:<index>>>")$
```

The runner writes the whole batch, then reads stdout until the final end sentinel. Splitting the
buffer on the per-statement markers yields exact output attribution, even when a statement prints
multi-line warnings, errors, or user output containing parentheses and prompts.

A per-request random nonce prevents collisions with user output. Markers and bare `(%iN)` prompts
emitted by a few Maxima functions are removed during cleanup.

### Failure handling

| Event                | Behavior                                                                    |
| -------------------- | --------------------------------------------------------------------------- |
| Timeout              | Kill process (`SIGTERM`, then `SIGKILL`), reject call, restart on next call |
| Abort signal         | Same as timeout, error code `ABORTED`                                       |
| Output limit         | Same, error code `LIMIT_EXCEEDED`                                           |
| Memory limit         | Same as output limit, error code `LIMIT_EXCEEDED` (Linux, when configured)  |
| Process exit         | Reject pending call; next call starts a new process                         |
| Missing binary       | `MAXIMA_NOT_FOUND` with install hint                                        |
| Initialization error | Fail session startup                                                        |

Process death is observable: every result carries `restarted`. Session metadata tracks restart
counts. No attempt is made to restore state, because Maxima has no portable state snapshot.

### Concurrency

Each `MaximaProcess` has a mutex, so statements within a session are strictly serialized. Different
sessions run in parallel. The session manager bounds the number of processes with
`MAXIMA_MCP_MAX_SESSIONS` and evicts the least-recently-used idle session when the limit is reached.
An idle reaper closes sessions after `MAXIMA_MCP_SESSION_IDLE_MS`.

## Documentation index

`src/docs/indexer.ts` builds an in-memory index from the GNU Texinfo HTML manual shipped by
`maxima-doc`:

1. Parse `Function-and-Variable-Index.html` to obtain ~2,900 index rows mapping symbol names to
   HTML files and anchors.
2. Parse each HTML file once with Cheerio, build an `id → node` map and extract:
   - kind (`Function`, `Variable`, `System variable`, `Option variable`, …),
   - signature,
   - description (example blocks stripped),
   - example blocks,
   - categories,
   - section title.
3. Build a file-level section index for resources and `maxima_doc_read`.

Indexing takes roughly 4–6 seconds and ~100–200 MB on a typical installation. It is lazy and
pre-warmed in the background by default (`MAXIMA_MCP_DOCS_PREWARM`). Tool calls wait for the build
to finish rather than returning partial results.

### Search

`src/docs/search.ts` is a dependency-free BM25 implementation:

- Tokenization is tuned for Maxima symbols (`%pi`, `x_1`, `+`, `*`).
- Postings are stored as flat `[documentIndex, termFrequency]` arrays for compactness.
- Prefix expansion over a sorted vocabulary handles plurals and morphological variants.
- Exact symbol-name matches, name prefixes and title matches receive large boosts.

The index contains both symbol entries and manual sections; callers can filter by result type.

## Source index

`src/docs/source.ts` walks `maxima-src` and `maxima-share` (max depth 5, files ≤ 8 MB) and indexes:

- Lisp definitions: `defmfun`, `defun`, `defmspec`, `defmvar`, `mdefprop`, `defprop`,
  `def-simplifier`, `define-compiler-macro`.
- Maxima definitions: `name(...) := ...`, `name[n](...) := ...`, `define_variable(...)`.

Symbol lookup returns file, line, definition kind and language; the reader returns numbered context
lines. Full-text search supports literal and JavaScript-regex matching with context. All paths are
resolved and checked against the configured roots before reading.

Share package discovery lists directories and top-level `.mac` files under the share tree. Package
loading accepts only exact names from this index, never arbitrary paths.

File contents are served from a bounded LRU cache (`MAXIMA_MCP_SOURCE_CACHE_BYTES`, default 64 MiB)
so repeated searches and definition reads do not re-read the source tree from disk.

## Plotting

`src/maxima/plot.ts` constructs a trusted `plot2d`/`plot3d` command with a temporary output path and
gnuplot terminal options. It validates ranges, dimensions, expressions and format, renders through
the caller's session, then verifies the file signature (PNG magic bytes or `<svg`) before returning
base64 image content. Temporary files are deleted in a `finally` block.

## Transports

### stdio

`src/index.ts` connects a single `McpServer` to `StdioServerTransport`. All logs are written to
stderr; stdout is reserved exclusively for JSON-RPC.

### Streamable HTTP

`src/http.ts` runs Express 5:

- One `McpServer` + `StreamableHTTPServerTransport` per MCP HTTP session, created on `initialize`.
- Sessions are keyed by `Mcp-Session-Id`, idle-expired and closed on `DELETE`.
- Bearer authentication (constant-time comparison), CORS, host-header validation, fixed-window rate
  limiting, JSON body limits and DNS-rebinding protection for loopback binds.
- `GET /healthz`, `GET /readyz`, `GET /metrics`, `GET /`.
- JSON responses can be selected with `MAXIMA_MCP_JSON_RESPONSE=true`; otherwise SSE streams are
  used.

## Error model

Tool failures are returned as MCP `isError` results with text of the form:

```
Error [CODE]: human-readable message
Hint: actionable next step
```

Codes include `VALIDATION_ERROR`, `UNSAFE_EXPRESSION`, `LIMIT_EXCEEDED`, `MAXIMA_NOT_FOUND`,
`MAXIMA_TIMEOUT`, `MAXIMA_CRASHED`, `SESSION_NOT_FOUND`, `DOCS_UNAVAILABLE`, `DOC_NOT_FOUND`,
`SOURCE_UNAVAILABLE`, `PACKAGE_NOT_FOUND`, `PLOT_FAILED` and `INTERNAL_ERROR`.

Semantic Maxima errors (division by zero, unsupported integral, syntax error) do not throw at the
tool boundary; they are returned with `isError: true` and the original Maxima text, so the model can
read and correct its input.

## Observability

Structured JSON logs (Pino) go to stderr. Metrics are exposed in Prometheus text format:

- `maxima_mcp_tool_calls_total{tool,status}`
- `maxima_mcp_tool_duration_milliseconds_{sum,count}{tool}`
- `maxima_mcp_evaluations_total{status}`
- `maxima_mcp_evaluation_duration_milliseconds_{sum,count}`
- `maxima_mcp_sessions`, `maxima_mcp_sessions_busy`
- `maxima_mcp_http_sessions`, `maxima_mcp_http_requests_total{method,status}`

`maxima_system_info` exposes the same state as a tool for clients that cannot scrape metrics.

## Extension points

- Add tools in `src/tools/<domain>.ts` and register them in `src/tools/index.ts`.
- Add resources in `src/resources.ts`.
- Add prompts in `src/prompts.ts`.
- New configuration belongs in `src/config.ts` with validation, documentation and tests.
- Keep tool handlers thin: validation and sanitization in the handler, execution in `maxima/`,
  indexing in `docs/`.
