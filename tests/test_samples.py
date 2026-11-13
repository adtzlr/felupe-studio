"""The sample models of the app (app/public/samples, made by
app/scripts/make_samples.py) are valid project files and solve with FElupe."""

import json
import sys
from pathlib import Path

import numpy as np
import pytest

from felupe_studio.commands import errors
from felupe_studio.project import dumps, loads
from felupe_studio.runner import run

APP = Path(__file__).parents[1] / "app"
SAMPLES = json.loads((APP / "src" / "core" / "samples.json").read_text())
sys.path.insert(0, str(APP / "scripts"))

from make_samples import thumbnail  # noqa: E402


def test_index_lists_every_sample():
    folders = {p.name for p in (APP / "public" / "samples").iterdir() if p.is_dir()}
    assert {s["id"] for s in SAMPLES} == folders
    for sample in SAMPLES:
        assert sample["title"] and sample["description"] and sample["topics"]


@pytest.mark.parametrize("sample", SAMPLES, ids=[s["id"] for s in SAMPLES])
def test_sample_solves(sample, monkeypatch):
    folder = APP / "public" / "samples" / sample["id"]
    text = (folder / "model.felupe.json").read_text(encoding="utf-8")
    document = loads(text)
    # a canonical project file, as the app saves it
    assert dumps(document) == text
    assert errors(document) == []
    # the files of imported meshes and of scripts that make meshes (#182)
    files = {
        c["file"]
        for c in document["commands"]
        if c["command"] in ("mesh.import", "mesh.script")
    }
    assert sorted(files) == sample["files"]
    assert all((folder / name).is_file() for name in files)

    monkeypatch.chdir(folder)
    results = run(document)
    steps = [c for c in document["commands"] if c["command"] == "step.add"]
    assert results["job"]["substeps"] == sum(s["ramp"]["num"] + 1 for s in steps)
    force = np.array(results["job"]["y"])[:, 0]
    assert np.all(np.isfinite(force)) and force[-1] > 0


def test_material_test_is_analytical(monkeypatch):
    "Uniaxial tension of the incompressible Neo-Hooke model: P = mu (λ - 1 / λ²)."
    folder = APP / "public" / "samples" / "material-test"
    monkeypatch.chdir(folder)
    results = run(loads((folder / "model.felupe.json").read_text()))["job"]
    stretch = 1 + np.array(results["x"])[:, 0]
    force = np.array(results["y"])[:, 0]
    # an eighth of a unit cube: the force is the nominal stress of the end face
    np.testing.assert_allclose(force, 0.5 * (stretch - 1 / stretch**2), rtol=2e-3)


def test_glued_plate_moves_and_tilts(monkeypatch):
    "The plate of the glued plate is moved by 8 mm and tilted by 0.1 rad (#102)."
    from felupe_studio import results

    folder = APP / "public" / "samples" / "glued-plate"
    monkeypatch.chdir(folder)
    run(loads((folder / "model.felupe.json").read_text()))
    meta, _ = results.scene("job", results.substeps("job"), "displacement")
    points = {p["name"]: p for p in json.loads(meta)["points"]}
    np.testing.assert_allclose(points["plate"]["displacement"], [8, 0, 0], atol=1e-8)
    np.testing.assert_allclose(points["tilt"]["displacement"], [0, 0.1, 0], atol=1e-8)
    assert points["tilt"]["rotation"]
    # the shear force and the moment that tilts the plate
    assert points["plate"]["force"][0] > 0
    assert abs(points["tilt"]["force"][1]) > 0


def test_sandwich_spring_follows_its_parameters(monkeypatch):
    """The sandwich spring (#184) with 3 and 5 rubber layers: the same project with
    another value of a parameter. The top follows the height of the stack (z ==
    max), and the shear stiffness is about G A / (layers height)."""
    folder = APP / "public" / "samples" / "sandwich-spring"
    document = loads((folder / "model.felupe.json").read_text(encoding="utf-8"))
    monkeypatch.chdir(folder)
    forces = {}
    for layers in (3, 5):
        for c in document["commands"]:
            if c["name"] == "layers":
                c["value"] = layers
        results = run(document)["job"]
        forces[layers] = np.array(results["y"])[-1, 0]
        assert np.array(results["x"])[-1, 0] == pytest.approx(12)
    # linear: 0.5 MPa * pi * 50² mm² / (layers * 8 mm) * 12 mm
    for layers, force in forces.items():
        linear = 0.5 * np.pi * 50**2 / (layers * 8) * 12
        assert force == pytest.approx(linear, rel=0.05)
    assert forces[3] / forces[5] == pytest.approx(5 / 3, rel=0.02)


def test_axisymmetric_sandwich_spring_follows_its_parameters(monkeypatch):
    """The axisymmetric sandwich spring (#175) with 3 and 5 rubber layers, pressed by
    0.04 mm: the first sheet follows the stack (x == min), the stiffness of the
    stack of bonded layers is inversely proportional to the number of layers."""
    folder = APP / "public" / "samples" / "sandwich-spring-axisymmetric"
    document = loads((folder / "model.felupe.json").read_text(encoding="utf-8"))
    monkeypatch.chdir(folder)
    forces = {}
    for c in document["commands"]:
        if c["command"] == "step.add":
            c["ramp"] = {"num": 1, "items": [{"target": "press", "end": 0.04}]}
    for layers in (3, 5):
        for c in document["commands"]:
            if c["name"] == "layers":
                c["value"] = layers
        results = run(document)["job"]
        forces[layers] = np.array(results["y"])[-1, 0]
        assert np.array(results["x"])[-1, 0] == pytest.approx(0.04)
    assert forces[3] / forces[5] == pytest.approx(5 / 3, rel=0.02)


def test_plate_with_hole_concentrates_the_stress(monkeypatch):
    """The plate with a hole in plane strain (#175): the largest principal stress is
    at the top of the hole (x = 0, y = radius), more than twice the mean stress of
    the end (the force per unit thickness over the width) in the cell there."""
    from felupe_studio import results

    folder = APP / "public" / "samples" / "plate-with-hole"
    document = loads((folder / "model.felupe.json").read_text(encoding="utf-8"))
    for c in document["commands"]:
        if c["command"] == "step.add":
            c["ramp"] = {"num": 1, "items": [{"target": "pull", "end": 0.4}]}
    monkeypatch.chdir(folder)
    force = np.array(run(document)["job"]["y"])[-1, 0]
    meta, _ = results.scene("job", 2, "stress_max")
    # the center of the cell at the top of the hole
    top = json.loads(meta)["extremes"]["max"]
    assert top["position"][0] == pytest.approx(0, abs=1)
    assert top["position"][1] == pytest.approx(10, abs=2)
    assert top["value"] / (force / 40) > 2


def test_bushing_matches_ex05(monkeypatch):
    """The bushing (#185) with a rigid connection of the inner sleeve, compared with
    the example ex05 of FElupe on the same mesh, which prescribes the rotated
    positions of the inner sleeve: the moments of the torsion and the tilt."""
    import runpy

    import felupe as fem

    folder = APP / "public" / "samples" / "bushing"
    monkeypatch.chdir(folder)
    results = run(loads((folder / "model.felupe.json").read_text(encoding="utf-8")))
    torsion, tilt = np.array(results["job"]["y"])[-1, :2]

    # ex05, with the mesh of the script and as many substeps
    meshes = runpy.run_path("bushing.py")["mesh"]
    regions = [fem.RegionHexahedron(meshes[m]) for m in ("rubber", "metal")]
    fields = [fem.Field(r, dim=3).as_container() for r in regions]
    field = fem.FieldContainer(fields).merge()
    solids = [
        fem.SolidBodyNearlyIncompressible(fem.NeoHooke(mu=1), fields[0], bulk=5000),
        fem.SolidBody(fem.LinearElasticLargeStrain(E=2.1e5, nu=0.3), fields[1]),
    ]
    x, y, z = field.region.mesh.points.T
    boundaries = fem.BoundaryDict(
        inner=fem.Boundary(field[0], mask=np.isclose(np.hypot(y, z), 25)),
        outer=fem.Boundary(field[0], mask=np.isclose(np.hypot(y, z), 65)),
    )
    inner = field.region.mesh.points[boundaries["inner"].points]
    move = []
    for progress in fem.math.linsteps([0, 1], num=6):
        rotated = fem.math.rotate_points(inner, 30 * progress, axis=0)
        rotated = fem.math.rotate_points(rotated, -5 * progress, axis=1)
        move.append([0, 0, 8 * progress] + rotated - inner)
    step = fem.Step(solids, ramp={boundaries["inner"]: move}, boundaries=boundaries)
    fem.Job([step]).evaluate(x0=field, tol=0.01, verbose=0)
    forces = sum(s.assemble.vector() for s in solids).toarray().reshape(-1, 3)
    points = boundaries["inner"].points
    deformed = inner + field[0].values[points]
    moment = np.cross(deformed - [0, 0, 8], forces[points]).sum(axis=0)

    # the same torsion; the tilt differs by the order of the two rotations of ex05
    assert torsion == pytest.approx(moment[0], rel=0.002)
    assert tilt == pytest.approx(moment[1], rel=0.01)


@pytest.mark.parametrize("sample", SAMPLES, ids=[s["id"] for s in SAMPLES])
def test_thumbnail_is_up_to_date(sample):
    "The picture of a sample (#127) is made from its project by make_samples.py."
    folder = APP / "public" / "samples" / sample["id"]
    svg = (folder / "thumbnail.svg").read_text(encoding="utf-8")
    assert svg == thumbnail(folder), "Run python app/scripts/make_samples.py."
    assert svg.startswith('<svg xmlns="http://www.w3.org/2000/svg"')
    assert svg.count("<polygon") > 10
