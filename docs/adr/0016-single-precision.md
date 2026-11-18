# 0016 Single precision

Status: Accepted

## Context

Large models hit the memory limit of WebAssembly first: Pyodide is 32-bit, a tab gets at most 4 GB and often less (#152). For a direct solver, the factorization of the linear equation system is the largest array, followed by the matrix, the gradients of the regions and the stresses and tangents at the quadrature points. FElupe 12.1 builds regions (`Region.astype`), fields (`dtype=`, also `fem.FieldsMixed`) and items in `float32`, and its Newton-Raphson method has an absolute tolerance `atol` for the round-off of the residual forces.

Measured with FElupe 12.1.0 in CPython:

| | Model in `float32` (regions, fields, matrix, factorization) | Only the linear equation system in `float32` |
| --- | --- | --- |
| Golden cases (35) | 23 within 4e-4; up to 9e-2 (rubber bonded to steel), 2e-2 (Extended Tube) and 1e-2 (contacts); the plasticity cube and the friction block do not converge | of the 34 with a direct solver, 33 within 2e-5 and the bar with cutbacks 1e-4 |
| Samples (13) | 9 within 3e-3; the bushing 1e-1, the sandwich spring 5e-2, the material test 2e-2; the metacone does not converge (NaN) | all within 2e-5, the plastic plate 3e-4 (its tolerance) |
| Cube, 27,783 dofs, u-p-J | 13 s, 595 MB | 22 s, 826 MB |

Each value is the largest deviation from the curves of double precision at the same tolerance of the job, relative to the largest force of a curve (without curves of zero force). Double precision takes 45 s and 1083 MB for the cube. With the linear equation system in single precision, the Newton iterations are the same (at the tight tolerance 1.49e-8, the linear elastic and the plasticity cube take a few more), and the samples are up to 1.4 times faster (the sandwich spring 2.0 s instead of 2.8 s). One is slower: u-p-J fields of tetrahedrons (`fem.FieldsMixed`, an indefinite system), where SuperLU of FElupe falls back to a factorization with pivoting in 11 of 16 solves (the hex-tet sample 2.3 s instead of 0.75 s).

The model in `float32` has two problems in FElupe 12.1, and one of its own:

- `fem.field.merge` reloads the regions in double precision (adtzlr/felupe#1293). Every model of the app goes through the merge, so the script would have to cast the regions again after it.
- The default `atol` is 50 to 150 times the actual round-off of the residual forces, and the iteration stops before it converges: with an explicit `atol` near the round-off, the material test agrees to 2e-4 and the bushing to 5e-5 (adtzlr/felupe#1294). An explicit `atol` depends on the units and the model, so it is no option for the app.
- Rubber bonded to steel (`E = 210000`, `mu = 0.5`) is beyond the precision of `float32`: in the sandwich spring, the round-off of the residual forces is 6 % of the reaction forces. The bushing has the same materials and agrees to 5e-5 (with an explicit `atol`), so the limit depends on the model, not on the materials alone.

## Decision

- **First, the linear equation system in single precision, the model in double precision.** The linear solver of a job (#203) gets a precision: `solver.precision` is `double` (the default) or `single`, for the direct solvers `superlu` and `spsolve`. The matrix and the right-hand side are cast to `float32`, the factorization is in `float32`, and the increment is returned in `float64`. Regions, fields, the assembly, the residual forces and the convergence check stay in double precision, so the results agree with double precision to the tolerance of the job, also for rubber bonded to steel.
- **A setting of the job, not of the model:** the regions and the fields do not change, the precision belongs to the linear solver like its type. Two jobs of one model can differ, e.g. a quick one in single precision and the final one in double precision.
- **The script:** a helper, embedded only in scripts that use it, wraps the solver, e.g. `job.evaluate(x0=field, tol=0.01, solver=single_precision(fem.solve.SuperLUSolver()))` and `single_precision(spsolve)`:

  ```python
  def single_precision(solver):
      """Return a linear solver which solves in single precision (float32), with the
      increment in the precision of the right-hand side (float64)."""

      def solve(A, b):
          return solver(A.astype(np.float32), b.astype(np.float32)).astype(b.dtype)

      return solve
  ```

- **The tolerance** of the job stays as it is: the Newton iteration is in double precision. Near the solution it converges linearly instead of quadratically (with a rate of the round-off of the factorization), which costs a few iterations only at tight tolerances.
- **The app:** the solver fields of the job form get *Precision*: *Double* or *Single (float32)*, with one line: half the memory of the factorization, the results of double precision, a few more iterations at tight tolerances. Iterative solvers have no precision (schema). The job panel and the description of the solver say *single precision*. The MCP server and the agent tools take it from the schema.
- **Then, the model in single precision** (#297, with FElupe 12.1.1, which has adtzlr/felupe#1293 and #1294): it halves also the gradients, the stresses, the tangents and the matrix, and it is faster still.
  - `model.settings.precision` is `double` (the default) or `single`. It is a model setting, because the regions and the fields are built once for all jobs.
  - The script has `DTYPE = np.float32` at its top, the regions `.astype(DTYPE)` and the fields `dtype=DTYPE`, also of the control points, the face sets and `mixed_field`.
  - Its accuracy depends on the model, so each job of a model in single precision reports an estimate of the round-off of the forces relative to the reaction forces (`felupe_studio.runner.RoundOff`). The estimate is the largest absolute tolerance of the Newton-Raphson method (FElupe's estimate of the round-off of the residual forces) over the largest norm of the reaction forces, of the converged iterations.
  - Measured with FElupe 12.1.1 on the golden cases and the samples, the curves deviate from double precision by about a tenth of the estimate. Below 1e-2 they agree within 1e-3, e.g. the bushing (5e-5, estimate 8e-4) and the material test (2e-4, estimate 4e-3), or within the tolerance of the job: the elastic-plastic plate deviates by 2e-3 at its tolerance of 0.01 and by 3e-5 at 1e-6. Above it, the job panel warns and suggests double precision: the sandwich spring, steel bonded to rubber (4e-2, estimate 0.43); the shear mount (3e-3, estimate 8e-2); the metacone (3e-3, estimate 3e-2).
  - The friction block (golden case) does not converge in single precision.
  - The elastic-plastic material of FElupe returns its tangent in double precision, so the linear equation system of a model with it stays in double precision.

## Consequences

- Large models with a direct solver need about a quarter less memory and are faster, with the results of double precision. The memory of the matrix is not halved: the matrix of double precision is kept by the Newton iteration while the one of single precision is factorized.
- No change of regions, fields, results and exports: the recorder, the curves and the files stay in double precision.
- An ill-conditioned linear equation system (a condition number above about 1e7, the inverse of the machine epsilon of `float32`) may converge slowly or not at all in single precision; then the solver of double precision is the fallback. None of the golden cases and samples is affected. Indefinite systems (u-p-J fields of tetrahedrons) are slower, see above.
- Tests: a golden case with its script; every golden case with a direct solver once more in single precision against its curves (relative 1e-4); codegen, the schema and the shared validation cases (Python and TypeScript), the description of the solver.
- `docs/benchmarks.md` gets the cube in both precisions, in CPython and in Pyodide (the benchmark of Help ▸ About with the solver in single precision).

## Alternatives

- **The model in single precision now**, with the regions cast again after the merge and an explicit `atol`: deviations of up to 10 % with the default `atol` of FElupe 12.1, an explicit one depends on the model; later, see above.
- **Precision as a model setting** (`model.settings`, as planned in #152): right for the model in single precision, whose regions and fields are built once for all jobs, but the linear solver is a setting of the job.
- **Iterative solvers in single precision:** their memory is the matrix only, and in `float32` they do not reach a relative tolerance of 1e-4 for the ill-conditioned systems of rubber with steel. Not now.
- **PyPardiso in single precision** (in the local runtime, ADR 0014): with PyPardiso as a solver of a job, later; the same `precision` applies.
