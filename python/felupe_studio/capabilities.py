"""The linear solvers that not every runtime has (#308): PARDISO of Intel oneMKL
(the package pypardiso) runs only in Python on the computer, e.g. of
``felupe-studio serve``, because MKL has no build for WebAssembly (Pyodide).

:func:`capabilities` says what the runtime has, :func:`capability_issues` which
jobs of a model it can not run, like ``capabilityIssues()`` of the app
(``app/src/core/capabilities.ts``). A model stays the same in every runtime: these
issues are of the runtime, not of the model, and they are not part of
:func:`felupe_studio.commands.errors`.
"""

import sys
import warnings
from functools import cache
from importlib.metadata import PackageNotFoundError, version
from importlib.util import find_spec

__all__ = ["capabilities", "capability_errors", "capability_issues"]


def _single(pypardiso):
    """Whether a PyPardiso factorizes in single precision (float32), e.g. the one of
    adtzlr/PyPardiso: PyPardiso 0.4 raises a TypeError for a matrix in float32."""
    import numpy as np
    from scipy import sparse

    A = sparse.csr_matrix(np.ones((1, 1), dtype=np.float32))
    try:
        with warnings.catch_warnings():
            warnings.simplefilter("ignore")
            x = pypardiso.spsolve(A, np.ones(1, dtype=np.float32))
    except Exception:
        return False
    return x.dtype == np.float32


@cache
def capabilities():
    """Return what the runtime has: ``runtime`` (``"pyodide"`` in the browser, else
    ``"python"``) and ``pardiso`` with the ``version`` of pypardiso and whether it
    factorizes in ``single`` precision, if it is installed."""
    result = {"runtime": "pyodide" if sys.platform == "emscripten" else "python"}
    if find_spec("pypardiso") is None:
        return result
    try:
        import pypardiso
    except Exception:
        # e.g. without the library of MKL: as if it were not installed, so that
        # the runtime starts
        return result

    try:
        installed = version("pypardiso")
    except PackageNotFoundError:
        installed = getattr(pypardiso, "__version__", "unknown")
    result["pardiso"] = {"version": installed, "single": _single(pypardiso)}
    return result


def _single_precision(job, commands):
    """Whether the linear equation system of a job is in single precision: of its
    solver (ADR 0016), or of the model (#297)."""
    model = any(
        c.get("precision") == "single"
        for c in commands
        if c["command"] == "model.settings"
    )
    return model or job.get("solver", {}).get("precision") == "single"


def capability_issues(commands, available=None):
    """Return the issues of the jobs whose linear solver the runtime does not have,
    as ``{"index", "name", "message", "field"}`` like the issues of the app.

    Parameters
    ----------
    commands : list of dict
        The commands of a model.
    available : dict, optional
        What the runtime has, see :func:`capabilities` (default: this Python).

    Examples
    --------
    >>> jobs = [{"command": "job.add", "name": "job_1", "steps": ["step_1"],
    ...          "solver": {"type": "pardiso"}}]
    >>> print(capability_issues(jobs, {"runtime": "python"})[0]["message"])
    PARDISO needs the package pypardiso: pip install pypardiso.
    >>> capability_issues(jobs, {"runtime": "python",
    ...                          "pardiso": {"version": "0.4.7", "single": False}})
    []
    """
    available = capabilities() if available is None else available
    pardiso = available.get("pardiso")
    issues = []
    for index, job in enumerate(commands):
        if job["command"] != "job.add":
            continue
        if job.get("solver", {}).get("type") != "pardiso":
            continue
        issue = {"index": index, "name": job["name"], "field": "solver.type"}
        if pardiso is None and available.get("runtime") == "pyodide":
            message = (
                "PARDISO needs Python on your computer (felupe-studio serve): "
                "Intel oneMKL has no build for the browser."
            )
        elif pardiso is None:
            message = "PARDISO needs the package pypardiso: pip install pypardiso."
        elif not pardiso["single"] and _single_precision(job, commands):
            message = (
                f"PyPardiso {pardiso['version']} solves only in double precision: "
                "choose double precision, or install a PyPardiso that factorizes "
                "in float32 (e.g. adtzlr/PyPardiso)."
            )
            if job["solver"].get("precision") == "single":
                issue["field"] = "solver.precision"
        else:
            continue
        issues.append({**issue, "message": message})
    return issues


def capability_errors(commands, available=None):
    """Return the messages of :func:`capability_issues`, prefixed by
    ``commands/<index>: `` like :func:`felupe_studio.commands.errors`."""
    return [
        f"commands/{issue['index']}: {issue['message']}"
        for issue in capability_issues(commands, available)
    ]
