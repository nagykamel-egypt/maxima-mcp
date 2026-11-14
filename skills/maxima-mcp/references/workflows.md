# Workflows

These procedures are the practical layer between the skill's rules and the
individual tools. Each workflow names the tools, the order, the check, and the
failure mode to watch for.

## 1. Environment preflight and session setup

**When:** first use, a new machine, a suspected outage, or any result that looks
impossible.

1. Call `maxima_system_info`.
2. Confirm `maxima.available: true` and record `maxima.version`.
3. Check `docs.state` and `source.state` if the task needs manual or source
   lookup. `loading` is transient; `unavailable` means install the optional
   packages or set the directory.
4. Note `maxima.allow_dangerous`, `default_timeout_ms`, `max_timeout_ms`, and
   `max_sessions`.
5. For a multi-step task, create one named session with
   `maxima_session_open`.
6. Run a one-line smoke test in that session:

```json
{ "expression": "1 + 1", "session_id": "my-task" }
```

Expected output: `2`.

If the smoke test fails, do not continue with the real problem. Follow
[errors](errors.md) or [integration](integration.md).

---

## 2. Exact symbolic computation with verification

**When:** the user wants an exact closed form, an antiderivative, a derivative,
a simplification, or a symbolic solution.

1. **Frame the expression.** Write it unambiguously. Use `^` for powers, `*` for
   multiplication, and `=` for equations.
2. **Ground syntax.** If the operation or option is uncertain, call
   `maxima_help` on the function. Use `maxima_examples` for a canonical call.
3. **Compute with the focused tool.** For example:

```json
{
  "expression": "x^2*exp(-x)",
  "variable": "x",
  "lower": "0",
  "upper": "inf",
  "numerical": false
}
```

4. **Read the raw result.** If it contains `integrate(...)`, `diff(...)`, a
   conditional, or a noun form, the operation did not fully evaluate. Do not
   present it as a closed form.
5. **Verify independently.** For an integral, differentiate the result and
   simplify; or compare with `quad_qags` on a finite interval. For a derivative,
   compare with a finite difference. For a simplification, evaluate both forms
   at several safe points.
6. **Report the exact result, the check, and the assumptions.**

**Common failure:** a parameterized definite integral hangs because Maxima is
waiting for a sign. Set assumptions first:

```json
{
  "commands": ["assume(a > 0)$", "integrate(exp(-a*x), x, 0, inf);"],
  "session_id": "parameter-integral"
}
```

Expected: `1/a`.

---

## 3. Solve equations and systems

**When:** the user wants roots, a solution set, or a system solution.

1. Rewrite the problem as equations using `=`. Move everything to one side only
   if that improves clarity.
2. Decide whether exact (`maxima_solve`) or numeric (`numerical: true` or a
   numeric root method) is appropriate.
3. Solve:

```json
{
  "equations": ["x + y = 3", "x - y = 1"],
  "variables": ["x", "y"]
}
```

Expected form: `[[x = 2, y = 1]]`.

4. Substitute every solution into every original equation. A solution is only
   accepted when all residuals simplify to zero (or are within an explicitly
   stated tolerance).
5. Check for missed branches, extraneous roots, and parameter conditions.
6. If `solve` returns `[]`, do not conclude "no solution" without an independent
   argument. Try `to_poly_solve` (if available), `allroots`, `find_root`, or a
   numerical scan.

**System example with verification:**

```json
{
  "commands": [
    "s: solve([x + y = 3, x - y = 1], [x, y])$",
    "s;",
    "subst(s[1], [x + y - 3, x - y - 1]);"
  ],
  "session_id": "linear-system"
}
```

Expected: `[0, 0]` for the residual list.

**Pitfalls**

- `solve` may return a parameterized family or a conditional.
- Trigonometric equations often have infinitely many solutions; `solve` may
  return a principal set. State the domain and period.
- Equations with `abs`, `min`, `max`, or piecewise definitions may need case
  splitting.

---

## 4. Calculus: derivatives, integrals, limits, and series

### 4.1 Derivative

1. Use `maxima_differentiate`.
2. Verify with a central finite difference at two or three interior points:

```json
{
  "commands": [
    "f: sin(x)*exp(-x)$",
    "df: diff(f, x)$",
    "for xv in [0.3, 1.1, 2.7] do",
    "  print(xv, float(subst(xv, x, df)), float((subst(xv+1e-6, x, f)-subst(xv-1e-6, x, f))/2e-6))$"
  ],
  "session_id": "derivative-check"
}
```

Interpret the printed pairs; they should agree to roughly the finite-difference
truncation error.

### 4.2 Indefinite integral

1. Use `maxima_integrate` without bounds.
2. Differentiate the result and simplify the difference with the integrand.
3. If the difference is not zero, try `ratsimp`, `trigsimp`, or `radcan` before
   declaring failure. A nonzero difference may reflect a branch or an
   unsimplified constant.

### 4.3 Definite integral

1. Use `maxima_integrate` with both bounds.
2. Verify with `quad_qags` on a finite interval. If the true upper bound is
   infinite, integrate to increasing finite bounds and show convergence:

```json
{
  "commands": ["for b in [5, 10, 20, 50] do", "  print(b, quad_qags(exp(-x^2), x, 0, b)[1])$"],
  "session_id": "quadrature-convergence"
}
```

3. For singular integrands, split at the singularity and use `quad_qagp` or
   carefully chosen `quad_qags` calls. State the treatment.
4. If the symbolic result is a noun form, say so; do not invent a value.

### 4.4 Limit

1. Use `maxima_limit` with `direction: "both"`.
2. If undefined, test `plus` and `minus`.
3. Cross-check numerically on both sides and, when possible, with a series.
4. For limits at infinity, substitute `x = 1/t` with `t -> 0+` if the direct form
   is awkward.

### 4.5 Series

1. Use `maxima_series` with an explicit order.
2. Compare the truncated series with the function at small offsets.
3. State the expansion point, order, and remainder status.
4. For a singularity, decide whether a Taylor, Laurent, or asymptotic expansion
   is appropriate. `taylor` may return negative powers near a pole.

---

## 5. Simplification strategy ladder

**When:** an expression is correct but unusable, or two forms need comparison.

Try methods in this order, stopping when the form is fit for the next step:

1. `auto` (`radcan(ratsimp(expr))`) for a general rational/algebraic cleanup.
2. `ratsimp` or `fullratsimp` for rational functions.
3. `factor` or `expand` depending on whether a product or a sum is wanted.
4. `radcan` for radicals and algebraic extensions.
5. `trigsimp` for trigonometric identities.
6. `trigexpand` or `trigreduce` for the desired trigonometric form.
7. `logcontract` or `rootscontract` for log/root aggregation (check domain).
8. `rectform` or `polarform` for complex expressions.
9. `demoivre` or `exponentialize` to switch complex representations.

**Always** evaluate the original and simplified forms at several safe numeric
points. A simplification that changes the value on the domain is wrong, even if
it looks cleaner.

**Branch warning:** `radcan`, `logcontract`, and `rootscontract` can change
branch behavior. If the expression contains logs, roots, or fractional powers,
state the assumed domain and verify on both sides of the branch.

---

## 6. Linear algebra

**When:** determinants, inverses, ranks, traces, eigenvalues, eigenvectors,
characteristic polynomials, adjoints, or nullspaces.

1. Build the matrix as a Maxima matrix expression:

```text
matrix([a, b], [c, d])
```

2. Use `maxima_matrix` with the requested operation.
3. Interpret the result:

| Operation      | Typical output                            |
| -------------- | ----------------------------------------- |
| `determinant`  | scalar                                    |
| `inverse`      | matrix                                    |
| `transpose`    | matrix                                    |
| `rank`         | integer                                   |
| `trace`        | scalar                                    |
| `eigenvalues`  | `[[values], [multiplicities]]`            |
| `eigenvectors` | `[[values], [multiplicities], [vectors]]` |
| `charpoly`     | polynomial in `variable`                  |
| `adjoint`      | matrix                                    |
| `nullspace`    | list of basis vectors                     |

4. Verify:

- `A . inverse(A)` is the identity (or `A . adjoint(A) = det(A) * I`).
- `determinant(A)` matches the product of eigenvalues (with multiplicity).
- Each eigenvector `v` satisfies `A . v = lambda * v`.
- `rank + nullity = number of columns`.
- For a singular matrix, state that the inverse does not exist and use
  `adjoint`, `nullspace`, or a pseudoinverse approach.

**Symbolic matrices:** check for conditions such as a parameter being nonzero
before dividing. Use `assume` or return a conditional answer.

---

## 7. Numerical evaluation and quadrature

**When:** the user wants a number, a numerical root, or an approximate integral.

1. Decide the precision target: double (`double`) or arbitrary precision
   (`bfloat`, `digits`).
2. Prefer exact arithmetic until the final conversion.
3. For a function value:

```json
{ "expression": "sqrt(2) + %pi", "mode": "bfloat", "digits": 50 }
```

4. For an integral, use `maxima_integrate` with `numerical: true` and **finite**
   bounds, or call `quad_qags` directly through `maxima_eval`.
5. Read the quadrature tuple: `[value, estimated_error, evaluations, error_code]`.
   `error_code = 0` is success. Nonzero codes need investigation.
6. Verify convergence by refining the interval, splitting singularities, or
   comparing with a symbolic result.
7. Report the method, precision, estimated error, and any conditioning concerns.

**Important:** `quad_qags(..., inf)` may return the noun form rather than a
number. Use a finite cutoff and demonstrate convergence, or transform the
integral.

---

## 8. Assumptions, parameters, and branches

**When:** the answer depends on a sign, a domain, or a parameter.

1. List the assumptions explicitly: real/complex, positive/negative/nonzero,
   integer, range, branch.
2. Add them to the session before the computation:

```json
{
  "commands": ["assume(a > 0, b > 0)$", "integrate(exp(-a*x)*sin(b*x), x, 0, inf);"],
  "session_id": "assumption-demo"
}
```

3. Verify the result with sample parameter values that satisfy the assumptions.
4. If the result is conditional, report the conditions. Do not silently choose a
   branch.
5. Reset the session or use `forget(...)` when assumptions no longer apply.

**Useful forms**

```maxima
assume(x > 0)$
assume(a > 0, b > 0)$
declare(n, integer)$
declare(x, real)$
facts();
forget(x > 0)$
```

`assume` adds inequality facts; `declare` adds type/feature facts. They are not
interchangeable.

---

## 9. Plotting and visual QA

**When:** a visual communicates the result better than a formula, or a plot is
needed for a report.

1. Decide 2D or 3D. 2D expressions use `x`; 3D use `x` and `y`.
2. Choose a range that contains the interesting behavior and avoids unrelated
   singularities.
3. Call `maxima_plot` with labels and a title.
4. Inspect the returned image, not only the text summary.
5. Verify by sampling known points. For example, for `sin(x)` on `[0, 4]`, check
   `x = %pi/2` and `x = %pi`.
6. For log axes, confirm the data is positive on the range.
7. For 3D, provide `y_min` and `y_max`; otherwise validation fails.
8. If gnuplot is missing, expect `PLOT_FAILED`; do not fabricate an image.

**Multiple curves:** pass up to 12 expressions in one call so they share axes and
legend.

**Report:** include the expression, range, axis modes, and the image. State any
clipping or singular behavior.

---

## 10. Documentation-first discovery

**When:** the exact function name or option is unknown.

1. Search by concept: `maxima_search_docs` with a query such as
   `"definite integral"` or `"eigenvalues"`.
2. Read the best symbol entry with `maxima_help`, including examples.
3. If you need more context, list sections with `maxima_doc_sections`, then read
   one with `maxima_doc_read`.
4. Run a minimal `maxima_eval` test to confirm the syntax in the installed
   version.
5. Cite the manual section or symbol in the answer when the user needs
   provenance.

**Do not** paste a huge manual section into the final answer. Extract the
signature, the relevant semantics, and one example.

---

## 11. Source and package exploration

**When:** the manual is ambiguous, behavior is version-specific, or a share
package is needed.

1. Find the implementation with `maxima_source`.
2. Read surrounding context; note the file, line, language, and kind.
3. If needed, search the source tree with `maxima_search_source`.
4. List packages with `maxima_list_packages`, then load the exact name with
   `maxima_package_load`.
5. Test one documented call in the same session.
6. Report the package name and any version caveat.

**Packages are session state.** A reset or restart loses them; reload before
continuing.

**First load may compile.** Use a generous timeout (the tool's default fallback
is 180 s) and avoid treating a slow first load as a crash.

---

## 12. Debugging a wrong or unexpected result

**When:** the output is wrong, an error appears, or the result is suspicious.

1. Reproduce with the smallest possible expression.
2. Read `is_error`, `warnings`, and the raw output, not just the formatted text.
3. Check the function signature with `maxima_help`; verify argument order and
   evaluation flags.
4. Reduce to intermediate values with `maxima_batch` and inspect each step.
5. Consider:
   - missing assumptions or wrong domain;
   - `=` used where `:` was intended, or vice versa;
   - a function defined with `:=` used without its argument;
   - a package not loaded;
   - a name collision with a built-in;
   - a branch cut or singular point;
   - a noun form or conditional being mistaken for a value;
   - session state from an earlier task;
   - `restarted: true` after a timeout.
6. Reset the session and retry the minimal case.
7. Provide the corrected expression and explain the root cause.

**Never** "fix" a result by silently changing the problem. State what changed.

---

## 13. Stateful batch computations

**When:** definitions, assumptions, or intermediate results must persist across
several steps.

1. Create a named session.
2. Put setup statements first, with `$` terminators to suppress noise.
3. Put the decisive computation last, with `;` so it displays.
4. Keep the batch under the configured command limit (default 50).
5. Inspect every `results[i]`.
6. Use a second batch for follow-up checks in the same session.

**Template**

```json
{
  "commands": [
    "kill(all)$",
    "assume(a > 0)$",
    "f: exp(-a*x)*sin(x)$",
    "F: integrate(f, x)$",
    "check: radcan(trigsimp(diff(F, x) - f));",
    "print(\"check =\", check)$",
    "limit(F, x, inf) - limit(F, x, 0);"
  ],
  "session_id": "symbolic-task",
  "timeout_ms": 120000
}
```

Use `maxima_session_list` to confirm the session is alive and not busy.

---

## 14. Parallel branches and isolation

**When:** several independent computations can run at once, or two tasks must
not share assumptions.

1. Assign one session per branch, for example `task-a`, `task-b`.
2. Run the calls concurrently only if the client supports parallel tool calls.
3. Keep calls within one session serialized; the server queues them.
4. Do not use the same session for branches with conflicting assumptions.
5. Close finished sessions to free process slots.
6. If `SESSION_LIMIT` is reached, close an idle session or reduce parallelism.

**Never** rely on cross-session state. Each session is an independent Maxima
process.

---

## 15. Engineering and scientific analysis

**When:** a calculation supports a design, a report, or a decision.

1. **Define the model.** State the governing equation, sign convention, units,
   and validity range.
2. **Normalize units.** Maxima is unit-agnostic. Convert inputs to a consistent
   unit system before evaluation. If `ezunits` is installed and verified, it can
   help, but do not assume it is available.
3. **Compute symbolically first.** Derive the general relation, then substitute
   numbers. This exposes sensitivity and dimensional structure.
4. **Check dimensions manually.** A symbolic result with inconsistent units is
   wrong regardless of the number.
5. **Run limit cases.** Zero, infinity, equal parameters, and boundary values
   should reduce to known results.
6. **Quantify sensitivity.** Vary key parameters and report the range.
7. **Verify numerically.** Use an independent method (quadrature, finite
   difference, energy balance, equilibrium residual).
8. **State safety factors and code assumptions.** Do not present a mathematical
   result as a code compliance claim without the applicable standard.
9. **Produce a reproducible record.** Include commands, inputs, assumptions,
   version, and checks.

**Report skeleton**

```markdown
**Model and assumptions**
**Governing equations**
**Symbolic derivation**
**Numerical inputs and units**
**Result**
**Verification and sensitivity**
**Limitations and code/standard notes**
```

---

## 16. Explaining a Maxima symbol or function

**When:** the user asks "what does this do?" or needs a grounded explanation.

1. `maxima_help` for the official description, signature, categories, and
   examples.
2. `maxima_source` if behavior is subtle or the manual is incomplete.
3. Run one or two minimal `maxima_eval` tests to demonstrate behavior and an
   edge case.
4. Explain arguments, return value, evaluation semantics, related functions, and
   pitfalls.
5. Cite the manual section and source location.

Use the `maxima_explain_symbol` prompt when available.

---

## 17. Verifying an external answer

**When:** you must check a result produced by another model, a spreadsheet, or a
human.

1. Restate the claimed result and the claimed assumptions.
2. Reproduce it independently in Maxima. Do not start from the claimed
   intermediate steps.
3. Compare exact forms where possible.
4. Substitute, differentiate, integrate, or evaluate numerically as appropriate.
5. If the claim is numerically approximate, state the tolerance and the
   reference value.
6. Report agreement, disagreement, or "cannot verify" with evidence. Do not
   soften a clear disagreement.

---

## 18. Reproducibility and handoff

**When:** the result must be audited, regenerated, or handed to another agent.

Record:

- server name and version (`maxima_system_info`);
- Maxima version;
- session ID and whether it was restarted;
- exact expressions and commands;
- assumptions;
- precision and tolerances;
- verification method and evidence;
- limitations and unresolved branches;
- optional plots or source references.

A second agent should be able to rerun the decisive commands in a fresh session
and obtain the same result.
