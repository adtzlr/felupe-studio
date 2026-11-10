import copy
import json
from pathlib import Path

import felupe as fem
import meshio
import numpy as np
import pytest

from felupe_studio import results
from felupe_studio.runner import LAST, run

GOLDEN = Path(__file__).parent / "golden"


def load(case):
    return json.loads((GOLDEN / case / "commands.json").read_text(encoding="utf-8"))


def arrays(surface):
    """The arrays of a surface of a result scene."""
    dtypes = {"triangles": "<u4", "faces": "<u4", "edges": "<u4"}
    return {
        key: np.frombuffer(value, dtype=dtypes.get(key, "<f4"))
        for key, value in surface.items()
        if isinstance(value, bytes)
    }


@pytest.fixture
def two_materials(monkeypatch):
    """The bar of two sections (u and u-p-J), solved."""
    monkeypatch.chdir(GOLDEN / "bar_two_materials")
    run(load("bar_two_materials"))
    return LAST


def test_quantities_like_felupe(two_materials):
    namespace = two_materials
    for section in ["hard_body", "soft_body"]:
        field = namespace[f"field_{section}"]
        view = fem.ViewSolid(field, namespace[f"solid_{section}"])
        strain = view.cell_data["Principal Values of Logarithmic Strain"]
        stress = view.cell_data["Principal Values of Cauchy Stress"]
        mises = view.cell_data["Equivalent of Cauchy Stress"]

        # the last substep (the current state of the fields)
        expected = {
            "strain_max": strain.max(axis=1),
            "strain_min": strain.min(axis=1),
            "stress_max": stress.max(axis=1),
            "stress_mid": np.median(stress, axis=1),
            "stress_mises": mises.ravel(),
        }
        for quantity, values in expected.items():
            meta, surfaces = results.scene("job_1", 6, quantity)
            surface = next(s for s in surfaces if s["name"] == section)
            owners = results._surface(section)[0].owners
            np.testing.assert_allclose(
                arrays(surface)["values"], values[owners], rtol=1e-5, atol=1e-7
            )
            assert json.loads(meta)["at"] == "cell"


def test_substeps_restore_the_fields(two_materials):
    # the right end moves by linsteps([0, 0.5], num=5) in x
    for substep, moved in enumerate(np.linspace(0, 0.5, 6), start=1):
        meta, surfaces = results.scene("job_1", substep, "displacement_x")
        meta = json.loads(meta)
        assert meta == {
            "label": "Displacement x",
            "at": "point",
            "range": [0.0, pytest.approx(moved)],
        }
        for surface in surfaces:
            data = arrays(surface)
            assert len(data["values"]) == len(data["positions"]) // 3
            np.testing.assert_allclose(data["values"], data["displacement"][0::3])

    # the stresses follow the restored fields
    low = json.loads(results.scene("job_1", 2, "stress_mises")[0])["range"]
    high = json.loads(results.scene("job_1", 6, "stress_mises")[0])["range"]
    assert 0 < low[1] < high[1]

    meta, _ = results.scene("job_1", 6, "displacement")
    assert json.loads(meta)["range"][1] > 0.5
    with pytest.raises(IndexError):
        results.scene("job_1", 7, "displacement")
    with pytest.raises(KeyError):
        results.scene("job_2", 1, "displacement")
    assert results.substeps("job_1") == 6


def test_surfaces_are_cached_per_run(two_materials):
    first = results._surface("hard_body")
    assert results._surface("hard_body") is first
    run(load("bar_two_materials"))
    assert results._surface("hard_body") is not first


def solid_meshes():
    hexahedron = fem.Cube(b=(3, 1, 1), n=(4, 2, 2))
    tetra = hexahedron.triangulate()
    return {
        "hexahedron": hexahedron,
        "hexahedron20": fem.mesh.convert(hexahedron, order=2),
        "tetra": tetra,
        "tetra10": fem.mesh.add_midpoints_edges(tetra, cell_type_new="tetra10"),
    }


@pytest.mark.parametrize("cell_type", list(solid_meshes()))
@pytest.mark.parametrize("formulation", ["u", "u-p-J"])
def test_every_cell_type_and_formulation(cell_type, formulation, tmp_path, monkeypatch):
    mesh = solid_meshes()[cell_type]
    meshio.Mesh(mesh.points, [(cell_type, mesh.cells)]).write(tmp_path / "bar.vtu")
    monkeypatch.chdir(tmp_path)
    document = copy.deepcopy(load("bar_single_body"))
    commands = document["commands"]
    commands[0].pop("tag", None)
    commands[0]["file"] = "bar.vtu"
    for i, command in enumerate(commands):
        if command["command"] == "cellset.from_tag":
            commands[i] = {
                "command": "cellset.from_file",
                "name": command["name"],
                "mesh": command["mesh"],
            }
        if command["command"] == "section.add" and formulation == "u-p-J":
            command.update(formulation="u-p-J", bulk=5000.0)
    run(document)

    for quantity in ["displacement", "stress_max"]:
        meta, surfaces = results.scene("job_1", results.substeps("job_1"), quantity)
        meta = json.loads(meta)
        assert meta["range"][1] > 0
        for surface in surfaces:
            data = arrays(surface)
            npoints = len(data["positions"]) // 3
            ntriangles = len(data["triangles"]) // 3
            assert len(data["displacement"]) == 3 * npoints
            assert data["triangles"].max() < npoints
            expected = npoints if quantity == "displacement" else ntriangles
            assert len(data["values"]) == expected
            assert np.isfinite(data["values"]).all()
            # linear cells are shaded by faces, curved faces are subdivided
            assert (surface["faces"] is None) == (cell_type.endswith("0"))
