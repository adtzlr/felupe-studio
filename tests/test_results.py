import copy
import json
from pathlib import Path

import felupe as fem
import meshio
import numpy as np
import pytest

from felupe_studio import results, samples
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
        extremes = meta.pop("extremes")
        meta.pop("sections")
        assert meta == {
            "label": "Displacement x",
            "at": "point",
            "shift": True,
            "range": [0.0, pytest.approx(moved)],
            "points": [],
        }
        # the maximum at a node of the moved end (#140)
        assert extremes["max"]["value"] == pytest.approx(moved)
        assert extremes["max"]["at"] == "point"
        assert extremes["max"]["displacement"][0] == pytest.approx(moved)
        if moved > 0:
            assert extremes["max"]["position"][0] == pytest.approx(3)
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


def test_stresses_of_nearly_incompressible_substeps(two_materials):
    # the u-p-J section of hexahedrons is a fem.SolidBodyNearlyIncompressible (#226):
    # its pressure and volume ratio are a state of the solid body, but the stresses
    # of a substep do not depend on the substep shown before. The pressure is in the
    # principal stresses, not in the von Mises stress.
    assert isinstance(
        two_materials["solid_soft_body"], fem.SolidBodyNearlyIncompressible
    )
    assert len(two_materials["field_soft_body"].fields) == 1

    def stress(substep, before):
        results.scene("job_1", before, "displacement")
        surfaces = results.scene("job_1", substep, "stress_max")[1]
        surface = next(s for s in surfaces if s["name"] == "soft_body")
        return arrays(surface)["values"]

    np.testing.assert_allclose(stress(3, before=6), stress(3, before=3), rtol=1e-6)
    np.testing.assert_allclose(stress(6, before=1), stress(6, before=6), rtol=1e-6)


@pytest.mark.parametrize("quantity", ["displacement_x", "stress_mises", "strain_min"])
def test_ranges_of_all_substeps(two_materials, quantity):
    # the ranges of the scenes of every substep, for a range over the job (#139)
    expected = [
        json.loads(results.scene("job_1", substep, quantity)[0])["range"]
        for substep in range(1, 7)
    ]
    text = results.ranges("job_1", quantity)
    ranges = json.loads(text)["range"]
    assert len(ranges) == 6
    for got, want in zip(ranges, expected, strict=True):
        np.testing.assert_allclose(got, want, rtol=1e-12, atol=1e-15)
    # kept until the next run, and the scenes are not changed by it
    assert results.ranges("job_1", quantity) == text
    assert json.loads(results.scene("job_1", 3, quantity)[0])["range"] == expected[2]
    assert json.loads(results.ranges("job_2", quantity)) == {
        "range": [],
        "sections": {"hard_body": [], "soft_body": []},
    }


@pytest.mark.parametrize("quantity", ["displacement_x", "stress_mises"])
def test_ranges_of_every_section(two_materials, quantity):
    # the range of chosen sections (#377): the ranges and the extremes of every
    # section, of the scenes and of all substeps
    ranges = json.loads(results.ranges("job_1", quantity))
    assert list(ranges["sections"]) == ["hard_body", "soft_body"]
    for substep in range(1, 7):
        meta = json.loads(results.scene("job_1", substep, quantity)[0])
        sections = meta["sections"]
        assert list(sections) == ["hard_body", "soft_body"]
        for name, section in sections.items():
            assert ranges["sections"][name][substep - 1] == section["range"]
            # the extremes of a section are its own, at its range
            if section["range"]:
                low, high = section["range"]
                assert section["extremes"]["min"]["section"] == name
                assert section["extremes"]["min"]["value"] == pytest.approx(low)
                assert section["extremes"]["max"]["value"] == pytest.approx(high)
        # all sections: the union of the ranges, the extremes of the sections
        lows, highs = zip(*(s["range"] for s in sections.values()), strict=True)
        assert meta["range"] == [min(lows), max(highs)]
        assert meta["extremes"]["max"] in [
            s["extremes"]["max"] for s in sections.values()
        ]
        assert meta["extremes"]["max"]["value"] == max(highs)
    # the sections have ranges of their own
    last = json.loads(results.scene("job_1", 6, quantity)[0])["sections"]
    assert last["hard_body"]["range"] != last["soft_body"]["range"]


def test_range_of_the_rubber_beside_the_steel(monkeypatch):
    # the bushing with steel sleeves (#377): the stresses of the steel set the range
    # of all sections, the range of the rubber covers its values only
    from felupe_studio.project import loads

    folder = samples.folder_of(Path(__file__).parents[1] / "app" / "samples", "bushing")
    monkeypatch.chdir(folder)
    run(loads(Path("model.felupe.json").read_text(encoding="utf-8")))
    last = results.substeps("job")
    meta, surfaces = results.scene("job", last, "stress_mises")
    meta = json.loads(meta)
    rubber, steel = meta["sections"]["soft_body"], meta["sections"]["sleeves"]
    assert meta["range"] == [rubber["range"][0], steel["range"][1]]
    assert meta["extremes"]["max"] == steel["extremes"]["max"]
    assert rubber["range"][1] < 0.6 * steel["range"][1]
    values = arrays(next(s for s in surfaces if s["name"] == "soft_body"))["values"]
    assert rubber["range"][0] <= values.min() and values.max() <= rubber["range"][1]
    assert rubber["extremes"]["max"]["section"] == "soft_body"
    # over all substeps
    ranges = json.loads(results.ranges("job", "stress_mises"))
    assert ranges["range"][-1] == meta["range"]
    assert ranges["sections"]["soft_body"][-1] == rubber["range"]


def test_extremes_of_a_contour(two_materials):
    # the minimum and the maximum with their node or cell (#140)
    meta = json.loads(results.scene("job_1", 6, "stress_mises")[0])
    low, high = meta["range"]
    smallest, largest = meta["extremes"]["min"], meta["extremes"]["max"]
    assert smallest["value"] == pytest.approx(low)
    assert largest["value"] == pytest.approx(high)
    assert largest["at"] == "cell" and largest["section"] in ("hard_body", "soft_body")
    # the bar has 4 x 4 cells in its cross section: some cells are inside
    assert isinstance(largest["surface"], bool)
    # the position is the center of the points of the cell
    namespace = results._state["namespace"]
    field = namespace[f"field_{largest['section']}"]
    mesh = field[0].region.mesh
    cell = mesh.cells[largest["index"]][:8]
    np.testing.assert_allclose(largest["position"], mesh.points[cell].mean(axis=0))
    np.testing.assert_allclose(
        largest["displacement"], field[0].values[cell].mean(axis=0)
    )
    stress = namespace[f"solid_{largest['section']}"].evaluate.cauchy_stress(field)
    mises = fem.math.equivalent_von_mises(stress).mean(-2)
    assert mises[largest["index"]] == pytest.approx(high)

    meta = json.loads(results.scene("job_1", 1, "displacement")[0])
    assert meta["label"] == "Displacement magnitude"
    assert meta["extremes"]["min"]["value"] == 0
    assert meta["extremes"]["min"]["at"] == "point"
    # the fixed end is at the surface
    assert meta["extremes"]["min"]["surface"] is True


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

    # the stresses at the cells and projected to the points (#231)
    for quantity, method in [
        ("displacement", "cells"),
        ("stress_max", "cells"),
        ("stress_max", "project"),
    ]:
        substep = results.substeps("job_1")
        meta, surfaces = results.scene("job_1", substep, quantity, method)
        meta = json.loads(meta)
        assert meta["range"][1] > 0
        cells = quantity != "displacement" and method == "cells"
        assert meta["at"] == ("cell" if cells else "point")
        assert meta["shift"] == (cell_type == "hexahedron")
        for surface in surfaces:
            data = arrays(surface)
            npoints = len(data["positions"]) // 3
            ntriangles = len(data["triangles"]) // 3
            assert len(data["displacement"]) == 3 * npoints
            assert data["triangles"].max() < npoints
            expected = npoints if meta["at"] == "point" else ntriangles
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
    folder = samples.folder_of(
        Path(__file__).parents[1] / "app" / "samples", "glued-plate"
    )
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


def homogeneous_meshes():
    hexahedron = fem.Cube(b=(2, 1, 1), n=(3, 2, 2))
    tetra = hexahedron.triangulate()
    quad = fem.Rectangle(b=(2, 1), n=(4, 3))
    triangle = quad.triangulate()
    return {
        "hexahedron": hexahedron,
        "hexahedron20": fem.mesh.convert(hexahedron, order=2),
        "hexahedron27": fem.mesh.convert(
            hexahedron, order=2, calc_midfaces=True, calc_midvolumes=True
        ),
        "tetra": tetra,
        "tetra10": fem.mesh.add_midpoints_edges(tetra, cell_type_new="tetra10"),
        "quad": quad,
        "quad8": fem.mesh.convert(quad, order=2),
        "quad9": fem.mesh.convert(quad, order=2, calc_midfaces=True),
        "triangle": triangle,
        "triangle6": fem.mesh.add_midpoints_edges(triangle, cell_type_new="triangle6"),
    }


def deform(mesh, mixed=False):
    """The results of one section of a mesh with a homogeneous deformation (with the
    u-p-J formulation: the MINI elements of triangles and tetrahedrons)."""
    from felupe_studio import _helpers

    dim = mesh.dim
    planar = {"planestrain": True} if dim == 2 else {}
    umat = fem.NeoHooke(mu=1.0, bulk=5.0)
    if mixed:
        region = _helpers.mixed_region(mesh)
        field = _helpers.mixed_field(region, **planar)
        solid = fem.SolidBody(fem.NearlyIncompressible(umat, bulk=5.0), field)
    else:
        region = _helpers.REGIONS[mesh.cell_type](mesh)
        Field = fem.FieldPlaneStrain if dim == 2 else fem.Field
        field = fem.FieldContainer([Field(region, dim=dim)])
        solid = fem.SolidBody(umat, field)
    F = np.array([[1.2, 0.1, 0.0], [0.0, 0.9, 0.05], [0.0, 0.0, 0.95]])[:dim, :dim]
    points = region.mesh.points
    field[0].values[:] = points @ (F - np.eye(dim)).T
    results.reset({"field": field, "field_s": field, "solid_s": solid}, ["s"])


CASES = [(t, False) for t in homogeneous_meshes()] + [
    ("tetra", True),
    ("triangle", True),
]


@pytest.mark.parametrize(("cell_type", "mixed"), CASES)
def test_values_at_the_points_of_a_homogeneous_deformation(cell_type, mixed):
    # every method gives the values of the cells at the points (#231)
    deform(homogeneous_meshes()[cell_type], mixed)
    shift = cell_type in ("hexahedron", "hexahedron27", "quad", "quad9") and not mixed
    assert results.shift() == shift
    assert results.method_of("topoints") == ("topoints" if shift else "project")
    nodes = np.unique(results._cells("s")[1])
    for kind in ["strain", "stress", "mises"]:
        cells = results._data(kind, "s")
        np.testing.assert_allclose(cells, np.broadcast_to(cells[0], cells.shape))
        for method in ["mean", "project", "topoints"][: 3 if shift else 2]:
            data = results._data(kind, "s", method)[nodes]
            np.testing.assert_allclose(
                data, np.broadcast_to(cells[0], data.shape), rtol=1e-6, atol=1e-9
            )


def test_means_of_the_cells_at_the_points(two_materials):
    # the means of the cells, averaged at the points of a section (#231): of the
    # stress tensors, then their principal values (#274)
    for section in ["hard_body", "soft_body"]:
        cells = results._cells(section)[1]
        means = results._quadrature_tensor("stress", section).mean(-2)
        total = np.zeros((cells.max() + 1, 3, 3))
        count = np.zeros(cells.max() + 1)
        for cell, values in zip(cells, means.transpose(2, 0, 1), strict=True):
            total[cell] += values
            count[cell] += 1
        nodes = np.unique(cells)
        tensors = (total[nodes] / count[nodes, None, None]).transpose(1, 2, 0)
        expected = -np.sort(-fem.math.eigvalsh(tensors).T, axis=1)
        data = results._data("stress", section, "mean")[nodes]
        np.testing.assert_allclose(data, expected, rtol=1e-6, atol=1e-9)
        # values of the points: at the points of the surface too
        meta, surfaces = results.scene("job_1", 6, "stress_max", "mean")
        assert json.loads(meta)["method"] == "mean"
        surface = next(s for s in surfaces if s["name"] == section)
        values = arrays(surface)["values"]
        assert len(values) == len(arrays(surface)["positions"]) // 3


def test_invariants_of_the_tensors_at_the_points(monkeypatch):
    # the engine mount (ex07) after its vertical job: at the points, the tensors are
    # moved and their invariants are evaluated there (#274), so the von Mises
    # stress is never negative; the projection of the von Mises stress of the
    # quadrature points undershoots beside the soft air
    from felupe_studio.project import loads

    monkeypatch.chdir(
        samples.folder_of(Path(__file__).parents[1] / "app" / "samples", "engine-mount")
    )
    document = loads(Path("model.felupe.json").read_text(encoding="utf-8"))
    document["commands"] = [
        c
        for c in document["commands"]
        if not (c["command"] == "job.add" and c["name"] == "horizontal")
    ]
    run(document)
    for section in results._state["sections"]:
        for method in ["mean", "project", "topoints"]:
            method = results.method_of(method)
            for kind in ["strain", "stress"]:
                tensor = results._quadrature_tensor(kind, section)
                moved = results._at(tensor[results.UPPER], section, method)
                tensors = np.empty((3, 3, len(moved)))
                tensors[results.UPPER] = tensors[results.UPPER[::-1]] = moved.T
                if kind == "stress":
                    mises = results._data("mises", section, method)
                    expected = fem.math.equivalent_von_mises(tensors)
                    np.testing.assert_allclose(mises[:, 0], expected, atol=1e-12)
                    assert mises.min() >= 0
                principal = results._data(kind, section, method)
                expected = -np.sort(-fem.math.eigvalsh(tensors).T, axis=1)
                np.testing.assert_allclose(principal, expected, atol=1e-12)
    old = results._reduce(
        results._quadrature_data("mises", "air_section"), "air_section", "project"
    )
    assert old.min() < 0
    # at the cells as before: the means of the invariants of the quadrature points
    cells = results._data("mises", "air_section")
    np.testing.assert_allclose(
        cells[:, 0], results._quadrature_data("mises", "air_section")[0].mean(0)
    )


def test_projected_peak_at_a_hole(monkeypatch):
    # the plate with a hole: the projected stresses have a higher peak than the
    # means of the cells, and the ranges of all substeps follow the method (#231)
    from felupe_studio.project import loads

    monkeypatch.chdir(
        samples.folder_of(
            Path(__file__).parents[1] / "app" / "samples", "plate-with-hole"
        )
    )
    run(loads(Path("model.felupe.json").read_text(encoding="utf-8")))
    last = results.substeps("job")
    peaks = {}
    for method in results.METHODS:
        meta = json.loads(results.scene("job", last, "stress_mises", method)[0])
        peaks[method] = meta["range"][1]
        ranges = json.loads(results.ranges("job", "stress_mises", method))["range"]
        assert ranges[-1] == pytest.approx(meta["range"])
        assert meta["extremes"]["max"]["at"] == meta["at"]
    assert meta["method"] == "topoints" and meta["shift"]
    assert peaks["project"] > peaks["topoints"] > peaks["cells"]
    # the means of the cells at the points are within the range of the cells
    assert peaks["mean"] <= peaks["cells"]
    with pytest.raises(ValueError, match="Unknown method"):
        results.scene("job", last, "stress_mises", "nodes")


def test_export_values_at_the_points(two_materials, tmp_path):
    # the stresses at the points, the means of the sections at common points (#231)
    data = results.export("job_1", "vtu", method="project")
    mesh = meshio.read(read(data, ".vtu", tmp_path))
    stress = mesh.point_data["Principal Values of Cauchy Stress"]
    assert stress.shape == (len(mesh.points), 3)
    assert np.isfinite(stress).all()
    # the cell data are kept
    assert "Principal Values of Cauchy Stress" in mesh.cell_data
    sections = ["hard_body", "soft_body"]
    nodes = [np.unique(results._cells(s)[1]) for s in sections]
    common = np.intersect1d(*nodes)
    assert len(common)
    both = [results._data("stress", s, "project")[common] for s in sections]
    np.testing.assert_allclose(stress[common], (both[0] + both[1]) / 2, rtol=1e-5)
    only = np.setdiff1d(nodes[0], nodes[1])
    np.testing.assert_allclose(
        stress[only], results._data("stress", "hard_body", "project")[only], rtol=1e-5
    )
    # without a point method, the strains and the stresses are cell data only
    mesh = meshio.read(read(results.export("job_1", "vtu"), ".vtu", tmp_path))
    assert set(mesh.point_data) == {"Displacement"}


@pytest.fixture
def plastic(monkeypatch):
    """The cube of steel pulled beyond its yield stress and unloaded (#191)."""
    monkeypatch.chdir(GOLDEN / "plasticity_cube")
    run(load("plasticity_cube"))
    return LAST


def test_plastic_strain_and_stress_of_every_substep(plastic, tmp_path):
    # the state variables of every substep are restored with its fields (#191): the
    # stress of a substep of the loading after the last substep (unloaded) is the
    # one of the loading, not of the unloaded state
    E, sy, K = 210000.0, 250.0, 1000.0
    u = 0.002
    ep = (u - sy / E) / (1 + K / E)
    for substep in [11, 3, 11, 3]:
        meta, surfaces = results.scene("job_1", substep, "stress_max")
        low, high = json.loads(meta)["range"]
        if substep == 3:
            assert low == pytest.approx(sy + K * ep, rel=1e-2)
        else:
            assert abs(high) < 3
    meta, surfaces = results.scene("job_1", 3, "plastic_strain")
    meta = json.loads(meta)
    assert meta["label"] == "Equivalent plastic strain"
    assert meta["range"] == pytest.approx([ep, ep], rel=1e-10)
    # the remaining plastic strain after the unloading, and none before yielding
    end = json.loads(results.scene("job_1", 11, "plastic_strain", "project")[0])
    assert end["range"][0] == pytest.approx(0.0037914691943128, rel=1e-8)
    assert end["at"] == "point"
    ranges = json.loads(results.ranges("job_1", "plastic_strain"))["range"]
    assert ranges[1] == [0.0, 0.0]
    assert ranges[2] == pytest.approx([ep, ep])
    # the export has the equivalent plastic strain of the last substep
    mesh = meshio.read(read(results.export("job_1", "vtu"), ".vtu", tmp_path))
    data = np.concatenate(mesh.cell_data["Equivalent Plastic Strain"])
    np.testing.assert_allclose(data, 0.0037914691943128, rtol=1e-8)


def test_plastic_strain_of_a_model_without_plasticity(two_materials, tmp_path):
    # zero, and no plastic strain in the export (#191)
    meta = json.loads(results.scene("job_1", 6, "plastic_strain")[0])
    assert meta["range"] == [0.0, 0.0]
    mesh = meshio.read(read(results.export("job_1", "vtu"), ".vtu", tmp_path))
    assert "Equivalent Plastic Strain" not in mesh.cell_data


@pytest.fixture
def mullins(monkeypatch):
    """The incompressible cube of Neo-Hooke with the Mullins effect, stretched to
    1.5, released, stretched to 1.5 again, released, stretched to 2 and released
    (#346)."""
    monkeypatch.chdir(GOLDEN / "cube_mullins_neo_hooke")
    run(load("cube_mullins_neo_hooke"))
    return LAST


def test_mullins_effect_of_every_substep(mullins):
    # the state variable of every substep, the maximum strain energy density, is
    # restored with its fields (#346): the Cauchy stress of the first stretch to 1.3
    # is the one of the material without softening, also after the last substep, of
    # the stretch to 2; that of the second stretch to 1.3 is softer. The stress of
    # the homogeneous deformation is the stretch times the force of the curve.
    curve = json.loads(
        (GOLDEN / "cube_mullins_neo_hooke" / "results.json").read_text("utf-8")
    )["jobs"]["job_1"]
    force = curve["force"]
    assert results._history("body")
    for substep in [36, 4, 16, 4, 16]:
        low, high = json.loads(results.scene("job_1", substep, "stress_max")[0])[
            "range"
        ]
        if substep in (4, 16):
            assert low == pytest.approx(high, rel=1e-6)
            assert high == pytest.approx(1.3 * force[substep - 1], rel=1e-3)
    first = json.loads(results.scene("job_1", 4, "stress_max")[0])["range"][1]
    second = json.loads(results.scene("job_1", 16, "stress_max")[0])["range"][1]
    assert second < 0.8 * first

    # the state variable grows with the largest stretch only
    def statevars(substep):
        results.scene("job_1", substep, "stress_max")
        return mullins["solid_body"].results.statevars.copy()

    peak = statevars(6)
    assert np.all(peak > 0)
    np.testing.assert_allclose(statevars(18), peak, rtol=1e-6)
    assert np.all(statevars(30) > peak)
    np.testing.assert_allclose(statevars(36), statevars(30), rtol=1e-6)


def energy(stretch):
    """The strain energy density of the isochoric part of Neo-Hooke (μ = 1) of an
    incompressible uniaxial stretch."""
    return (stretch**2 + 2 / stretch - 3) / 2


def test_mullins_energy_of_every_substep(mullins, tmp_path):
    # the contour of the maximum strain energy density of the load history (#346):
    # of the stretch to 1.5 after the first stretch, also released and stretched to
    # 1.5 again, of the stretch to 2 at the end (nearly incompressible)
    for substep, stretch in [(6, 1.5), (18, 1.5), (12, 1.5), (30, 2), (36, 2)]:
        meta = json.loads(results.scene("job_1", substep, "mullins_energy")[0])
        assert meta["label"] == "Max. strain energy density"
        assert meta["range"] == pytest.approx([energy(stretch)] * 2, rel=1e-3)
    # zero at the start, never smaller than in a substep before
    ranges = json.loads(results.ranges("job_1", "mullins_energy"))["range"]
    highs = [r[1] for r in ranges]
    assert highs[0] == pytest.approx(0, abs=1e-12)
    assert np.all(np.diff(highs) >= -1e-12)
    assert highs[18] == pytest.approx(highs[5], rel=1e-10)
    # at the points, a state variable moved itself
    meta = json.loads(results.scene("job_1", 6, "mullins_energy", "project")[0])
    assert meta["at"] == "point"
    assert meta["range"] == pytest.approx([energy(1.5)] * 2, rel=1e-3)

    # the exports have it as cell data, and at the points as point data
    name = "Maximum Strain Energy Density"
    mesh = meshio.read(read(results.export("job_1", "vtu", 18), ".vtu", tmp_path))
    data = np.concatenate(mesh.cell_data[name])
    np.testing.assert_allclose(data, energy(1.5), rtol=1e-3)
    assert "Equivalent Plastic Strain" not in mesh.cell_data
    path = read(results.export("job_1", "xdmf", method="mean"), ".xdmf", tmp_path)
    reader = meshio.xdmf.TimeSeriesReader(str(path))
    reader.read_points_cells()
    _, point_data, cell_data = reader.read_data(reader.num_steps - 1)
    np.testing.assert_allclose(point_data[name], energy(2), rtol=1e-3)
    np.testing.assert_allclose(cell_data[name][0], energy(2), rtol=1e-3)


def test_mullins_energy_of_a_section_of_another_material(monkeypatch):
    # zero in a section of a material without the Mullins effect (#346), like the
    # equivalent plastic strain
    monkeypatch.chdir(GOLDEN / "bar_two_materials")
    document = load("bar_two_materials")
    for command in document["commands"]:
        if command["name"] == "rubber":
            command["mullins"] = {"r": 3, "m": 0.2, "beta": 0.1}
    run(document)
    assert results._mullins("soft_body")
    assert not results._mullins("hard_body")
    _, surfaces = results.scene("job_1", 6, "mullins_energy")
    for surface in surfaces:
        values = arrays(surface)["values"]
        if surface["name"] == "soft_body":
            assert np.all(values > 0)
        else:
            assert np.all(values == 0)


def test_mullins_energy_of_a_model_without_the_mullins_effect(two_materials, tmp_path):
    # zero, and not in the export (#346)
    meta = json.loads(results.scene("job_1", 6, "mullins_energy")[0])
    assert meta["range"] == [0.0, 0.0]
    mesh = meshio.read(read(results.export("job_1", "vtu"), ".vtu", tmp_path))
    assert "Maximum Strain Energy Density" not in mesh.cell_data


def test_no_history_of_elastic_materials(two_materials):
    # no state variables of their own: nothing is recorded per substep (#346)
    assert not results._history("hard_body")
    assert not results._history("soft_body")
