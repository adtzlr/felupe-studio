import copy
import json
import subprocess
import sys
from pathlib import Path

import felupe as fem
import numpy as np
import pytest

from felupe_studio.commands import ValidationError
from felupe_studio.runner import LAST, run, run_json, uses_tensortrax

GOLDEN = Path(__file__).parent / "golden"


def load(case):
    return json.loads((GOLDEN / case / "commands.json").read_text(encoding="utf-8"))


def test_runs_the_jobs_with_progress(monkeypatch):
    monkeypatch.chdir(GOLDEN / "bar_single_body")
    events = []
    results = run(load("bar_single_body"), events.append)

    kinds = [e["event"] for e in events]
    assert kinds[0] == "start" and kinds[-1] == "finished"
    assert events[0] == {
        "event": "start",
        "jobs": ["job_1"],
        "substeps": {"job_1": [6]},
    }
    substeps = [e for e in events if e["event"] == "substep"]
    assert [e["substep"] for e in substeps] == [0, 1, 2, 3, 4, 5]
    assert substeps[-1] == {
        "event": "substep",
        "job": "job_1",
        "step": 0,
        "steps": 1,
        "substep": 5,
        "substeps": 6,
    }
    iterations = [e for e in events if e["event"] == "iteration"]
    assert all(e["fnorm"] is not None for e in iterations)
    converged = [e for e in events if e["event"] == "converged"]
    assert len(converged) == 6 and all(e["increments"] == 1 for e in converged)

    # the curve of the golden results, and the field for results
    expected = json.loads((GOLDEN / "bar_single_body" / "results.json").read_text())
    np.testing.assert_allclose(
        np.array(results["job_1"]["y"])[:, 0], expected["jobs"]["job_1"]["force"]
    )
    assert results["job_1"]["substeps"] == 6
    assert isinstance(LAST["field"], fem.FieldContainer)


def test_json_for_the_worker(monkeypatch):
    monkeypatch.chdir(GOLDEN / "bar_single_body")
    texts = []
    results = json.loads(run_json(json.dumps(load("bar_single_body")), texts.append))
    assert json.loads(texts[0])["event"] == "start"
    assert set(results) == {"job_1"}


def test_cutback_of_a_failing_substep(monkeypatch):
    monkeypatch.chdir(GOLDEN / "bar_two_materials")
    document = copy.deepcopy(load("bar_two_materials"))
    step = next(c for c in document["commands"] if c["command"] == "step.add")
    step["ramp"]["num"] = 1
    step["ramp"]["items"][0]["end"] = 3.0

    with pytest.raises(fem.NewtonConvergenceError):
        run(document)

    job = next(c for c in document["commands"] if c["command"] == "job.add")
    job["cutback"] = {}
    events = []
    results = run(document, events.append)
    failed = [e for e in events if e["event"] == "failed"]
    assert failed and failed[0]["message"].startswith("NewtonConvergenceError")
    last = [e for e in events if e["event"] == "converged"][-1]
    assert last["increments"] > 1
    assert results["job_1"]["y"][-1][0] > 0


def test_settings_of_the_cutback(monkeypatch):
    # a substep that one cutback by the default factor 0.5 does not recover, but one
    # by the factor 0.25 (#133), like the golden case bar_cutback
    monkeypatch.chdir(GOLDEN / "bar_two_materials")
    document = copy.deepcopy(load("bar_two_materials"))
    step = next(c for c in document["commands"] if c["command"] == "step.add")
    step["ramp"]["num"] = 1
    step["ramp"]["items"][0]["end"] = 5.0
    job = next(c for c in document["commands"] if c["command"] == "job.add")

    job["cutback"] = {"max_cutbacks": 1}
    with pytest.raises(fem.NewtonConvergenceError):
        run(document)

    job["cutback"] = {"factor": 0.25, "max_cutbacks": 1}
    events = []
    run(document, events.append)
    last = [e for e in events if e["event"] == "converged"][-1]
    assert last["increments"] == 3  # 0.25, 0.75 (growth 2) and 1


def test_maximum_iterations_of_a_job(monkeypatch):
    monkeypatch.chdir(GOLDEN / "bar_two_materials")
    document = copy.deepcopy(load("bar_two_materials"))
    job = next(c for c in document["commands"] if c["command"] == "job.add")
    job["maxiter"] = 2
    events = []
    with pytest.raises(fem.NewtonConvergenceError):
        run(document, events.append)
    iterations = [e["iteration"] for e in events if e["event"] == "iteration"]
    assert max(iterations) <= 2


def test_tolerance_of_a_job(monkeypatch):
    monkeypatch.chdir(GOLDEN / "bar_two_materials")
    document = copy.deepcopy(load("bar_two_materials"))

    def iterations(document):
        events = []
        run(document, events.append)
        return [e for e in events if e["event"] == "iteration"]

    strict = iterations(document)
    job = next(c for c in document["commands"] if c["command"] == "job.add")
    job["tol"] = 0.05
    loose = iterations(document)
    assert len(loose) < len(strict)
    assert loose[-1]["fnorm"] < 0.05


def test_invalid_models_are_not_run():
    document = load("bar_single_body")
    document["commands"].append(document["commands"][0])
    with pytest.raises(ValidationError):
        run(document)


def test_uses_tensortrax():
    assert not uses_tensortrax(load("bar_single_body"))
    assert uses_tensortrax(load("bar_mooney_rivlin"))


def test_load_tensortrax_after_felupe():
    # FElupe was imported before tensortrax was installed, like in the worker
    code = """
import sys
sys.modules["tensortrax"] = None
import felupe as fem
assert not hasattr(fem, "Hyperelastic")
del sys.modules["tensortrax"]
from felupe_studio.runner import load_tensortrax
load_tensortrax()
assert hasattr(fem, "Hyperelastic") and hasattr(fem, "mooney_rivlin")
"""
    subprocess.run([sys.executable, "-c", code], check=True)


def test_runs_with_the_packages_of_the_worker():
    # the worker has FElupe, NumPy, SciPy and meshio, but no jsonschema or tensortrax
    code = f"""
import json, os, sys
sys.modules["jsonschema"] = None
sys.modules["tensortrax"] = None
from felupe_studio.commands import ValidationError
from felupe_studio.runner import run_json, script, script_view
os.chdir({str(GOLDEN / "bar_single_body")!r})
with open("commands.json") as file:
    text = file.read()
results = json.loads(run_json(text, lambda event: None))
assert results["job_1"]["substeps"] == 6
assert "fem.CharacteristicCurve(" in script(text)
view = json.loads(script_view(text))
assert view["script"] == script(text)
assert view["lines"]["job_1"][-1][1] == len(view["script"].splitlines())
document = json.loads(text)
document["commands"].append(document["commands"][0])
try:
    run_json(json.dumps(document), lambda event: None)
except ValidationError as error:
    assert "already used" in str(error)
else:
    raise AssertionError("not validated")
"""
    subprocess.run([sys.executable, "-c", code], check=True)


def test_mooney_rivlin(monkeypatch):
    monkeypatch.chdir(GOLDEN / "bar_mooney_rivlin")
    results = run(load("bar_mooney_rivlin"))
    expected = json.loads((GOLDEN / "bar_mooney_rivlin" / "results.json").read_text())
    np.testing.assert_allclose(
        np.array(results["job_1"]["y"])[:, 0], expected["jobs"]["job_1"]["force"]
    )
