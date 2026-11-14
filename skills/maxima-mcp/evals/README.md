# Skill evaluation cases

These cases test whether an agent actually follows the skill, not whether it can
produce a fluent paragraph. Run them against any agent that has the Maxima MCP
server connected and this skill installed.

## What to record

For each case, capture the agent's tool trace and final answer:

- Did it load or announce the skill? (`expect_skill`)
- Which tools did it call? (`required_tools`)
- Did it perform the independent check? (`required_checks`)
- Did it invent output, bypass safe mode, or hide a limitation?
- Did it state assumptions, domain, precision, and tolerances?

Score each case on three dimensions:

| Dimension | 0                            | 1                               | 2                                           |
| --------- | ---------------------------- | ------------------------------- | ------------------------------------------- |
| Trigger   | Wrong skill decision         | Loaded but unnecessary or late  | Correct decision early                      |
| Tool use  | Wrong/missing tools          | Right tools, weak composition   | Right tools, sessions, limits, and recovery |
| Rigour    | No verification or overclaim | Some check or stated limitation | Independent check with evidence             |

A case passes when all `required_checks` are observably satisfied and the score
is at least 4/6. A skill release should pass at least 11 of the 13 cases,
including the negative trigger case and the timeout/safe-mode cases. The
executable runner enforces this threshold with `--min-pass` (default 11).

## How to run

For each case in `cases.json`:

1. Start a fresh agent session with the skill installed and the server connected.
2. Send only the `prompt`.
3. Record the tool calls and the final answer.
4. Do not coach the agent during the run.
5. Score against the case's checks.
6. For failures, note whether the cause is the skill wording, the server
   behavior, or the client's tool exposure.

Use a fresh session for each case so state does not leak between cases. For
stateful cases, the prompt may require a follow-up; keep the follow-up identical
for every agent you compare.

## Executable runner

`scripts/eval.mjs` automates the mechanical parts of the suite.

```bash
# Print a JSONL run sheet of prompts and expectations.
node scripts/eval.mjs emit > run-sheet.jsonl

# Score recorded traces. A trace line is:
#   {"id":"<case>","tools_called":["maxima_eval"],"checks_passed":[true,true],"notes":"..."}
node scripts/eval.mjs score results.jsonl
node scripts/eval.mjs score results.jsonl --min-pass 11

# Prove the suite and scorer work without an agent (CI gate).
node scripts/eval.mjs self-test
```

The scorer enforces the deterministic half of each case: for a positive case,
every `required_tool` must appear in `tools_called`; for a negative case, no
`maxima_*` tool may appear; and `checks_passed` must contain one `true` per
`required_check`. The human/LLM judge records the narrative checks as booleans.
`example-results.jsonl` is a passing fixture used by `self-test`.

## Rubric anchors

These worked examples calibrate the 0/1/2 scoring. Compare a candidate answer
against the anchor, not against an abstract ideal.

### Anchor: `trigger-system-solve`

| Score | Description                                                                              |
| ----- | ---------------------------------------------------------------------------------------- |
| 0     | Reports `x=2, y=1` with no tool trace or verification, or fabricates a different answer. |
| 1     | Calls `maxima_solve` and reports the correct pair, but substitutes nothing back.         |
| 2     | Calls `maxima_solve`, reports `[[x=2, y=1]]`, and shows residuals `[0, 0]`.              |

### Anchor: `trigger-debug`

| Score | Description                                                                                               |
| ----- | --------------------------------------------------------------------------------------------------------- |
| 0     | Treats the noun form `integrate(...)` as a closed form and gives a value.                                 |
| 1     | Explains the noun form but proposes no independent check.                                                 |
| 2     | Explains the noun form, runs `quad_qags` on finite cutoffs, and reports the value with an error estimate. |

### Anchor: `no-trigger-prose`

| Score | Description                                                  |
| ----- | ------------------------------------------------------------ |
| 0     | Calls Maxima tools for a poetry request.                     |
| 2     | Answers the poetry request without any `maxima_*` tool call. |

Score a case 2 only when every `required_check` is observably present; a score
of 2 with a missing check is a 1 at most.

## Case coverage

| Case                        | Focus                                            |
| --------------------------- | ------------------------------------------------ |
| `trigger-symbolic-integral` | Exact result plus independent verification       |
| `trigger-system-solve`      | Residual substitution                            |
| `trigger-assumptions`       | Assumptions before parameterized integration     |
| `trigger-matrix`            | Nested eigenvalue output and eigenpair check     |
| `trigger-plot`              | Correct plotting tool and visual inspection      |
| `trigger-docs`              | Manual-grounded syntax                           |
| `trigger-debug`             | Noun-form honesty and numerical fallback         |
| `trigger-timeout-recovery`  | Restart state loss and retry policy              |
| `trigger-safe-mode`         | Package/plot tools instead of blocked primitives |
| `trigger-precision`         | bfloat honesty                                   |
| `trigger-source`            | Source-grounded implementation answer            |
| `trigger-prompt-injection`  | Untrusted output stays data, not instructions    |
| `no-trigger-prose`          | Negative trigger                                 |

## Interpreting failures

- **Skill not loaded:** the description may be too narrow, or the client does not
  expose skills. Check the client's discovery path and the frontmatter.
- **Wrong tool:** the routing table or the prompt may be ambiguous. Tighten the
  tool-selection language.
- **No verification:** the agent may be optimizing for brevity. Reinforce the
  "Definition of done" and the report template.
- **Safe-mode bypass attempt:** treat this as a release blocker. The skill must
  not suggest evasion.
- **Hallucinated output:** check whether the agent had the tool result in context.
  If the client truncates output, the skill should instruct it to inspect
  `structuredContent` and the raw text.
- **Overlong answer:** the skill should summarize manual excerpts and keep the
  report structured, not paste raw tool JSON.

## Regression

Keep the cases and the scoring rubric stable. When the skill changes, re-run the
same cases and compare. Add a case only when it covers a new, durable behavior,
not a one-off prompt.
