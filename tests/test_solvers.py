"""The linear solver of a job (#203): SuperLU of FElupe (the default), spsolve of
SciPy or an iterative method of SciPy with a relative tolerance from the tolerance
of the job; the direct solvers also in single precision (ADR 0016)."""

import copy
import json
import sys
from pathlib import Path

import felupe as fem
import numpy as np
import pytest
from scipy import sparse

from felupe_studio import capabilities as capabilities_
from felupe_studio._helpers import single_precision
from felupe_studio.capabilities import capability_errors, capability_issues
from felupe_studio.codegen import codegen, solver_rtol, solver_source
from felupe_studio.commands import ValidationError, errors
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
    # the linear equation system in single precision (ADR 0016)
    single = {"precision": "single"}
    assert solver_source({"solver": {"type": "superlu", **single}}) == (
        "single_precision(fem.solve.SuperLUSolver())"
    )
    assert solver_source({"solver": {"type": "spsolve", **single}}) == (
        "single_precision(spsolve)"
    )
    assert solver_source({"solver": {"type": "superlu", "precision": "double"}}) == (
        "fem.solve.SuperLUSolver()"
    )
    # PARDISO of Intel oneMKL (#308)
    assert solver_source({"solver": {"type": "pardiso"}}) == "pypardiso.spsolve"
    assert solver_source({"solver": {"type": "pardiso", **single}}) == (
        "single_precision(pypardiso.spsolve)"
    )


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
    single = script({"type": "superlu", "precision": "single"})
    assert "solver=single_precision(fem.solve.SuperLUSolver()))" in single
    assert "def single_precision(solver):" in single
    assert "def single_precision" not in superlu


def test_options_of_an_iterative_solver_need_one():
    # method, rtol and maxiter only with an iterative solver
    document = with_solver({"type": "spsolve", "rtol": 1e-4})
    assert errors(document)
    assert errors(with_solver({"type": "iterative"}))  # the method is required
    assert errors(with_solver({"type": "iterative", "method": "lsqr"}))
    assert errors(with_solver({"type": "iterative", "method": "cg", "rtol": 1}))
    assert errors(with_solver({"type": "iterative", "method": "cg"})) == []
    # the precision only of a direct solver (ADR 0016)
    assert errors(with_solver({"type": "superlu", "precision": "single"})) == []
    assert errors(with_solver({"type": "spsolve", "precision": "double"})) == []
    assert errors(with_solver({"type": "superlu", "precision": "half"}))
    iterative = {"type": "iterative", "method": "cg", "precision": "single"}
    assert errors(with_solver(iterative))
    # the names of the helpers are reserved
    document = with_solver(None)
    document["commands"][0]["name"] = "spsolve"
    assert any("reserved" in e for e in errors(document))


@pytest.mark.parametrize(
    "solver",
    [
        {"type": "superlu"},
        {"type": "spsolve"},
        {"type": "superlu", "precision": "single"},
        {"type": "spsolve", "precision": "single"},
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


def test_single_precision_solves_in_float32():
    # the matrix and the right-hand side in float32, the increment back in float64
    calls = []

    def solver(A, b):
        calls.append((A.dtype, b.dtype))
        return fem.solve.SuperLUSolver()(A, b)

    A = sparse.random(20, 20, density=0.3, random_state=0) + 20 * sparse.eye(20)
    b = np.ones(20)
    x = single_precision(solver)(A, b)
    assert calls == [(np.float32, np.float32)] and x.dtype == np.float64
    np.testing.assert_allclose(A @ x, b, rtol=1e-5)


def test_scripts_import_pypardiso_only_when_needed():
    # PARDISO of Intel oneMKL (#308): the package only in scripts that use it
    assert "pypardiso" not in codegen(with_solver({"type": "superlu"}))
    script = codegen(with_solver({"type": "pardiso"}))
    assert "import numpy as np\nimport pypardiso\n" in script
    assert "job_1.evaluate(x0=field, tol=0.01, solver=pypardiso.spsolve)" in script
    assert "def spsolve" not in script
    single = codegen(with_solver({"type": "pardiso", "precision": "single"}))
    assert "solver=single_precision(pypardiso.spsolve))" in single
    assert "def single_precision(solver):" in single
    # the model does not depend on the runtime
    assert errors(with_solver({"type": "pardiso"})) == []


BROWSER = {"runtime": "pyodide"}
PYTHON = {"runtime": "python"}


def pardiso(single):
    return {"runtime": "python", "pardiso": {"version": "0.4.7", "single": single}}


def test_issues_of_the_runtime():
    # like capabilityIssues() of the app (app/src/core/capabilities.test.ts)
    def issues(solver, available, precision=None):
        document = with_solver(solver)
        if precision:
            settings = {"command": "model.settings", "name": "settings"}
            document["commands"].insert(0, {**settings, "precision": precision})
        return capability_issues(document["commands"], available)

    assert issues({"type": "superlu"}, BROWSER) == []
    assert issues(None, BROWSER) == []
    (issue,) = issues({"type": "pardiso"}, BROWSER)
    assert issue == {
        "index": 9,
        "name": "job_1",
        "field": "solver.type",
        "message": "PARDISO needs Python on your computer (felupe-studio serve): "
        "Intel oneMKL has no build for the browser.",
    }
    (issue,) = issues({"type": "pardiso"}, PYTHON)
    assert issue["message"] == (
        "PARDISO needs the package pypardiso: pip install pypardiso."
    )
    assert issues({"type": "pardiso"}, pardiso(False)) == []
    # single precision needs a PyPardiso that factorizes in float32
    single = {"type": "pardiso", "precision": "single"}
    (issue,) = issues(single, pardiso(False))
    assert issue["field"] == "solver.precision"
    assert issue["message"] == (
        "PyPardiso 0.4.7 solves only in double precision: choose double precision, "
        "or install a PyPardiso that factorizes in float32 (e.g. adtzlr/PyPardiso)."
    )
    # a model in single precision (#297): the matrix is in float32 anyway
    (issue,) = issues({"type": "pardiso"}, pardiso(False), precision="single")
    assert issue["field"] == "solver.type"
    assert issues(single, pardiso(True)) == []
    assert issues({"type": "pardiso"}, pardiso(True), precision="single") == []
    commands = with_solver({"type": "pardiso"})["commands"]
    assert capability_errors(commands, PYTHON) == [
        "commands/9: PARDISO needs the package pypardiso: pip install pypardiso."
    ]


def test_capabilities_of_this_python():
    available = capabilities_.capabilities()
    assert available["runtime"] == "python"
    try:
        import pypardiso  # noqa: F401
    except ImportError:
        assert "pardiso" not in available
    else:
        assert set(available["pardiso"]) == {"version", "single"}


def test_a_broken_pypardiso_is_not_installed(monkeypatch):
    # e.g. without the library of MKL: the runtime starts without PARDISO
    monkeypatch.setattr(capabilities_, "find_spec", lambda name: object())
    monkeypatch.setitem(sys.modules, "pypardiso", None)
    assert capabilities_.capabilities.__wrapped__() == PYTHON


def test_a_run_needs_the_solver_of_the_runtime(tmp_path, monkeypatch):
    monkeypatch.setattr(capabilities_, "capabilities", lambda: PYTHON)
    for path in (GOLDEN / "bar_single_body").iterdir():
        if path.suffix in (".vtu", ".msh", ".xdmf", ".h5"):
            (tmp_path / path.name).write_bytes(path.read_bytes())
    monkeypatch.chdir(tmp_path)
    with pytest.raises(ValidationError, match="needs the package pypardiso"):
        run(with_solver({"type": "pardiso"}))
