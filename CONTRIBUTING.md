# Contributing

Thanks for improving `maxima-mcp`.

## Development setup

```bash
git clone https://github.com/nagykamel-egypt/maxima-mcp.git
cd maxima-mcp
npm ci
```

Install the optional system dependencies for full integration testing:

```bash
# Debian/Ubuntu
sudo apt-get install maxima maxima-doc maxima-src maxima-share gnuplot
```

Build and run:

```bash
npm run build
MAXIMA_MCP_LOG_FORMAT=pretty node dist/index.js
```

## Quality gates

Every pull request must pass:

```bash
npm run typecheck
npm run lint
npm run format:check
npm test
npm run build
```

`npm test` runs unit tests plus integration tests that automatically skip when the relevant system
dependencies are absent.

## Project conventions

- TypeScript strict mode, ESM, NodeNext module resolution. Relative imports use `.js` extensions.
- Validation belongs in tool handlers; Maxima execution belongs in `src/maxima/`; indexing belongs
  in `src/docs/`.
- Never write to stdout in server code. stdout is reserved for MCP stdio framing; use the logger
  (`stderr`) instead.
- Return `ToolError` with an actionable `hint` for expected failures. Preserve Maxima's original
  error text for semantic math errors.
- New tools need: a clear title/description, a Zod input schema, annotations, an output schema when
  returning structured data, tests, and entries in `README.md`/`docs/TOOLS.md`.
- New configuration requires: a `MAXIMA_MCP_*` name, Zod validation, a safe default, docs in
  README and `.env.example`, and tests.
- Keep tool output bounded; respect `MAXIMA_MCP_MAX_OUTPUT_CHARS` and related limits.
- Do not weaken safe mode or child environment sanitization without a security review.

## Tests

- Unit tests live in `test/unit` and must not require Maxima.
- Integration tests live in `test/integration` and use the real `maxima` binary, documentation,
  source tree and gnuplot.
- Use `test/helpers.ts` to create isolated runtimes with temporary cache directories. Always close
  runtimes in `afterAll` so child processes and temporary directories are cleaned up.
- Tests run with `fileParallelism: false` because they spawn Maxima processes.

## Commit and PR guidelines

- Keep commits focused and describe behavior, not just files touched.
- Include a short test plan in the pull request.
- Update `CHANGELOG.md` for user-visible changes.
- Do not commit generated `dist/`, `node_modules/`, logs or secrets.

## Security

Report vulnerabilities privately as described in [`docs/SECURITY.md`](docs/SECURITY.md). Do not open
a public issue for an exploitable problem.

## License

Contributions are accepted under the MIT License.
