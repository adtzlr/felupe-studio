"""Benchmark of FElupe for the Pyodide spike (#9).

The same module runs in CPython (tests, native reference) and in Pyodide (browser).
It times a uniaxial tension test of a hyperelastic cube for several mesh sizes, in
double precision, with the linear equation system in single precision, or with the
model in single precision (ADR 0016).
"""

from time import perf_counter

import numpy as np


def benchmark(n=5, num=5, precision="double"):
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

    Returns
    -------
    dict
        Number of points, cells and degrees of freedom, the precision, timings in
        seconds for the model setup and the solution, and the final reaction force.
    """
    import felupe as fem

    t0 = perf_counter()
    mesh = fem.Cube(n=n)
    region = fem.RegionHexahedron(mesh)
    dtype = None
    if precision == "model":
        dtype = np.float32
        region = region.astype(dtype)
    field = fem.FieldContainer([fem.Field(region, dim=3, dtype=dtype)])
    boundaries = fem.dof.uniaxial(field, clamped=True)
    umat = fem.NeoHookeCompressible(mu=1.0, lmbda=2.0)
    solid = fem.SolidBody(umat, field)
    move = fem.math.linsteps([0, 1], num=num)
    step = fem.Step(
        items=[solid], ramp={boundaries["move"]: move}, boundaries=boundaries
    )
    job = fem.CharacteristicCurve(steps=[step], boundary=boundaries["move"])

    solver = fem.solve.SuperLUSolver()
    if precision == "single":
        from ._helpers import single_precision

        solver = single_precision(solver)

    t1 = perf_counter()
    job.evaluate(verbose=0, solver=solver)
    t2 = perf_counter()

    return {
        "n": n,
        "points": int(mesh.npoints),
        "cells": int(mesh.ncells),
        "dofs": int(field[0].values.size),
        "increments": num,
        "precision": precision,
        "setup": t1 - t0,
        "solve": t2 - t1,
        "force": float(np.array(job.y)[-1, 0]),
    }
