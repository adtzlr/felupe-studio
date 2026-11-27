"""The parts of the script of the steps and the jobs (ADR 0018).

The steps with their items and ramps, the jobs (or characteristic curves) of the
steps and their evaluation with the settings of the Newton-Raphson method and of the
linear solver.
"""

from .directions import components
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
from .formulations import formulation_of
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
    boundaries of a load case, a Cartesian or cylindrical constraint (its
    displacements, #421, #422), a point load (its force, scaled by the values) or a
    pressure (scaled by the values)."""
    if name in context.moved:
        return [f"{name}: {values}"]
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


def directions(context, item):
    """The ramped item of a step with the values of all directions of a Cartesian
    or cylindrical constraint (#421, #422), whose ramp is a table of its
    displacements: the values of the constrained directions and 0 of the free
    ones."""
    command = context.moved.get(item["target"])
    if command is None:
        return item
    return {
        **item,
        "start": components(command, item.get("start", 0), context.dim),
        "end": components(command, item["end"], context.dim),
    }


def ramp_arrays(context, step):
    """The lines of the ramp of a step and the array of every ramped item: one array
    if the values of all items are the same, else an array per item, in the order of
    the items."""
    r, ramp = step["ramp"], f"ramp_{step['name']}"
    values = {
        item["target"]: ramp_value(directions(context, item), r["num"])
        for item in r["items"]
    }
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


def step_sections(context, step):
    """The names of the sections of a step, all of them by default."""
    return step.get("sections", [s["name"] for s in context.sections])


def items(context, solids, others):
    """The items of a step or of the forces of a load: the solid bodies, of a script
    with meshes of scripts those with a volume (#429), and the other items."""
    if not context.volumes or not solids:
        return List([*solids, *others], prefix="items=")
    if not others:
        return Call("items=with_volume", solids)
    return List([Call("*with_volume", solids), *others], prefix="items=")


def bodycontact_sections(command):
    """The sections of the surfaces of a contact between bodies (#462)."""
    return {command["section"], command.get("primary", command["section"])}


def step_items(context, step):
    """The items of a step: the solid bodies of its sections, its constraints and
    its loads, all of them by default. A contact between bodies is not a default
    constraint of a step that leaves out one of its sections (#462); in a script with
    meshes of scripts, the contacts between bodies are those that the script made,
    without those of a section without volume (#429)."""
    sections = step_sections(context, step)
    constraints = [
        c["name"]
        for c in context.get(
            "mpc.add",
            "cartesian.add",
            "cylindrical.add",
            "contact.add",
            "bodycontact.add",
        )
        if c["command"] != "bodycontact.add" or bodycontact_sections(c) <= set(sections)
    ]
    others = step.get("constraints", constraints) + step.get(
        "loads", [*context.loads, *context.pressures]
    )
    if context.volumes:
        contacts = {c["name"] for c in context.bodycontacts}
        made = [name for name in others if name in contacts]
        if made:
            first = others.index(made[0])
            others = [name for name in others if name not in contacts]
            others.insert(first, Call("*present", made))
    return items(context, ["solid_" + n for n in sections], others)


def switches(steps):
    """Whether a step has not all boundaries, so that steps switch boundaries on and
    off (#393)."""
    return any("boundaries" in step for step in steps)


def held_sections(context, step):
    """The sections that a step leaves out whose dual fields it holds (#428): those of
    a formulation whose fields may be mixed fields, e.g. u-p-J (``mixed_field``
    decides by the type of the cells when the script runs)."""
    if "sections" not in step:
        return []
    return [
        sec["name"]
        for sec in context.sections
        if sec["name"] not in step["sections"] and formulation_of(sec).dual
    ]


def empty_sections(context, step):
    """The sections of a step whose dual fields it holds if they have no volume when
    the script runs (#429): those of a formulation whose fields may be mixed fields,
    e.g. u-p-J, of a script with meshes of scripts."""
    if not context.volumes:
        return []
    dual = {sec["name"]: formulation_of(sec).dual for sec in context.sections}
    return [n for n in step_sections(context, step) if dual[n]]


def holds(context):
    """Whether a step leaves out a section whose dual fields it holds (#428), or holds
    them of a section without volume (#429)."""
    return any(
        held_sections(context, step) or empty_sections(context, step)
        for step in context.get("step.add")
    )


def step_boundaries(step, held=(), empty=()):
    """The boundaries of a step: all of them by default, or those of its boundaries,
    load cases and symmetry planes (#393), and those that hold the dual fields of the
    held sections (#428) and of its sections without volume (#429).

    Examples
    --------
    >>> step_boundaries({"name": "pull"})
    'boundaries=boundaries'
    >>> str(step_boundaries({"name": "release", "boundaries": ["fixed", "tension"]}))
    'boundaries=pick(boundaries, ["fixed", "tension"])'
    >>> str(step_boundaries({"name": "pull", "sections": ["hexahedrons"]}, ["tets"]))
    'boundaries={**boundaries, **hold_dual_fields(field, field_tets)}'
    >>> print(step_boundaries({"name": "pull"}, empty=["tets"]).exploded(0))
    boundaries={
        **boundaries,
        **hold_dual_fields(field, *fields_without_volume(solid_tets)),
    }
    """
    prefix = "**" if held or empty else "boundaries="
    if "boundaries" in step:
        names = List(map(quote, step["boundaries"]))
        chosen = Call(f"{prefix}pick", ["boundaries", names])
    else:
        chosen = f"{prefix}boundaries"
    if not held and not empty:
        return chosen
    fields = [f"field_{name}" for name in held]
    if empty:
        solids = [f"solid_{name}" for name in empty]
        fields.append(Call("*fields_without_volume", solids))
    hold = Call("**hold_dual_fields", ["field", *fields])
    return Dict([chosen, hold], prefix="boundaries=")


def step_add(context, step):
    """A step, after its ramp."""
    lines, args = [], [step_items(context, step)]
    if "ramp" in step:
        lines, arrays = ramp_arrays(context, step)
        entries = [e for t, v in arrays.items() for e in ramped(context, t, v)]
        args.append(Dict(entries, prefix="ramp="))
    held = held_sections(context, step)
    args.append(step_boundaries(step, held, empty_sections(context, step)))
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
    point load or a Cartesian or cylindrical constraint (#421, #422): the
    displacement of its first point over its total force."""
    if name in context.loads or name in context.moved:
        return name
    if name in context.loadcases:
        name = f"{name}/{moving(context.loadcases[name])[0][0]}"
    return f"boundaries[{quote(name)}]"


def cylindrical_curves(context):
    """Whether a job records the curve of a cylindrical constraint (#422), with the
    helper ``CylindricalCurve``."""
    return any(is_cylindrical(context, job) for job in context.get("job.add"))


def is_cylindrical(context, job):
    """Whether the curve of a job is of a cylindrical constraint (#422)."""
    command = context.moved.get(job.get("curve"))
    return command is not None and command["command"] == "cylindrical.add"


def job_add(context, job):
    """A job, or a characteristic curve of a boundary, a point load or a constraint
    in local coordinates; of a cylindrical constraint in its directions (#422)."""
    args = [List(job["steps"], prefix="steps=")]
    if "curve" in job:
        args.append(f"boundary={curve(context, job['curve'])}")
        if job["curve"] in context.loads or job["curve"] in context.moved:
            # the force of a load: the sum of the internal forces at its points; of
            # a constraint in local coordinates (#421, #422) the reaction force,
            # those of the other items at its points
            constraints = [
                c["name"] for c in context.constraints if c["name"] != job["curve"]
            ]
            args.append(items(context, context.solids, constraints))
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
    if is_cylindrical(context, job):
        func = "CylindricalCurve"
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


# the comment of the steps of a script with meshes of scripts (#429)
VOLUMES = (
    "# with_volume() leaves out the solid bodies of sections without volume (V = 0),"
    "\n# e.g. of an empty part of a mesh script as one degenerate cell: off in every "
    "step"
)


def steps(context):
    """The part of the steps, with the plugin of the boundaries that they switch on
    (#393)."""
    comment = "# steps"
    if context.volumes and context.sections:
        comment += "\n" + VOLUMES
    lines = context.emit(STEPS, comment)
    if switches(context.get("step.add")):
        lines += boundary_switch(context)
    return lines


def jobs(context):
    """The part of the jobs, and of their evaluation."""
    lines = context.emit(JOBS, "# jobs")
    if lines and context.evaluate:
        lines += ["", *(evaluation(job) for job in context.get("job.add"))]
    return lines
