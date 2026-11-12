"""The linear solver of a job (#203): SuperLU of FElupe (the default), spsolve of
SciPy or an iterative method of SciPy with a relative tolerance from the tolerance
of the job."""

import copy
import json
from pathlib import Path

import numpy as np
import pytest

from felupe_studio.codegen import codegen, solver_rtol, solver_source
from felupe_studio.commands import errors
from felupe_studio.runner import run

GOLDEN = Path(__file__).parent / "golden"


def load(case):
    return json.loads((GOLDEN / case / "commands.json").read_text(encoding="utf-8"))


def with_solver(solver, **job):
    document = copy.deepcopy(load("bar_single_body"))
    command = next(c for c in document["commands"] if c["command"] == "job.add")
    command.update(job)
    if solver is not None:
        command["solver"] = solver
    return document


def test_sources_of_the_solvers():
    assert solver_source({}) is None
    assert solver_source({"solver": {"type": "superlu"}}) == (
        "fem.solve.SuperLUSolver()"
    )
    assert solver_source({"solver": {"type": "spsolve"}}) == "spsolve"
    # rtol two orders of magnitude finer than the tolerance of the job, or given
    iterative = {"type": "iterative", "method": "minres"}
    assert solver_source({"solver": iterative}) == (
        'iterative_solver("minres", rtol=0.0001)'
    )
    assert solver_rtol({"tol": 1.49e-8, "solver": iterative}) == 1.49e-10
    assert solver_rtol({"tol": 0.03, "solver": iterative}) == 0.0003
    assert solver_source(
        {"tol": 0.05, "solver": {**iterative, "rtol": 1e-6, "maxiter": 200}}
    ) == ('iterative_solver("minres", rtol=1e-06, maxiter=200)')


def test_scripts_embed_the_helpers_only_when_needed():
    def script(solver):
        return codegen(with_solver(solver))

    default = script(None)
    assert "solver=" not in default and "def iterative_solver" not in default
    superlu = script({"type": "superlu"})
    assert "tol=0.01, solver=fem.solve.SuperLUSolver())" in superlu
    assert "def spsolve" not in superlu
    spsolve = script({"type": "spsolve"})
    assert "job_1.evaluate(x0=field, tol=0.01, solver=spsolve)" in spsolve
    assert "def spsolve(A, b):" in spsolve and "def iterative_solver(" in spsolve
    cg = script({"type": "iterative", "method": "cg", "maxiter": 50})
    assert 'solver=iterative_solver("cg", rtol=0.0001, maxiter=50)' in cg


def test_options_of_an_iterative_solver_need_one():
    # method, rtol and maxiter only with an iterative solver
    document = with_solver({"type": "spsolve", "rtol": 1e-4})
    assert errors(document)
    assert errors(with_solver({"type": "iterative"}))  # the method is required
    assert errors(with_solver({"type": "iterative", "method": "lsqr"}))
    assert errors(with_solver({"type": "iterative", "method": "cg", "rtol": 1}))
    assert errors(with_solver({"type": "iterative", "method": "cg"})) == []
    # the names of the helpers are reserved
    document = with_solver(None)
    document["commands"][0]["name"] = "spsolve"
    assert any("reserved" in e for e in errors(document))


@pytest.mark.parametrize(
    "solver",
    [
        {"type": "superlu"},
        {"type": "spsolve"},
        {"type": "iterative", "method": "minres"},
        {"type": "iterative", "method": "cg"},
        {"type": "iterative", "method": "gmres"},
        {"type": "iterative", "method": "bicgstab"},
    ],
)
def test_runs_with_the_solver(solver, monkeypatch):
    # the curve of the direct solver within the tolerance of the job
    monkeypatch.chdir(GOLDEN / "bar_single_body")
    expected = json.loads((GOLDEN / "bar_single_body" / "results.json").read_text())
    force = expected["jobs"]["job_1"]["force"]
    results = run(with_solver(solver))
    np.testing.assert_allclose(
        np.array(results["job_1"]["y"])[:, 0], force, rtol=0, atol=0.01 * max(force)
    )


def test_an_iterative_solver_that_does_not_converge_fails_the_job(monkeypatch):
    monkeypatch.chdir(GOLDEN / "bar_single_body")
    solver = {"type": "iterative", "method": "cg", "maxiter": 1}
    with pytest.raises(RuntimeError, match="The linear solver cg did not converge"):
        run(with_solver(solver))
