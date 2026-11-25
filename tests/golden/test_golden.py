"""Golden tests: command list → generated script → FElupe → stored results.

Each folder in ``tests/golden`` is a case with

- ``commands.json``: the command list,
- mesh files used by the commands (see ``make_meshes.py``),
- ``script.py``: the expected generated script (without its version line),
- ``results.json``: the expected force-displacement curves of the jobs.

Run ``pytest tests/golden --update-golden`` to rewrite ``script.py`` and
``results.json`` after an intended change, and review the diff.
"""

import functools
import json
import re
import runpy
import shutil
from pathlib import Path

import felupe as fem
import numpy as np
import pytest

from felupe_studio import codegen
from felupe_studio.capabilities import capabilities
from felupe_studio.codegen import TOL
from felupe_studio.expressions import resolve
from felupe_studio.materials import material_call
from felupe_studio.runner import run

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


def single_precision(document):
    """Whether a job solves the linear equation system in single precision (ADR
    0016). Its results depend on the round-off of the factorization in float32 of
    the machine: they are compared with a looser relative tolerance."""
    return any(
        c.get("solver", {}).get("precision") == "single"
        for c in document["commands"]
        if c["command"] == "job.add"
    )


def model_in_single_precision(document):
    """Whether the model is in single precision (ADR 0016, #297). Its results depend
    on the round-off of float32 of the machine, e.g. the order of the sums of BLAS:
    at a tolerance below the round-off, the Newton iterations stop where the
    round-off of the machine lets them (CI and a container differ by 7e-4 of the
    largest force of bar_two_materials_float32, whose estimate is 6.5e-3). Each
    machine agrees with double precision within 1e-3 of the largest force
    (test_model_in_single_precision), so two machines within 2e-3."""
    return any(
        c.get("precision") == "single"
        for c in document["commands"]
        if c["command"] == "model.settings"
    )


pytestmark = pytest.mark.golden


def needs_pardiso(document, single=False):
    """Skip a case whose jobs solve with PARDISO (#308) where this Python does not
    have pypardiso (e.g. CI), or for ``single`` precision a PyPardiso that
    factorizes in float32."""
    if not any(
        c.get("solver", {}).get("type") == "pardiso"
        for c in document["commands"]
        if c["command"] == "job.add"
    ):
        return
    pardiso = capabilities().get("pardiso")
    if pardiso is None:
        pytest.skip("PARDISO needs the package pypardiso.")
    if single and not pardiso["single"]:
        pytest.skip("PARDISO in single precision needs a PyPardiso in float32.")


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
    needs_pardiso(load(case))
    results = evaluate(case, tmp_path, monkeypatch)
    expected = HERE / case / "results.json"
    if request.config.getoption("--update-golden"):
        expected.write_text(json.dumps(results, indent=2) + "\n", encoding="utf-8")

    reference = json.loads(expected.read_text(encoding="utf-8"))
    assert results["jobs"].keys() == reference["jobs"].keys()
    document = load(case)
    rtol, atol = (1e-6 if single_precision(document) else RTOL), ATOL
    for name, curve in results["jobs"].items():
        for key in ("displacement", "force"):
            if model_in_single_precision(document):
                values = np.abs(reference["jobs"][name][key])
                rtol, atol = 0, 2e-3 * values.max() + ATOL
            np.testing.assert_allclose(
                curve[key],
                reference["jobs"][name][key],
                rtol=rtol,
                atol=atol,
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


def test_expressions_like_numbers():
    # the sandwich spring of 3 layers with expressions of its parameters (#242):
    # the same values, the same curve
    curves = [
        json.loads((HERE / case / "results.json").read_text(encoding="utf-8"))
        for case in ("sandwich_spring_3_layers", "sandwich_spring_expressions")
    ]
    for key in ("displacement", "force"):
        np.testing.assert_allclose(
            curves[1]["jobs"]["job"][key], curves[0]["jobs"]["job"][key], rtol=1e-12
        )
    script = (HERE / "sandwich_spring_expressions" / "script.py").read_text("utf-8")
    assert "fem.math.linsteps([0, (0.5 * layers * height)], num=(2 * cells))" in script


def test_derived_parameters_like_expressions():
    # the sandwich spring with derived parameters (#333, ADR 0021) before the
    # parameters that they use: the same values, the same curve as the expressions
    curves = [
        json.loads((HERE / case / "results.json").read_text(encoding="utf-8"))
        for case in ("sandwich_spring_expressions", "sandwich_spring_derived")
    ]
    for key in ("displacement", "force"):
        np.testing.assert_allclose(
            curves[1]["jobs"]["job"][key], curves[0]["jobs"]["job"][key], rtol=1e-12
        )
    script = (HERE / "sandwich_spring_derived" / "script.py").read_text("utf-8")
    # after the free parameters, as their expressions, an integer one as an int
    lines = script[script.index("# parameters") :].splitlines()[1:9]
    assert lines[5:] == [
        "total_height = sheet + layers * (height + sheet)  # mm",
        "travel = 0.5 * layers * height  # mm",
        "substeps = int(2 * cells)",
    ]
    assert "fem.math.linsteps([0, travel], num=substeps)" in script


def test_two_materials_reference():
    # checked by hand with FElupe 12.0.0 before the GUI existed
    results = json.loads(
        (HERE / "bar_two_materials" / "results.json").read_text(encoding="utf-8")
    )
    assert np.isclose(results["jobs"]["job_1"]["force"][-1], 0.66322, rtol=1e-5)


def test_repeated_step_of_a_load_cycle():
    # the bar of bar_single_body loaded, unloaded and loaded again by the steps
    # [load, unload, load] of one job (#331): every step has 6 substeps; the
    # second load gives the curve of the first, which is that of bar_single_body,
    # since the hyperelastic bar is unloaded to its undeformed state, and the
    # unload follows the load back within the tolerance of the Newton iterations
    cycle, single = (
        json.loads((HERE / case / "results.json").read_text(encoding="utf-8"))
        for case in ("bar_load_cycle", "bar_single_body")
    )
    u = np.array(cycle["jobs"]["job_1"]["displacement"])
    f = np.array(cycle["jobs"]["job_1"]["force"])
    first = single["jobs"]["job_1"]
    assert len(u) == 18
    np.testing.assert_allclose(u[:6], first["displacement"])
    np.testing.assert_allclose(u[6:12], first["displacement"][::-1])
    np.testing.assert_allclose(f[:6], first["force"], rtol=1e-10, atol=1e-12)
    np.testing.assert_allclose(f[12:], f[:6], rtol=1e-10, atol=1e-12)
    np.testing.assert_allclose(f[6:12], f[5::-1], atol=1e-2 * f.max())
    script = (HERE / "bar_load_cycle" / "script.py").read_text(encoding="utf-8")
    assert "fem.CharacteristicCurve(steps=[load, unload, load]," in script


def test_cube_made_by_a_tool_like_the_file():
    # the cube of cube_yeoh made by the mesh tool Cube (ADR 0019) instead of read
    # from its file (fem.Cube(n=3)): the same mesh, the same curve
    tool, file = (
        json.loads((HERE / case / "results.json").read_text(encoding="utf-8"))
        for case in ("cube_made_by_tools", "cube_yeoh")
    )
    for key in ("displacement", "force"):
        np.testing.assert_allclose(
            tool["jobs"]["job_1"][key], file["jobs"]["job_1"][key], rtol=1e-10
        )
    script = (HERE / "cube_made_by_tools" / "script.py").read_text("utf-8")
    line = "cube = fem.Cube(a=[0, 0, 0], b=[1, 1, 1], n=[nodes, nodes, nodes])"
    assert line in script
    # no mesh file: no meshio
    assert "import meshio" not in script


def test_cube_expanded_from_a_rectangle_like_the_file():
    # the cube of cube_yeoh as a rectangle expanded by the operation expand (ADR
    # 0019): the same mesh, the same curve
    tool, file = (
        json.loads((HERE / case / "results.json").read_text(encoding="utf-8"))
        for case in ("cube_expanded_from_rectangle", "cube_yeoh")
    )
    for key in ("displacement", "force"):
        np.testing.assert_allclose(
            tool["jobs"]["job_1"][key], file["jobs"]["job_1"][key], rtol=1e-10
        )


def test_pardiso_like_superlu():
    # the bar of two materials with PARDISO of Intel oneMKL (#308): the curve of
    # SuperLU, stored where pypardiso is installed
    pardiso, superlu = (
        json.loads((HERE / case / "results.json").read_text(encoding="utf-8"))
        for case in ("bar_pardiso", "bar_two_materials")
    )
    for key in ("displacement", "force"):
        np.testing.assert_allclose(
            pardiso["jobs"]["job_1"][key], superlu["jobs"]["job_1"][key], rtol=1e-10
        )


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


def run_script(document, folder, tmp_path, monkeypatch):
    """Run the script of a command list with the files of a case in a directory."""
    for path in (HERE / folder).glob("*.vtu"):
        shutil.copy(path, tmp_path)
    script = tmp_path / "script.py"
    script.write_text(codegen(document), encoding="utf-8")
    monkeypatch.chdir(tmp_path)
    return runpy.run_path(str(script))


def test_diagonal_boundary_like_two_boundaries(tmp_path, monkeypatch):
    # one boundary that moves the right end diagonally, ramped with one value per
    # constrained component (#225), like two boundaries with one component each
    diagonal = load("bar_single_body")
    move = next(c for c in diagonal["commands"] if c["name"] == "move")
    move["constrained"] = ["x", "z"]
    step = next(c for c in diagonal["commands"] if c["command"] == "step.add")
    step["ramp"]["items"] = [{"target": "move", "end": [0.5, -0.1]}]

    apart = load("bar_single_body")
    at = 1 + next(i for i, c in enumerate(apart["commands"]) if c["name"] == "move")
    apart["commands"].insert(
        at,
        {
            "command": "boundary.add",
            "name": "press",
            "pointset": "right",
            "constrained": ["z"],
        },
    )
    step = next(c for c in apart["commands"] if c["command"] == "step.add")
    step["ramp"]["items"] = [
        {"target": "move", "end": 0.5},
        {"target": "press", "end": -0.1},
    ]

    one = run_script(diagonal, "bar_single_body", tmp_path, monkeypatch)
    two = run_script(apart, "bar_single_body", tmp_path, monkeypatch)
    np.testing.assert_allclose(
        one["field"][0].values, two["field"][0].values, atol=1e-12
    )
    np.testing.assert_allclose(
        np.array(one["job_1"].y), np.array(two["job_1"].y), atol=1e-12
    )
    # the end moved in x and z at once
    end = one["field"][0].values[one["boundaries"]["move"].points]
    np.testing.assert_allclose(end[:, 0], 0.5)
    np.testing.assert_allclose(end[:, 2], -0.1)


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


def test_rotation_in_plane_strain_like_the_bar_with_fixed_z(tmp_path, monkeypatch):
    # the plate of the cross section turned by a rigid end about z (#175): its moment
    # is the moment of the bar (thickness 1) with all displacements in z fixed, its
    # end turned by a rotation point about z and not tilted
    document = load("plate_rotation_plane_strain")
    commands = [c for c in document["commands"] if c["command"] != "model.settings"]
    for cmd in commands:
        if cmd["command"] == "mesh.import":
            cmd["file"] = "bar.vtu"
        if cmd["command"] == "point.add":
            cmd["coordinates"][2] = 0.5
        if cmd["name"] == "hold":
            cmd["constrained"] = ["x", "y", "z"]
        if cmd["command"] == "mpc.add":
            cmd["constrained"] = ["x", "y", "z"]
    at = commands.index(next(c for c in commands if c["name"] == "fixed"))
    commands[at:at] = [
        {
            "command": "pointset.add",
            "name": "all_points",
            "select": {"ids": list(range(325))},
        },
        {
            "command": "boundary.add",
            "name": "plane",
            "pointset": "all_points",
            "constrained": ["z"],
        },
        {
            "command": "boundary.add",
            "name": "tilt",
            "pointset": "pivot",
            "constrained": ["x", "y"],
        },
    ]
    shutil.copy(HERE / "bar_loadcase" / "bar.vtu", tmp_path)
    script = tmp_path / "script.py"
    script.write_text(codegen({**document, "commands": commands}), encoding="utf-8")
    monkeypatch.chdir(tmp_path)
    job = runpy.run_path(str(script))["job_1"]
    plate = json.loads(
        (HERE / "plate_rotation_plane_strain" / "results.json").read_text(
            encoding="utf-8"
        )
    )["jobs"]["job_1"]
    # the rotation and the moment about z
    np.testing.assert_allclose(plate["displacement"], np.array(job.x)[:, 2])
    np.testing.assert_allclose(plate["force"], np.array(job.y)[:, 2], rtol=1e-5)
    assert plate["force"][-1] > 0


def curve_of(document, folder, tmp_path, monkeypatch, k=2):
    """The displacements and the forces of component k of the curve of a job, by the
    script."""
    for path in (HERE / folder).glob("*.vtu"):
        shutil.copy(path, tmp_path)
    script = tmp_path / "script.py"
    script.write_text(codegen(document), encoding="utf-8")
    monkeypatch.chdir(tmp_path)
    job = runpy.run_path(str(script))["job_1"]
    return np.array(job.x)[:, k], np.array(job.y)[:, k]


def prescribed(document, constrained, points="top", axis="z"):
    """The model of a contact case with its points moved like the rigid surface."""
    commands = [
        c
        for c in document["commands"]
        if c["command"] not in ("rigid.add", "contact.add")
        and c["name"] not in ("press", "guide")
    ]
    at = next(i for i, c in enumerate(commands) if c["command"] == "step.add")
    commands.insert(
        at,
        {
            "command": "boundary.add",
            "name": "press",
            "pointset": points,
            "constrained": [axis],
        },
    )
    if constrained:
        commands.insert(
            at + 1,
            {
                "command": "boundary.add",
                "name": "guide",
                "pointset": points,
                "constrained": constrained,
            },
        )
    return {**document, "commands": commands}


@pytest.mark.parametrize(
    "case, constrained",
    [("block_contact_plane", []), ("block_contact_friction", ["x", "y"])],
)
def test_contact_with_a_plane_like_a_prescribed_top(
    case, constrained, tmp_path, monkeypatch
):
    # a block pressed by a rigid plane (#220): without friction its top slides
    # freely like a prescribed displacement in z, with friction it sticks like a
    # prescribed displacement with x and y fixed; the penalty of the contact lets
    # the top penetrate the plane a little (a relative difference of 6e-4)
    document = load(case)
    moves, forces = curve_of(document, case, tmp_path, monkeypatch)
    np.testing.assert_allclose(moves, np.linspace(0, -0.2, 6))
    _, reference = curve_of(
        prescribed(document, constrained), case, tmp_path, monkeypatch
    )
    assert forces[-1] < 0
    np.testing.assert_allclose(forces, reference, rtol=1e-3, atol=1e-12)


@pytest.mark.parametrize(
    "case", ["plate_contact_plane_strain", "cylinder_contact_axisymmetric"]
)
def test_contact_with_a_line_like_a_prescribed_end(case, tmp_path, monkeypatch):
    # the plate (plane strain) and the cylinder (axisymmetric) pressed at their end
    # by a rigid line without friction (#221), like a prescribed displacement of the
    # end in x; the penalty of the contact of an axisymmetric model does not depend
    # on the radius of a point, but its penetration vanishes with the multiplier
    document = load(case)
    moves, forces = curve_of(document, case, tmp_path, monkeypatch, k=0)
    np.testing.assert_allclose(moves, np.linspace(0, -0.3, 4))
    _, reference = curve_of(
        prescribed(document, [], points="end", axis="x"),
        case,
        tmp_path,
        monkeypatch,
        k=0,
    )
    assert forces[-1] < 0
    np.testing.assert_allclose(forces, reference, rtol=1e-3, atol=1e-12)


def test_contact_with_a_circle(tmp_path, monkeypatch):
    # a roller (a circle about z) pressed onto the top of the plate in plane strain
    # (#221): the points in contact are on the circle
    document = load("plate_contact_roller")
    shutil.copy(HERE / "plate_contact_roller" / "plate.vtu", tmp_path)
    script = tmp_path / "script.py"
    script.write_text(codegen(document), encoding="utf-8")
    monkeypatch.chdir(tmp_path)
    namespace = runpy.run_path(str(script))
    job, field = namespace["job_1"], namespace["field"]
    forces = np.array(job.y)[:, 1]
    assert forces[-1] < 0 and np.all(np.diff(forces) <= 0)
    contact = namespace["touch"]
    points = field.mesh_container.points + field[0].values
    distance = np.hypot(*(points[contact.points] - [1.5, 3 - 0.2]).T)
    active = np.asarray(contact.results.active).ravel()
    assert active.sum() > 1
    np.testing.assert_allclose(distance[active], 2, atol=5e-3)


def test_contact_with_a_cylinder(tmp_path, monkeypatch):
    # a roller pressed onto the top of the block (#220): the points in contact are
    # on the deformed cylinder (within the penetration of the penalty)
    document = load("block_contact_cylinder")
    shutil.copy(HERE / "block_contact_cylinder" / "block.vtu", tmp_path)
    script = tmp_path / "script.py"
    script.write_text(codegen(document), encoding="utf-8")
    monkeypatch.chdir(tmp_path)
    namespace = runpy.run_path(str(script))
    job, field = namespace["job_1"], namespace["field"]
    forces = np.array(job.y)[:, 2]
    assert forces[-1] < 0 and np.all(np.diff(forces) <= 0)
    contact = namespace["touch"]
    points = field.mesh_container.points + field[0].values
    center = np.array([0, 0.5, 3 - 0.2])
    distance = np.hypot(*(points[contact.points] - center)[:, [0, 2]].T)
    active = np.asarray(contact.results.active).ravel()
    assert active.any()
    np.testing.assert_allclose(distance[active], 2, atol=5e-3)


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


# the cases of a model in double precision with a direct linear solver (all but the
# iterative ones and the model in single precision)
DIRECT = [
    case
    for case in CASES
    if all(
        c.get("solver", {}).get("type") != "iterative"
        for c in load(case)["commands"]
        if c["command"] == "job.add"
    )
    and not model_in_single_precision(load(case))
]


@pytest.mark.parametrize("case", DIRECT)
def test_single_precision_gives_the_curves_of_double_precision(
    case, tmp_path, monkeypatch
):
    # the linear equation system in single precision, the model in double precision
    # (ADR 0016): the curves of double precision within the tolerance of the job, at
    # most 1e-3 and at least 1e-6 of the largest force (measured: 1.2e-4 for the
    # cutback of bar_cutback with the tolerance 0.01, else below 2e-5)
    document = load(case)
    needs_pardiso(document, single=True)
    tolerances = {}
    for cmd in resolve(document)[0]["commands"]:
        if cmd["command"] == "job.add":
            tolerances[cmd["name"]] = float(cmd.get("tol", TOL))
    for cmd in document["commands"]:
        if cmd["command"] == "job.add":
            solver = cmd.get("solver", {"type": "superlu"})
            cmd["solver"] = {**solver, "precision": "single"}
    results = evaluate(case, tmp_path, monkeypatch, document)
    text = (HERE / case / "results.json").read_text(encoding="utf-8")
    reference = json.loads(text)["jobs"]
    assert results["jobs"].keys() == reference.keys()
    for name, curve in results["jobs"].items():
        force = np.array(reference[name]["force"])
        tol = max(min(tolerances[name], 1e-3), 1e-6)
        np.testing.assert_allclose(
            curve["force"], force, rtol=0, atol=tol * np.abs(force).max() + ATOL
        )


# the model in single precision (#297): cases whose round-off is too large for
# float32, as the estimate of the job says, and one that does not converge
LARGE_ROUNDOFF = {
    # steel (E = 210000) bonded to rubber (mu = 0.5): the curves deviate by 4e-2 to
    # 9e-2, with an estimate of 0.43 to 0.76
    "sandwich_spring_3_layers",
    "sandwich_spring_5_layers",
    "sandwich_spring_expressions",
    "sandwich_spring_derived",
    # the penalty of the multi-point constraint of the rotation point: 2e-3, with an
    # estimate of 0.74
    "plate_rotation_plane_strain",
}
# the three-field variation of steel on quadratic tetrahedrons (#420): the residual
# of float32 stalls at about 2.5 times the estimate of its round-off by FElupe 12.1.1,
# above the tight tolerance of the case (the estimate of mixed fields misses the
# isochoric part, adtzlr/felupe#1305); with the default tolerance of the app, it
# converges (test_three_field_variation_in_single_precision)
NOT_CONVERGED = {"block_contact_friction", "plasticity_cube_three_field"}


@pytest.mark.parametrize("case", CASES)
def test_model_in_single_precision(case, tmp_path, monkeypatch):
    # regions and fields in float32 (ADR 0016, #297), run like the app: an estimate
    # of the round-off below 1e-2 of the reaction forces, and the curves of double
    # precision within 1e-3 of the largest force (or within the estimate, which bounds
    # the deviation: the round-off of the machine varies, e.g. 8.4e-4 of the Extended
    # Tube with an estimate of 6e-3); above 1e-2 for the cases of LARGE_ROUNDOFF,
    # which the app reports (measured with FElupe 12.1.1: the deviations are about a
    # tenth of the estimate)
    document = load(case)
    needs_pardiso(document, single=True)
    settings = [c for c in document["commands"] if c["command"] == "model.settings"]
    if not settings:
        settings = [{"command": "model.settings", "name": "settings"}]
        document["commands"].insert(0, settings[0])
    settings[0]["precision"] = "single"
    for path in (HERE / case).iterdir():
        if path.name not in ("commands.json", "script.py", "results.json"):
            shutil.copy(path, tmp_path)
    monkeypatch.chdir(tmp_path)
    if case in NOT_CONVERGED:
        with pytest.raises(fem.NewtonConvergenceError):
            run(document)
        return
    results = run(document)
    # the curves of the app in double precision, also of a rotation (the moments)
    settings[0]["precision"] = "double"
    reference = run(document)
    for name, result in results.items():
        if "y" not in result:
            continue
        force = np.array(reference[name]["y"], dtype=float)
        scale = np.abs(force).max()
        single = np.array(result["y"], dtype=float)
        deviation = np.abs(single - force).max() / scale if scale > 1e-6 else 0.0
        estimate = result["roundoff"]
        if case in LARGE_ROUNDOFF:
            assert estimate > 1e-2 and deviation < estimate
        else:
            assert deviation < max(1e-3, estimate) and estimate < 1e-2


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


def umat_of(material):
    """The material of a ``material.add`` command, without its volumetric part."""
    func, args, _ = material_call(material)
    return eval(f"{func}({', '.join(args)})", {"fem": fem, "functools": functools})


@pytest.mark.parametrize("case", MATERIALS)
def test_material_matches_felupe(case):
    # the stretch is 1 + u and the force is the nominal stress of the cube; the
    # reference is the incompressible uniaxial tension of FElupe, also along the
    # load cycle of the Mullins effect (#346), whose state variable FElupe carries
    # along the path of the stretches
    commands = load(case)["commands"]
    [material] = [c for c in commands if c["command"] == "material.add"]
    curve = json.loads((HERE / case / "results.json").read_text(encoding="utf-8"))
    u = np.array(curve["jobs"]["job_1"]["displacement"])
    force = np.array(curve["jobs"]["job_1"]["force"])
    _, stress, _ = fem.ViewMaterialIncompressible(umat_of(material)).uniaxial(1 + u)
    assert np.isclose(u.max(), 1)  # up to a stretch of 2
    np.testing.assert_allclose(force, stress, rtol=1e-3, atol=1e-6)


@pytest.mark.parametrize(
    "case", ["cube_mullins_neo_hooke", "cube_mullins_mooney_rivlin"]
)
def test_mullins_effect_of_a_load_cycle(case):
    # the cube stretched to 1.5, released, stretched to 1.5 again, released,
    # stretched to 2 and released (#346, the steps [stretch, release, stretch,
    # release, stretch_more, release_more]): the second stretch to 1.5 is softer than
    # the first one and follows the release back; at the first stretch and above
    # 1.5, the largest stretch so far, the curve is that of the material without the
    # Mullins effect
    commands = load(case)["commands"]
    [material] = [c for c in commands if c["command"] == "material.add"]
    curve = json.loads((HERE / case / "results.json").read_text(encoding="utf-8"))
    u = np.array(curve["jobs"]["job_1"]["displacement"])
    force = np.array(curve["jobs"]["job_1"]["force"])
    first, release, second = force[0:6], force[6:12], force[12:18]
    assert np.all(second[1:5] < 0.9 * first[1:5])
    np.testing.assert_allclose(second, release[::-1], rtol=1e-6, atol=1e-9)
    np.testing.assert_allclose(second[-1], first[-1], rtol=1e-6)
    elastic = umat_of({k: v for k, v in material.items() if k != "mullins"})
    primary = np.r_[0:6, 27:30]  # the first stretch, the stretch from 1.6 to 2
    _, stress, _ = fem.ViewMaterialIncompressible(elastic).uniaxial(1 + u[primary])
    np.testing.assert_allclose(force[primary], stress, rtol=1e-3, atol=1e-6)
    # the release from 2 is softer than the stretch to 2 (the same stretches)
    np.testing.assert_array_less(force[31:35], force[25:29][::-1])


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


# the cube of cube_yeoh in the explicit ways of u-p-J (#420)
WAYS = ["cube_yeoh_condensed", "cube_yeoh_mixed", "cube_yeoh_three_field"]


@pytest.mark.parametrize("case", WAYS)
def test_ways_of_u_p_j_like_the_automatic_one(case):
    # condensed per cell, mixed fields of a constant pressure and volume ratio per
    # cell (Q1/P0) and the three-field variation of Yeoh with the volumetric part
    # K/2 (J - 1)² of the material: the same discretization of the cube of linear
    # hexahedrons as the automatic u-p-J, so the same converged curve
    def curve(case):
        text = (HERE / case / "results.json").read_text(encoding="utf-8")
        return json.loads(text)["jobs"]["job_1"]

    automatic, way = curve("cube_made_by_tools"), curve(case)
    np.testing.assert_allclose(way["displacement"], automatic["displacement"])
    np.testing.assert_allclose(way["force"], automatic["force"], rtol=1e-7)
    # the script says which way it is
    script = (HERE / case / "script.py").read_text(encoding="utf-8")
    assert "# body: the " in script
    assert "nearly_incompressible(" not in script


def test_condensed_like_mixed_fields_of_quadratic_hexahedrons(tmp_path, monkeypatch):
    # the clamped bar of quadratic hexahedrons condensed per cell (Q2/P0) and on
    # mixed fields, whose pressure and volume ratio are constant per cell of
    # hexahedron20 too (#420): the same converged curve
    document = load("bar_hexahedron20_condensed")
    for cmd in document["commands"]:
        if cmd["command"] == "section.add":
            cmd["formulation"] = "u-p-J-mixed"
    mixed = evaluate("bar_hexahedron20_condensed", tmp_path, monkeypatch, document)
    text = (HERE / "bar_hexahedron20_condensed" / "results.json").read_text("utf-8")
    condensed = json.loads(text)["jobs"]["job_1"]
    np.testing.assert_allclose(
        mixed["jobs"]["job_1"]["force"], condensed["force"], rtol=1e-6, atol=1e-12
    )
    script = (HERE / "bar_hexahedron20_condensed" / "script.py").read_text("utf-8")
    assert "region_body = condensed_region(all_cells)" in script
    assert "fem.SolidBodyNearlyIncompressible(rubber, field_body, bulk=5000)" in script


def test_three_field_variation_in_single_precision(tmp_path, monkeypatch):
    # the steel of plasticity_cube_three_field in float32 (#297, #420) with the
    # default tolerance of the app: the curve of double precision within 1e-3 of the
    # largest force (it does not converge with the tight tolerance of the case, see
    # NOT_CONVERGED)
    document = load("plasticity_cube_three_field")
    for cmd in document["commands"]:
        if cmd["command"] == "job.add":
            del cmd["tol"]
    for path in (HERE / "plasticity_cube_three_field").glob("*.vtu"):
        shutil.copy(path, tmp_path)
    monkeypatch.chdir(tmp_path)
    reference = np.array(run(document)["job_1"]["y"], dtype=float)
    settings = next(c for c in document["commands"] if c["command"] == "model.settings")
    settings["precision"] = "single"
    single = np.array(run(document)["job_1"]["y"], dtype=float)
    scale = np.abs(reference).max()
    assert np.abs(single - reference).max() < 1e-3 * scale


def test_plasticity_like_linear_hardening(tmp_path, monkeypatch):
    # uniaxial tension of a unit cube of steel beyond its yield stress and unloaded
    # (#191): von Mises plasticity with linear isotropic hardening K gives the stress
    # sy + K ep at the plastic strain ep = (u - sy / E) / (1 + K / E), and an elastic
    # unloading with E, which leaves the plastic strain as remaining strain
    E, sy, K = 210000.0, 250.0, 1000.0
    curve = json.loads(
        (HERE / "plasticity_cube" / "results.json").read_text(encoding="utf-8")
    )["jobs"]["job_1"]
    u, force = np.array(curve["displacement"]), np.array(curve["force"])
    loading, unloading = slice(0, 6), slice(6, None)
    plastic = np.maximum((u[loading] - sy / E) / (1 + K / E), 0)
    expected = np.where(plastic > 0, sy + K * plastic, E * u[loading])
    np.testing.assert_allclose(force[loading], expected, rtol=1e-10)
    remaining = plastic[-1]
    np.testing.assert_allclose(force[unloading], E * (u[unloading] - remaining))
    assert remaining == pytest.approx(0.0037914691943128)

    # the state variable of the equivalent plastic strain of the solid body
    document = load("plasticity_cube")
    namespace = run_script(document, "plasticity_cube", tmp_path, monkeypatch)
    statevars = namespace["solid_body"].results.statevars
    np.testing.assert_allclose(statevars[0], remaining, rtol=1e-10)


def test_plasticity_of_the_three_field_variation():
    # the cube of plasticity_cube_three_field, quadratic tetrahedrons in the
    # three-field variation (#420): the stress sy + K ep and the elastic unloading of
    # von Mises plasticity, like the displacement formulation of plasticity_cube
    E, sy, K = 210000.0, 250.0, 1000.0
    curve = json.loads(
        (HERE / "plasticity_cube_three_field" / "results.json").read_text("utf-8")
    )["jobs"]["job_1"]
    u, force = np.array(curve["displacement"]), np.array(curve["force"])
    loading, unloading = slice(0, 6), slice(6, None)
    plastic = np.maximum((u[loading] - sy / E) / (1 + K / E), 0)
    expected = np.where(plastic > 0, sy + K * plastic, E * u[loading])
    np.testing.assert_allclose(force[loading], expected, rtol=1e-8)
    np.testing.assert_allclose(
        force[unloading], E * (u[unloading] - plastic[-1]), rtol=1e-6
    )
    script = (HERE / "plasticity_cube_three_field" / "script.py").read_text("utf-8")
    assert "fem.SolidBody(fem.ThreeFieldVariation(steel), field_body)" in script
    assert "field_body = fem.FieldsMixed(region_body, n=3)" in script


def test_linear_elastic_small_strain_like_hooke(tmp_path, monkeypatch):
    # the linear elastic material of small strains (fem.LinearElastic, #259) under
    # uniaxial tension: the stress E u, and the curve of the strain-based linear
    # elastic material in the framework of small strains
    E = 210000.0
    curve = json.loads(
        (HERE / "linear_elastic_cube" / "results.json").read_text(encoding="utf-8")
    )["jobs"]["job_1"]
    u, force = np.array(curve["displacement"]), np.array(curve["force"])
    np.testing.assert_allclose(force, E * u, rtol=1e-10)

    document = load("linear_elastic_cube")
    for cmd in document["commands"]:
        if cmd["command"] == "material.add":
            cmd.update(model="LinearElastic", framework="small-strain")
    strain = evaluate("linear_elastic_cube", tmp_path, monkeypatch, document)
    np.testing.assert_allclose(strain["jobs"]["job_1"]["force"], force, rtol=1e-10)


@pytest.mark.parametrize(
    "framework",
    [
        {"framework": "total-lagrange"},
        {"framework": "co-rotational"},
        {"framework": "seth-hill", "strain_exponent": 0},
    ],
)
def test_frameworks_like_small_strain(tmp_path, monkeypatch, framework):
    # the frameworks of large deformations of the strain-based material (#191): Total
    # Lagrange, co-rotational and the Hencky strain of Seth-Hill (FElupe 12.1) give
    # about the curve of the small strains of 0.5 %
    document = load("plasticity_cube")
    for cmd in document["commands"]:
        if cmd["command"] == "material.add":
            cmd.update(framework)
    total = evaluate("plasticity_cube", tmp_path, monkeypatch, document)
    small = json.loads(
        (HERE / "plasticity_cube" / "results.json").read_text(encoding="utf-8")
    )
    force = np.array(total["jobs"]["job_1"]["force"])
    reference = np.array(small["jobs"]["job_1"]["force"])
    np.testing.assert_allclose(force, reference, rtol=0, atol=0.01 * reference.max())
    if framework["framework"] == "co-rotational":
        # a stretch without rotation: the Biot strain is the engineering strain and
        # the first Piola-Kirchhoff stress the Biot stress, those of small strains
        np.testing.assert_allclose(force, reference, rtol=1e-10)
    else:
        assert not np.allclose(force, reference, rtol=1e-6)
