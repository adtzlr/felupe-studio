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
    dtypes = {
        "triangles": "<u4",
        "faces": "<u4",
        "edges": "<u4",
        "owners": "<u4",
        "nodes": "<i4",
    }
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
            "points": [],
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
            # the cell of every triangle and the node of every point (if any)
            section = surface["name"]
            cells = results._cells(section)[1]
            assert len(data["owners"]) == ntriangles
            assert data["owners"].max() < len(cells)
            nodes = data["nodes"]
            assert len(nodes) == npoints
            if cell_type == "hexahedron20":
                # the centers of the subdivided faces are no nodes
                assert (nodes < 0).any() and (nodes >= 0).any()
            else:
                assert (nodes >= 0).all()
            known = nodes >= 0
            points = LAST[f"field_{section}"][0].region.mesh.points
            np.testing.assert_allclose(
                data["positions"].reshape(-1, 3)[known],
                points[nodes[known]],
                rtol=1e-6,
                atol=1e-6,
            )
            # the nodes of a triangle belong to its cell
            triangles = data["triangles"].reshape(-1, 3)
            for t in range(0, ntriangles, max(ntriangles // 20, 1)):
                corner = nodes[triangles[t]]
                corner = corner[corner >= 0]
                assert set(corner) <= set(cells[data["owners"][t]])

    # the export has the points of the cells only (no bubble points of MINI)
    exported = meshio.read(read(results.export("job_1", "vtu"), ".vtu", tmp_path))
    assert len(exported.points) == len(mesh.points)
    assert {block.type for block in exported.cells} == {cell_type}


def read(data, suffix, tmp_path):
    path = tmp_path / f"result{suffix}"
    path.write_bytes(data)
    return path


def test_export_vtu(two_materials, tmp_path):
    namespace = two_materials
    mesh = meshio.read(read(results.export("job_1", "vtu"), ".vtu", tmp_path))
    field = namespace["field"]
    assert len(mesh.points) == len(field[0].values)
    # the blocks of the sections are read as one block of hexahedrons
    assert [block.type for block in mesh.cells] == ["hexahedron"]
    np.testing.assert_allclose(mesh.point_data["Displacement"], field[0].values)
    assert mesh.point_data["Displacement"][:, 0].max() == pytest.approx(0.5)
    sections = ["hard_body", "soft_body"]
    section = np.concatenate(mesh.cell_data["Section"])
    for name in ["Equivalent of Cauchy Stress", "Principal Values of Cauchy Stress"]:
        exported = np.concatenate(mesh.cell_data[name]).reshape(len(section), -1)
        for i, name_of_section in enumerate(sections):
            view = fem.ViewSolid(
                namespace[f"field_{name_of_section}"],
                namespace[f"solid_{name_of_section}"],
            )
            expected = view.cell_data[name].reshape((section == i).sum(), -1)
            np.testing.assert_allclose(
                np.sort(exported[section == i], axis=1),
                np.sort(expected, axis=1),
                rtol=1e-5,
                atol=1e-8,
            )
    assert sorted(set(section)) == [0, 1]

    # an earlier substep
    mesh = meshio.read(read(results.export("job_1", "vtu", 2), ".vtu", tmp_path))
    assert mesh.point_data["Displacement"][:, 0].max() == pytest.approx(0.1)


def test_export_xdmf(two_materials, tmp_path):
    path = read(results.export("job_1", "xdmf"), ".xdmf", tmp_path)
    assert not list(tmp_path.glob("*.h5"))
    reader = meshio.xdmf.TimeSeriesReader(str(path))
    points, cells = reader.read_points_cells()
    assert {block.type for block in cells} == {"hexahedron"}
    assert sum(len(block.data) for block in cells) == 192
    assert reader.num_steps == 6
    for k, moved in enumerate(np.linspace(0, 0.5, 6)):
        time, point_data, cell_data = reader.read_data(k)
        assert time == k + 1
        assert point_data["Displacement"][:, 0].max() == pytest.approx(moved, abs=1e-12)
        assert set(cell_data) == {*results.EXPORTED, "Section"}

    with pytest.raises(KeyError):
        results.export("job_2", "xdmf")
    with pytest.raises(ValueError):
        results.export("job_1", "stl")


def test_control_points_are_left_out_of_the_results(monkeypatch, tmp_path):
    monkeypatch.chdir(GOLDEN / "bar_two_materials")
    document = copy.deepcopy(load("bar_two_materials"))
    commands = document["commands"]
    first = next(i for i, c in enumerate(commands) if c["command"] == "boundary.add")
    commands[first:first] = [
        {"command": "point.add", "name": "control", "coordinates": [4, 0.5, 0.5]},
        {
            "command": "boundary.add",
            "name": "pin",
            "pointset": "control",
            "constrained": ["x", "y", "z"],
        },
    ]
    run(document)
    field = LAST["field"]
    meta, surfaces = results.scene("job_1", 6, "displacement")
    assert json.loads(meta)["range"][1] == pytest.approx(0.5, rel=0.05)
    assert {s["name"] for s in surfaces} == {"hard_body", "soft_body"}
    # the control point with its position and displacement (pinned)
    assert json.loads(meta)["points"] == [
        {
            "name": "control",
            "position": [4, 0.5, 0.5],
            "displacement": [0, 0, 0],
            "force": [0, 0, 0],
        }
    ]
    mesh = meshio.read(read(results.export("job_1", "vtu"), ".vtu", tmp_path))
    # the points of the cells, without the control point
    assert len(mesh.points) == len(field[0].values) - 1
    assert [block.type for block in mesh.cells] == ["hexahedron"]


def test_displacements_and_forces_of_control_points(monkeypatch):
    # the right end face is glued to a control point that is moved in x (#101)
    monkeypatch.chdir(GOLDEN / "bar_two_materials")
    document = copy.deepcopy(load("bar_two_materials"))
    commands = document["commands"]
    move = next(c for c in commands if c["name"] == "move")
    first = next(i for i, c in enumerate(commands) if c["command"] == "boundary.add")
    commands[first:first] = [
        {"command": "point.add", "name": "plate", "coordinates": [4, 0.5, 0.5]},
    ]
    face = move["pointset"]
    move["pointset"] = "plate"
    step = next(i for i, c in enumerate(commands) if c["command"] == "step.add")
    commands[step:step] = [
        {
            "command": "boundary.add",
            "name": "hold",
            "pointset": "plate",
            "constrained": ["y", "z"],
        },
        {
            "command": "mpc.add",
            "name": "glue",
            "points": face,
            "center": "plate",
            "constrained": ["x", "y", "z"],
        },
    ]
    run(document)
    curve = LAST["job_1"]
    n = results.substeps("job_1")
    meta, _ = results.scene("job_1", n, "displacement")
    [plate] = json.loads(meta)["points"]
    assert plate["name"] == "plate"
    assert plate["displacement"][0] == pytest.approx(curve.x[-1][0])
    # the force of the constraint at the control point is the reaction of the curve
    assert plate["force"][0] == pytest.approx(curve.y[-1][0], rel=1e-6)
    assert "rotation" not in plate

    text = results.export("job_1", "csv").decode()
    lines = text.splitlines()
    assert lines[0] == (
        "substep,plate.u_x,plate.u_y,plate.u_z,plate.F_x,plate.F_y,plate.F_z"
    )
    assert len(lines) == n + 1
    assert float(lines[-1].split(",")[4]) == pytest.approx(curve.y[-1][0], rel=1e-6)


def test_units_of_the_control_points(monkeypatch):
    # the columns of the control points with the units of the model settings (#132)
    folder = Path(__file__).parents[1] / "app" / "public" / "samples" / "glued-plate"
    document = json.loads((folder / "model.felupe.json").read_text(encoding="utf-8"))
    monkeypatch.chdir(folder)
    run(document)
    [job] = [c["name"] for c in document["commands"] if c["command"] == "job.add"]
    header = results.export(job, "csv").decode().splitlines()[0].split(",")
    assert header[:4] == [
        "substep",
        "plate.u_x [mm]",
        "plate.u_y [mm]",
        "plate.u_z [mm]",
    ]
    assert header[4] == "plate.F_x [N]"
    assert header[7] == "tilt.phi_x [rad]"
    assert header[10] == "tilt.M_x [N mm]"
