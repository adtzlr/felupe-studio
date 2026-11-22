"""The cut of the view through the undeformed model (#395, ADR 0022)."""

import json
from pathlib import Path

import felupe as fem
import meshio
import numpy as np
import pytest
from felupe.view._surface import polynomial_order, triangulate_surface

from felupe_studio import cuts, results
from felupe_studio._helpers import volume_cells
from felupe_studio.runner import LAST, run
from felupe_studio.scene import surface

GOLDEN = Path(__file__).parent / "golden"


def cut_of(mesh, cut):
    """The cut of a FElupe mesh and the positions of its points."""
    order = polynomial_order(mesh)
    outer = triangulate_surface(mesh, subdivisions=order)
    plane = cuts.plane(cut)
    result = cuts.cut(outer, mesh.points, mesh.cells, mesh.cell_type, plane, order)
    points = np.pad(mesh.points, ((0, 0), (0, 3 - mesh.points.shape[1])))
    return result, result.interpolate(points)


def area(positions, triangles):
    a, b, c = (positions[triangles[:, k]] for k in range(3))
    return 0.5 * np.linalg.norm(np.cross(b - a, c - a), axis=1).sum()


def enclosed_volume(positions, triangles):
    """The volume enclosed by outward-oriented triangles (divergence theorem)."""
    a, b, c = (positions[triangles[:, k]] for k in range(3))
    return np.einsum("ij,ij->i", a, np.cross(b, c)).sum() / 6


def edge_counts(positions, triangles):
    """How often every edge is used by the triangles, with the points merged by
    their positions: 2 for every edge of a closed surface."""
    _, merged = np.unique(np.round(positions, 9), axis=0, return_inverse=True)
    t = merged.ravel()[triangles]
    edges = np.concatenate([t[:, [0, 1]], t[:, [1, 2]], t[:, [2, 0]]])
    return np.unique(np.sort(edges, axis=1), axis=0, return_counts=True)[1]


X = {"axis": "x", "value": 0.5, "half": "+"}


def test_plane():
    assert cuts.plane(None) is None
    assert cuts.plane({"axis": "y", "value": 2, "half": "-"}) == (1, 2.0, -1)
    assert cuts.plane({"axis": "z", "value": "0.5"}) == (2, 0.5, 1)
    with pytest.raises(ValueError, match="x, y or z"):
        cuts.plane({"axis": "w", "value": 0})
    with pytest.raises(ValueError, match="'\\+' or '-'"):
        cuts.plane({"axis": "x", "value": 0, "half": "*"})
    with pytest.raises(ValueError, match="finite"):
        cuts.plane({"axis": "x", "value": float("nan")})


@pytest.mark.parametrize("half", ["+", "-"])
def test_cube_cut_at_half(half):
    """A cube cut at x = 0.5 through its cells: the cut face has the area of a side,
    in the plane and towards the hidden half, and closes the clipped outer surface."""
    result, positions = cut_of(fem.Cube(n=4), {**X, "half": half})
    outer = result.triangles[: result.outer]
    section = result.triangles[result.outer :]

    assert np.isclose(area(positions, section), 1.0)
    assert np.allclose(positions[np.unique(section), 0], 0.5)
    # the clipped outer surface: a side and half of the four others
    assert np.isclose(area(positions, outer), 3.0)
    sign = 1 if half == "+" else -1
    assert np.all(sign * (positions[np.unique(result.triangles), 0] - 0.5) <= 1e-12)
    a, b, c = (positions[section[:, k]] for k in range(3))
    assert np.all(sign * np.cross(b - a, c - a)[:, 0] > 0)

    # closed: half of the volume, every edge of two triangles
    assert np.isclose(enclosed_volume(positions, result.triangles), 0.5)
    assert np.all(edge_counts(positions, result.triangles) == 2)

    # the owners: the cells that cross the plane, the cut face one per cell
    centers = fem.Cube(n=4).points[fem.Cube(n=4).cells].mean(axis=1)
    owners = np.unique(result.owners[result.outer :])
    assert np.allclose(centers[owners, 0], 0.5)
    assert len(np.unique(result.faces[result.outer :])) == len(owners)


def test_interpolated_values():
    """A point of the cut face is interpolated linearly from the two points of its
    edge, so a linear field is exact on the cut face."""
    mesh = fem.Cube(n=4)
    result, positions = cut_of(mesh, {"axis": "z", "value": 0.4, "half": "-"})
    field = mesh.points @ np.array([[1.0, 2.0], [3.0, 4.0], [5.0, 6.0]])
    assert np.allclose(result.interpolate(field), positions @ [[1, 2], [3, 4], [5, 6]])

    # the points of the cut face on the edges of the cells, between two points
    interpolation = result.interpolation
    section = np.unique(result.triangles[result.outer :])
    two = section[np.diff(interpolation.indptr)[section] == 2]
    assert len(two)
    for row in two[:5]:
        columns = interpolation.indices[
            interpolation.indptr[row] : interpolation.indptr[row + 1]
        ]
        assert np.ptp(mesh.points[columns, 2]) > 0


def test_edges():
    """The clipped edges of the outer surface and the lines where the faces of the
    cells cross the plane."""
    result, positions = cut_of(fem.Cube(n=3), {"axis": "y", "value": 0.25})
    lengths = np.linalg.norm(np.diff(positions[result.edges], axis=1), axis=2)
    assert np.all(lengths > 0)
    on_plane = np.all(np.isclose(positions[result.edges, 1], 0.25), axis=1)
    # the outline of the cut face (4) and the lines of the inner faces at x = 0.5 and
    # z = 0.5 (1 each), once
    assert np.isclose(lengths[on_plane].sum(), 4 + 2)
    assert np.all(positions[result.edges, 1] <= 0.25 + 1e-12)
    # every edge once
    assert len(np.unique(np.sort(result.edges, axis=1), axis=0)) == len(result.edges)


def wedges():
    """A unit cube of wedges: triangles expanded in z."""
    base = fem.Rectangle(n=4).triangulate()
    layers = np.linspace(0, 1, 4)
    points = np.vstack(
        [np.column_stack([base.points, np.full(len(base.points), z)]) for z in layers]
    )
    n = len(base.points)
    cells = np.vstack(
        [np.hstack([base.cells + k * n, base.cells + (k + 1) * n]) for k in range(3)]
    )
    return fem.Mesh(points, cells, "wedge")


def pyramids():
    """A unit cube of pyramids: the faces of its hexahedrons with their centers."""
    cube = fem.Cube(n=3)
    points = np.vstack([cube.points, cube.points[cube.cells].mean(axis=1)])
    center = len(cube.points) + np.arange(len(cube.cells))
    # the outward faces of a hexahedron, inwards as the bases of the pyramids
    faces = [[1, 2, 3, 0], [7, 6, 5, 4], [4, 5, 1, 0], [5, 6, 2, 1], [6, 7, 3, 2]]
    faces.append([7, 4, 0, 3])
    cells = np.vstack([np.column_stack([cube.cells[:, f], center]) for f in faces])
    return fem.Mesh(points, cells, "pyramid")


@pytest.mark.parametrize(
    "mesh",
    [
        fem.Cube(n=4).triangulate(),
        wedges(),
        pyramids(),
        fem.mesh.convert(fem.Cube(n=3), order=2),
        fem.mesh.convert(
            fem.Cube(n=3), order=2, calc_midfaces=True, calc_midvolumes=True
        ),
        fem.mesh.convert(fem.Cube(n=3).triangulate(), order=2),
    ],
    ids=["tetra", "wedge", "pyramid", "hexahedron20", "hexahedron27", "tetra10"],
)
def test_cell_types(mesh):
    """Tetrahedrons, wedges, pyramids and quadratic cells: a closed cut with the
    area of a side."""
    result, positions = cut_of(mesh, {"axis": "x", "value": 0.37})
    section = result.triangles[result.outer :]
    assert np.isclose(area(positions, section), 1.0)
    assert np.isclose(enclosed_volume(positions, result.triangles), 0.37)
    assert np.all(edge_counts(positions, result.triangles) == 2)


def test_warped_cells():
    """The faces of two cut cells are cut alike, also if they are not plane: no gap
    in the cut face."""
    mesh = fem.Cube(n=5)
    mesh.points[:, 0] += 0.1 * np.sin(3 * mesh.points[:, 1]) * mesh.points[:, 2]
    for cut in [{"axis": "x", "value": 0.52}, {"axis": "y", "value": 0.5}]:
        result, positions = cut_of(mesh, cut)
        assert np.all(edge_counts(positions, result.triangles) == 2)


def test_quadratic_cells_meet_the_outer_surface():
    """The curved faces of quadratic cells are cut like the outer surface is
    subdivided: the cut face meets the clipped outer surface without a gap."""
    mesh = fem.mesh.convert(fem.Cube(n=3), order=2)
    mesh.points[:, 0] += 0.05 * np.sin(np.pi * mesh.points[:, 1])
    result, positions = cut_of(mesh, {"axis": "z", "value": 0.6, "half": "-"})
    assert np.all(edge_counts(positions, result.triangles) == 2)
    assert result.outer > 0 and len(result.triangles) > result.outer


@pytest.mark.parametrize(
    "mesh, expected",
    [
        (fem.Rectangle(n=4), 0.5),
        (fem.Rectangle(n=4).triangulate(), 0.5),
        (fem.mesh.convert(fem.Rectangle(n=4), order=2), 0.5),
    ],
    ids=["quad", "triangle", "quad8"],
)
def test_2d(mesh, expected):
    """A 2D model: the cells are clipped at a line, without a cut face, and the line
    is an edge."""
    result, positions = cut_of(mesh, X)
    assert result.outer == len(result.triangles)
    assert np.isclose(area(positions, result.triangles), expected)
    on_line = np.all(np.isclose(positions[result.edges, 0], 0.5), axis=1)
    lengths = np.linalg.norm(np.diff(positions[result.edges], axis=1), axis=2)
    assert np.isclose(lengths[on_line].sum(), 1.0)
    # z is everything or nothing
    assert len(cut_of(mesh, {"axis": "z", "value": 0.0})[0].triangles) == 0
    nothing = cut_of(mesh, {"axis": "z", "value": 1.0})[0]
    assert len(nothing.triangles) == len(triangulate_surface(mesh).triangles)


def test_plane_through_points():
    """A plane through points of the mesh: the cut face is made of the faces of the
    cells on the visible side, without triangles of no area."""
    mesh = fem.Cube(n=3)
    for half, side in [("+", 0.25), ("-", 0.75)]:
        result, positions = cut_of(mesh, {**X, "half": half})
        section = result.triangles[result.outer :]
        assert len(section) == 8
        assert np.isclose(area(positions, section), 1.0)
        centers = mesh.points[mesh.cells].mean(axis=1)
        assert np.allclose(centers[result.owners[result.outer :], 0], side)
        assert np.all(edge_counts(positions, result.triangles) == 2)


def test_plane_outside():
    """A plane outside the model hides nothing or everything."""
    mesh = fem.Cube(n=3)
    outer = triangulate_surface(mesh)
    result, positions = cut_of(mesh, {"axis": "x", "value": 2.0})
    assert result.outer == len(result.triangles) == len(outer.triangles)
    assert len(positions) == outer.interpolation.shape[0]
    assert np.isclose(enclosed_volume(positions, result.triangles), 1.0)
    assert len(result.edges) == len(outer.edges)
    for cut in [{"axis": "x", "value": -1.0}, {"axis": "x", "value": 0.0}]:
        empty, positions = cut_of(mesh, cut)
        assert len(empty.triangles) == len(empty.edges) == len(positions) == 0


def solid_of(mesh):
    return volume_cells(meshio.Mesh(mesh.points, [(mesh.cell_type, mesh.cells)]))


def test_scene_surface():
    """The surface of a mesh for the viewer, cut: the triangles of the cut face are
    marked, every region is closed by its own cut face."""
    mesh = fem.Cube(n=5)
    tags = {"layer": (mesh.points[mesh.cells].mean(axis=1)[:, 1] > 0.5).astype(int)}
    result = surface(solid_of(mesh), tags, {"axis": "x", "value": 0.4})
    positions = np.frombuffer(result["positions"], "<f4").reshape(-1, 3)
    triangles = np.frombuffer(result["triangles"], "<u4").reshape(-1, 3)
    owners = np.frombuffer(result["owners"], "<u4")
    cutface = np.frombuffer(result["cutface"], "u1").astype(bool)
    isnode = np.frombuffer(result["isnode"], "u1")
    assert len(cutface) == len(triangles) == len(owners)
    assert np.isclose(area(positions.astype(float), triangles[cutface]), 1.0)
    assert np.allclose(positions[np.unique(triangles[cutface]), 0], 0.4, atol=1e-6)
    # the points of the cut face inside cells are no nodes
    assert not isnode[np.unique(triangles[cutface])].all()
    # every region closed: twice the area of the cut face of a region (y = 0.5)
    for value in (0, 1):
        own = tags["layer"][owners] == value
        assert np.isclose(area(positions.astype(float), triangles[own & cutface]), 0.5)
    assert surface(solid_of(mesh), tags)["cutface"] is None


@pytest.fixture
def two_materials(monkeypatch):
    """The bar of two sections (u and u-p-J), solved."""
    monkeypatch.chdir(GOLDEN / "bar_two_materials")
    commands = json.loads(
        (GOLDEN / "bar_two_materials" / "commands.json").read_text(encoding="utf-8")
    )
    run(commands)
    return LAST


def test_results_scene(two_materials):
    """The results of a substep cut: the surfaces of the sections with the values
    inside, the ranges and the extremes of the sections."""
    last = results.substeps("job_1")
    meta, plain = results.scene("job_1", last, "stress_mises")
    bounds = np.vstack(
        [np.frombuffer(s["positions"], "<f4").reshape(-1, 3) for s in plain]
    )
    middle = float(bounds[:, 0].mean())
    cut = {"axis": "x", "value": middle, "half": "+"}
    meta_cut, surfaces = results.scene("job_1", last, "stress_mises", cut=cut)
    meta, meta_cut = json.loads(meta), json.loads(meta_cut)
    for key in ("range", "extremes", "sections"):
        assert meta_cut[key] == meta[key]

    for s in surfaces:
        positions = np.frombuffer(s["positions"], "<f4").reshape(-1, 3)
        triangles = np.frombuffer(s["triangles"], "<u4").reshape(-1, 3)
        values = np.frombuffer(s["values"], "<f4")
        owners = np.frombuffer(s["owners"], "<u4")
        displacement = np.frombuffer(s["displacement"], "<f4").reshape(-1, 3)
        assert len(triangles) == len(values) == len(owners)
        assert np.all(positions[np.unique(triangles), 0] <= middle + 1e-5)
        drawn = results._drawn(s["name"], cuts.plane(cut))
        # the values of the cells and the displacements of the points
        data = results._data("mises", s["name"])[:, 0]
        assert np.allclose(values, data[owners])
        u = two_materials[f"field_{s['name']}"][0].values
        assert np.allclose(displacement, drawn.interpolate(u), atol=1e-6)


def test_results_cache(two_materials):
    """The geometry of a cut is kept per section, until the next cut or run."""
    cut = {"axis": "y", "value": 0.0, "half": "-"}
    results.scene("job_1", 1, "displacement", cut=cut)
    section = results._state["sections"][0]
    first = results._drawn(section, cuts.plane(cut))
    results.scene("job_1", 2, "displacement_x", cut=cut)
    assert results._drawn(section, cuts.plane(cut)) is first
    other = {**cut, "value": 0.1}
    results.scene("job_1", 2, "displacement", cut=other)
    assert results._drawn(section, cuts.plane(other)) is not first
    assert results._drawn(section) is results._surface(section)[0]


def test_results_point_values(two_materials):
    """Values at the points are interpolated to the points of the cut face."""
    cut = {"axis": "z", "value": 0.0, "half": "+"}
    meta, surfaces = results.scene("job_1", 3, "stress_max", "mean", cut=cut)
    assert json.loads(meta)["at"] == "point"
    for s in surfaces:
        values = np.frombuffer(s["values"], "<f4")
        positions = np.frombuffer(s["positions"], "<f4").reshape(-1, 3)
        assert len(values) == len(positions)
        drawn = results._drawn(s["name"], cuts.plane(cut))
        data = results._data("stress", s["name"], "mean")[:, 0]
        assert np.allclose(values, drawn.interpolate(data), rtol=1e-5, atol=1e-6)
