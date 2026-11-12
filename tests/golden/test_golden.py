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
from felupe_studio.materials import material_call

HERE = Path(__file__).parent
CASES = sorted(p.name for p in HERE.iterdir() if (p / "commands.json").exists())

# cases that describe the same bar with one material and must give the same curve
SAME_BODY = [
    "bar_single_body",
    "bar_sections_tag",
    "bar_sections_gmsh",
    "bar_sections_files",
    "bar_sections_files_merged",
]

# uniaxial tension of a cube (1 x 1 x 1, symmetric load case) per material model of
# tensortrax, nearly incompressible with a bulk modulus of 5000 (#136); the jobs of
# these references have FElupe's tight tolerance, 1.49e-8 (#176)
MATERIALS = [case for case in CASES if case.startswith("cube_")]

RTOL, ATOL = 1e-8, 1e-12

pytestmark = pytest.mark.golden


def load(case):
    return json.loads((HERE / case / "commands.json").read_text(encoding="utf-8"))


def normalize(script):
    """Remove the version of FElupe Studio from the header of a script."""
    return re.sub(r"FElupe Studio \S+ ", "FElupe Studio ", script, count=1)


def evaluate(case, tmp_path, monkeypatch, document=None):
    """Run the generated script of a case (or of another command list with its
    files) and return the curves of its jobs."""
    document = document or load(case)
    for path in (HERE / case).iterdir():
        if path.name not in ("commands.json", "script.py", "results.json"):
            shutil.copy(path, tmp_path)
    script = tmp_path / "script.py"
    script.write_text(codegen(document), encoding="utf-8")
    monkeypatch.chdir(tmp_path)
    namespace = runpy.run_path(str(script))

    jobs = {}
    for cmd in document["commands"]:
        if cmd["command"] == "job.add" and "curve" in cmd:
            job = namespace[cmd["name"]]
            jobs[cmd["name"]] = {
                "displacement": np.array(job.x)[:, 0].tolist(),
                "force": np.array(job.y)[:, 0].tolist(),
            }
    return {"felupe": fem.__version__, "jobs": jobs}


def test_cases_exist():
    assert set(SAME_BODY) <= set(CASES)
    assert {"bar_two_materials", "bar_cell_types"} <= set(CASES)


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


def test_cell_types_close_to_hexahedra():
    # the same bar, its right half of tetrahedra: one mesh per cell type of a file
    hexahedra, mixed = (
        json.loads((HERE / case / "results.json").read_text(encoding="utf-8"))
        for case in ("bar_single_body", "bar_cell_types")
    )
    np.testing.assert_allclose(
        mixed["jobs"]["job_1"]["force"],
        hexahedra["jobs"]["job_1"]["force"],
        rtol=1e-3,
    )


def test_symmetry_quarter_of_the_bar(tmp_path, monkeypatch):
    # a quarter of the clamped bar of bar_loadcase with symmetry planes at y = 0.5
    # and z = 0.5 has a quarter of its force (#186), both converged
    document = load("bar_loadcase")
    for cmd in document["commands"]:
        if cmd["command"] == "job.add":
            cmd["tol"] = 1.49e-8
    full = evaluate("bar_loadcase", tmp_path, monkeypatch, document)["jobs"]["job_1"]
    quarter = json.loads(
        (HERE / "bar_symmetry_quarter" / "results.json").read_text(encoding="utf-8")
    )["jobs"]["job_1"]
    np.testing.assert_allclose(quarter["displacement"], full["displacement"])
    np.testing.assert_allclose(
        4 * np.array(quarter["force"]), full["force"], rtol=1e-6, atol=1e-12
    )


def test_plane_strain_like_the_bar_with_fixed_z(tmp_path, monkeypatch):
    # the cross section of the clamped bar of bar_loadcase in plane strain (#175)
    # has the force of the bar (thickness 1) with all displacements in z fixed
    document = load("bar_loadcase")
    commands = document["commands"]
    commands.insert(
        commands.index(next(c for c in commands if c["command"] == "loadcase.add")),
        {
            "command": "pointset.add",
            "name": "all_points",
            "select": {"ids": list(range(325))},
        },
    )
    commands.insert(
        commands.index(next(c for c in commands if c["command"] == "step.add")),
        {
            "command": "boundary.add",
            "name": "plane",
            "pointset": "all_points",
            "constrained": ["z"],
        },
    )
    for cmd in commands:
        if cmd["command"] == "job.add":
            cmd["tol"] = 1.49e-8
    bar = evaluate("bar_loadcase", tmp_path, monkeypatch, document)["jobs"]["job_1"]
    plate = json.loads(
        (HERE / "plate_plane_strain" / "results.json").read_text(encoding="utf-8")
    )["jobs"]["job_1"]
    np.testing.assert_allclose(plate["displacement"], bar["displacement"])
    np.testing.assert_allclose(plate["force"], bar["force"], rtol=1e-6, atol=1e-12)


def test_axisymmetric_cylinder_like_the_analytical_solution(tmp_path, monkeypatch):
    # the solid cylinder (radius 1, length 3) in uniaxial tension (#175): at a small
    # strain, the total force over the circumference is E * strain * pi * R^2 with
    # E = mu (3 lmbda + 2 mu) / (lmbda + mu) of NeoHookeCompressible
    document = load("cylinder_axisymmetric")
    for cmd in document["commands"]:
        if cmd["command"] == "step.add":
            cmd["ramp"] = {"num": 1, "items": [{"target": "tension", "end": 3e-4}]}
    result = evaluate("cylinder_axisymmetric", tmp_path, monkeypatch, document)
    curve = result["jobs"]["job_1"]
    mu, lmbda = 1.0, 2.0
    modulus = mu * (3 * lmbda + 2 * mu) / (lmbda + mu)
    expected = modulus * 3e-4 / 3 * np.pi * 1**2
    np.testing.assert_allclose(curve["force"][-1], expected, rtol=2e-4)


def test_iterative_solver_close_to_the_direct_one():
    # the bar of bar_single_body, solved with minres and rtol = tol / 100 (#203):
    # the curve of the direct solver within its tolerance (0.01). The golden case has
    # FElupe's tight tolerance 1.49e-8, so rtol = 1.49e-10 and its results do not
    # depend on the round-off of the machine, as they would with a loose rtol
    def force(case):
        text = (HERE / case / "results.json").read_text(encoding="utf-8")
        return np.array(json.loads(text)["jobs"]["job_1"]["force"])

    direct = force("bar_single_body")
    np.testing.assert_allclose(
        force("bar_iterative_minres"), direct, rtol=0, atol=0.01 * direct.max()
    )


@pytest.mark.parametrize("case", MATERIALS)
def test_material_matches_felupe(case):
    # the stretch is 1 + u and the force is the nominal stress of the cube; the
    # reference is the incompressible uniaxial tension of FElupe
    commands = load(case)["commands"]
    [material] = [c for c in commands if c["command"] == "material.add"]
    func, args, _ = material_call(material)
    umat = eval(f"{func}({', '.join(args)})", {"fem": fem})
    curve = json.loads((HERE / case / "results.json").read_text(encoding="utf-8"))
    u = np.array(curve["jobs"]["job_1"]["displacement"])
    force = np.array(curve["jobs"]["job_1"]["force"])
    _, stress, _ = fem.ViewMaterialIncompressible(umat).uniaxial(1 + u)
    assert np.isclose(u[-1], 1)  # up to a stretch of 2
    np.testing.assert_allclose(force, stress, rtol=1e-3, atol=1e-6)


@pytest.mark.parametrize("case", MATERIALS)
def test_default_tolerance(case, tmp_path, monkeypatch):
    # the default tolerance of a job, 0.01 like commercial codes, deviates from the
    # converged curve by less than 1 % of the largest force (#176)
    document = load(case)
    for cmd in document["commands"]:
        if cmd["command"] == "job.add":
            del cmd["tol"]
    loose = evaluate(case, tmp_path, monkeypatch, document)
    reference = json.loads((HERE / case / "results.json").read_text(encoding="utf-8"))
    for name, curve in loose["jobs"].items():
        force = np.array(reference["jobs"][name]["force"])
        deviation = np.abs(np.array(curve["force"]) - force).max() / force.max()
        assert 0 < deviation < 0.01, f"{case}: {deviation:.2%}"
