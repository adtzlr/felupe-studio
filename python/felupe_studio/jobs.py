"""The parts of the script of the steps and the jobs (ADR 0018).

The steps with their items and ramps, the jobs (or characteristic curves) of the
steps and their evaluation with the settings of the Newton-Raphson method and of the
linear solver.
"""

from .formatting import (
    LINE_LENGTH,
    Call,
    Dict,
    List,
    assign,
    call,
    explode,
    quote,
    vector,
    wrap,
)
from .loadcases import moving

# the default tolerance of the Newton-Raphson method: the norm of the residual forces
# relative to a reference force (the reaction forces, or the forces between the items
# like a pressure on a solid body if they are larger, FElupe 12.1), looser than
# FElupe's default (the square root of the machine epsilon) like commercial codes (#176)
TOL = 0.01

# the direct linear solvers of a job by their type: SuperLU of FElupe, spsolve of
# SciPy (#203) and PARDISO of Intel oneMKL (#308)
DIRECT = {
    "superlu": "fem.solve.SuperLUSolver()",
    "spsolve": "spsolve",
    "pardiso": "pypardiso.spsolve",
}

# the parameters of fem.CutbackPlugin of the settings of a cutback (#133)
CUTBACK = {"factor": float, "max_cutbacks": int, "growth": float}


def evaluate_options(job):
    """Return the keyword arguments of ``Job.evaluate()`` of a ``job.add`` command,
    besides ``x0``: the settings of the Newton-Raphson method, the tolerance always
    (:data:`TOL` by default) and the maximum number of iterations if it is given.

    Examples
    --------
    >>> evaluate_options({"name": "job_1", "steps": ["step_1"]})
    {'tol': 0.01}
    >>> evaluate_options({"name": "job_1", "steps": ["step_1"], "tol": 0.05})
    {'tol': 0.05}
    >>> evaluate_options({"name": "job_1", "steps": ["step_1"], "maxiter": 30})
    {'tol': 0.01, 'maxiter': 30}
    """
    options = {"tol": float(job.get("tol", TOL))}
    if "maxiter" in job:
        options["maxiter"] = int(job["maxiter"])
    return options


def solver_rtol(job):
    """Return the relative tolerance of the iterative linear solver of a ``job.add``
    command (#203): its ``rtol`` if given, else two orders of magnitude finer than
    the tolerance of the job, since an inexact linear solve makes the Newton
    iteration converge linearly with a rate of about ``rtol``.

    Examples
    --------
    >>> solver_rtol({"solver": {"type": "iterative", "method": "minres"}})
    0.0001
    >>> solver_rtol({"tol": 1.49e-8, "solver": {"type": "iterative"}})
    1.49e-10
    >>> solver_rtol({"solver": {"type": "iterative", "rtol": 1e-6}})
    1e-06
    """
    solver = job.get("solver", {})
    if "rtol" in solver:
        return float(solver["rtol"])
    return float(f"{float(job.get('tol', TOL)) / 100:.6g}")


def solver_source(job):
    """Return the source of the linear solver of a ``job.add`` command for
    ``Job.evaluate(solver=...)`` (#203), or None for the default of FElupe.

    Examples
    --------
    >>> solver_source({"solver": {"type": "superlu"}})
    'fem.solve.SuperLUSolver()'
    >>> solver_source({"solver": {"type": "spsolve"}})
    'spsolve'
    >>> solver_source({"solver": {"type": "iterative", "method": "cg", "maxiter": 500}})
    'iterative_solver("cg", rtol=0.0001, maxiter=500)'
    >>> solver_source({"solver": {"type": "superlu", "precision": "single"}})
    'single_precision(fem.solve.SuperLUSolver())'
    >>> solver_source({"solver": {"type": "pardiso"}})
    'pypardiso.spsolve'
    >>> solver_source({}) is None
    True
    """
    solver = job.get("solver")
    if solver is None:
        return None
    if solver["type"] in DIRECT:
        source = DIRECT[solver["type"]]
        # the linear equation system in single precision (ADR 0016)
        if solver.get("precision") == "single":
            return f"single_precision({source})"
        return source
    args = [quote(solver.get("method", "minres")), f"rtol={solver_rtol(job)!r}"]
    if "maxiter" in solver:
        args.append(f"maxiter={int(solver['maxiter'])}")
    return f"iterative_solver({', '.join(args)})"


def uses_pardiso(jobs):
    """Whether a job solves with PARDISO, which the script imports (#308)."""
    return any(job.get("solver", {}).get("type") == "pardiso" for job in jobs)


def uses_solver_helpers(jobs):
    """Whether a linear solver of the jobs needs the helpers of the solvers."""
    return any(
        job.get("solver", {}).get("type") in ("spsolve", "iterative")
        or job.get("solver", {}).get("precision") == "single"
        for job in jobs
    )


def cutback_options(job):
    """Return the keyword arguments of ``fem.CutbackPlugin`` of a ``job.add`` command
    with a cutback, the parameters that are given (``None`` without a cutback).

    Examples
    --------
    >>> cutback_options({"cutback": {"factor": 0.25}})
    {'factor': 0.25}
    >>> cutback_options({"cutback": {}})
    {}
    >>> cutback_options({}) is None
    True
    """
    if "cutback" not in job:
        return None
    cutback = job["cutback"]
    return {key: kind(cutback[key]) for key, kind in CUTBACK.items() if key in cutback}


def ramp_value(item, num):
    """Return the values of a ramped item over the substeps of a step as an
    expression: ``fem.math.linsteps([start, end], num)``, or of a boundary with one
    value per constrained component ``np.linspace(start, end, num + 1)``, one row per
    substep (#225).

    Examples
    --------
    >>> str(ramp_value({"target": "move", "end": 0.5}, 5))
    'fem.math.linsteps([0, 0.5], num=5)'
    >>> str(ramp_value({"target": "move", "start": -0.5, "end": 0.5}, 2))
    'fem.math.linsteps([-0.5, 0.5], num=2)'
    >>> str(ramp_value({"target": "move", "end": [0.2, -0.1]}, 5))
    'np.linspace([0, 0], [0.2, -0.1], 6)'
    >>> str(ramp_value({"target": "move", "start": [0.1, 0], "end": 0.3}, 2))
    'np.linspace([0.1, 0], [0.3, 0.3], 3)'
    """
    start, end = item.get("start", 0), item["end"]
    if not isinstance(start, list) and not isinstance(end, list):
        return Call("fem.math.linsteps", [f"[{start!r}, {end!r}]", f"num={num!r}"])
    # a number of a list ramp applies to all components
    count = len(end) if isinstance(end, list) else len(start)
    start, end = ([v] * count if not isinstance(v, list) else v for v in (start, end))
    return Call(
        "np.linspace", [List(map(repr, start)), List(map(repr, end)), repr(num + 1)]
    )


def ramped(context, name, values):
    """The entries of the ramp of a step of an item: a boundary, the moving
    boundaries of a load case, a point load (its force, scaled by the values) or a
    pressure (scaled by the values)."""
    if name in context.loads:
        load = context.loads[name]
        force = vector(context.components(load["force"], load["points"]))
        return [f"{name}: np.outer({values}, {force})"]
    if name in context.pressures:
        return [f"{name}: {context.pressures[name]['pressure']!r} * {values}"]
    if name not in context.loadcases:
        return [f"boundaries[{quote(name)}]: {values}"]
    return [
        f"boundaries[{quote(name + '/' + key)}]: {'' if sign > 0 else '-'}{values}"
        for key, sign in moving(context.loadcases[name])
    ]


def ramp_arrays(step):
    """The lines of the ramp of a step and the array of every ramped item: one array
    if the values of all items are the same, else an array per item, in the order of
    the items."""
    r, ramp = step["ramp"], f"ramp_{step['name']}"
    values = {item["target"]: ramp_value(item, r["num"]) for item in r["items"]}
    if len({str(v) for v in values.values()}) == 1:
        lines = [assign(ramp, values[r["items"][0]["target"]])]
        return lines, {target: ramp for target in values}
    lines = [f"{ramp} = ["]
    for item in r["items"]:
        value = values[item["target"]]
        line = f"    {value},  # {item['target']}"
        if len(line) > LINE_LENGTH and isinstance(value, Call):
            line = f"    {value.exploded(1)},  # {item['target']}"
        lines.append(line)
    lines.append("]")
    arrays = {item["target"]: f"{ramp}[{i}]" for i, item in enumerate(r["items"])}
    return lines, arrays


def step_items(context, step):
    """The items of a step: the solid bodies of its sections, its constraints and
    its loads, all of them by default."""
    names = step.get("sections", [s["name"] for s in context.sections])
    constraints = [c["name"] for c in context.get("mpc.add", "contact.add")]
    return (
        ["solid_" + n for n in names]
        + step.get("constraints", constraints)
        + step.get("loads", [*context.loads, *context.pressures])
    )


def switches(steps):
    """Whether a step has not all boundaries, so that steps switch boundaries on and
    off (#393)."""
    return any("boundaries" in step for step in steps)


def held_sections(context, step):
    """The sections that a step leaves out whose dual fields it holds (#428): those of
    the formulation u-p-J, which may have mixed fields (``mixed_field`` decides by the
    type of the cells when the script runs)."""
    if "sections" not in step:
        return []
    return [
        sec["name"]
        for sec in context.sections
        if sec["name"] not in step["sections"] and sec["formulation"] == "u-p-J"
    ]


def holds(context):
    """Whether a step leaves out a section whose dual fields it holds (#428)."""
    return any(held_sections(context, step) for step in context.get("step.add"))


def step_boundaries(step, held=()):
    """The boundaries of a step: all of them by default, or those of its boundaries,
    load cases and symmetry planes (#393), and those that hold the dual fields of the
    held sections (#428).

    Examples
    --------
    >>> step_boundaries({"name": "pull"})
    'boundaries=boundaries'
    >>> str(step_boundaries({"name": "release", "boundaries": ["fixed", "tension"]}))
    'boundaries=pick(boundaries, ["fixed", "tension"])'
    >>> str(step_boundaries({"name": "pull", "sections": ["hexahedrons"]}, ["tets"]))
    'boundaries={**boundaries, **hold_dual_fields(field, field_tets)}'
    """
    prefix = "**" if held else "boundaries="
    if "boundaries" in step:
        names = List(map(quote, step["boundaries"]))
        chosen = Call(f"{prefix}pick", ["boundaries", names])
    else:
        chosen = f"{prefix}boundaries"
    if not held:
        return chosen
    fields = [f"field_{name}" for name in held]
    hold = Call("**hold_dual_fields", ["field", *fields])
    return Dict([chosen, hold], prefix="boundaries=")


def step_add(context, step):
    """A step, after its ramp."""
    lines, args = [], [List(step_items(context, step), prefix="items=")]
    if "ramp" in step:
        lines, arrays = ramp_arrays(step)
        entries = [e for t, v in arrays.items() for e in ramped(context, t, v)]
        args.append(Dict(entries, prefix="ramp="))
    args.append(step_boundaries(step, held_sections(context, step)))
    return [*lines, f"{step['name']} = fem.Step(\n{explode(args)})"]


def boundary_switch(context):
    """The plugin of the jobs that sets the values of the boundaries that a step
    switches on (#393): the steps whose values are those at the start of the job."""
    steps = [
        s["name"] for s in context.get("step.add") if s.get("switched_on") == "job"
    ]
    args = [List(steps, prefix="job_start=")] if steps else []
    return [
        "\n# the boundaries that a step switches on take the displacements of their "
        "points at\n# the start of the step, or of the job",
        call("boundary_switch", "BoundarySwitch", args),
    ]


def curve(context, name):
    """The boundary of a characteristic curve (of a load case: its first move), or a
    point load (the displacement of its first point over its total force)."""
    if name in context.loads:
        return name
    if name in context.loadcases:
        name = f"{name}/{moving(context.loadcases[name])[0][0]}"
    return f"boundaries[{quote(name)}]"


def job_add(context, job):
    """A job, or a characteristic curve of a boundary or a point load."""
    args = [List(job["steps"], prefix="steps=")]
    if "curve" in job:
        args.append(f"boundary={curve(context, job['curve'])}")
        if job["curve"] in context.loads:
            # the force of a load: the sum of the internal forces at its points
            reacting = context.solids + [c["name"] for c in context.constraints]
            args.append(List(reacting, prefix="items="))
    # the values of the boundaries switched on (#393) before a cutback, which
    # subdivides the substeps with them
    plugins = ["boundary_switch"] if switches(context.get("step.add")) else []
    cutback = cutback_options(job)
    if cutback is not None:
        options = ", ".join(f"{k}={v!r}" for k, v in cutback.items())
        plugins.append(f"fem.CutbackPlugin({options})")
    if plugins:
        args.append(List(plugins, prefix="plugins="))
    func = "fem.CharacteristicCurve" if "curve" in job else "fem.Job"
    return [call(job["name"], func, args)]


def evaluation(job):
    """The evaluation of a job with the settings of the Newton-Raphson method and of
    the linear solver."""
    args = ["x0=field"]
    args += [f"{k}={v!r}" for k, v in evaluate_options(job).items()]
    solver = solver_source(job)
    if solver is not None:
        args.append(f"solver={solver}")
    return wrap(f"{job['name']}.evaluate", args)


STEPS = {"step.add": step_add}
JOBS = {"job.add": job_add}


def steps(context):
    """The part of the steps, with the plugin of the boundaries that they switch on
    (#393)."""
    lines = context.emit(STEPS, "# steps")
    if switches(context.get("step.add")):
        lines += boundary_switch(context)
    return lines


def jobs(context):
    """The part of the jobs, and of their evaluation."""
    lines = context.emit(JOBS, "# jobs")
    if lines and context.evaluate:
        lines += ["", *(evaluation(job) for job in context.get("job.add"))]
    return lines
