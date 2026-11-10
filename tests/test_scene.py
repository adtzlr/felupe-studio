from pathlib import Path

import felupe as fem
import meshio
import numpy as np
import pytest
from felupe.view._surface import triangulate_surface

from felupe_studio._helpers import volume_cells
from felupe_studio.meshes import load
from felupe_studio.scene import regions, surface

GOLDEN = Path(__file__).parent / "golden"


def arrays(result):
    "Decode the bytes of a surface like the viewer does."
    decoded = {
        key: np.frombuffer(result[key], dtype=dtype)
        for key, dtype in [
            ("positions", "<f4"),
            ("triangles", "<u4"),
            ("edges", "<u4"),
            ("owners", "<u4"),
        ]
    }
    if result["faces"] is not None:
        decoded["faces"] = np.frombuffer(result["faces"], dtype="<u4")
    return decoded


def enclosed_volume(positions, triangles):
    "The volume enclosed by outward-oriented triangles (divergence theorem)."
    a, b, c = (positions[triangles[:, k]] for k in range(3))
    return np.einsum("ij,ij->i", a, np.cross(b, c)).sum() / 6


def solid_of(mesh):
    return volume_cells(meshio.Mesh(mesh.points, [(mesh.cell_type, mesh.cells)]))


def test_like_felupe():
    solid = volume_cells(meshio.read(GOLDEN / "bar_single_body" / "bar.vtu"))
    result = arrays(surface(solid))
    expected = triangulate_surface(fem.Mesh(solid.points, solid.cells, solid.cell_type))
    np.testing.assert_allclose(
        result["positions"].reshape(-1, 3), expected.interpolate(solid.points)
    )
    np.testing.assert_array_equal(
        result["triangles"].reshape(-1, 3), expected.triangles
    )
    np.testing.assert_array_equal(result["faces"], expected.faces)
    np.testing.assert_array_equal(result["edges"].reshape(-1, 2), expected.edges)
    np.testing.assert_array_equal(result["owners"], expected.owners)


@pytest.mark.parametrize(
    "mesh",
    [
        fem.Cube(n=3),
        fem.Cube(n=3).triangulate(),
        fem.mesh.add_midpoints_edges(fem.Cube(n=3).triangulate(), "tetra10"),
        fem.mesh.add_midpoints_edges(fem.Cube(n=3), "hexahedron20"),
    ],
    ids=["hexahedron", "tetra", "tetra10", "hexahedron20"],
)
def test_outward_and_closed(mesh):
    result = surface(solid_of(mesh))
    decoded = arrays(result)
    positions = decoded["positions"].reshape(-1, 3).astype(float)
    triangles = decoded["triangles"].reshape(-1, 3)
    assert enclosed_volume(positions, triangles) == pytest.approx(1.0, rel=1e-5)
    assert decoded["owners"].max() < result["cells"] == len(mesh.cells)
    assert decoded["edges"].max() < len(positions)
    # flat faces of linear cells, curved (subdivided) faces of quadratic cells
    assert (result["faces"] is None) == (mesh.cell_type in ("tetra10", "hexahedron20"))


def test_load_unusable_file(tmp_path):
    (tmp_path / "broken.vtu").write_text("not a mesh")
    text, result = load(tmp_path / "broken.vtu")
    assert '"error"' in text
    assert result == {}


def test_closed_regions_of_tags():
    mesh = meshio.read(GOLDEN / "bar_sections_tag" / "bar.vtu")
    solid = volume_cells(mesh, tag="material")
    result = surface(solid, {"material": solid.tags})
    decoded = arrays(result)
    positions = decoded["positions"].reshape(-1, 3).astype(float)
    triangles = decoded["triangles"].reshape(-1, 3)
    material = np.frombuffer(result["tags"]["material"], dtype="<i4")
    np.testing.assert_array_equal(material, solid.tags)

    # every region is closed: the interface at x = 1.5 belongs to both halves
    for value in (1, 2):
        mine = material[decoded["owners"]] == value
        assert enclosed_volume(positions, triangles[mine]) == pytest.approx(1.5)
    assert enclosed_volume(positions, triangles) == pytest.approx(3.0)
    assert decoded["edges"].max() < len(positions)
    assert decoded["faces"].max() < len(triangles)

    # without tags, the interface is an inner face
    single = arrays(surface(solid))
    assert len(single["triangles"]) < len(decoded["triangles"])


def test_regions():
    tags = {"a": np.array([1, 1, 2, 2]), "b": np.array([5, 6, 6, 6])}
    np.testing.assert_array_equal(regions(4, tags), [0, 1, 2, 2])
    np.testing.assert_array_equal(regions(3, {}), [0, 0, 0])
