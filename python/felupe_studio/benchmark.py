"""Benchmark of FElupe for the Pyodide spike (#9).

The same module runs in CPython (tests, native reference) and in Pyodide (browser).
It times a uniaxial tension test of a hyperelastic cube for several mesh sizes, in
double precision, with the linear equation system in single precision, or with the
model in single precision (ADR 0016), with SuperLU of FElupe or, in CPython with the
package pypardiso, with PARDISO of Intel oneMKL (#308): compressible, or nearly
incompressible in one of the ways of u-p-J (#420).
"""

from time import perf_counter

import numpy as np

# the bulk modulus of the nearly incompressible cube (#420)
BULK = 5000.0


def _displacements(fem, region, dtype):
    return fem.FieldContainer([fem.Field(region, dim=3, dtype=dtype)])


def _astype(region, dtype):
    return region if dtype is None else region.astype(dtype)


def _compressible(fem, mesh, dtype):
    """The compressible Neo-Hooke of the displacements (u)."""
    field = _displacements(fem, _astype(fem.RegionHexahedron(mesh), dtype), dtype)
    return field, fem.SolidBody(fem.NeoHookeCompressible(mu=1.0, lmbda=2.0), field)


def _automatic(fem, mesh, dtype):
    """u-p-J of the helpers of the script: condensed per cell of hexahedrons (#226)."""
    from ._helpers import mixed_field, mixed_region, nearly_incompressible

    field = mixed_field(_astype(mixed_region(mesh), dtype), dtype=dtype)
    return field, nearly_incompressible(fem.NeoHooke(mu=1.0), field, bulk=BULK)


def _condensed(fem, mesh, dtype):
    """u-p-J-condensed: fem.SolidBodyNearlyIncompressible of the displacements."""
    from ._helpers import condensed_region

    field = _displacements(fem, _astype(condensed_region(mesh), dtype), dtype)
    umat = fem.NeoHooke(mu=1.0)
    return field, fem.SolidBodyNearlyIncompressible(umat, field, bulk=BULK)


def _mixed_fields(fem, mesh, dtype):
    from ._helpers import mixed_region

    return fem.FieldsMixed(_astype(mixed_region(mesh), dtype), n=3, dtype=dtype)


def _mixed(fem, mesh, dtype):
    """u-p-J-mixed: fem.NearlyIncompressible on mixed fields."""
    field = _mixed_fields(fem, mesh, dtype)
    umat = fem.NearlyIncompressible(fem.NeoHooke(mu=1.0), bulk=BULK)
    return field, fem.SolidBody(umat, field)


def _three_field(fem, mesh, dtype):
    """u-p-J-three-field: fem.ThreeFieldVariation of the material with its bulk
    modulus on mixed fields."""
    field = _mixed_fields(fem, mesh, dtype)
    umat = fem.ThreeFieldVariation(fem.NeoHooke(mu=1.0, bulk=BULK))
    return field, fem.SolidBody(umat, field)


# the field container and the solid body of the cube by its formulation (#420): the
# compressible Neo-Hooke of the displacements by default, else Neo-Hooke with the
# bulk modulus 5000 in a way of u-p-J
SOLIDS = {
    None: _compressible,
    "u-p-J": _automatic,
    "u-p-J-condensed": _condensed,
    "u-p-J-mixed": _mixed,
    "u-p-J-three-field": _three_field,
}


def benchmark(n=5, num=5, precision="double", solver="superlu", formulation=None):
    r"""Run a uniaxial tension test of a unit cube with ``n`` points per edge.

    Parameters
    ----------
    n : int, optional
        Number of points per edge of the cube (default is 5).
    num : int, optional
        Number of load increments (default is 5).
    precision : str, optional
        ``"double"`` (default), ``"single"`` for the linear equation system in single
        precision (``float32``, the model in double precision) or ``"model"`` for the
        model in single precision (the region and the field in ``float32``, #297),
        see ADR 0016.
    solver : str, optional
        ``"superlu"`` (default, ``fem.solve.SuperLUSolver``) or ``"pardiso"``
        (``pypardiso.spsolve``, #308). PARDISO in single precision needs a
        PyPardiso that factorizes in ``float32``, e.g. adtzlr/PyPardiso.
    formulation : str or None, optional
        None (default) for ``fem.NeoHookeCompressible(mu=1, lmbda=2)`` of the
        displacements, or a way of u-p-J (#420) for ``fem.NeoHooke(mu=1)`` with the
        bulk modulus 5000: ``"u-p-J"`` (automatic, condensed per cell of the
        hexahedrons), ``"u-p-J-condensed"``, ``"u-p-J-mixed"`` or
        ``"u-p-J-three-field"``.

    Returns
    -------
    dict
        Number of points, cells and degrees of freedom (of all fields), the precision,
        the solver, the formulation, timings in seconds for the model setup and the
        solution, the number of Newton iterations and the final reaction force.
    """
    import felupe as fem

    t0 = perf_counter()
    mesh = fem.Cube(n=n)
    dtype = np.float32 if precision == "model" else None
    field, solid = SOLIDS[formulation](fem, mesh, dtype)
    boundaries = fem.dof.uniaxial(field, clamped=True)
    move = fem.math.linsteps([0, 1], num=num)
    step = fem.Step(
        items=[solid], ramp={boundaries["move"]: move}, boundaries=boundaries
    )
    # the Newton iterations of every substep
    iterations = []
    job = fem.CharacteristicCurve(
        steps=[step],
        boundary=boundaries["move"],
        plugins=[lambda context, state: iterations.append(context.substep.iterations)],
    )

    if solver == "pardiso":
        import pypardiso

        solve = pypardiso.spsolve
    else:
        solve = fem.solve.SuperLUSolver()
    if precision == "single":
        from ._helpers import single_precision

        solve = single_precision(solve)

    t1 = perf_counter()
    job.evaluate(verbose=0, solver=solve)
    t2 = perf_counter()

    return {
        "n": n,
        "points": int(mesh.npoints),
        "cells": int(mesh.ncells),
        "dofs": int(sum(f.values.size for f in field.fields)),
        "increments": num,
        "precision": precision,
        "solver": solver,
        "formulation": formulation,
        "setup": t1 - t0,
        "solve": t2 - t1,
        "iterations": int(sum(iterations)),
        "force": float(np.array(job.y)[-1, 0]),
    }
