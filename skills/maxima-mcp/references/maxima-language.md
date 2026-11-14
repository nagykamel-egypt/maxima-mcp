# Maxima language reference

A compact, task-oriented reference for composing correct Maxima through the MCP
tools. It is not a substitute for the installed manual; use `maxima_help` and
`maxima_examples` when exact behavior matters.

## Evaluation model

Maxima is an interactive computer algebra system. Statements end with `;` to
display a result or `$` to suppress it. In the MCP server:

- `maxima_eval` and `maxima_batch` add a terminator when one is missing.
- The focused math tools construct the command for you; do not include `;` or
  `$` in their expression arguments.
- `maxima_batch` preserves assignments, function definitions, assumptions, and
  loaded packages between statements in the same session.
- A session is a separate Maxima process. A timeout, crash, or reset discards
  its state.

## Syntax essentials

| Concept              | Maxima                                     |
| -------------------- | ------------------------------------------ |
| Assignment           | `a: 3$`                                    |
| Equation             | `x^2 = 4`                                  |
| Function definition  | `f(x) := x^2$`                             |
| Function application | `f(3)`                                     |
| Power                | `x^2`, `a^(1/2)`                           |
| Multiplication       | `2*x`, not `2x`                            |
| Comment              | `/* ... */`                                |
| List                 | `[1, 2, 3]`                                |
| Matrix               | `matrix([1, 2], [3, 4])`                   |
| Matrix product       | `A . B`                                    |
| String               | `"text"`                                   |
| Previous result      | `%` (avoid in tool workflows)              |
| Last output label    | `%o1`, `%o2`, ... (avoid as durable state) |

### Numbers and constants

| Meaning                | Maxima                       |
| ---------------------- | ---------------------------- |
| Exact integer/rational | `2`, `1/3`                   |
| Machine float          | `1.5`, `1.0/3`               |
| Arbitrary precision    | `bfloat(...)`, with `fpprec` |
| Pi                     | `%pi`                        |
| Euler's number         | `%e`                         |
| Imaginary unit         | `%i`                         |
| Positive infinity      | `inf`                        |
| Negative infinity      | `minf`                       |
| Undefined              | `und`                        |
| Indefinite             | `ind`                        |

`pi`, `e`, and `i` are ordinary symbols in Maxima unless you assign them. Always
use the `%`-prefixed constants for the mathematical constants.

### Arithmetic and comparison

```maxima
a + b
a - b
a * b
a / b
a ^ b
a!
abs(x)
min(a, b)
max(a, b)
```

Comparison and logical operators include `=`, `#`, `<`, `<=`, `>`, `>=`, `and`,
`or`, `not`. In Maxima, `=` in an expression is an equation, not a boolean test;
use `is(...)` or `if ... then ...` for decisions.

## Algebra

### Expand, factor, and rational forms

```maxima
expand((x + 1)^3);
factor(x^3 - 1);
ratsimp((x^2 - 1)/(x - 1));
fullratsimp(1/x + 1/(x + 1));
radcan(sqrt(x^2));
partfrac(1/(x^2 - 1), x);
```

- `expand` distributes products and powers.
- `factor` factors polynomials over the integers/rationals.
- `ratsimp` combines rational expressions over a common denominator.
- `fullratsimp` applies `ratsimp` repeatedly.
- `radcan` simplifies radicals and algebraic expressions, but can change branch
  behavior.
- `partfrac` decomposes into partial fractions.

### Trigonometric and logarithmic forms

```maxima
trigsimp(sin(x)^2 + cos(x)^2);
trigexpand(sin(x + y));
trigreduce(sin(x)^2);
logcontract(log(a) + log(b));
rootscontract(sqrt(a)*sqrt(b));
```

Check domains for `logcontract` and `rootscontract`; they are not universally
valid without positivity assumptions.

### Complex forms

```maxima
rectform(exp(%i*x));
polarform(1 + %i);
cabs(3 + 4*%i);
carg(1 + %i);
realpart(z);
imagpart(z);
conjugate(z);
demoivre(exp(%i*x));
exponentialize(sin(x));
```

## Calculus

```maxima
diff(f, x);
diff(f, x, 2);
integrate(f, x);
integrate(f, x, a, b);
limit(f, x, a);
limit(f, x, a, plus);
limit(f, x, a, minus);
taylor(f, x, a, n);
sum(k^2, k, 1, n);
product(k, k, 1, n);
```

- `diff(f, x, n)` is the `n`-th derivative.
- `integrate` may return a noun form when it cannot find an antiderivative.
- `limit` direction is `plus` or `minus` for one-sided limits.
- `taylor` returns a truncated series; the remainder is not exact.
- `sum` and `product` may return closed forms or noun forms.

### Differential equations

```maxima
ode2('diff(y, x, 2) + y = 0, y, x);
ic1(%, x = 0, y = 0);
ic2(%, x = 0, y = 0, 'diff(y, x) = 1);
desolve([diff(y(x), x) = y(x)], [y(x)]);
laplace(f(t), t, s);
ilt(F(s), s, t);
```

`ode2` returns a general solution with constants such as `%c1`, `%c2`. Apply
initial conditions with `ic1`/`ic2` or boundary conditions with `bc2`. Some ODE
classes need a share package such as `contrib_ode`.

### Numerical quadrature

```maxima
quad_qags(f, x, a, b);
quad_qags(f, x, a, b, epsrel, epsabs, limit);
quad_qagp(f, x, a, b, [singular_points]);
find_root(f = 0, x, a, b);
allroots(polynomial);
realroots(polynomial);
```

`quad_qags` returns `[value, estimated_error, evaluations, error_code]`.
`error_code = 0` means success. Use finite bounds; `inf` may return the noun form.
For singular integrands, split the interval or use `quad_qagp`.

## Equations and assumptions

```maxima
solve(x^2 - 4 = 0, x);
solve([x + y = 3, x - y = 1], [x, y]);
linsolve([x + y = 3, x - y = 1], [x, y]);
allroots(x^3 - x + 1);
find_root(cos(x) = x, x, 0, 1);
```

### Assumptions

```maxima
assume(x > 0)$
assume(a > 0, b > 0)$
declare(n, integer)$
declare(x, real)$
facts();
forget(x > 0)$
```

- `assume` records inequality facts used by simplification, integration, and
  limits.
- `declare` records type/feature facts such as `integer`, `real`, `even`,
  `odd`, `constant`.
- Add assumptions before a parameterized integral or limit; otherwise Maxima may
  ask a question that becomes a timeout in non-interactive mode.
- State assumptions in the final answer. Reset the session or `forget` them when
  they no longer apply.

## Lists, matrices, and parts

```maxima
L: [1, 2, 3]$
length(L);
first(L);
last(L);
rest(L);
append(L, [4, 5]);
map(lambda([u], u^2), L);
makelist(k^2, k, 1, 5);

A: matrix([1, 2], [3, 4])$
B: matrix([5, 6], [7, 8])$
A . B;
transpose(A);
determinant(A);
invert(A);
rank(A);
eigenvalues(A);
eigenvectors(A);
charpoly(A, %lambda);
adjoint(A);
nullspace(A);
identity(2);
zeromatrix(2, 2);
```

- Matrix multiplication uses `.` (dot), not `*`.
- `*` between matrices is elementwise.
- `eigenvalues` returns `[[values], [multiplicities]]`.
- `eigenvectors` returns `[[values], [multiplicities], [vector lists]]`.
- `invert` fails or returns a conditional for singular matrices.

## Programming constructs

```maxima
block([local1, local2], local1: 1, local2: 2, local1 + local2);

if condition then expr1 else expr2;

for i: 1 thru 10 do print(i)$
for i in [1, 2, 3] do print(i)$
while condition do expr$

f(x) := x^2$
g(x, y) := block([z], z: x + y, z^2)$

map(f, [1, 2, 3]);
apply(f, [2]);
lambda([x], x^2);
```

- `block` localizes variables listed in its first argument.
- `for ... thru ... do` and `for ... in ... do` are common loops.
- `do` bodies can be compound expressions separated by commas.
- `print` writes output; `disp` and `display` are also available.
- Use `$` to suppress loop noise when you only need side effects.

## Evaluation and substitution

```maxima
subst(2, x, x^2 + 1);
ev(x^2 + 1, x = 2);
at(x^2 + 1, x = 2);
ev(expr, numer);
float(expr);
bfloat(expr);
```

- `subst(new, old, expr)` substitutes `new` for `old`.
- `ev(expr, x = value)` evaluates with substitutions and flags.
- `at(expr, x = value)` evaluates at a point.
- `ev(expr, numer)` turns mathematical constants into floats where possible.
- `float` converts to machine precision; `bfloat` uses `fpprec` digits.

## Plotting

Use `maxima_plot` for images. It handles gnuplot output safely and returns a
native MCP image. Direct `plot2d`/`plot3d` through `maxima_eval` may open a GUI or
hit safe-mode restrictions.

Plot expressions are in `x` for 2D and `x`, `y` for 3D. Do not include `;` or
`$`. For 3D, provide both `y_min` and `y_max`.

Equivalent Maxima concepts:

```maxima
plot2d(sin(x), [x, -%pi, %pi]);
plot2d([sin(x), cos(x)], [x, 0, 4*%pi]);
plot3d(sin(x)*cos(y), [x, -%pi, %pi], [y, -%pi, %pi]);
```

## Common traps

| Trap                                   | Correct approach                                  |
| -------------------------------------- | ------------------------------------------------- |
| `2x`                                   | `2*x`                                             |
| `x**2`                                 | `x^2`                                             |
| `e^x` means symbol `e`                 | `%e^x`                                            |
| `pi` means symbol `pi`                 | `%pi`                                             |
| `i` means symbol `i`                   | `%i`                                              |
| `infinity`                             | `inf` or `minf`                                   |
| `f = x^2` for a function               | `f(x) := x^2`                                     |
| `x = 2` as assignment                  | `x: 2`                                            |
| `f(x)` with no definition              | define `f(x) := ...` or use a built-in            |
| `sqrt(x^2)` assumed to be `x`          | use assumptions or `abs(x)` when appropriate      |
| `log(x*y)` assumed to split            | use `logexpand` or `logcontract` and check domain |
| `integrate` with a parameter hangs     | `assume(a > 0)$` before the call                  |
| `quad_qags` with `inf`                 | finite cutoff plus convergence check              |
| `solve` result has extraneous roots    | substitute back                                   |
| `eigenvalues` treated as a flat list   | it is `[[values], [multiplicities]]`              |
| `taylor` treated as exact              | it is truncated; state the order                  |
| `kill(all)` treated as a process reset | use `maxima_session_reset` for a clean process    |
| `%` used across batches                | assign explicit names                             |
| `load("pkg")` in safe mode             | `maxima_package_load` with an exact package name  |
| `plot2d` output in a headless server   | `maxima_plot` with gnuplot installed              |

## Function quick map

| Task          | Core functions                                                                                                            |
| ------------- | ------------------------------------------------------------------------------------------------------------------------- |
| Expand/factor | `expand`, `factor`, `ratsimp`, `fullratsimp`, `radcan`, `partfrac`                                                        |
| Simplify trig | `trigsimp`, `trigexpand`, `trigreduce`                                                                                    |
| Logs/roots    | `logcontract`, `rootscontract`, `logexpand`                                                                               |
| Complex       | `rectform`, `polarform`, `cabs`, `carg`, `realpart`, `imagpart`, `conjugate`                                              |
| Differentiate | `diff`                                                                                                                    |
| Integrate     | `integrate`, `quad_qags`, `quad_qagp`                                                                                     |
| Limits        | `limit`                                                                                                                   |
| Series        | `taylor`, `powerseries`, `niceindices`                                                                                    |
| Sums/products | `sum`, `product`, `simplify_sum` (package)                                                                                |
| Solve         | `solve`, `linsolve`, `allroots`, `realroots`, `find_root`                                                                 |
| ODEs          | `ode2`, `ic1`, `ic2`, `bc2`, `desolve`, `laplace`, `ilt`                                                                  |
| Matrices      | `matrix`, `determinant`, `invert`, `transpose`, `rank`, `eigenvalues`, `eigenvectors`, `charpoly`, `adjoint`, `nullspace` |
| Lists         | `length`, `first`, `last`, `rest`, `append`, `map`, `makelist`, `apply`, `lambda`                                         |
| Assumptions   | `assume`, `declare`, `facts`, `forget`, `is`, `sign`                                                                      |
| Numeric       | `float`, `bfloat`, `fpprec`, `numer`                                                                                      |

## Session state checklist

Before a long computation, confirm:

- the session ID is the intended one;
- definitions and assumptions are present;
- required packages are loaded;
- no stale conflicting assumptions remain;
- the previous call did not report `restarted: true`.

After a timeout or crash, assume all of the above is gone and rebuild it.
