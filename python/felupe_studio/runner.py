"""Run the jobs of a command list, e.g. in the Pyodide worker of the app.

:func:`run` generates the script of a command list (:func:`felupe_studio.codegen`),
executes it without evaluating its jobs and evaluates every job with a plugin that
reports the progress: the steps and substeps, the iterations of the Newton-Raphson
method and failed substeps. An optional :class:`felupe.CutbackPlugin` subdivides
failed substeps. The fields of every substep are recorded for the results, see
:mod:`felupe_studio.results`.

The hyperelastic models of tensortrax (e.g. Mooney-Rivlin) need the package
tensortrax, which the app loads only for these models: :func:`load_tensortrax` makes
it available to FElupe after FElupe was imported without it.
"""

import importlib
import json
import sys
import time

import felupe as fem

from . import results as results_
from .codegen import codegen, evaluate_options, object_lines, solver_source
from .materials import models

# the namespace of the last run, e.g. its field for results
LAST = {}


def uses_tensortrax(document):
    """True if a command list (or its JSON text) uses a material model of
    tensortrax."""
    if isinstance(document, str):
        document = json.loads(document)
    hyperelastic = {name for name, m in models().items() if m.hyperelastic}
    return any(
        c["command"] == "material.add" and c["model"] in hyperelastic
        for c in document["commands"]
    )


def load_tensortrax():
    """Make the models of tensortrax available in FElupe, e.g. ``fem.Hyperelastic``,
    also if FElupe was imported before tensortrax was installed."""
    if hasattr(fem, "Hyperelastic"):
        return
    importlib.import_module("tensortrax")
    importlib.reload(sys.modules["felupe.constitution.tensortrax"])
    importlib.reload(sys.modules["felupe.constitution"])
    importlib.reload(fem)


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
    interval : float, optional
        The least time between two scenes in seconds (default 1).
    budget : float, optional
        The largest share of the time of the job spent on scenes (default 0.1).
    clock : callable, optional
        The time in seconds (default :func:`time.perf_counter`).
    """

    def __init__(
        self,
        report,
        job,
        substeps,
        curve=None,
        quantity=None,
        interval=1.0,
        budget=0.1,
        clock=time.perf_counter,
    ):
        self.report = report
        self.job = job
        self.substeps = substeps
        self.curve = curve
        self.quantity = quantity
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
            event["x"] = [_number(v) for v in self.curve.x[-1]]
            event["y"] = [_number(v) for v in self.curve.y[-1]]
        now = self.clock()
        if self.due(now, state):
            event["scene"] = results_.current_scene(
                self.job, event["substep"], self.quantity
            )
            self.last = self.clock()
            self.spent += self.last - now
        if "x" in event or "scene" in event:
            self.report(event)


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
        ``quantity`` and optionally the ``interval`` and the ``budget`` of
        :class:`Live`. Without them, the live events have only the points of the
        curves of characteristic curves.
    clock : callable, optional
        The time in seconds, e.g. a fake clock for tests of the live scenes.

    Returns
    -------
    dict
        The results by job: the number of substeps, the time and, for a
        characteristic curve, the displacements ``x`` and forces ``y`` of its
        boundary (three components per substep).
    """
    if isinstance(document, str):
        document = json.loads(document)
    if uses_tensortrax(document):
        load_tensortrax()

    # the app validated the command list against the schema with Ajv: no jsonschema
    # in the worker, the references are checked here
    script = codegen(document, evaluate=False, check_schema=False)
    namespace = {"__name__": "felupe_studio_model"}
    exec(compile(script, "model.py", "exec"), namespace)
    LAST.clear()
    LAST.update(namespace)
    sections = [
        c["name"] for c in document["commands"] if c["command"] == "section.add"
    ]
    points = [c["name"] for c in document["commands"] if c["command"] == "point.add"]
    settings = [c for c in document["commands"] if c["command"] == "model.settings"]
    units = settings[0].get("units") if settings else None
    results_.reset(namespace, sections, points, units)

    commands = {c["name"]: c for c in document["commands"] if c["command"] == "job.add"}
    jobs = list(commands)
    substeps = {
        name: [step.nsubsteps for step in namespace[name].steps] for name in jobs
    }
    report({"event": "start", "jobs": jobs, "substeps": substeps})
    results = {}
    for name in jobs:
        job = namespace[name]
        job.dispatcher.add_plugin(Progress(report, name, substeps[name]))
        job.dispatcher.add_plugin(results_.Recorder(name, namespace["field"]))
        curve = job if isinstance(job, fem.CharacteristicCurve) else None
        job.dispatcher.add_plugin(
            Live(report, name, substeps[name], curve, clock=clock, **(live or {}))
        )
        started = time.perf_counter()
        options = evaluate_options(commands[name])
        # the linear solver of the script (#203): the same source, in its namespace
        solver = solver_source(commands[name])
        if solver is not None:
            options["solver"] = eval(solver, namespace)  # noqa: S307
        job.evaluate(x0=namespace["field"], verbose=False, **options)
        result = {
            "substeps": sum(substeps[name]),
            "time": time.perf_counter() - started,
        }
        if isinstance(job, fem.CharacteristicCurve):
            result["x"] = [[_number(v) for v in x] for x in job.x]
            result["y"] = [[_number(v) for v in y] for y in job.y]
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
