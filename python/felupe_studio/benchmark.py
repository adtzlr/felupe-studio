"""Benchmark of FElupe for the Pyodide spike (#9).

The same module runs in CPython (tests, native reference) and in Pyodide (browser).
It times a uniaxial tension test of a hyperelastic cube for several mesh sizes.
"""

from time import perf_counter

import numpy as np


def benchmark(n=5, num=5):
    r"""Run a uniaxial tension test of a unit cube with ``n`` points per edge.

    Parameters
    ----------
    n : int, optional
        Number of points per edge of the cube (default is 5).
    num : int, optional
        Number of load increments (default is 5).

    Returns
    -------
    dict
        Number of points, cells and degrees of freedom, timings in seconds for the
        model setup and the solution, and the final reaction force.
    """
    import felupe as fem

    t0 = perf_counter()
    mesh = fem.Cube(n=n)
    region = fem.RegionHexahedron(mesh)
    field = fem.FieldContainer([fem.Field(region, dim=3)])
    boundaries = fem.dof.uniaxial(field, clamped=True)
    umat = fem.NeoHookeCompressible(mu=1.0, lmbda=2.0)
    solid = fem.SolidBody(umat, field)
    move = fem.math.linsteps([0, 1], num=num)
    step = fem.Step(
        items=[solid], ramp={boundaries["move"]: move}, boundaries=boundaries
    )
    job = fem.CharacteristicCurve(steps=[step], boundary=boundaries["move"])

    t1 = perf_counter()
    job.evaluate(verbose=0)
    t2 = perf_counter()

    return {
        "n": n,
        "points": int(mesh.npoints),
        "cells": int(mesh.ncells),
        "dofs": int(field[0].values.size),
        "increments": num,
        "setup": t1 - t0,
        "solve": t2 - t1,
        "force": float(np.array(job.y)[-1, 0]),
    }
