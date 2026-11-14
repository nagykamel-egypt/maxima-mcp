# Troubleshooting

## First checks

```bash
node --version                 # must be >= 20.19
maxima --version
which maxima
ls /usr/share/doc/maxima-doc/html/index.html
ls /usr/share/maxima/*/src | head
gnuplot --version
```

Run the server directly to see structured startup logs on stderr:

```bash
MAXIMA_MCP_LOG_FORMAT=pretty MAXIMA_MCP_LOG_LEVEL=debug node dist/index.js
```

Validate configuration without a client:

```bash
node dist/index.js --version
node dist/index.js --help
```

## Maxima cannot be started

**`MAXIMA_NOT_FOUND`** or `Failed to start Maxima executable`.

1. Install Maxima (Debian/Ubuntu: `sudo apt-get install maxima`).
2. Confirm `maxima --version` works as the same user that runs the server.
3. If Maxima is not on `PATH`, set `MAXIMA_BIN=/absolute/path/to/maxima`.
4. In containers, remember the image must include Maxima; the Node base image does not.

## Documentation tools are unavailable

**`DOCS_UNAVAILABLE`**.

```bash
sudo apt-get install maxima-doc
ls /usr/share/doc/maxima-doc/html/index.html
```

If the manual is installed elsewhere:

```bash
export MAXIMA_MCP_DOC_DIR=/path/to/html
```

The directory must contain `index.html` and `Function-and-Variable-Index.html`. The first call may
take a few seconds while the index is built; prewarming happens in the background at startup.

## Source or package tools are unavailable

**`SOURCE_UNAVAILABLE`**, **`PACKAGE_NOT_FOUND`**.

```bash
sudo apt-get install maxima-src maxima-share
ls /usr/share/maxima/*/src
ls /usr/share/maxima/*/share
```

Set `MAXIMA_MCP_SRC_DIR` and `MAXIMA_MCP_SHARE_DIR` if you use a non-standard installation. The
server auto-detects the newest version directory under `/usr/share/maxima`.

## Evaluations time out

**`MAXIMA_TIMEOUT`**.

- Increase `timeout_ms` on the call (up to `MAXIMA_MCP_MAX_TIMEOUT_MS`, default 5 minutes).
- Simplify the expression, add assumptions, or use numerical methods
  (`maxima_integrate` with `numerical: true`).
- Remember that a timeout **kills the Maxima process** and all definitions in that session are lost.
  The next call reports `restarted: true`.
- `for` loops with huge ranges are usually a modeling mistake. Use symbolic operations where
  possible.

Check whether the same expression finishes in a terminal:

```bash
time maxima --very-quiet -q --batch-string='display2d:false$ integrate(1/(x^7+1), x)$'
```

## Output is truncated or the process is killed

- `MAXIMA_MCP_MAX_OUTPUT_CHARS` (default 200,000) truncates per-statement output.
- `MAXIMA_MCP_MAX_OUTPUT_BYTES` (default 1,000,000) kills the process before buffering unbounded
  output.
- Suppress large intermediate values with `$` and print only what you need.
- Use `maxima_numeric` for approximate values instead of printing enormous exact expressions.

## First package load is very slow

Share packages with Lisp components may compile on first use. This is especially visible with
`draw` on GCL builds and can take one to two minutes. The server uses a persistent Maxima userdir
(`MAXIMA_MCP_USERDIR`, default `<cache>/maxima-user`) so compiled artifacts survive sessions and
restarts. The default package-load timeout is 180 seconds. Increase `timeout_ms` or
`MAXIMA_MCP_MAX_TIMEOUT_MS` if needed.

If compilation fails, remove the cache directory and retry:

```bash
rm -rf ~/.cache/maxima-mcp/maxima-user
```

## Plotting fails

**`PLOT_FAILED`**.

1. Install gnuplot: `sudo apt-get install gnuplot`.
2. Verify Maxima can plot in a terminal:

   ```bash
   maxima --very-quiet -q --batch-string='plot2d(sin(x), [x,-5,5], [gnuplot_term,"png"], [gnuplot_out_file,"/tmp/test.png"]);'
   ```

3. Ensure the server process can write to the system temporary directory.
4. Check `MAXIMA_MCP_MAX_PLOT_BYTES` for large images.
5. Expressions must be in terms of `x` for 2D and `x`, `y` for 3D; use `maxima_plot`, not raw
   `plot2d` with output options in safe mode.

## HTTP problems

### 401 Unauthorized

Set the header on every MCP request:

```
Authorization: Bearer <MAXIMA_MCP_AUTH_TOKEN>
```

The MCP client configuration must include it (see `examples/http-client.json`).

### 403 Forbidden / `Host ... is not allowed`

Host-header validation is active. Either:

- connect using `127.0.0.1`/`localhost`, or
- add the public hostname: `MAXIMA_MCP_ALLOWED_HOSTS=mcp.example.com`.

### 404 Session not found or expired

MCP HTTP sessions are in memory and expire after `MAXIMA_MCP_HTTP_SESSION_IDLE_MS` (default 30
minutes). Reconnect/re-initialize the client. Restarting the server invalidates all HTTP sessions.

### 429 Rate limit exceeded

Raise `MAXIMA_MCP_RATE_LIMIT` or decrease client parallelism. Set it to `0` only behind a trusted
proxy that already limits traffic.

### 413 Request body too large

Increase `MAXIMA_MCP_BODY_LIMIT`, but prefer sending smaller expressions; the expression length limit
is independent.

## Sessions and state

- State is per `session_id`; calls without one use `default`.
- `maxima_session_reset` discards all definitions and loaded packages.
- Idle sessions expire and are evicted (LRU) when the session limit is reached.
- After a crash/timeout/cancellation, definitions are gone. Re-run setup commands in a batch.
- Use `maxima_session_list` to see PIDs, restarts and evaluation counts.

## Maxima syntax errors

Use `maxima_help`/`maxima_search_docs` instead of guessing. Common issues:

- Function arguments are comma-separated, and equations use `=` (not `==`).
- Assignment is `:`; `:=` defines functions.
- `$` suppresses output, `;` displays it.
- `%pi`, `%e`, `%i` are constants. Infinity is `inf`; negative infinity is `minf`.
- Matrices are `matrix([1,2],[3,4])`; element access is `M[1,2]`.
- Some functions require a package: `maxima_package_load` with `draw`, `distrib`, `combinatorics`,
  `to_poly_solve`, etc.

## MCP client shows no tools

- Ensure the client is configured for the correct transport (stdio vs HTTP).
- For stdio, run `node dist/index.js --version` manually and check stderr.
- Confirm the package is built (`npm run build`) and the path in the client config points at
  `dist/index.js`.
- Some clients cache the tool list; restart the client after upgrading.

## Tests fail locally

Integration tests skip automatically when Maxima, docs, source or gnuplot are missing. To run them:

```bash
sudo apt-get install maxima maxima-doc maxima-src maxima-share gnuplot
npm run test:integration
```

Unit tests are independent of Maxima:

```bash
npm run test:unit
```

## Reporting a bug

Include:

- server version (`node dist/index.js --version`),
- Maxima version (`maxima --version`),
- operating system and Node version,
- relevant tool arguments and the full error response,
- debug logs with `MAXIMA_MCP_LOG_LEVEL=debug` (remove secrets).

Security issues: follow `SECURITY.md` instead of opening a public issue.
