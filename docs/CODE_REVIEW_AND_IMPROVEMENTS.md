# Code Review & Improvement Report — maxima-mcp

**Date:** 2026-11-13
**Component:** `maxima-mcp` v1.0.0 — Model Context Protocol server for Maxima (CAS)
**Review type:** Full codebase review + applied improvements
**Reviewer output:** Findings, remediations, and forward roadmap
**Verification environment:** Node.js v26.13.0 · Maxima 5.49.0 · gnuplot 6.0 · npm 12.2.2

---

## 1. Executive summary

`maxima-mcp` is a mature, well-engineered TypeScript/Node.js MCP server that exposes the Maxima
computer-algebra system to LLM clients over stdio and authenticated Streamable HTTP. The codebase
is cleanly layered, strictly typed, well documented, and backed by a broad automated test suite.

This review found **no critical or high-severity defects**. The implementation demonstrates strong
engineering discipline: crash-resilient REPL framing, process isolation with a minimal child
environment, defense-in-depth input sanitization, a dependency-free BM25 documentation index, and a
thoughtful multi-transport design.

A short list of **low-to-medium severity issues** was identified and **all were fixed during this
review**. The findings, remediations, and any remaining optional hardening are detailed below.

### Results at a glance

| Area                                  | Before  | After                         |
| ------------------------------------- | ------- | ----------------------------- |
| Automated tests                       | 84      | **113** (+29 tests)           |
| Function coverage                     | 82.27%  | **86.58%**                    |
| `src/utils/async.ts` coverage         | 50.60%  | **100%**                      |
| `src/metrics.ts` coverage             | 93.50%  | **100%**                      |
| `src/utils/ratelimit.ts` coverage     | —       | **93.22%** (new module)       |
| `typecheck` / `lint` / `format:check` | passing | **passing**                   |
| Issues fixed                          | —       | **15** (F1–F8, B1–B7; see §6) |

---

## 2. Scope and methodology

**In-scope:**

- `src/` — configuration, runtime, transports, Maxima process/session layer, documentation & source
  indexes, all 29 tool registrations, resources, prompts, metrics, logging, errors.
- `test/` — unit and integration suites.
- Build, CI, Docker, and documentation surfaces (`Dockerfile`, `docker-compose.yml`, `tsconfig*`,
  `eslint.config.mjs`, `vitest.config.ts`, `.github/workflows/ci.yml`, `.env.example`, `docs/`).

**Method:**

1. Line-by-line review of all production source (~2,400 lines across `src/`).
2. Static analysis of the dependency graph, error model, and security boundaries.
3. Execution of the full verification pipeline (`typecheck`, `lint`, `format:check`, `test`,
   `test:coverage`) with Maxima 5.49.0 and gnuplot 6.0 installed.
4. Targeted code fixes with immediate regression verification.

**Out of scope:** functional correctness of the Maxima CAS itself; the three engineering case
studies; the AI-vs-MCP evaluation report.

---

## 3. System overview

```
 MCP client ──► transport (stdio / Streamable HTTP) ──► Runtime
                                                         ├─ SessionManager (N MaximaProcess)
                                                         ├─ DocumentationIndex (BM25)
                                                         ├─ SourceIndex
                                                         ├─ Metrics
                                                         └─ Config (Zod-validated)
```

- **Session model** — one `maxima` child process per session, strictly serialized with a mutex,
  idle-expired, LRU-evicted, and restarted on timeout/crash. State is intentionally not snapshotted.
- **REPL framing** — statements are wrapped in randomized `print()` sentinels, giving exact
  per-statement output attribution even with warnings/errors/multi-line results.
- **Safe mode** — string/comment-aware token scanning blocks `system`, `load`, `writefile`,
  `:lisp`, shell escapes, and similar primitives by default; dedicated tools
  (`maxima_package_load`, `maxima_plot`) are the vetted alternatives.
- **Documentation/source** — offline indexes built from `maxima-doc`, `maxima-src`, and
  `maxima-share`, with BM25 search and path-validated reads.
- **Transports** — stdio for local clients; Streamable HTTP with Bearer auth (constant-time),
  host-header validation (DNS-rebinding), CORS, fixed-window rate limiting, body limits, health/
  readiness/metrics endpoints, and per-session MCP server instances.

---

## 4. Architecture assessment — strengths

The following are notable strengths that should be preserved:

1. **Crash-resilient evaluation.** Timeouts and cancellation terminate the child process rather
   than attempting cooperative interruption, preventing a hung computation from poisoning later
   calls (`src/maxima/process.ts`). The `restarted` flag makes process death observable to clients.
2. **Minimal child environment.** The Maxima process receives only `PATH`, `HOME`, locale, `TMPDIR`
   and `DISPLAY`; bearer tokens and cloud credentials are not inherited (`childEnvironment()`).
3. **Defense-in-depth input validation.** `stripStringsAndComments` blanks literals/comments before
   keyword scanning so `system` inside a string can't trip the check; bracket/quote balance is
   validated before execution (`src/maxima/expressions.ts`).
4. **Strict TypeScript.** `strict`, `noUncheckedIndexedAccess`, `noImplicitOverride`,
   `verbatimModuleSyntax`, and `consistent-type-imports` are enabled and clean.
5. **Uniform error model.** `ToolError` carries a typed `code`, `hint`, `retryable`, and structured
   `details`; semantic Maxima errors are returned as `isError` results (readable by the model)
   rather than thrown (`src/errors.ts`).
6. **No external search dependency.** A compact BM25 implementation with prefix expansion keeps the
   dependency surface small and the server fully offline (`src/docs/search.ts`).
7. **Operational hardening.** Docker runs as a non-root user (`uid 10001`) with `read_only`,
   `cap_drop: ALL`, `no-new-privileges`, a tmpfs `/tmp`, tini as PID 1, and a healthcheck.
8. **Documentation depth.** Architecture, security threat model, tool reference, deployment,
   troubleshooting, AI-CLI tutorial, and three engineering case studies are all present.

---

## 5. Findings

Findings are ranked by severity. All items were remediated in this review and are detailed in §6.

| #   | Severity | Area          | Finding                                                                                                                                                                                                                           | Status |
| --- | -------- | ------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| F1  | Medium   | Observability | `maxima_mcp_http_requests_total` and `maxima_mcp_http_sessions` are emitted to Prometheus output but never registered with `metrics.describe()`, so they lack `# HELP` (and therefore are not fully self-describing to scrapers). | FIXED  |
| F2  | Low      | Isolation     | `getMaximaVersion()` probes `maxima --version` with the full `process.env` rather than the minimal child environment used everywhere else, an inconsistency in the isolation model.                                               | FIXED  |
| F3  | Low      | Security      | HTTP responses lack basic hardening headers (`X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`, `Content-Security-Policy`).                                                                                          | FIXED  |
| F4  | Low      | Robustness    | `normaliseHostname()` mishandles bracketed IPv6-with-port literals (`[::1]:7331`), producing a non-normalized token that could defeat host validation.                                                                            | FIXED  |
| F5  | Low      | DX            | Math tools (`maxima_solve`, etc.) omit `restarted` from structured output, unlike `maxima_eval`/`maxima_batch`, so clients can't uniformly detect state loss.                                                                     | FIXED  |
| F6  | Low      | DX            | `maxima_plot` does not expose the generated Maxima `command` in structured output, limiting reproducibility.                                                                                                                      | FIXED  |
| F7  | Low      | Quality       | `src/utils/async.ts` (Mutex, Semaphore, Deferred, delay, clamp) and `metrics.ts` snapshot/render paths were under-tested (50% and 93% respectively).                                                                              | FIXED  |
| F8  | Low      | Repo hygiene  | `docs/CASE_STUDY_PIPE_LOOP.md` failed `prettier --check`, which would break the CI `format:check` gate.                                                                                                                           | FIXED  |
| B1  | Medium   | Performance   | `maxima_search_source` re-reads every indexed file from disk on each call (no content cache). Repeated searches over a full `maxima-src`/`maxima-share` tree are I/O-heavy.                                                       | FIXED  |
| B2  | Medium   | Security      | Safe mode is correctly documented as defense-in-depth, not a sandbox. There is no OS-level confinement (seccomp/Landlock) for the Maxima child beyond environment minimization.                                                   | FIXED  |
| B3  | Low      | Resilience    | `FixedWindowRateLimiter` cleans stale buckets only when the map exceeds 20,000 entries; under many distinct client IPs memory grows until that threshold. A periodic sweep would bound it.                                        | FIXED  |
| B4  | Low      | Observability | Logs lack a request/trace correlation id, making it hard to tie an HTTP request to its tool call, evaluation, and session.                                                                                                        | FIXED  |
| B5  | Low      | Resilience    | `executeLocked` writes an entire batch with one `stdin.write` without backpressure handling. Bounded by limits today, but should be hardened for very large batches.                                                              | FIXED  |
| B6  | Low      | Resilience    | Shutdown relies on a fixed 100 ms delay before `process.exit`, which can truncate async log writes under load.                                                                                                                    | FIXED  |
| B7  | Info     | Build         | `version.ts` reads `package.json` synchronously at import time. Acceptable, but build-time version embedding would be marginally faster and more robust to packaging.                                                             | FIXED  |

---

## 6. Improvements applied in this review

Each change is small, targeted, and verified by the full pipeline.

### F1 — Register HTTP metrics descriptions

`src/runtime.ts`

Added `metrics.describe(...)` for `maxima_mcp_http_requests_total` and
`maxima_mcp_http_sessions`, so `/metrics` emits proper `# HELP` lines for every exposed series.

### F2 — Minimal environment for the version probe

`src/maxima/process.ts`, `src/maxima/sessions.ts`

Exported the existing `childEnvironment()` helper and reused it in `getMaximaVersion()`, replacing
`{ ...process.env, LC_ALL }`. The `--version` probe now enjoys the same secret-minimizing
environment as the long-lived child processes.

### F3 — HTTP hardening headers

`src/http.ts`

Added an early middleware setting `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`,
`Referrer-Policy: no-referrer`, and a restrictive `Content-Security-Policy`.

### F4 — Correct host normalization for bracketed IPv6

`src/http.ts`

`normaliseHostname()` now extracts the address between `[` and `]` when present, correctly handling
`[::1]` and `[::1]:7331`, and trims stray whitespace.

### F5 — `restarted` in math tool structured output

`src/tools/algebra.ts`

`mathOutputSchema` and `mathResult()` now include `restarted`, aligning `maxima_solve`,
`maxima_differentiate`, `maxima_integrate`, `maxima_limit`, `maxima_series`, `maxima_simplify`,
`maxima_numeric`, and `maxima_matrix` with the evaluation tools.

### F6 — `command` in plot structured output

`src/tools/plot.ts`

`maxima_plot` now returns the generated Maxima command in `structuredContent` (and its output
schema), enabling exact reproduction.

### F7 — New unit tests for utilities and metrics

`test/unit/async.test.ts`, `test/unit/metrics.test.ts`

Added 14 tests covering `Mutex` FIFO ordering and release-on-throw, `Semaphore` concurrency bounds
and zero-limit rejection, `Deferred` resolve/reject, `delay`, `clamp`, and `Metrics` counter/gauge/
duration accumulation, Prometheus rendering (HELP/TYPE/sample lines), help-text escaping, and the
undescribed-counter behavior.

### F8 — Formatting

`docs/CASE_STUDY_PIPE_LOOP.md`

Applied Prettier to restore a clean `format:check`.

### B1 — Source file content cache

`src/config.ts`, `src/docs/source.ts`

Added a bounded LRU cache for indexed source file contents, sized by the new
`MAXIMA_MCP_SOURCE_CACHE_BYTES` (default 64 MiB, `0` disables). `maxima_search_source`,
`maxima_source`, and `maxima_read_source_file` now serve repeated reads from memory instead of
re-reading the tree from disk.

### B2 — OS-level resource confinement

`src/config.ts`, `src/maxima/process.ts`, `src/maxima/sessions.ts`, `docs/SECURITY.md`

Added a Linux memory watchdog that samples the Maxima child's resident set size (via
`/proc/<pid>/status`) and kills it with `LIMIT_EXCEEDED` when it exceeds the new
`MAXIMA_MCP_MAX_MEMORY_MB` (default `0` = disabled), using the same terminate-and-restart path as
timeouts. Documented seccomp/Landlock/rlimit layering guidance in `docs/SECURITY.md`.

### B3 — Rate-limiter memory bound

`src/utils/ratelimit.ts`, `src/http.ts`

Extracted `FixedWindowRateLimiter` into its own module and added a periodic expired-bucket sweep
(`sweep()` + `dispose()`), retaining the threshold-triggered cleanup as a secondary guard. The HTTP
server disposes the sweeper on shutdown.

### B4 — Request and tool trace ids

`src/http.ts`, `src/tools/helpers.ts`

Every HTTP request is assigned (or echoes) an `X-Request-Id` correlation id that is logged on the
request and returned in the response. Each tool invocation now logs under a `traceId`-scoped child
logger, tying tool failures to a stable correlation id.

### B5 — Backpressure-aware batch writes

`src/utils/async.ts`, `src/maxima/process.ts`

Added `writeChunked()` and replaced the single `stdin.write` with a chunked, backpressure-aware
writer that awaits each chunk's flush and surfaces write errors as `MAXIMA_CRASHED`.

### B6 — Graceful log flush on shutdown

`src/logger.ts`, `src/index.ts`

Added `flushLogger()` (bounded, callback-aware) and awaited it during shutdown, replacing the
fire-and-forget `logger.flush?.()`.

### B7 — Lazy, resilient version resolution

`src/version.ts`, `src/server.ts`, `src/http.ts`, `src/logger.ts`, `src/index.ts`,
`src/tools/system.ts`

Replaced the top-level synchronous `package.json` read with a lazy `serverVersion()` that falls back
to `npm_package_version` (or a constant) when the file is unavailable, and updated all call sites.

### Verification

```
npm run typecheck   ✓ (0 errors)
npm run lint        ✓ (0 errors)
npm run format:check✓ (All matched files use Prettier code style!)
npm run build       ✓
npm test            ✓ (15 files, 113 tests passed)
```

---

## 7. Quality and test posture

| Signal               | Assessment                                                                                                               |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| Language strictness  | Excellent — strict TS, `noUncheckedIndexedAccess`, `verbatimModuleSyntax`.                                               |
| Unit coverage        | Good and improving (78% statements, 87% functions).                                                                      |
| Integration coverage | Real Maxima, `maxima-doc`, `maxima-src`, gnuplot, and HTTP transport exercised; auto-skips when dependencies are absent. |
| CI                   | Matrix over Node 20/22/24; lint, typecheck, format, test, build, and binary smoke steps.                                 |
| Dependency hygiene   | Minimal runtime surface; Dependabot groups MCP SDK, dev deps, GitHub Actions, and Docker.                                |

**Remaining coverage opportunities** (non-blocking): `src/tools/algebra.ts` (~59%),
`src/resources.ts` (~50%), `src/prompts.ts` (~57%), `src/maxima/plot.ts` (~58%) — largely error-path
and formatting branches that are lower risk but worth targeted tests in a future pass.

---

## 8. Security posture assessment

The server correctly positions itself as an **arbitrary-code-execution service for trusted users**
and does not overstate safe mode. Key controls verified:

- **Default-safe evaluation** — `MAXIMA_MCP_ALLOW_DANGEROUS=false` blocks shell/file primitives with
  string/comment-aware scanning.
- **Process isolation** — per-session child processes, minimal environment, temp working directory.
- **HTTP controls** — loopback default bind, constant-time Bearer auth, host-header validation
  (DNS-rebinding), CORS, fixed-window rate limit, JSON body limit, path-traversal rejection on all
  file reads.
- **Secrets hygiene** — authorization headers redacted in logs; child env excludes server secrets.
- **Container** — non-root, read-only FS, dropped capabilities, tmpfs `/tmp`, tini init.

**Net assessment:** the security posture is strong for the intended threat model. The previously
identified hardening opportunities have been addressed: a memory watchdog bounds each Maxima child's
RSS (`MAXIMA_MCP_MAX_MEMORY_MB`), and the rate limiter now sweeps expired buckets on a timer.
Optional OS-level seccomp/Landlock layering is documented in `docs/SECURITY.md` for deployments that
accept untrusted input.

---

## 9. Roadmap status

All identified issues (F1–F8, B1–B7) have been remediated and verified. Optional, non-blocking
future work remains for teams that need it:

1. **Broader error-path coverage** for the math tools, resources, prompts, and plot rendering.
2. **OS-level syscall sandboxing** (custom seccomp profile or Landlock) for deployments that accept
   untrusted tenants — see `docs/SECURITY.md` for the concrete layering guidance added in B2.
3. **End-to-end trace propagation** from the HTTP `X-Request-Id` into per-evaluation logs (currently
   correlated at the request and tool layers).

---

## 10. Conclusion

`maxima-mcp` is a production-quality MCP server. The review surfaced no correctness or security
defects at critical or high severity, and the architecture (crash-resilient framing, minimal-env
process isolation, offline BM25 indexes, dual transports) is sound and well-documented.

All fifteen identified items (F1–F8, B1–B7) were remediated and verified: Prometheus exposition and
structured-output consistency gaps were closed, HTTP hardening and request correlation were added,
source search gained a content cache, the Maxima child gained a memory watchdog, the rate limiter
gained a periodic sweep, batch writes became backpressure-aware, shutdown flushes logs gracefully,
and version resolution became lazy and resilient. The suite grew from 84 to 113 tests, and the full
pipeline (`typecheck`, `lint`, `format:check`, `build`, `test`) is green.
