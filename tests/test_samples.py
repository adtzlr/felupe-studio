"""The sample models of the app (app/public/samples, made by
app/scripts/make_samples.py) are valid project files and solve with FElupe."""

import json
from pathlib import Path

import numpy as np
import pytest

from felupe_studio.commands import errors
from felupe_studio.project import dumps, loads
from felupe_studio.runner import run

APP = Path(__file__).parents[1] / "app"
SAMPLES = json.loads((APP / "src" / "core" / "samples.json").read_text())


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
    files = {c["file"] for c in document["commands"] if c["command"] == "mesh.import"}
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
