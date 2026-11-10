"""Helpers of the generated scripts.

The part below the marker is copied verbatim into every generated script (see
:mod:`felupe_studio.codegen`), so a script runs without FElupe Studio. The same code
is used by :mod:`felupe_studio.checks`.
"""

from types import SimpleNamespace

import felupe as fem
import numpy as np

# --- embedded in generated scripts ---
# regions by cell type of the solid cells
REGIONS = {
    "tetra": fem.RegionTetra,
    "tetra10": fem.RegionQuadraticTetra,
    "hexahedron": fem.RegionHexahedron,
    "hexahedron20": fem.RegionQuadraticHexahedron,
    "hexahedron27": fem.RegionTriQuadraticHexahedron,
}

# topological dimension of meshio cell types (wedges and pyramids are solid cells
# without a region in FElupe)
DIMENSIONS = {
    **dict.fromkeys(["line", "line3"], 1),
    **dict.fromkeys(["triangle", "triangle6", "quad", "quad8", "quad9"], 2),
    **dict.fromkeys(["wedge", "wedge15", "pyramid", "pyramid13", *REGIONS], 3),
}


def solid_types(mesh):
    """Return the types of the solid cells of a meshio mesh, in the order of blocks."""
    types = [b.type for b in mesh.cells if DIMENSIONS.get(b.type) == 3]
    return list(dict.fromkeys(types))


def volume_cells(mesh, tag=None, cell_type=None):
    """Return the points, the cell type, the solid cells and their tags (optional) of
    a meshio mesh. Lower-dimensional cell blocks (e.g. boundary faces) are ignored. A
    mesh with more than one type of solid cells needs the cell type to take."""
    types = solid_types(mesh)
    if cell_type is None and len(types) == 1:
        cell_type = types[0]
    if cell_type not in types:
        raise ValueError(f"Expected the type of solid cells to take, one of {types}.")
    blocks = [i for i, b in enumerate(mesh.cells) if b.type == cell_type]
    cells = np.vstack([mesh.cells[i].data for i in blocks])
    tags = None
    if tag is not None:
        tags = np.concatenate([np.ravel(mesh.cell_data[tag][i]) for i in blocks])
    return SimpleNamespace(
        points=mesh.points, cell_type=cell_type, cells=cells, tags=tags
    )


def mixed_region(mesh):
    """Return the region of the mixed fields (u-p-J) of a mesh. Linear tetrahedra get
    a bubble point in every cell (MINI element), the dual fields are linear.

    Only the points of the cells are kept: the dual fields of tetrahedra are fields of
    the points, and a point of another section would be a free degree of freedom
    without stiffness. ``fem.field.merge`` merges the points of the sections again."""
    used, cells = np.unique(mesh.cells, return_inverse=True)
    mesh = fem.Mesh(mesh.points[used], cells.reshape(mesh.cells.shape), mesh.cell_type)
    if mesh.cell_type == "tetra":
        bubble = fem.mesh.add_midpoints_volumes(mesh, cell_type_new="tetra5")
        return fem.RegionTetraMINI(bubble)
    return REGIONS[mesh.cell_type](mesh)
