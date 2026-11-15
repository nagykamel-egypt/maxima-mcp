# Maxima MCP Agent Skill

A portable, production-oriented [Agent Skill](https://opencode.ai/docs/skills/)
for the [Maxima MCP server](https://github.com/nagykamel-egypt/maxima-mcp). It
works with any MCP-capable client that can load a `SKILL.md` file and call the
`maxima_*` tools.

<img src="assets/logo.svg" alt="maxima-mcp skill logo" width="120" />

## What it provides

- **Tool routing** for all 29 Maxima MCP tools, plus resources and prompts.
- **Operating discipline**: preflight, session strategy, input composition, and
  result interpretation.
- **Verification standards**: independent checks, tolerances, branch/domain
  handling, and evidence templates.
- **Error recovery**: every server error code, retry policy, and playbook.
- **Safety and enterprise controls**: safe mode, deployment, observability,
  governance, capacity, and runbooks.
- **Practical recipes**: copy-ready calls for calculus, algebra, matrices,
  numerics, plotting, debugging, and engineering analysis.
- **Validation and smoke-test scripts** with no extra dependencies, including a
  tool-schema drift check and an executable evaluation runner.
- **A Vitest test suite** (`test/unit/skill.test.ts` and
  `test/integration/skill-scripts.test.ts`) that asserts the skill's structure,
  coverage, and scripts.
- **Per-client tool allowlists** for least-privilege rollouts.

## Logo and brand assets

The mark is a geometric **M** built from three connected nodes, with a subtle
integral-sign watermark: Maxima, a computer algebra system, and the MCP network
in one glyph. It uses the project palette (cyan `#38BDF8`, teal `#2DD4BF`,
violet `#A78BFA`, deep navy `#070D18`).

| Asset                                                            | Use                                                           |
| ---------------------------------------------------------------- | ------------------------------------------------------------- |
| `assets/logo.svg`, `assets/logo.png`, `assets/logo-1024.png`     | Primary badge; dark background; works on any page background. |
| `assets/logo-wordmark.svg`, `assets/logo-wordmark.png`           | Horizontal lockup with dark text for light backgrounds.       |
| `assets/logo-wordmark-dark.svg`, `assets/logo-wordmark-dark.png` | Horizontal lockup with light text for dark backgrounds.       |
| `assets/logo-mono.svg`                                           | Single-color mark for light backgrounds.                      |
| `assets/logo-mono-light.svg`                                     | Single-color mark for dark backgrounds.                       |

Keep clear space around the badge equal to at least one quarter of its width.
Do not stretch, recolor the gradient, or place the primary badge on a
similarly-valued dark surface without the border.

## Layout

```text
skills/maxima-mcp/
├── SKILL.md                     # entry point and operating loop
├── references/
│   ├── tools.md                 # all 29 tools, resources, prompts
│   ├── workflows.md             # end-to-end procedures
│   ├── maxima-language.md       # syntax, function map, common traps
│   ├── verification.md          # independent checks and evidence
│   ├── errors.md                # error codes, retries, recovery
│   ├── cookbook.md              # copy-ready recipes and anti-patterns
│   ├── integration.md           # server/client/skill installation
│   ├── enterprise.md            # deployment, security, observability, governance
│   └── prompts.md               # system/task/report prompt templates
├── evals/
│   ├── README.md                # scoring rubric and how to run
│   ├── cases.json               # behavioural evaluation cases
│   └── example-results.jsonl    # passing fixture for the scorer self-test
├── scripts/
│   ├── validate.mjs             # validates the skill structure and links
│   ├── check-drift.mjs          # detects tool-schema drift vs src/tools
│   ├── smoke.mjs                # MCP stdio/HTTP smoke test
│   └── eval.mjs                 # eval runner (emit / score / self-test)
├── assets/
│   ├── logo.svg, logo.png, logo-1024.png              # primary badge
│   ├── logo-wordmark.svg, logo-wordmark.png          # light-background lockup
│   ├── logo-wordmark-dark.svg, logo-wordmark-dark.png # dark-background lockup
│   ├── logo-mono.svg, logo-mono-light.svg            # single-color marks
│   ├── mcp-stdio.json           # generic stdio config
│   ├── mcp-stdio-local.json     # local checkout variant (node + absolute path)
│   ├── mcp-http.json            # generic HTTP config
│   ├── tool-policies.md         # per-client allowed-tools overlays
│   └── AGENTS-snippet.md        # pointer for clients without a skill loader
├── LICENSE
└── README.md
```

## Quick start

1. Install and connect the Maxima MCP server. See
   [references/integration.md](references/integration.md).
2. Copy or symlink this directory into your client's skill location:

   ```bash
   # OpenCode, global
   mkdir -p ~/.config/opencode/skills
   ln -s "$PWD/skills/maxima-mcp" ~/.config/opencode/skills/maxima-mcp

   # Claude Code, project
   mkdir -p .claude/skills
   cp -R skills/maxima-mcp .claude/skills/
   ```

3. Restart the client and ask a math question. The agent should announce the
   skill, call `maxima_system_info`, and use the workflow.
4. Validate, check drift, and smoke-test:

   ```bash
   node skills/maxima-mcp/scripts/validate.mjs
   node skills/maxima-mcp/scripts/check-drift.mjs   # only in the repository
   node skills/maxima-mcp/scripts/eval.mjs self-test
   node skills/maxima-mcp/scripts/smoke.mjs --command "maxima-mcp"
   ```

5. Run the behavioural evaluation cases in
   [`evals/README.md`](evals/README.md) against your agent before rollout. Use
   `node skills/maxima-mcp/scripts/eval.mjs emit` to produce a run sheet and
   `node skills/maxima-mcp/scripts/eval.mjs score <results.jsonl>` to score it.

6. Run the automated test suite (from the repository root):

   ```bash
   npm run skill:test   # focused skill tests
   npm test             # full suite, including the skill tests
   ```

## Design contract

- `SKILL.md` stays short enough to load on every trigger; details live in
  `references/` and are loaded only when needed.
- Every claim about tool behavior is grounded in the server implementation in
  this repository.
- The skill never asks the agent to bypass safe mode or to fabricate output.
- The verification contract is explicit: a result is not "done" until an
  independent check or a clear limitation is stated.
- Behavioural evaluation cases make the trigger and rigour contract testable.
- The skill is client-neutral: no OpenCode-only or Claude-only syntax in the
  operating instructions.

## Review

The enterprise review report for this skill is at
[`docs/SKILL_REVIEW.md`](https://github.com/nagykamel-egypt/maxima-mcp/blob/main/docs/SKILL_REVIEW.md).
It records the review criteria, findings, risk register, compliance checklist,
and acceptance decision.

## Compatibility

### Compatibility matrix

| Skill version | Server version | Tool surface                       | Notes                                                        |
| ------------- | -------------- | ---------------------------------- | ------------------------------------------------------------ |
| 1.0.x         | 1.x            | 29 tools + 5 resources + 3 prompts | Target. Verified against `maxima-mcp` 1.0.0 / Maxima 5.49.0. |

The skill targets the `maxima-mcp` 1.x tool names. A server minor/patch release
that adds optional arguments or fixes behavior remains compatible; a release
that **renames, removes, or re-signatures** a tool is a breaking change and
requires a skill update. Run `scripts/check-drift.mjs` after any server change
to confirm the reference still matches the source schemas.

- Agent Skills frontmatter (`name`, `description`, optional `license`,
  `metadata`, `allowed-tools`).
- MCP stdio and Streamable HTTP transports.
- Works from any client that can load a `SKILL.md` and call MCP tools; if the
  client has no skill loader, use `assets/AGENTS-snippet.md` in its project
  instructions.

### Version-bump policy

Follow [Semantic Versioning](https://semver.org) for `metadata.version`:

- **Patch** (`1.0.x`): typo fixes, wording, link corrections, or non-behavioral
  additions that do not change instructions or checks.
- **Minor** (`1.x.0`): new reference, workflow, recipe, or evaluation case;
  added synonyms or overlays; improved verification or error guidance.
- **Major** (`x.0.0`): a change to the tool routing, the operating rules, the
  verification contract, or a move to an incompatible server version.

Every version change must pass `validate.mjs`, `check-drift.mjs`,
`eval.mjs self-test`, and a smoke test before being published.

## Localization

The skill is currently English-only. The controlled, imperative style in
`references/` is chosen to be easy to translate. The localization plan is:

1. Keep `SKILL.md` and `references/` as the English source of truth.
2. When a locale is required, ship a parallel `SKILL.<locale>.md` and
   `references/<locale>/` tree and let the client select by locale.
3. Keep tool names, code, error codes, and metric names untranslated; translate
   only prose and descriptions.
4. Update the evaluation cases with locale-specific prompts only when the
   translated skill is also re-validated against the same rubric.

Localization is deferred until a concrete enterprise demand exists.

## Maintenance

- Re-run `node scripts/validate.mjs` after edits.
- Re-run `node scripts/check-drift.mjs` after any server change (in the
  repository) to confirm the tool reference matches the source schemas.
- Re-run `node scripts/eval.mjs self-test` after editing the evaluation cases.
- Re-run `node scripts/smoke.mjs` against the target server version.
- Re-run `npm run skill:test` (or `npm test`) after changes to the skill or its
  scripts.
- Keep `metadata.version` aligned with meaningful content changes per the
  version-bump policy.
- Update `references/tools.md` when the server tool surface changes.
- Keep the report and verification templates stable; they are part of the
  contract.

## License

MIT. See the repository `LICENSE`.
