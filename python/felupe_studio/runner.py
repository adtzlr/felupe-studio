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


def _number(value):
    """A float for JSON (None for missing or non-finite values)."""
    try:
        value = float(value)
    except (TypeError, ValueError):
        return None
    return value if value == value and abs(value) != float("inf") else None


def run(document, report=lambda event: None):
    """Run the jobs of a command list.

    Parameters
    ----------
    document : dict or str
        The command list (or its JSON text).
    report : callable, optional
        Called with a dict for every event: ``start`` (with the substeps of the steps
        of every job), ``substep``, ``iteration``, ``failed``, ``converged`` and
        ``finished``.

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


def run_json(text, report):
    """:func:`run` with JSON texts for the worker: the command list, the events (given
    to ``report``) and the results."""
    results = run(text, lambda event: report(json.dumps(event)))
    return json.dumps(results)
