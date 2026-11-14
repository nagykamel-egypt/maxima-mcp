# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project adheres to
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Portable `skills/maxima-mcp` agent skill: complete tool reference, workflows,
  Maxima language notes, verification protocol, error recovery, integration
  guide, enterprise operations guide, prompt pack, cookbook, validation script
  and stdio/HTTP smoke test. The skill ships in the npm package and is validated
  with `npm run skill:check` / `npm run skill:smoke`.
- Enterprise review report for the agent skill (`docs/SKILL_REVIEW.md`):
  review criteria, findings register, risk register, compliance checklist,
  verification evidence, remediation plan and acceptance decision.
- Applied the review's remediation items: tool-schema drift detection
  (`scripts/check-drift.mjs`), executable evaluation runner (`scripts/eval.mjs`),
  compatibility matrix and version-bump policy, per-client tool allowlists,
  localization plan, evaluation rubric anchors, a prompt-injection case, and a
  local-checkout stdio config variant.
- Added a Vitest test suite for the agent skill (`test/unit/skill.test.ts` and
  `test/integration/skill-scripts.test.ts`, 19 tests) covering structure,
  frontmatter, tool/resource/prompt coverage, link resolution, evaluation-case
  integrity, and the validate/drift/eval/smoke scripts over stdio and HTTP.
  Runnable with `npm run skill:test`.

## [1.0.0] - 2026-11-14

### Added

- Initial public release of the Maxima MCP server.
- Engineering case study: VAV supply-air duct system and fan selection for a mid-rise office floor,
  including ASHRAE 62.1 ventilation, Colebrook duct friction, ASHRAE 90.1 fan-power compliance,
  altitude correction, duct heat gain, fan/system operating points and part-load energy, with a
  runnable Maxima script and charts.
- Comparison report revision 1.1: added Case C and renumbered sections and appendices.
- Persistent, crash-resilient Maxima sessions with sentinel-framed output attribution, timeouts,
  cancellation, crash recovery, idle expiry and LRU eviction.
- 29 MCP tools:
  - evaluation: `maxima_eval`, `maxima_batch`;
  - mathematics: `maxima_solve`, `maxima_differentiate`, `maxima_integrate`, `maxima_limit`,
    `maxima_series`, `maxima_simplify`, `maxima_numeric`, `maxima_matrix`;
  - sessions: `maxima_session_open`, `maxima_session_list`, `maxima_session_close`,
    `maxima_session_reset`;
  - documentation: `maxima_help`, `maxima_search_docs`, `maxima_examples`,
    `maxima_list_symbols`, `maxima_doc_sections`, `maxima_doc_read`, `maxima_doc_categories`;
  - source/packages: `maxima_source`, `maxima_search_source`, `maxima_list_source_files`,
    `maxima_read_source_file`, `maxima_list_packages`, `maxima_package_load`;
  - plotting: `maxima_plot` (PNG/SVG, 2D/3D, MCP image content);
  - system: `maxima_system_info`.
- Offline HTML manual index with ~2,900 symbol entries, BM25 search, examples and categories.
- Offline source index over `maxima-src`/`maxima-share` with symbol lookup, regex search and package
  discovery.
- MCP resources for the manual, symbols, sections and source files.
- MCP prompts for problem solving, symbol explanation and debugging.
- stdio and authenticated Streamable HTTP transports.
- Bearer authentication, host validation, CORS, rate limiting, body limits and secure headers.
- Health, readiness, Prometheus metrics and structured JSON logging.
- Safe mode blocking shell and file-system primitives, with a minimal child environment.
- Zod-validated configuration with auto-detection of the newest installed Maxima tree.
- Dockerfile, Compose file, systemd example, nginx example and CI workflow.
- AI CLI integration tutorial and ready-to-copy configs for OpenCode, Claude Code, OpenAI Codex CLI,
  Gemini CLI, Cursor CLI, GitHub Copilot CLI and Crush.
- Engineering case study: preliminary design of a steel cantilever beam with symbolic derivation,
  section selection, design checks and Maxima-generated diagrams.
- 113 automated tests (unit and integration).

[1.0.0]: https://github.com/nagykamel-egypt/maxima-mcp/releases/tag/v1.0.0
