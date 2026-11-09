"""Golden tests: command list → generated script → FElupe → stored results.

Each folder in ``tests/golden`` is a case with

- ``commands.json``: the command list,
- mesh files used by the commands (see ``make_meshes.py``),
- ``script.py``: the expected generated script (without its version line),
- ``results.json``: the expected force-displacement curves of the jobs.

Run ``pytest tests/golden --update-golden`` to rewrite ``script.py`` and
``results.json`` after an intended change, and review the diff.
"""

import json
import re
import runpy
import shutil
from pathlib import Path

import felupe as fem
import numpy as np
import pytest

from felupe_studio import codegen

HERE = Path(__file__).parent
CASES = sorted(p.name for p in HERE.iterdir() if (p / "commands.json").exists())

# cases that describe the same bar with one material and must give the same curve
SAME_BODY = [
    "bar_single_body",
    "bar_sections_tag",
    "bar_sections_gmsh",
    "bar_sections_files",
]

RTOL, ATOL = 1e-8, 1e-12

pytestmark = pytest.mark.golden


def load(case):
    return json.loads((HERE / case / "commands.json").read_text(encoding="utf-8"))


def normalize(script):
    """Remove the version of FElupe Studio from the header of a script."""
    return re.sub(r"FElupe Studio \S+ ", "FElupe Studio ", script, count=1)


def evaluate(case, tmp_path, monkeypatch):
    """Run the generated script of a case and return the curves of its jobs."""
    for path in (HERE / case).iterdir():
        if path.name not in ("commands.json", "script.py", "results.json"):
            shutil.copy(path, tmp_path)
    script = tmp_path / "script.py"
    script.write_text(codegen(load(case)), encoding="utf-8")
    monkeypatch.chdir(tmp_path)
    namespace = runpy.run_path(str(script))

    jobs = {}
    for cmd in load(case)["commands"]:
        if cmd["command"] == "job.add" and "curve" in cmd:
            job = namespace[cmd["name"]]
            jobs[cmd["name"]] = {
                "displacement": np.array(job.x)[:, 0].tolist(),
                "force": np.array(job.y)[:, 0].tolist(),
            }
    return {"felupe": fem.__version__, "jobs": jobs}


def test_cases_exist():
    assert set(SAME_BODY) <= set(CASES)
    assert "bar_two_materials" in CASES


@pytest.mark.parametrize("case", CASES)
def test_script(case, request):
    expected = HERE / case / "script.py"
    script = normalize(codegen(load(case)))
    if request.config.getoption("--update-golden"):
        expected.write_text(script, encoding="utf-8")
    assert script == expected.read_text(encoding="utf-8"), (
        f"The generated script of {case} changed. If intended, run "
        "pytest tests/golden --update-golden and review the diff."
    )


@pytest.mark.parametrize("case", CASES)
def test_results(case, tmp_path, monkeypatch, request):
    results = evaluate(case, tmp_path, monkeypatch)
    expected = HERE / case / "results.json"
    if request.config.getoption("--update-golden"):
        expected.write_text(json.dumps(results, indent=2) + "\n", encoding="utf-8")

    reference = json.loads(expected.read_text(encoding="utf-8"))
    assert results["jobs"].keys() == reference["jobs"].keys()
    for name, curve in results["jobs"].items():
        for key in ("displacement", "force"):
            np.testing.assert_allclose(
                curve[key],
                reference["jobs"][name][key],
                rtol=RTOL,
                atol=ATOL,
                err_msg=f"{case}: {name} {key} (reference: FElupe "
                f"{reference['felupe']})",
            )


def test_same_body_gives_same_curve():
    curves = [
        json.loads((HERE / case / "results.json").read_text(encoding="utf-8"))
        for case in SAME_BODY
    ]
    for case, curve in zip(SAME_BODY[1:], curves[1:], strict=True):
        np.testing.assert_allclose(
            curve["jobs"]["job_1"]["force"],
            curves[0]["jobs"]["job_1"]["force"],
            rtol=1e-10,
            err_msg=f"{case} differs from {SAME_BODY[0]}",
        )


def test_two_materials_reference():
    # checked by hand with FElupe 12.0.0 before the GUI existed
    results = json.loads(
        (HERE / "bar_two_materials" / "results.json").read_text(encoding="utf-8")
    )
    assert np.isclose(results["jobs"]["job_1"]["force"][-1], 0.66322, rtol=1e-5)
