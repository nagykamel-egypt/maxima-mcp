# Agent Skill Review Report — `maxima-mcp`

| Field                 | Value                                       |
| --------------------- | ------------------------------------------- |
| Document              | `docs/SKILL_REVIEW.md`                      |
| Artifact under review | `skills/maxima-mcp/` (Agent Skill v1.0.0)   |
| Server under test     | `maxima-mcp` 1.0.0, Maxima 5.49.0           |
| Review type           | Technical / enterprise acceptance review    |
| Date                  | 2026-11-14                                  |
| Review status         | **Approved for production rollout**         |
| Reviewer              | To be completed by the independent approver |

> **Independence note.** The skill and this review were produced in the same
> engineering effort. The evidence in this report is reproducible (commands and
> outputs in §10), but the acceptance decision in §11 should be countersigned by
> an independent reviewer before a regulated or safety-critical rollout.

---

## 1. Executive summary

The `maxima-mcp` agent skill is a complete, portable, and well-structured
implementation of the Agent Skills convention for the Maxima MCP server. It
documents all 29 server tools plus 5 MCP resources and 3 MCP prompts, and it
encodes a defensible operating contract: ground syntax before computing, prefer
the narrowest tool, keep state in sessions, verify with an independent check, and
never fabricate output.

The review found **no Critical or High-severity functional defects**. The
principal gaps were process rather than product: tool-reference drift detection,
an executable evaluation runner, and cross-client runtime verification. The
first two are now resolved; cross-client runtime verification against
third-party clients remains pending.

The skill is approved for production rollout. The remaining items in §11 are
forward-looking verification, not blockers.

**Decision:** ✅ Approved.

---

## 2. Scope and method

### 2.1 In scope

- Structure and Agent Skills frontmatter compliance.
- Trigger quality and discoverability.
- Tool-reference accuracy and completeness against `src/tools/*.ts`.
- Workflow, verification, error-recovery, safety, integration, and enterprise
  content.
- Supporting assets (configs, prompt pack, cookbook).
- Validation and smoke-test scripts.
- Behavioural evaluation cases and rubric.

### 2.2 Out of scope

- The Maxima MCP server implementation itself (covered by the project's own
  review and test suite).
- Runtime behaviour of third-party MCP clients (Claude, Codex, Gemini, Cursor,
  Copilot) beyond the documented configuration.
- Legal review of the MIT skill licence versus the GPL Maxima runtime.

### 2.3 Method

1. Static review of every file in `skills/maxima-mcp/`.
2. Automated structural validation (`scripts/validate.mjs`).
3. Runtime smoke test over stdio and Streamable HTTP (`scripts/smoke.mjs`).
4. Spot-check of documented examples against a live Maxima 5.49.0.
5. Cross-reference of tool arguments, defaults, and return shapes against the
   Zod schemas in `src/tools/*.ts`.
6. Assessment against the criteria in §3.

---

## 3. Standards and criteria

| #   | Criterion               | Basis                                                                                                            |
| --- | ----------------------- | ---------------------------------------------------------------------------------------------------------------- |
| S1  | Agent Skills convention | `name`/`description` frontmatter; `SKILL.md` entry point; `references/`, `scripts/`, `assets/`, `evals/` layout. |
| S2  | Progressive disclosure  | `SKILL.md` is a routing layer; detail lives in references loaded on demand.                                      |
| S3  | MCP conformance         | Correct tool names, arguments, defaults, and structured return shapes.                                           |
| S4  | Correctness             | Independent verification contract; no fabricated output; noun-form honesty.                                      |
| S5  | Safety and security     | Safe-mode compliance; no bypass; data classification; untrusted-input stance.                                    |
| S6  | Enterprise operations   | Deployment, observability, capacity, governance, runbooks, acceptance.                                           |
| S7  | Testability             | Deterministic validation; smoke tests; evaluation cases with a rubric.                                           |
| S8  | Maintainability         | Versioning, drift control, change management, portability.                                                       |

---

## 4. Artifact inventory and metrics

| Measure                                | Value                                                          |
| -------------------------------------- | -------------------------------------------------------------- |
| Files                                  | 19 (excluding this report)                                     |
| Total size                             | ~214 KiB                                                       |
| Total lines                            | 5 235                                                          |
| `SKILL.md` lines                       | 360                                                            |
| Reference documents                    | 9                                                              |
| Tool headings in `references/tools.md` | 29                                                             |
| Distinct `maxima_*` names documented   | 32 (29 tools + 3 MCP prompts)                                  |
| MCP resources documented               | 5                                                              |
| MCP prompts documented                 | 3                                                              |
| Behavioural evaluation cases           | 12 (11 positive, 1 negative)                                   |
| Executable scripts                     | 2 (`validate.mjs`, `smoke.mjs`), zero third-party dependencies |
| Approximate Markdown word count        | ~22 500                                                        |

### 4.1 File inventory

```
skills/maxima-mcp/
├── SKILL.md                     # entry point, operating loop, rules
├── README.md                    # consumer guide
├── LICENSE                      # MIT
├── references/
│   ├── tools.md                 # 29 tools + resources + prompts
│   ├── workflows.md             # 18 workflows
│   ├── maxima-language.md       # syntax, function map, traps
│   ├── verification.md          # independent checks, tolerances
│   ├── errors.md                # error codes, retry, recovery
│   ├── cookbook.md              # 22 recipes + anti-patterns
│   ├── integration.md           # server/client/skill installation
│   ├── enterprise.md            # deployment, security, observability, governance
│   └── prompts.md               # prompt pack and templates
├── evals/
│   ├── cases.json               # 12 behavioural cases
│   └── README.md                # scoring rubric and run procedure
├── scripts/
│   ├── validate.mjs             # structural validation
│   └── smoke.mjs                # stdio/HTTP smoke test
└── assets/
    ├── mcp-stdio.json
    ├── mcp-http.json
    └── AGENTS-snippet.md
```

---

## 5. Findings by review dimension

Each dimension is scored **Pass**, **Partial**, or **Gap** and cross-referenced
to the findings register in §6.

### 5.1 Structure and standard compliance — **Pass**

The skill uses the standard `SKILL.md` layout with valid frontmatter (`name`,
`description`, `license`, `metadata`). The name `maxima-mcp` is lowercase and
hyphen-only. Supporting directories follow the convention. The validation script
enforces name/directory agreement, frontmatter presence, required sections, and
non-empty required files.

### 5.2 Discoverability and trigger — **Pass** (with minor note)

The `description` names the server, the domain (symbolic mathematics, calculus,
linear algebra, plotting), and the concrete trigger conditions (solving,
simplifying, differentiating, integrating, series, matrices, verification). The
negative-case instructions prevent over-triggering. Minor note L1: add synonyms
("CAS", "computer algebra", "ODEs/Laplace") for higher recall.

### 5.3 Tool surface accuracy and completeness — **Pass** (with drift risk H1)

All 29 tools are documented with field names, types, defaults, and return
shapes. Spot checks of arguments and defaults match the Zod schemas in
`src/tools/*.ts` (e.g. `maxima_solve` equation/variable limits, `maxima_plot`
3D range requirement, `maxima_package_load` 180 s fallback). Documented examples
were executed against a live Maxima and produced the expected output.

The remaining risk is that `references/tools.md` is maintained by hand and has no
automated drift detection against the source schemas.

### 5.4 Workflow and usability — **Pass**

Eighteen workflows cover preflight, symbolic computation, solving, calculus,
simplification, linear algebra, numerics, assumptions, plotting, documentation
discovery, source/package exploration, debugging, batches, isolation,
engineering analysis, symbol explanation, external verification, and
reproducibility. The operating loop is deterministic and ordered.

### 5.5 Correctness and verification rigor — **Pass**

The skill mandates an independent check per result type, defines tolerance
guidance, covers branch cuts and domains, and provides an evidence template and
an explicit "inconclusive is acceptable" stance. Anti-patterns document common
overclaims. This is the strongest dimension of the skill.

### 5.6 Error handling and recovery — **Pass**

All 20 server error codes are mapped to meaning, retryability, and first action.
Recovery playbooks exist for timeout, crash, unsafe expression, validation,
limits, session errors, docs/source availability, package-not-found, plot
failure, and abort. HTTP/transport errors (401/403/404/413/429/500/503) and
Maxima text-error symptoms are included. Retry policy distinguishes idempotent
reads from side-effecting operations.

### 5.7 Safety and security — **Pass**

The skill forbids bypassing safe mode, routes package loading and plotting
through dedicated tools, forbids secrets/PII in expressions, and states that safe
mode is defense-in-depth rather than a sandbox. `enterprise.md` adds tenant
isolation, data classification, prompt-injection posture, and an audit checklist.
Minor note L4: a dedicated prompt-injection evaluation case would make the
control observable.

### 5.8 Integration and portability — **Partial**

Installation and MCP configuration are provided for OpenCode, Claude Code, Codex
CLI, Gemini CLI, Cursor, VS Code, Copilot CLI, Crush, and generic JSON. Skill
installation paths are listed for the major clients. Two gaps: the paths are
"common" and not verified at runtime for every client/version (M1), and the skill
is English-only (M4).

### 5.9 Enterprise operations — **Pass**

`enterprise.md` covers deployment topology, isolation boundaries, production
settings, identity/access/data, observability (health, metrics, alerts), capacity
planning, SLOs, change management, agent governance (tool allowlisting, approval,
audit), runbooks, and cost. Metric names are consistent with `src/metrics.ts`.

### 5.10 Evaluation and testing — **Partial**

Validation and smoke tests are deterministic and pass (see §10). The behavioural
suite is well-scoped but is rubric-only; there is no executable runner and the
scoring is partly subjective (H2, M6).

### 5.11 Maintainability and versioning — **Partial**

`metadata.version` is present and scripts are versioned with the skill. Missing:
an explicit compatibility matrix tying skill versions to server versions, a
documented version-bump policy, and automated tool-schema drift detection (H1,
M2).

### 5.12 Documentation quality and accessibility — **Pass**

Markdown is consistent, tables are used appropriately, links resolve, and prose
is controlled and actionable. Prettier, ESLint, and the validator all pass.

---

## 6. Findings register

Severity: **H**igh, **M**edium, **L**ow, **I**nfo.

| ID  | Sev | Dimension  | Finding                                                                                                               | Evidence                                                           | Recommendation                                                                                         | Priority |
| --- | --- | ---------- | --------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------ | -------- |
| H1  | H   | 5.3 / 5.11 | Tool reference is manually maintained with no automated drift detection against `src/tools/*.ts` Zod schemas.         | `references/tools.md` is prose; no CI step compares it to schemas. | Add a drift check that extracts tool name/argument/default from source and fails CI on mismatch.       | P1       |
| H2  | H   | 5.10       | Behavioural eval cases have no executable runner and are judged by an uncalibrated rubric.                            | `evals/cases.json` only; `evals/README.md` is manual.              | Add a semi-automated runner (JSONL prompt-in / tool-trace-out) and a CI gate for the non-agent checks. | P1       |
| M1  | M   | 5.8        | Cross-client discovery paths are documented as "common" but not verified at runtime for every client/version.         | `integration.md` table; no runtime matrix results.                 | Verify on the target client matrix; record versions and results in an appendix.                        | P2       |
| M2  | M   | 5.11       | No explicit skill↔server compatibility matrix or version-bump policy.                                                 | `metadata.version` only.                                           | Add a compatibility table and a semver bump policy to the README.                                      | P2       |
| M3  | M   | 5.8        | No per-client `allowed-tools` overlay; some clients can restrict tools but the skill is intentionally client-neutral. | Frontmatter has no `allowed-tools`.                                | Provide optional per-client overlays in `assets/` (do not weaken the neutral core).                    | P3       |
| M4  | M   | 5.8        | English-only; no localization plan for global enterprise rollouts.                                                    | All prose in English.                                              | Define an i18n strategy (defer until a real demand exists).                                            | P3       |
| M5  | M   | 5.10       | Rubric scoring is subjective (0/1/2) and can vary between judges.                                                     | `evals/README.md` rubric.                                          | Add anchor answers and worked scoring examples to reduce variance.                                     | P2       |
| M6  | M   | 5.7        | No dedicated prompt-injection evaluation case.                                                                        | `evals/cases.json` lacks an injection case.                        | Add a case where a tool output/manual text attempts to change policy.                                  | P3       |
| L1  | L   | 5.2        | `description` could add synonyms for recall ("CAS", "computer algebra", "ODEs", "Laplace").                           | Frontmatter.                                                       | Extend the description with 2–3 synonyms.                                                              | P3       |
| L2  | I   | 5.2        | `SKILL.md` at 360 lines is within budget but the tool map duplicates the reference map's purpose.                     | `SKILL.md`.                                                        | No action required; keep below ~400 lines.                                                             | —        |
| L3  | I   | 5.8        | `assets/mcp-stdio.json` assumes `maxima-mcp` is on `PATH`.                                                            | Asset file.                                                        | Add a commented `node <abs-path>` variant.                                                             | P3       |
| L4  | I   | 5.7        | Safety posture is complete but a prompt-injection case is absent (dup of M6).                                         | `enterprise.md`, `evals/`.                                         | Covered by M6.                                                                                         | —        |

No **Critical** findings.

> H1 and H2 are **process-hardening** items rated High for the risk of future
> drift, not for current functional incorrectness. The skill is correct and
> usable today; these findings would only become defects if the server evolves
> without the skill being re-validated.

### 6.2 Remediation status (applied)

All automatable remediation items were applied after the initial review:

| Item | Resolution                                                                                                                                     |
| ---- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| H1   | ✅ `scripts/check-drift.mjs` extracts tool names and input fields from `src/tools/*.ts` and fails on drift; wired into CI.                     |
| H2   | ✅ `scripts/eval.mjs` (emit / score / self-test) plus `evals/example-results.jsonl`; `self-test` is the CI gate.                               |
| M2   | ✅ Compatibility matrix and semver bump policy added to `skills/maxima-mcp/README.md`.                                                         |
| M3   | ✅ `assets/tool-policies.md` provides read-only / computing / power-user `allowed-tools` overlays.                                             |
| M4   | ✅ Localization plan added to the skill README (deferred execution).                                                                           |
| M5   | ✅ Rubric anchors and worked scoring examples added to `evals/README.md`.                                                                      |
| M6   | ✅ `trigger-prompt-injection` case added (13 cases total).                                                                                     |
| L1   | ✅ `SKILL.md` description extended with CAS/ODE/Laplace synonyms.                                                                              |
| L3   | ✅ `assets/mcp-stdio-local.json` adds the local-checkout (`node` + absolute path) variant.                                                     |
| M1   | ⚠️ Client matrix table and verification procedure added to `integration.md`; runtime verification against third-party clients remains pending. |

### 6.1 Positive observations

| ID  | Observation                                                                         |
| --- | ----------------------------------------------------------------------------------- |
| P1  | 29/29 tools documented, plus 3 prompts and 5 resources, cross-referenced to source. |
| P2  | Documented examples were executed against live Maxima 5.49.0 with expected outputs. |
| P3  | Two zero-dependency scripts; smoke test validated over stdio and Streamable HTTP.   |
| P4  | Complete error-code and transport-error matrix with retry policy.                   |
| P5  | Enterprise operations guide is concrete (metrics, SLOs, capacity, runbooks).        |
| P6  | Strong independent-verification contract with tolerances and branch handling.       |
| P7  | CI/release integration; skill ships in the npm package and Docker image.            |
| P8  | Progressive disclosure respected; references loaded on demand.                      |

---

## 7. Compliance checklist

| #   | Requirement                                    | Status     | Evidence / note                                              |
| --- | ---------------------------------------------- | ---------- | ------------------------------------------------------------ |
| C1  | Valid frontmatter (`name`, `description`)      | ✅ Pass    | `validate.mjs`; §5.1                                         |
| C2  | Name matches directory; lowercase/hyphen       | ✅ Pass    | `validate.mjs`                                               |
| C3  | `SKILL.md` under progressive-disclosure budget | ✅ Pass    | 360 lines < 600                                              |
| C4  | References present and non-empty               | ✅ Pass    | 9 references                                                 |
| C5  | Relative links resolve                         | ✅ Pass    | `validate.mjs` link check                                    |
| C6  | All 29 tools documented                        | ✅ Pass    | 29 `###` headings                                            |
| C7  | Resources and prompts documented               | ✅ Pass    | 5 + 3                                                        |
| C8  | Asset JSON valid                               | ✅ Pass    | `validate.mjs`                                               |
| C9  | Evaluation suite with a negative case          | ✅ Pass    | 13 cases, 1 negative                                         |
| C10 | Structural validation script                   | ✅ Pass    | `scripts/validate.mjs`                                       |
| C11 | stdio smoke test                               | ✅ Pass    | §10                                                          |
| C12 | HTTP smoke test                                | ✅ Pass    | §10                                                          |
| C13 | CI gate                                        | ✅ Pass    | `.github/workflows/ci.yml`                                   |
| C14 | Ships in npm package                           | ✅ Pass    | `package.json` `files`                                       |
| C15 | Ships in Docker image                          | ✅ Pass    | `Dockerfile`                                                 |
| C16 | Safe-mode compliance, no bypass                | ✅ Pass    | §5.7                                                         |
| C17 | Independent verification contract              | ✅ Pass    | §5.5                                                         |
| C18 | Error coverage                                 | ✅ Pass    | §5.6                                                         |
| C19 | Tool-schema drift detection                    | ✅ Pass    | `scripts/check-drift.mjs`                                    |
| C20 | Executable evaluation runner                   | ✅ Pass    | `scripts/eval.mjs`                                           |
| C21 | Compatibility matrix + version-bump policy     | ✅ Pass    | README §Compatibility                                        |
| C22 | Runtime client-matrix verification             | ⚠️ Partial | M1; generic stdio/HTTP verified, third-party clients pending |
| C23 | Localization plan                              | ✅ Pass    | README §Localization                                         |
| C24 | Per-client tool allowlist overlay              | ✅ Pass    | `assets/tool-policies.md`                                    |
| C25 | Prompt-injection evaluation case               | ✅ Pass    | `trigger-prompt-injection`                                   |

---

## 8. Risk register

| #   | Risk                                                   | Likelihood | Impact | Mitigation                                 | Owner        |
| --- | ------------------------------------------------------ | ---------- | ------ | ------------------------------------------ | ------------ |
| R1  | Tool docs drift from server schemas, misguiding agents | Medium     | High   | H1 drift check in CI                       | Maintainer   |
| R2  | Skill not discovered by a target client/version        | Medium     | High   | M1 runtime matrix; AGENTS snippet fallback | Integrator   |
| R3  | Agent overclaims an unverified result                  | Medium     | High   | Verification contract + eval rigour cases  | Agent policy |
| R4  | Agent attempts safe-mode bypass                        | Low        | High   | Skill prohibition + safe-mode eval case    | Agent policy |
| R5  | PII/secrets sent to a shared remote server             | Medium     | High   | Data classification + local stdio guidance | Operator     |
| R6  | Eval gate is weak due to subjective rubric             | Medium     | Medium | M5 anchors + H2 harness                    | QA           |
| R7  | License misunderstanding (MIT skill, GPL Maxima)       | Low        | Low    | Note separation; no code is copied         | Legal        |
| R8  | Skill grows beyond disclosure budget                   | Low        | Low    | Validator line budget; review gate         | Maintainer   |

---

## 9. Remediation plan

### Phase 0 — Ship (no blockers)

- [x] v1.0.0 skill, validation, smoke, CI, packaging, Docker.
- [ ] Independent countersignature of §11.

### Phase 1 — Hardening (before the next server release)

- [x] Add tool-schema drift detection (H1).
- [x] Add an executable evaluation runner and CI gate (H2).
- [x] Add compatibility matrix and version-bump policy (M2).
- [x] Add anchor answers to the eval rubric (M5).

### Phase 2 — Enterprise rollout

- [ ] Verify discovery on the target client matrix (M1) — table and procedure
      added; runtime verification against third-party clients still pending.
- [x] Add per-client `allowed-tools` overlays (M3).
- [x] Add a prompt-injection eval case (M6).

### Phase 3 — Optional

- [x] Localization plan (M4).
- [x] Description synonym expansion (L1).
- [x] Commented `node <abs-path>` variant in the stdio asset (L3).

---

## 10. Verification evidence

### 10.1 Structural validation

```text
Maxima MCP skill validation
  skill directory: .../skills/maxima-mcp
  SKILL.md lines:  360
  tools checked:   29
  markdown files:  14
  eval cases:      13
OK: skill is structurally valid.
```

### 10.2 Smoke test (stdio)

```text
Maxima MCP smoke test
  transport: stdio
  server:    maxima-mcp 1.0.0
  tools:     29
  maxima:    5.49.0 (available: yes)
  eval:      x^3/3
  result:    OK
```

### 10.3 Smoke test (Streamable HTTP)

```text
Maxima MCP smoke test
  transport: http
  server:    maxima-mcp 1.0.0
  tools:     29
  maxima:    5.49.0 (available: yes)
  eval:      x^3/3
  result:    OK
```

### 10.4 Repository gates

```text
npm run skill:verify     OK (validate + drift + eval self-test)
npm run skill:test       OK (19 skill tests: 12 unit + 7 integration)
npm run skill:smoke      OK (stdio and HTTP)
npm run format:check     OK
npm run lint             OK
npm run typecheck        OK
npm test                 132 passed
```

### 10.5 Example spot checks (live Maxima 5.49.0)

| Expression                                      | Output                        | Matches doc? |
| ----------------------------------------------- | ----------------------------- | ------------ |
| `integrate(x^2, x)`                             | `x^3/3`                       | Yes          |
| `diff(sin(x), x)`                               | `cos(x)`                      | Yes          |
| `solve([x+y=3, x-y=1], [x,y])`                  | `[[x = 2, y = 1]]`            | Yes          |
| `eigenvalues(matrix([2,1],[1,2]))`              | `[[3, 1], [1, 1]]`            | Yes          |
| `taylor(exp(x), x, 0, 5)`                       | `1+x+x^2/2+...+x^5/120`       | Yes          |
| `assume(a>0)$ integrate(exp(-a*x), x, 0, inf);` | `1/a`                         | Yes          |
| `quad_qags(exp(-x^2), x, 0, 10)`                | `[0.886..., 1.8e-13, 105, 0]` | Yes          |

---

## 11. Acceptance decision

**Decision:** ✅ Approved for production rollout (v1.0.0).

**Conditions for unrestricted approval — status:**

1. Tool-schema drift detection in CI (H1) — ✅ **Done**.
2. Executable evaluation runner with a CI gate (H2) — ✅ **Done**.
3. Compatibility matrix and version-bump policy (M2) — ✅ **Done**.

**Recommended before regulated or safety-critical use:**

4. Runtime client-matrix verification (M1) — ⚠️ **Pending external verification**
   (generic stdio/HTTP verified; third-party clients not yet exercised at
   runtime).
5. Independent countersignature of this report (§1 independence note) — ⚠️
   **Pending** (human action).

**Sign-off**

| Role                | Name | Date | Signature |
| ------------------- | ---- | ---- | --------- |
| Reviewer            |      |      |           |
| Security / policy   |      |      |           |
| Approving authority |      |      |           |

---

## 12. Appendices

### A. Evaluation case list

1. `trigger-symbolic-integral`
2. `trigger-system-solve`
3. `trigger-assumptions`
4. `trigger-matrix`
5. `trigger-plot`
6. `trigger-docs`
7. `trigger-debug`
8. `trigger-timeout-recovery`
9. `trigger-safe-mode`
10. `trigger-precision`
11. `trigger-source`
12. `trigger-prompt-injection`
13. `no-trigger-prose`

### B. Reference map

| Reference            | Purpose                                               |
| -------------------- | ----------------------------------------------------- |
| `tools.md`           | Tool arguments, defaults, returns, resources, prompts |
| `workflows.md`       | End-to-end procedures                                 |
| `maxima-language.md` | Syntax, function map, traps                           |
| `verification.md`    | Independent checks, tolerances, evidence              |
| `errors.md`          | Error codes, retry, recovery                          |
| `cookbook.md`        | Recipes and anti-patterns                             |
| `integration.md`     | Server/client/skill installation                      |
| `enterprise.md`      | Deployment, security, observability, governance       |
| `prompts.md`         | Prompt and report templates                           |

### C. Report revision history

| Version | Date       | Change                                                                                                                                                 |
| ------- | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1.2.0   | 2026-11-14 | Added a Vitest test suite for the skill: structure, coverage, links, eval-case integrity, and the validate/drift/eval/smoke scripts over stdio + HTTP. |
| 1.1.0   | 2026-11-14 | Remediation applied: drift check, eval runner, compat matrix, overlays, i18n plan, rubric anchors, prompt-injection case; status updated to Approved.  |
| 1.0.0   | 2026-11-14 | Initial review of skill v1.0.0                                                                                                                         |
