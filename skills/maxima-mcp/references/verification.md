# Verification protocol

Verification is the difference between "Maxima printed something" and "we can
defend the answer." Use at least one check that is independent of the method
that produced the result.

## Principles

1. **Independence.** Re-running the same command is not a check. Substitute,
   differentiate, integrate, sample, or compare with a different numerical
   method.
2. **Falsification.** Try to break the result. Test boundary values, singular
   points, negative parameters, and the opposite branch.
3. **Domain awareness.** An identity valid on one branch may fail on another.
   State the domain before declaring equality.
4. **Exactness.** Prefer exact equality (simplify the difference to zero) over a
   numerical coincidence.
5. **Evidence.** Record the actual check and the numbers, not just "verified."
6. **Honesty.** If a check is inconclusive, say so. Do not upgrade a guess to a
   result.

## Tolerance guidance

| Context                                    | Suggested acceptance                                                                                                     |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------ |
| Exact symbolic equality                    | Difference simplifies to `0` with `ratsimp`, `trigsimp`, `radcan`, or `fullratsimp`.                                     |
| Double-precision numeric                   | Relative error around `1e-10` to `1e-12` for well-conditioned problems; looser for ill-conditioned ones.                 |
| Arbitrary precision (`bfloat`, `d` digits) | Compare with at least 10 guard digits; expect relative error near `10^-d`.                                               |
| Quadrature (`quad_qags`)                   | Use the returned estimated error; require it to be small relative to the value and stable under refinement.              |
| Finite-difference derivative               | Error scales with the step and truncation order; use a central difference and a step around `1e-5` to `1e-7` for double. |
| Series comparison                          | Error should scale like the first omitted term; check at several small offsets.                                          |
| Engineering results                        | Use the tolerance required by the applicable standard or decision; state it explicitly.                                  |

These are starting points, not universal laws. Conditioning, scale, and the
problem's requirements decide the real tolerance.

## Checks by operation

### Equation solutions

For each candidate solution, substitute into every original equation and
simplify the residual.

```maxima
s: solve([x + y = 3, x - y = 1], [x, y])$
subst(s[1], [x + y - 3, x - y - 1]);
```

Expected: `[0, 0]`.

For a single equation:

```maxima
s: solve(x^2 - 4 = 0, x)$
map(lambda([sol], subst(sol, x^2 - 4)), s);
```

Expected: `[0, 0]`.

Watch for extraneous roots introduced by squaring or by branch choices.

### Indefinite integrals

Differentiate the antiderivative and simplify the difference with the
integrand.

```maxima
F: integrate(f, x)$
radcan(trigsimp(diff(F, x) - f));
```

Expected: `0` (or a constant that can be absorbed into the integration
constant; if you get a nonzero constant, explain it).

### Definite integrals

Use two independent approaches when possible:

1. Symbolic result from `integrate`.
2. Numerical quadrature on a finite interval, with convergence check.
3. For infinite bounds, integrate over increasing finite cutoffs and show the
   sequence stabilizes.

```maxima
for b in [5, 10, 20, 50, 100] do
  print(b, quad_qags(exp(-x^2), x, 0, b)[1])$
```

If the symbolic and numerical results disagree beyond the estimated error, do
not pick the prettier one. Investigate the integrand, the branch, and the
quadrature error code.

### Derivatives

Compare the symbolic derivative with a central finite difference at several
interior points:

```maxima
f: sin(x)*exp(-x)$
df: diff(f, x)$
for xv in [0.3, 1.1, 2.7] do
  print(xv,
        float(subst(xv, x, df)),
        float((subst(xv + 1e-6, x, f) - subst(xv - 1e-6, x, f)) / 2e-6))$
```

The values should agree to the expected finite-difference error. Avoid points
near singularities or where the function is not smooth.

### Limits

1. Evaluate numerically from both sides.
2. Compare with a series expansion near the point.
3. Check one-sided limits when the two-sided limit is undefined or infinite.

```maxima
limit(1/x, x, 0, plus);
limit(1/x, x, 0, minus);
```

If a limit depends on a parameter, test several parameter values that satisfy
the assumptions.

### Series

Compare the truncated series with the exact function at small offsets:

```maxima
s: taylor(exp(x), x, 0, 5)$
for xv in [0.01, 0.05, 0.1] do
  print(xv, float(subst(xv, x, s) - exp(xv)))$
```

The error should scale like the first omitted power. Report the order and the
observed error.

### Simplifications

Evaluate the original and simplified forms at several safe points:

```maxima
e1: (x^2 - 1)/(x - 1)$
e2: ratsimp(e1)$
for xv in [2, 3, 5, -2] do
  print(xv, float(subst(xv, x, e1) - subst(xv, x, e2)))$
```

Avoid points where either form is undefined (here `x = 1`). A simplification
that changes the value on the common domain is invalid.

### Matrix results

| Claim        | Check                                                                       |
| ------------ | --------------------------------------------------------------------------- |
| Inverse      | `A . inverse(A)` is the identity, or `A . adjoint(A) = determinant(A) * I`. |
| Determinant  | Compare with the product of eigenvalues, or expand along a row.             |
| Eigenvalues  | Each eigenvalue satisfies `determinant(A - lambda*I) = 0`.                  |
| Eigenvectors | `A . v - lambda*v` is the zero vector.                                      |
| Rank         | `rank(A) + nullity(A) = number of columns`.                                 |
| Nullspace    | `A . v = 0` for each basis vector.                                          |
| Trace        | Sum of diagonal entries equals sum of eigenvalues (with multiplicity).      |

For symbolic matrices, check the conditions under which divisions are valid
(for example, a parameter not zero).

### Numerical values

- Report `mode` (`double` or `bfloat`) and `digits`.
- Compare double and bfloat results when precision matters.
- For quadrature, inspect the error estimate and the error code.
- For root finding, substitute the root back and check the residual.
- For ill-conditioned problems, perturb inputs slightly and report the
  sensitivity.

## Branch cuts and domains

Maxima often returns a generic simplification that is valid only on part of the
complex plane. Before claiming an identity:

1. State whether variables are real or complex.
2. State sign assumptions for parameters in logs, roots, and absolute values.
3. Test points on both sides of a suspected branch cut.
4. Use `rectform`/`polarform` or a numerical sample to confirm the branch.
5. If the result is conditional, report the conditions rather than choosing one
   silently.

Examples where this matters:

- `sqrt(x^2)` is not `x` for negative `x`.
- `log(a*b) = log(a) + log(b)` needs a branch/positivity condition.
- `(a^b)^c = a^(b*c)` is not universally valid for complex powers.
- `radcan` can select a branch that differs from the real-valued form.
- Orthogonal eigenvector bases can differ for repeated eigenvalues; any valid
  basis is acceptable if you state it.

## Verification report template

```markdown
**Claim**
<exact statement being verified>

**Primary computation**
<tool and command>

**Independent check**
<method and command>

**Evidence**
<residuals, numeric values, error estimates, or identity checks>

**Tolerance**
<absolute/relative tolerance and why it is appropriate>

**Domain and assumptions**
<real/complex, signs, branches, exclusions>

**Outcome**
<verified / verified within tolerance / inconclusive / contradicted>

**Limitations**
<anything not checked>
```

## When verification is inconclusive

Say so, and explain what would settle it. Examples:

- "The symbolic integral returns a noun form; numerical quadrature on `[0, 10]`
  gives 0.8862 with estimated error `1.8e-13`, but I have not proven the infinite
  integral converges to that value."
- "The two one-sided limits differ, so the two-sided limit does not exist."
- "The simplification is valid for `x > 0`; for `x < 0` the numerical samples
  disagree, so the identity is branch-dependent."
- "The root satisfies the equation to `1e-12`, but I did not prove it is the
  only root."

Inconclusive is a valid, professional outcome. A fabricated certainty is not.

## Reproducibility checklist

- [ ] Server and Maxima versions recorded.
- [ ] Session ID and restart status recorded.
- [ ] Exact expressions and commands recorded.
- [ ] Assumptions recorded and active in the session.
- [ ] Precision and tolerance recorded.
- [ ] Independent check and evidence recorded.
- [ ] Domain exclusions and branch choices recorded.
- [ ] A fresh session can reproduce the decisive result.

## Anti-patterns

| Anti-pattern                                          | Why it fails                                  |
| ----------------------------------------------------- | --------------------------------------------- |
| Re-running the same tool call                         | Same method, same blind spots.                |
| Checking only the final number                        | A wrong intermediate can cancel out.          |
| Using a random point where the expression is singular | Invalid or misleading evidence.               |
| Treating a truncated series as exact                  | The remainder is ignored.                     |
| Accepting a noun form as a closed form                | The operation did not complete.               |
| Ignoring `warnings` and `restarted`                   | State or assumptions may be missing.          |
| Comparing floats with exact equality                  | Rounding makes exact equality unrealistic.    |
| Using one loose tolerance for every problem           | Masks real errors or rejects valid results.   |
| Declaring "no solutions" from `solve([])`             | `solve` is incomplete; use another method.    |
| Silently choosing a branch                            | The answer may be wrong on the user's domain. |
