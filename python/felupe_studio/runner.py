"""Run the jobs of a command list, e.g. in the Pyodide worker of the app.

:func:`run` generates the script of a command list (:func:`felupe_studio.codegen`),
executes it without evaluating its jobs and evaluates every job with a plugin that
reports the progress: the steps and substeps, the iterations of the Newton-Raphson
method and failed substeps. An optional :class:`felupe.CutbackPlugin` subdivides
failed substeps. The fields of every substep are recorded for the results, see
:mod:`felupe_studio.results`.

The hyperelastic models of tensortrax (e.g. Mooney-Rivlin) need the package
tensortrax, which the app loads only for these models and for the materials of files
(ADR 0025): :func:`load_tensortrax` makes it available to FElupe after FElupe was
imported without it. The contact between bodies needs felupe-contact (#461), which the
app loads only for a model with one. :func:`lazy_wheels` names the wheels that a
command list needs.
"""

import contextlib
import importlib
import json
import sys
import time
import warnings

import felupe as fem
import numpy as np

from . import results as results_
from .capabilities import capability_errors
from .cartesian import base_vectors
from .codegen import (
    analysis_of,
    codegen,
    evaluate_options,
    object_lines,
    solver_source,
)
from .commands import ValidationError
from .expressions import resolve
from .materials import models

# the namespace of the last run, e.g. its field for results
LAST = {}


def uses_tensortrax(document):
    """True if a command list (or its JSON text) uses a material model of
    tensortrax, or a material of a file (ADR 0025), which may use one, e.g.
    ``fem.Hyperelastic``."""
    if isinstance(document, str):
        document = json.loads(document)
    hyperelastic = {name for name, m in models().items() if m.hyperelastic}
    return any(
        (c["command"] == "material.add" and c["model"] in hyperelastic)
        or c["command"] == "material.script"
        for c in document["commands"]
    )


def uses_contact(document):
    """True if a command list (or its JSON text) has a contact between bodies
    (``bodycontact.add``, #462), whose script imports felupe-contact (#461)."""
    if isinstance(document, str):
        document = json.loads(document)
    return any(c["command"] == "bodycontact.add" for c in document["commands"])


# the wheels that the app loads only for a command list that needs them (`lazy` in
# config.wheels of app/package.json), by the names of their packages
LAZY_WHEELS = {"tensortrax": uses_tensortrax, "felupe-contact": uses_contact}


def lazy_wheels(document):
    """Return the names of the lazy wheels of the app (``LAZY_WHEELS``) that a command
    list (or its JSON text) needs, e.g. ``["felupe-contact"]`` for a contact between
    bodies. The worker loads them before it runs the command list."""
    if isinstance(document, str):
        document = json.loads(document)
    return [name for name, uses in LAZY_WHEELS.items() if uses(document)]


def load_tensortrax():
    """Make the models of tensortrax available in FElupe, e.g. ``fem.Hyperelastic``,
    also if FElupe was imported before tensortrax was installed."""
    if hasattr(fem, "Hyperelastic"):
        return
    importlib.import_module("tensortrax")
    importlib.reload(sys.modules["felupe.constitution.tensortrax"])
    importlib.reload(sys.modules["felupe.constitution"])
    importlib.reload(fem)


@contextlib.contextmanager
def contact_warnings(report):
    """Report the warnings of felupe-contact (#462) as events ``warning`` of a run,
    once each, e.g. that no contact will be detected or of self-contact in the
    undeformed configuration. Other warnings are warned as before."""
    with warnings.catch_warnings(record=True) as caught:
        warnings.simplefilter("always")
        yield
    reported = set()
    for warning in caught:
        if "felupe_contact" not in warning.filename:
            warnings.warn_explicit(
                warning.message, warning.category, warning.filename, warning.lineno
            )
        elif str(warning.message) not in reported:
            reported.add(str(warning.message))
            report({"event": "warning", "message": str(warning.message)})


class Progress(fem.Plugin):
    """A plugin that reports the progress of a job as dicts."""

    def __init__(self, report, job, substeps):
        self.report = report
        self.job = job
        self.substeps = substeps
        self.iterations = 0

    def before_substep(self, context, state):
        self.iterations = 0
        self.report(
            {
                "event": "substep",
                "job": self.job,
                "step": state.stepnumber,
                "steps": len(self.substeps),
                "substep": state.substepnumber,
                "substeps": self.substeps[state.stepnumber],
            }
        )

    def after_iteration(self, context, state):
        self.iterations += 1
        self.report(
            {
                "event": "iteration",
                "iteration": state.iteration,
                "fnorm": _number(state.fnorm),
                "xnorm": _number(state.xnorm),
            }
        )

    def after_failed_substep(self, context, state):
        self.report(
            {
                "event": "failed",
                "step": state.stepnumber,
                "substep": state.substepnumber,
                "message": f"{type(state.error).__name__}: {state.error}",
            }
        )

    def after_substep(self, context, state):
        self.report(
            {
                "event": "converged",
                "step": state.stepnumber,
                "substep": state.substepnumber,
                "iterations": self.iterations,
                "increments": len(state.load_factors or [1]),
            }
        )


class RoundOff(fem.Plugin):
    """A plugin that estimates the round-off of the forces of a model in single
    precision (ADR 0016, #297), relative to the reaction forces: the largest absolute
    tolerance of the Newton-Raphson method (FElupe's estimate of the round-off of the
    residual forces) over the largest norm of the reaction forces, of the converged
    iterations of a job. It is an upper estimate: the curves of the golden cases and
    the samples deviate from double precision by about a tenth of it, e.g. 4e-2 of the
    sandwich spring (steel bonded to rubber) with an estimate of 0.43."""

    def __init__(self):
        self.atol = 0.0
        self.reaction = 0.0

    def after_iteration(self, context, state):
        if state.success and state.atol is not None and context.dof0 is not None:
            self.atol = max(self.atol, float(state.atol))
            reaction = np.linalg.norm(np.ravel(state.fun)[context.dof0])
            self.reaction = max(self.reaction, float(reaction))

    def estimate(self):
        """The round-off relative to the reaction forces, or None without them."""
        return self.atol / self.reaction if self.reaction > 0 else None


class Live(fem.Plugin):
    """A plugin that reports the live results of a running job (#207) after every
    converged substep, after the :class:`~felupe_studio.results.Recorder`: the point
    of the curve of a characteristic curve (cheap, every substep) and, when it is due,
    the scene of a quantity of the current fields.

    A scene is due at the last substep of every step, else at most every
    ``interval`` seconds and only while the time spent on scenes is at most
    ``budget`` of the time of the job, so that live scenes slow down a job by about
    that share at most.

    Parameters
    ----------
    report : callable
        Called with the dict of an event ``live``: the ``job``, the ``substep``
        (counted from 1 over all steps), ``x`` and ``y`` of a characteristic curve
        and the ``scene`` (the label as JSON text and the surfaces, see
        :func:`felupe_studio.results.scene`).
    job : str
        The name of the job.
    substeps : list of int
        The substeps of every step of the job.
    curve : felupe.CharacteristicCurve or None
        The job, if it is a characteristic curve.
    quantity : str or None, optional
        The quantity of the scenes (none without scenes).
    method : str, optional
        The method of the values of the strains and the stresses of the scenes
        (#231), see :func:`felupe_studio.results.scene`.
    cut : dict or None, optional
        The cut of the view of the scenes (#395), see
        :func:`felupe_studio.results.scene`.
    interval : float, optional
        The least time between two scenes in seconds (default 1).
    budget : float, optional
        The largest share of the time of the job spent on scenes (default 0.1).
    clock : callable, optional
        The time in seconds (default :func:`time.perf_counter`).
    rotation : bool, optional
        The curve is of a rotation point of a 2D model (default False), see
        :func:`curve_row`.
    frame : list of list of float or None, optional
        The base vectors of the Cartesian constraint of the curve (#421), see
        :func:`curve_row`.
    """

    def __init__(
        self,
        report,
        job,
        substeps,
        curve=None,
        quantity=None,
        method="cells",
        cut=None,
        interval=1.0,
        budget=0.1,
        clock=time.perf_counter,
        rotation=False,
        frame=None,
    ):
        self.report = report
        self.job = job
        self.substeps = substeps
        self.curve = curve
        self.rotation = rotation
        self.frame = frame
        self.quantity = quantity
        self.method = method
        self.cut = cut
        self.interval = interval
        self.budget = budget
        self.clock = clock
        self.started = clock()
        self.last = None
        self.spent = 0.0

    def due(self, now, state):
        """Whether the scene of the converged substep is due."""
        if self.quantity is None:
            return False
        if state.substepnumber >= self.substeps[state.stepnumber] - 1:
            return True
        if self.last is not None and now - self.last < self.interval:
            return False
        return self.spent <= self.budget * (now - self.started)

    def after_substep(self, context, state):
        event = {
            "event": "live",
            "job": self.job,
            "substep": results_.substeps(self.job),
        }
        if self.curve is not None and self.curve.x:
            event["x"] = curve_row(self.curve.x[-1], self.rotation, self.frame)
            event["y"] = curve_row(self.curve.y[-1], self.rotation, self.frame)
        now = self.clock()
        if self.due(now, state):
            event["scene"] = results_.current_scene(
                self.job, event["substep"], self.quantity, self.method, self.cut
            )
            self.last = self.clock()
            self.spent += self.last - now
        if "x" in event or "scene" in event:
            self.report(event)


def curve_row(values, rotation=False, frame=None):
    """Return the values of a curve at a substep as floats for JSON. Of a rotation
    point of a 2D model (#175), whose first component is the rotation (or the moment)
    about z, the three components with the rotation about z. Of a Cartesian
    constraint (#421), the components in the directions of its base vectors
    ``frame``.

    Examples
    --------
    >>> curve_row([1.0, 2.0], frame=[[0.0, 1.0], [-1.0, 0.0]])
    [2.0, -1.0]
    """
    if rotation:
        return [0.0, 0.0, _number(values[0])]
    if frame is not None:
        values = [
            sum(v * e for v, e in zip(values, base, strict=True)) for base in frame
        ]
    return [_number(v) for v in values]


def frames(commands):
    """Return the base vectors of the Cartesian constraints of the curves of jobs
    (#421), by the names of the jobs: their curves are in the directions 1, 2 and 3
    of the constraint.

    Examples
    --------
    >>> frames([
    ...     {"command": "cartesian.add", "name": "c", "e1": [0, 0, 1],
    ...      "e2": [1, 0, 0], "constrained": ["1"]},
    ...     {"command": "job.add", "name": "job_1", "curve": "c"},
    ... ])
    {'job_1': [[0.0, 0.0, 1.0], [1.0, 0.0, 0.0], [0.0, 1.0, 0.0]]}
    """
    dim = 3 if analysis_of(commands) == "3d" else 2
    cartesians = {c["name"]: c for c in commands if c["command"] == "cartesian.add"}
    return {
        c["name"]: base_vectors(cartesians[c["curve"]], dim)
        for c in commands
        if c["command"] == "job.add" and c.get("curve") in cartesians
    }


def rotation_curves(commands):
    """Return the names of the jobs whose curve is of a rotation point of a 2D model
    (#175): a boundary or a point load of the rotation point of a constraint.

    Examples
    --------
    >>> rotation_curves([
    ...     {"command": "model.settings", "name": "s", "analysis": "plane-strain"},
    ...     {"command": "mpc.add", "name": "c", "rotation": "r"},
    ...     {"command": "boundary.add", "name": "turn", "pointset": "r"},
    ...     {"command": "job.add", "name": "job_1", "curve": "turn"},
    ... ])
    {'job_1'}
    """
    if analysis_of(commands) == "3d":
        return set()
    rotations = {
        c["rotation"] for c in commands if c["command"] == "mpc.add" and "rotation" in c
    }
    points = {
        c["name"]: c.get("pointset", c.get("points"))
        for c in commands
        if c["command"] in ("boundary.add", "load.add")
    }
    return {
        c["name"]
        for c in commands
        if c["command"] == "job.add" and points.get(c.get("curve")) in rotations
    }


def _number(value):
    """A float for JSON (None for missing or non-finite values)."""
    try:
        value = float(value)
    except (TypeError, ValueError):
        return None
    return value if value == value and abs(value) != float("inf") else None


def run(document, report=lambda event: None, live=None, clock=time.perf_counter):
    """Run the jobs of a command list.

    Parameters
    ----------
    document : dict or str
        The command list (or its JSON text).
    report : callable, optional
        Called with a dict for every event: ``start`` (with the substeps of the steps
        of every job), ``substep``, ``iteration``, ``failed``, ``converged``,
        ``live`` (see :class:`Live`) and ``finished``.
    live : dict or None, optional
        The settings of the live scenes of the running jobs (#207): the
        ``quantity`` and optionally the ``method`` (#231), the ``cut`` (#395), the
        ``interval`` and the ``budget`` of :class:`Live`. Without them, the live
        events have only the points of the curves of characteristic curves.
    clock : callable, optional
        The time in seconds, e.g. a fake clock for tests of the live scenes.

    Returns
    -------
    dict
        The results by job: the number of substeps, the time and, for a
        characteristic curve, the displacements ``x`` and forces ``y`` of its
        boundary (three components per substep). A model in single precision has
        ``roundoff``, the estimate of :class:`RoundOff` (None without reaction
        forces).
    """
    if isinstance(document, str):
        document = json.loads(document)
    if uses_tensortrax(document):
        load_tensortrax()

    # the app validated the command list against the schema with Ajv: no jsonschema
    # in the worker, the references are checked here
    script = codegen(document, evaluate=False, check_schema=False)
    # the values of the expressions of the parameters (#242), which the script shows
    # as written
    document = resolve(document)[0]
    # the linear solvers of the jobs that this runtime has (#308), e.g. PARDISO
    unavailable = capability_errors(document["commands"])
    if unavailable:
        raise ValidationError(unavailable)
    namespace = {"__name__": "felupe_studio_model"}
    # the contacts between bodies warn when they are made (#462)
    with contact_warnings(report):
        exec(compile(script, "model.py", "exec"), namespace)
    LAST.clear()
    LAST.update(namespace)
    sections = [
        c["name"] for c in document["commands"] if c["command"] == "section.add"
    ]
    # the sections whose material has the Mullins effect (#346): of the registry,
    # or a strain energy function of a file (#424)
    softened = {
        c["name"]
        for c in document["commands"]
        if c["command"] in ("material.add", "material.script") and "mullins" in c
    }
    mullins = [
        c["name"]
        for c in document["commands"]
        if c["command"] == "section.add" and c["material"] in softened
    ]
    # the control points and the reference points of the rigid surfaces (#219)
    points = [
        c["name"]
        for c in document["commands"]
        if c["command"] in ("point.add", "rigid.add")
    ]
    settings = [c for c in document["commands"] if c["command"] == "model.settings"]
    units = settings[0].get("units") if settings else None
    single = bool(settings) and settings[0].get("precision") == "single"
    results_.reset(namespace, sections, points, units, mullins)

    commands = {c["name"]: c for c in document["commands"] if c["command"] == "job.add"}
    jobs = list(commands)
    substeps = {
        name: [step.nsubsteps for step in namespace[name].steps] for name in jobs
    }
    rotations = rotation_curves(document["commands"])
    local = frames(document["commands"])
    report({"event": "start", "jobs": jobs, "substeps": substeps})
    results = {}
    for name in jobs:
        job = namespace[name]
        job.dispatcher.add_plugin(Progress(report, name, substeps[name]))
        job.dispatcher.add_plugin(results_.Recorder(name, namespace["field"]))
        roundoff = RoundOff() if single else None
        if roundoff:
            job.dispatcher.add_plugin(roundoff)
        curve = job if isinstance(job, fem.CharacteristicCurve) else None
        rotation, frame = name in rotations, local.get(name)
        job.dispatcher.add_plugin(
            Live(
                report,
                name,
                substeps[name],
                curve,
                clock=clock,
                rotation=rotation,
                frame=frame,
                **(live or {}),
            )
        )
        started = time.perf_counter()
        options = evaluate_options(commands[name])
        # the linear solver of the script (#203): the same source, in its namespace
        solver = solver_source(commands[name])
        if solver is not None:
            options["solver"] = eval(solver, namespace)  # noqa: S307
        with contact_warnings(report):
            job.evaluate(x0=namespace["field"], verbose=False, **options)
        result = {
            "substeps": sum(substeps[name]),
            "time": time.perf_counter() - started,
        }
        if isinstance(job, fem.CharacteristicCurve):
            result["x"] = [curve_row(x, rotation, frame) for x in job.x]
            result["y"] = [curve_row(y, rotation, frame) for y in job.y]
        if roundoff:
            result["roundoff"] = _number(roundoff.estimate())
        results[name] = result
        report({"event": "finished", "job": name, "time": result["time"]})
    return results


def script(text):
    """Return the FElupe script of a command list (JSON text) for the export of the
    app. The app validated the command list against the schema with Ajv (see
    :func:`run`)."""
    return codegen(json.loads(text), check_schema=False)


def script_view(text):
    """Return the FElupe script of a command list (JSON text) and the lines of its
    objects (:func:`felupe_studio.codegen.object_lines`) as JSON text, for the script
    view of the app (#130)."""
    document = json.loads(text)
    source = codegen(document, check_schema=False)
    return json.dumps({"script": source, "lines": object_lines(source, document)})


def run_json(text, report, live=None, report_scene=None):
    """:func:`run` with JSON texts for the worker: the command list, the events (given
    to ``report``), the settings of the live scenes (#207) and the results. A live
    event with a scene is given to ``report_scene`` instead: the event without the
    scene as JSON text, the label of the scene as JSON text and its surfaces (the
    worker transfers their bytes)."""

    def send(event):
        scene = event.pop("scene", None)
        if scene is not None and report_scene is not None:
            report_scene(json.dumps(event), *scene)
        else:
            report(json.dumps(event))

    settings = json.loads(live) if live else None
    results = run(text, send, settings)
    return json.dumps(results)
