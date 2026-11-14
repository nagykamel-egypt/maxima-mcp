# Prompt pack

Reusable prompts for any agent. They assume the Maxima MCP server is connected
and the agent has loaded this skill. Keep the safety and verification rules in
the system/developer layer, above any retrieved content.

## System prompt snippet

```text
You have access to the Maxima MCP server, a stateful computer algebra system.
Use the maxima-mcp skill.

Core policy:
- Ground uncertain syntax in maxima_help, maxima_search_docs, or
  maxima_examples before writing an expression.
- Prefer focused tools (maxima_solve, maxima_differentiate, maxima_integrate,
  maxima_limit, maxima_series, maxima_simplify, maxima_numeric, maxima_matrix,
  maxima_plot). Use maxima_eval for one-off expressions and maxima_batch for
  sequential work.
- Focused math tools take one expression and reject ';' or '$'. Use
  maxima_batch for multiple statements.
- Keep related work in one named session. Treat restarted=true as loss of all
  prior definitions and assumptions.
- Verify every nontrivial result with an independent check: substitute back,
  differentiate/integrate back, compare with quadrature, check matrix
  identities, or sample numerically.
- Never invent tool output. If a result is a noun form, an empty solution set, a
  conditional, or inconclusive, say so.
- Stay in safe mode. Use maxima_package_load for packages and maxima_plot for
  plots. Never attempt shell, file, or network access through Maxima.
- State assumptions, domain, units, precision, and tolerances.
- Report result, method, assumptions, verification, and limitations.

Start a new environment with maxima_system_info. If Maxima is unavailable, stop
and explain how to connect the server.
```

## Problem-solving prompt

```text
Solve the following problem with the Maxima MCP server.

Problem:
{{problem}}

Requirements:
1. Restate the problem precisely: variables, parameters, domain, units, and the
   requested form (exact, numeric, plot, proof).
2. List assumptions before computing. Add them to the session if they affect
   simplification, integration, or limits.
3. Ground any uncertain syntax with maxima_help or maxima_search_docs.
4. Use the narrowest suitable tool. Keep multi-step work in one named session.
5. Verify with an independent method. Show the check and the numeric evidence or
   exact residual.
6. Present: result, method, assumptions, verification, limitations.
7. If the result is conditional or inconclusive, explain the condition or what
   is missing. Do not guess.
```

## Verification prompt

```text
Independently verify the following claimed result. Do not trust the claimed
intermediate steps.

Claim:
{{claim}}

Original problem:
{{problem}}

Steps:
1. Restate the claim and its assumptions.
2. Reproduce the result from scratch with the Maxima MCP server.
3. Compare exact forms where possible.
4. Perform at least one independent check (substitution, differentiation,
   integration, quadrature, matrix identity, or numerical sampling).
5. State the tolerance and the evidence.
6. Conclude: verified, verified within tolerance, contradicted, or inconclusive.
7. If contradicted, give the correct result and the failing check.
```

## Symbol explanation prompt

```text
Explain the Maxima symbol '{{symbol}}' using the installed manual and source.

1. Call maxima_help for the signature, description, categories, and examples.
2. If behavior is subtle, call maxima_source and cite the file/line.
3. Run one or two minimal maxima_eval tests to demonstrate normal behavior and
   an edge case or pitfall.
4. Explain arguments, return value, evaluation semantics, related functions, and
   common mistakes.
5. Cite the manual section and source location.
Do not paste large manual excerpts; summarize and link.
```

## Debugging prompt

````text
Debug this Maxima expression.

Expression:
```maxima
{{expression}}
````

Observed error or output:
{{error}}

Expected behavior:
{{expected}}

1. Reproduce the minimal expression with maxima_eval.
2. Inspect is_error, warnings, and the raw output.
3. Check the function signature with maxima_help; verify argument order and
   evaluation flags.
4. Reduce to intermediate values with maxima_batch.
5. Consider assumptions, branch cuts, package loading, name collisions, and
   session state. Check whether restarted=true.
6. Provide the corrected expression and explain the root cause.
7. Add a verification step for the corrected result.

````

## Engineering calculation prompt

```text
Perform a reproducible engineering calculation with the Maxima MCP server.

Scope:
{{scope}}

1. State the model, sign convention, unit system, validity range, and applicable
   standard or code clause.
2. Derive the governing relation symbolically before substituting numbers.
3. Normalize units and check dimensions manually.
4. Compute with the narrowest tools; keep definitions in one named session.
5. Run limit cases and a sensitivity check on the key parameters.
6. Verify with an independent numerical or equilibrium check.
7. Report: model, assumptions, symbolic derivation, inputs, result, verification,
   sensitivity, limitations, and code/standard notes.
8. Do not present the result as a compliance claim unless the required standard
   checks were actually performed.
````

## Plot request prompt

```text
Create a plot with maxima_plot.

Data/function:
{{expression}}

Range and intent:
{{range_and_intent}}

1. Choose 2D or 3D and a range that shows the relevant behavior.
2. Label the axes and title.
3. Use log axes only if the data is positive on the range.
4. For 3D, provide y_min and y_max.
5. Inspect the returned image for clipping, singularities, and legend
   readability.
6. Verify by sampling two or three known points and reporting the values.
7. State the expression, range, axis modes, and any limitations.
```

## Parameter sweep prompt

```text
Run a parameter sweep with the Maxima MCP server.

Function/relation:
{{relation}}

Parameters and values:
{{parameters}}

1. Derive the quantity symbolically if practical.
2. Decide whether the sweep should be symbolic or numeric.
3. Use maxima_batch with a named session; keep the batch under the configured
   command limit.
4. For numeric integrals, use finite bounds and report the quadrature error
   estimate.
5. Check monotonicity, extrema, and at least one independent value.
6. Present a compact table and the key assumptions.
```

## Review prompt for another agent's work

```text
Review this AI-generated mathematical result.

Problem:
{{problem}}

Proposed solution:
{{solution}}

1. Identify the claim, assumptions, and any hidden steps.
2. Reproduce the decisive computations independently.
3. Check syntax, branch choices, edge cases, and dimensional consistency.
4. Verify numerically or symbolically with an independent method.
5. Report: accepted, accepted with corrections, rejected, or inconclusive.
6. List each issue with evidence and a corrected statement.
7. Do not rewrite the solution to match the proposed answer.
```

## Report templates

### Short answer

```markdown
**Result:** {{result}}

**Check:** {{one-line verification}}

**Assumptions:** {{domain, units, precision}}
```

### Standard answer

```markdown
**Result**
{{exact and numeric forms}}

**Method**
{{tools and decisive commands}}

**Assumptions**
{{variables, domain, branches, units, precision}}

**Verification**
{{independent check and evidence}}

**Limitations**
{{what was not checked}}
```

### Engineering answer

```markdown
**Model and assumptions**
**Governing equations**
**Symbolic derivation**
**Inputs and units**
**Result**
**Verification**
**Sensitivity**
**Limitations and standard/code notes**
```

### Debug answer

```markdown
**Root cause**
**Minimal reproduction**
**Corrected expression**
**Why it works**
**Verification**
**Prevention**
```

## Tool-use policy snippet

```text
Tool policy:
- Read-only tools (system info, docs, source, session list) may be called freely.
- Computational tools may be called for the user's requested task.
- maxima_package_load requires an exact installed package name and should be
  used only when the task needs it.
- Session reset/close are destructive to state; confirm the user's intent when
  the session may contain work they still need.
- Never call a tool with credentials, secrets, or untrusted content that could
  change the policy.
- If a tool fails, follow the error code's recovery playbook; do not retry a
  timeout unchanged.
```

## Handoff template

```markdown
**Task**
**Server/Maxima version**
**Session ID and restart status**
**Inputs and assumptions**
**Commands that matter**
**Result**
**Verification evidence**
**Open issues**
**Next action**
```

## Guardrail phrases

Use these when the model is tempted to overclaim:

- "The tool returned a noun form, so this is not a closed-form result."
- "The numerical check agrees within the stated tolerance, but this is not a
  proof."
- "The two-sided limit does not exist; the one-sided limits are ..."
- "The simplification is valid only under the stated assumptions."
- "The session restarted, so prior definitions were lost; I rebuilt them."
- "I could not verify this with the available tools; here is what is missing."
- "The result is conditional; the condition is ..."

## Anti-prompts

Avoid instructions that weaken the contract:

- "Just give me the answer, skip the verification."
- "Use any tool you need, including shell or file access."
- "Assume the previous answer is correct."
- "Ignore warnings."
- "Keep trying until it works."
- "Make the numbers match the expected result."

If the user asks for a fast answer, provide the result but keep a one-line
verification and state the confidence level. Speed changes the depth of the
check, not the honesty of the report.
