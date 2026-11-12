"""Create the mesh files of the golden test cases.

The meshes are committed; this script documents how they were made. Run it from the
repository root with ``python tests/golden/make_meshes.py``.
"""

from pathlib import Path

import felupe as fem
import meshio
import numpy as np

HERE = Path(__file__).parent


def bar(a=(0, 0, 0), b=(3, 1, 1), n=(13, 5, 5)):
    """Bar of hexahedrons, by default 3 x 1 x 1 with 12 x 4 x 4 cells."""
    return fem.Cube(a=a, b=b, n=n)


def material_tag(mesh):
    """Tag 1 for cells with x < 1.5 and tag 2 for all others."""
    centers = mesh.points[mesh.cells].mean(axis=1)
    return np.where(centers[:, 0] < 1.5, 1, 2)


def write_vtu(path, mesh, cell_data=None):
    meshio.Mesh(
        mesh.points, [(mesh.cell_type, mesh.cells)], cell_data=cell_data or {}
    ).write(path, binary=False)


def main():
    mesh = bar()
    tag = material_tag(mesh)

    write_vtu(HERE / "bar_single_body" / "bar.vtu", mesh)
    # the same bar, solved with an iterative linear solver (#203)
    write_vtu(HERE / "bar_iterative_minres" / "bar.vtu", mesh)
    write_vtu(HERE / "bar_mooney_rivlin" / "bar.vtu", mesh)
    write_vtu(HERE / "bar_loadcase" / "bar.vtu", mesh)
    write_vtu(HERE / "bar_volumetric_log" / "bar.vtu", mesh)
    write_vtu(HERE / "bar_sections_tag" / "bar.vtu", mesh, {"material": [tag]})
    write_vtu(HERE / "bar_two_materials" / "bar.vtu", mesh, {"material": [tag]})
    write_vtu(HERE / "bar_cutback" / "bar.vtu", mesh, {"material": [tag]})

    # Gmsh: one block per physical group, tags in "gmsh:physical"
    cells = [mesh.cells[tag == 1], mesh.cells[tag == 2]]
    meshio.Mesh(
        mesh.points,
        [("hexahedron", c) for c in cells],
        cell_data={
            "gmsh:physical": [np.full(len(c), i + 1) for i, c in enumerate(cells)],
            "gmsh:geometrical": [np.full(len(c), i + 1) for i, c in enumerate(cells)],
        },
    ).write(HERE / "bar_sections_gmsh" / "bar.msh", file_format="gmsh22", binary=False)

    # two files with separate points arrays, conforming at x = 1.5
    files = HERE / "bar_sections_files"
    write_vtu(files / "left.vtu", bar(b=(1.5, 1, 1), n=(7, 5, 5)))
    write_vtu(files / "right.vtu", bar(a=(1.5, 0, 0), n=(7, 5, 5)))

    # like before, but the coordinates of the right file differ by 1e-9 (as with
    # files of different mesh generators); merged with mesh.merge (decimals=6)
    shifted = HERE / "bar_sections_files_merged"
    right = bar(a=(1.5, 0, 0), n=(7, 5, 5))
    right.points[:, 0] += 1e-9
    write_vtu(shifted / "left.vtu", bar(b=(1.5, 1, 1), n=(7, 5, 5)))
    write_vtu(shifted / "right.vtu", right)

    # one file with hexahedra (x < 1.5) and tetrahedra (x > 1.5) on the same points,
    # and the quads of the left end face: one mesh per type of solid cells
    hexahedra = mesh.cells[tag == 1]
    tetra = fem.Mesh(mesh.points, mesh.cells[tag == 2], "hexahedron").triangulate()
    faces = hexahedra[:, [0, 3, 7, 4]]
    left_face = faces[np.all(mesh.points[faces, 0] == 0, axis=1)]
    meshio.Mesh(
        mesh.points,
        [("quad", left_face), ("hexahedron", hexahedra), ("tetra", tetra.cells)],
    ).write(HERE / "bar_cell_types" / "bar.vtu", binary=False)

    # the quarter of the bar at y, z >= 0.5 (the same points), with symmetry planes
    # at y = 0.5 and z = 0.5 (#186)
    write_vtu(
        HERE / "bar_symmetry_quarter" / "bar.vtu", bar(a=(0, 0.5, 0.5), n=(13, 3, 3))
    )

    # a cube of 2 x 2 x 2 cells, pulled by a pressure on its end face (#105)
    write_vtu(HERE / "block_pressure" / "block.vtu", fem.Cube(n=3))

    # a cube of 2 x 2 x 2 cells for the uniaxial tension of the material models
    for case in MATERIAL_CASES:
        write_vtu(HERE / case / "cube.vtu", fem.Cube(n=3))


# the material tests of the models of tensortrax (#136)
MATERIAL_CASES = [
    "cube_arruda_boyce",
    "cube_extended_tube",
    "cube_ogden",
    "cube_third_order_deformation",
    "cube_yeoh",
]


if __name__ == "__main__":
    main()
