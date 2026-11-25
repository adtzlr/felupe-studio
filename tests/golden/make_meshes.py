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
    write_vtu(HERE / "bar_load_cycle" / "bar.vtu", mesh)
    write_vtu(HERE / "bar_sections_tag" / "bar.vtu", mesh, {"material": [tag]})
    write_vtu(HERE / "bar_two_materials" / "bar.vtu", mesh, {"material": [tag]})
    # the same bar, the linear equation system in single precision (ADR 0016)
    path = HERE / "bar_two_materials_single_precision" / "bar.vtu"
    write_vtu(path, mesh, {"material": [tag]})
    # the same bar, the model in single precision (ADR 0016, #297)
    path = HERE / "bar_two_materials_float32" / "bar.vtu"
    write_vtu(path, mesh, {"material": [tag]})
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

    # the left half of the bar, mirrored and stacked into the whole by the mesh tools
    # (#438)
    write_vtu(HERE / "bar_mirrored_half" / "half.vtu", bar(b=(1.5, 1, 1), n=(7, 5, 5)))
    # the bar of two materials of bar_two_materials as its half at y < 0.5 with the
    # tag of the material, mirrored and stacked into the whole with its tags (#438)
    half = bar(b=(3, 0.5, 1), n=(13, 3, 5))
    path = HERE / "bar_two_materials_mirrored" / "half.vtu"
    write_vtu(path, half, {"material": [material_tag(half)]})
    # the profile of tube_sleeve_torsion as a file of quads with the points of a 3D
    # mesh generator (z = 0), a construction mesh revolved into the tube (#438)
    profile = fem.Rectangle(a=(0, 1), b=(3, 2), n=(7, 3))
    points = np.pad(profile.points, ((0, 0), (0, 1)))
    write_vtu(
        HERE / "tube_revolved_profile" / "profile.vtu", profile.copy(points=points)
    )

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

    # 2D models (#175): the cross section of the bar (3 x 1, 12 x 4 quads) in plane
    # strain, and a solid cylinder of radius 1 and length 3 (x is the axis, y the
    # radius), in the plane z = 0 of the files
    plate = fem.Rectangle(b=(3, 1), n=(13, 5))
    for case in (
        "plate_plane_strain",
        "cylinder_axisymmetric",
        "plate_rotation_plane_strain",
        # pressed by rigid lines and circles (#221)
        "plate_contact_plane_strain",
        "cylinder_contact_axisymmetric",
        "plate_contact_roller",
    ):
        meshio.Mesh(
            np.pad(plate.points, ((0, 0), (0, 1))), [("quad", plate.cells)]
        ).write(HERE / case / "plate.vtu", binary=False)

    # the cylinder of quadratic quads (6 x 2 cells), pulled by a pressure on its end
    quadratic = fem.mesh.convert(fem.Rectangle(b=(3, 1), n=(7, 3)), order=2)
    meshio.Mesh(
        np.pad(quadratic.points, ((0, 0), (0, 1))), [("quad8", quadratic.cells)]
    ).write(HERE / "cylinder_pressure_axisymmetric" / "plate.vtu", binary=False)

    # a unit cube of 4 x 4 x 4 cells pressed by rigid surfaces (#220)
    for case in (
        "block_contact_plane",
        "block_contact_friction",
        "block_contact_cylinder",
    ):
        write_vtu(HERE / case / "block.vtu", fem.Cube(n=5))

    # a cube of 2 x 2 x 2 cells for the uniaxial tension of the material models, of
    # the elastic-plastic material (#191) and of the linear elastic one (#259)
    for case in [*MATERIAL_CASES, "plasticity_cube", "linear_elastic_cube"]:
        write_vtu(HERE / case / "cube.vtu", fem.Cube(n=3))

    # the cube of the elastic-plastic material as quadratic tetrahedrons, for the
    # three-field variation (#420)
    tetra = fem.Cube(n=3).triangulate()
    write_vtu(
        HERE / "plasticity_cube_three_field" / "cube.vtu",
        fem.mesh.add_midpoints_edges(tetra, cell_type_new="tetra10"),
    )

    # the bar of quadratic hexahedrons (6 x 2 x 2 cells), condensed per cell (#420)
    write_vtu(
        HERE / "bar_hexahedron20_condensed" / "bar.vtu",
        fem.mesh.convert(bar(n=(7, 3, 3)), order=2),
    )


# the material tests of the models of tensortrax (#136), and of the Mullins effect
# (#346)
MATERIAL_CASES = [
    "cube_arruda_boyce",
    "cube_extended_tube",
    "cube_mullins_mooney_rivlin",
    "cube_mullins_neo_hooke",
    "cube_ogden",
    "cube_third_order_deformation",
    "cube_yeoh",
]


if __name__ == "__main__":
    main()
