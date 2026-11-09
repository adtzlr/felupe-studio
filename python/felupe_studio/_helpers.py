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

# topological dimension of meshio cell types
DIMENSIONS = {
    **dict.fromkeys(["line", "line3"], 1),
    **dict.fromkeys(["triangle", "triangle6", "quad", "quad8", "quad9"], 2),
    **dict.fromkeys(REGIONS, 3),
}


def volume_cells(mesh, tag=None):
    """Return the points, the cell type, the solid cells and their tags (optional) of
    a meshio mesh. Lower-dimensional cell blocks (e.g. boundary faces) are ignored."""
    dim = max(DIMENSIONS.get(block.type, 0) for block in mesh.cells)
    blocks = [i for i, b in enumerate(mesh.cells) if DIMENSIONS.get(b.type) == dim]
    cell_types = {mesh.cells[i].type for i in blocks}
    if dim != 3 or len(cell_types) != 1:
        raise ValueError(f"Expected one type of solid cells, got {cell_types}.")
    cells = np.vstack([mesh.cells[i].data for i in blocks])
    tags = None
    if tag is not None:
        tags = np.concatenate([np.ravel(mesh.cell_data[tag][i]) for i in blocks])
    return SimpleNamespace(
        points=mesh.points, cell_type=cell_types.pop(), cells=cells, tags=tags
    )
