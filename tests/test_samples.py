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


@pytest.mark.parametrize("sample", SAMPLES, ids=[s["id"] for s in SAMPLES])
def test_thumbnail_is_up_to_date(sample):
    "The picture of a sample (#127) is made from its project by make_samples.py."
    folder = APP / "public" / "samples" / sample["id"]
    svg = (folder / "thumbnail.svg").read_text(encoding="utf-8")
    assert svg == thumbnail(folder), "Run python app/scripts/make_samples.py."
    assert svg.startswith('<svg xmlns="http://www.w3.org/2000/svg"')
    assert svg.count("<polygon") > 10
