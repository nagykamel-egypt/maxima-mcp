# Cookbook

Copy-ready recipes for common tasks. Each recipe lists the tool arguments, the
expected shape of the result, and the check. Adapt names and ranges to the
problem; do not copy numbers blindly.

## 1. Verify an indefinite integral

**Goal:** confirm that `F` is an antiderivative of `f`.

```json
{
  "commands": ["f: x^2*exp(-x)$", "F: integrate(f, x)$", "check: radcan(diff(F, x) - f);"],
  "session_id": "antiderivative-check"
}
```

Expected: `check` is `0`. If it is a nonzero constant, explain that it can be
absorbed into the integration constant, and verify by differentiating again. If
it depends on `x`, the antiderivative is wrong or the simplification needs
`trigsimp`/`ratsimp`.

## 2. Verify a definite integral with quadrature

**Goal:** compare a symbolic value with an independent numerical value.

```json
{
  "commands": [
    "S: integrate(exp(-x^2), x, 0, 10)$",
    "N: quad_qags(exp(-x^2), x, 0, 10)$",
    "print(S, float(S), N)$"
  ],
  "session_id": "definite-integral-check"
}
```

Expected: `S = sqrt(%pi)*erf(10)/2`, which is numerically `0.886226925...`;
`N` is `[0.886226925452758, 1.8e-13, 105, 0]`. The last element `0` is the
quadrature error code.

For an infinite upper bound, use increasing finite cutoffs and show convergence:

```json
{
  "commands": ["for b in [5, 10, 20, 50, 100] do", "  print(b, quad_qags(exp(-x^2), x, 0, b)[1])$"],
  "session_id": "infinite-integral-convergence"
}
```

## 3. Solve and substitute

**Goal:** solve a system and prove each solution satisfies the equations.

```json
{
  "commands": [
    "eqs: [x + y = 3, x - y = 1]$",
    "s: solve(eqs, [x, y])$",
    "s;",
    "subst(s[1], [x + y - 3, x - y - 1]);"
  ],
  "session_id": "system-check"
}
```

Expected: `s = [[x = 2, y = 1]]` and residuals `[0, 0]`.

For a single equation, map over all solutions:

```maxima
s: solve(x^2 - 4 = 0, x)$
map(lambda([sol], subst(sol, x^2 - 4)), s);
```

Expected: `[0, 0]`.

## 4. Parameterized integral with assumptions

**Goal:** avoid a sign question and get a conditional-free answer.

```json
{
  "commands": ["assume(a > 0)$", "integrate(exp(-a*x), x, 0, inf);"],
  "session_id": "parameter-integral"
}
```

Expected: `1/a`.

Without the assumption, Maxima may ask `Is a positive?` and the non-interactive
call can time out. If the result is conditional, report the condition instead of
choosing a branch.

## 5. Simplify with a branch check

**Goal:** choose a form and prove it is valid on the intended domain.

```json
{
  "commands": [
    "e1: log(x^2)$",
    "e2: radcan(e1)$",
    "for xv in [-3, -1, 1, 3] do",
    "  print(xv, float(subst(xv, x, e1)), float(subst(xv, x, e2)))$"
  ],
  "session_id": "branch-check"
}
```

`radcan(log(x^2))` returns `2*log(x)`. The samples at negative `x` disagree with
`log(x^2)` (which is real for nonzero real `x`), so the simplification is only
valid for `x > 0`. Report that condition, or keep the original form if the
domain includes negative values.

## 6. Eigenvalues and eigenvectors

```json
{
  "operation": "eigenvalues",
  "matrix": "matrix([2, 1], [1, 2])"
}
```

Expected shape: `[[3, 1], [1, 1]]` (values and multiplicities; the order of the
values is not guaranteed). Do not assume ascending order.

Then verify an eigenpair:

```json
{
  "commands": [
    "A: matrix([2, 1], [1, 2])$",
    "e: eigenvectors(A)$",
    "v: e[2][1][1]$",
    "A . v - e[1][1][1]*v;"
  ],
  "session_id": "eigen-check"
}
```

Expected: a zero column vector, `matrix([0], [0])`. Inspect the nested structure
of `eigenvectors` before indexing; it is
`[[[values], [multiplicities]], [vector lists]]`, and the order within the
values/multiplicities lists follows the returned order.

## 7. Matrix inverse check

```json
{
  "commands": ["A: matrix([1, 2], [3, 4])$", "B: invert(A)$", "A . B;", "determinant(A);"],
  "session_id": "inverse-check"
}
```

Expected: `A . B` is `matrix([1, 0], [0, 1])`; determinant is `-2`.

For a singular matrix, `invert` fails or returns a conditional. State that the
inverse does not exist and use `adjoint`, `nullspace`, or a least-squares
approach instead.

## 8. Numerical root with residual check

```json
{
  "commands": ["r: find_root(cos(x) = x, x, 0, 1)$", "r;", "float(cos(r) - r);"],
  "session_id": "root-check"
}
```

Expected: `r ≈ 0.7390851332151607` and residual near `0` (within double
precision). Check the bracketing interval and whether other roots exist.

## 9. Taylor series with error estimate

```json
{
  "commands": [
    "s: taylor(exp(x), x, 0, 5)$",
    "s;",
    "for xv in [0.01, 0.05, 0.1] do",
    "  print(xv, float(subst(xv, x, s) - exp(xv)))$"
  ],
  "session_id": "series-check"
}
```

Expected: `1 + x + x^2/2 + x^3/6 + x^4/24 + x^5/120`; the errors shrink like the
first omitted term. Report the order and that the remainder is not exact.

## 10. Plot a family of curves

```json
{
  "expressions": ["sin(x)", "sin(x)*exp(-x/5)", "cos(x)*exp(-x/5)"],
  "x_min": 0,
  "x_max": 12,
  "kind": "2d",
  "format": "png",
  "title": "Damped trigonometric family",
  "xlabel": "x",
  "ylabel": "f(x)",
  "width": 1000,
  "height": 600,
  "grid": true,
  "legend": true
}
```

Check the image for clipping, singularities, and legend readability. For a log
axis, ensure the data is positive on the range. For 3D, provide `y_min` and
`y_max`.

## 11. Discover syntax from a concept

```json
{ "query": "definite integral", "limit": 5, "type": "all" }
```

Then:

```json
{ "symbol": "integrate", "include_examples": true, "max_entries": 2 }
```

Run a minimal test:

```json
{ "expression": "integrate(x^2, x, 0, 1)" }
```

Expected: `1/3`.

## 12. Inspect a function implementation

```json
{ "symbol": "integrate", "context_lines": 15, "max_results": 2 }
```

If the definition is subtle, search the source tree:

```json
{
  "query": "defun integrate",
  "regex": true,
  "limit": 20,
  "file_filter": "src"
}
```

Ground the behavior with a minimal `maxima_eval` test. Do not infer behavior
from a source comment alone.

## 13. Load a package safely

```json
{ "filter": "draw", "limit": 20 }
```

```json
{
  "package": "draw",
  "session_id": "graphics",
  "timeout_ms": 180000
}
```

Then test one documented call in the same session. Remember that the package
disappears after a reset, crash, or restart.

Do not use `load("...")` in `maxima_eval`; safe mode blocks it and the dedicated
tool validates installed packages.

## 14. Debug a wrong result

1. Reproduce the minimal expression.
2. Read `is_error`, `warnings`, and the raw output.
3. Check `maxima_help` for argument order.
4. Check assumptions.
5. Check whether a package is loaded.
6. Check whether `restarted` is true.
7. Reset the session and retry the minimal case.
8. Compare with a numeric sample.

Example: a derivative of a function defined with `:=` should be taken on the
applied form `f(x)`, not on the name `f`.

## 15. Parameter sweep in a batch

```json
{
  "commands": [
    "f(x, a) := exp(-a*x)*sin(x)$",
    "for a in [0.1, 0.5, 1, 2] do",
    "  print(a, integrate(f(x, a), x, 0, inf))$"
  ],
  "session_id": "parameter-sweep",
  "timeout_ms": 120000
}
```

Expected: a printed value per parameter. Keep sweeps small; a symbolic sweep can
be much more expensive than a numeric one. For numeric sweeps, use `quad_qags`
with finite bounds and report the error estimates.

## 16. Isolate independent tasks

```json
{ "session_id": "task-a", "name": "Beam check" }
```

```json
{ "session_id": "task-b", "name": "Thermal loop" }
```

Run each task with its own ID. Do not share a session between tasks with
conflicting assumptions. Close sessions when done:

```json
{ "session_id": "task-a" }
```

## 17. Verify an external claim

Suppose another agent claims:

```text
integrate(x^2, x, 0, 1) = 1/2
```

1. Reproduce with `maxima_integrate`.
2. Compare exact forms.
3. Check numerically.

Expected correct value is `1/3`, not `1/2`. Report the contradiction with the
computed value and the check. Do not "average" the claims.

## 18. Dimensional sanity check

Maxima does not carry units by default. For an engineering formula:

1. Convert all inputs to SI (or the chosen consistent system).
2. Derive the symbolic relation.
3. Check the dimensions of each term manually.
4. Substitute numbers only after the symbolic check.
5. Verify a limiting case with a known dimensionally consistent result.
6. State the unit system in the report.

If `ezunits` is installed, verify it with `maxima_list_packages` before relying
on it. Do not assume the package exists.

## 19. Recover from a restart

If a call returns `restarted: true` or a timeout:

1. Assume variables, functions, assumptions, and packages are gone.
2. Re-run the setup batch.
3. Re-check `maxima_session_list` for `alive` and `restarts`.
4. Continue from a safe intermediate point, not from the failed statement.
5. State that the session was restarted if it affects reproducibility.

## 20. Handle safe mode

| Need                | Safe-mode-safe approach                              |
| ------------------- | ---------------------------------------------------- |
| Load a package      | `maxima_package_load`                                |
| Plot                | `maxima_plot`                                        |
| Read a manual       | `maxima_help`/`maxima_search_docs`/`maxima_doc_read` |
| Read source         | `maxima_source`/`maxima_read_source_file`            |
| List packages/files | `maxima_list_packages`/`maxima_list_source_files`    |
| Shell/file access   | Not available by design; ask the administrator       |

Do not attempt to evade safe mode by string concatenation or alternate names.
That is a policy violation, not a clever workaround.

## 21. High-precision value

```json
{ "expression": "%pi", "mode": "bfloat", "digits": 80 }
```

Expected: `3.141592653589793238462643383279502884197169399375105820974944592307816406286209b0`.

Check that the expression itself was exact before conversion. High `digits` does
not repair an ill-conditioned or low-precision input.

## 22. Canonical final report

```markdown
**Result**
\[
\int_0^\infty x^2 e^{-x}\,dx = 2
\]

**Method**
`maxima_integrate` with `expression = "x^2*exp(-x)"`, `variable = "x"`,
`lower = "0"`, `upper = "inf"`.

**Assumptions**
Real variable; the integrand is positive and integrable on the interval.

**Verification**
Differentiated the antiderivative and simplified the difference to zero;
quadrature on `[0, 50]` gave `1.999999999999...` with estimated error below
`1e-12`.

**Limitations**
None material. The numerical check uses a finite cutoff; convergence was
observed as the cutoff increased.
```

## Anti-patterns

| Anti-pattern                                     | Better approach                                 |
| ------------------------------------------------ | ----------------------------------------------- |
| Passing `";"` to a focused math tool             | Remove it; the tool constructs the command.     |
| Using `maxima_eval` for a 10-step derivation     | Use `maxima_batch` with a named session.        |
| Reusing the default session for unrelated tasks  | Use named sessions or reset.                    |
| Treating `solve` output as a proof               | Substitute back and check branches.             |
| Treating a noun form as a result                 | Keep it as a noun form or use a numeric method. |
| Using `quad_qags` with `inf`                     | Finite cutoff plus convergence check.           |
| Ignoring `warnings`                              | Read and report them.                           |
| Retrying a timeout unchanged                     | Reformulate, split, or add assumptions.         |
| Using `float` for a precision-critical result    | Use exact arithmetic and `bfloat`.              |
| Using `load` in safe mode                        | `maxima_package_load`.                          |
| Plotting with a log axis over nonpositive data   | Adjust the range or use a linear axis.          |
| Claiming code compliance from a math check alone | Cite the standard and the required checks.      |
| Hiding an inconclusive result                    | State what was and was not verified.            |
