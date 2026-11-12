"""Helpers of the generated scripts.

The part below the marker is copied verbatim into every generated script (see
:mod:`felupe_studio.codegen`), so a script runs without FElupe Studio. The same code
is used by :mod:`felupe_studio.checks`.
"""

from types import SimpleNamespace

import felupe as fem
import meshio
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


def volume_cells(mesh, tag=None, cell_type=None, scale=1.0):
    """Return the points (multiplied by the scale), the cell type, the solid cells and
    their tags (optional) of a meshio mesh. Lower-dimensional cell blocks (e.g.
    boundary faces) are ignored. A mesh with more than one type of solid cells needs
    the cell type to take."""
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
    points = mesh.points if scale == 1 else mesh.points * scale
    return SimpleNamespace(points=points, cell_type=cell_type, cells=cells, tags=tags)


def single_point(mask, name):
    """Return the index of the only point of a mask, e.g. of a center point. A mask
    of another number of points raises a ``ValueError``."""
    (indices,) = np.nonzero(mask)
    if len(indices) != 1:
        raise ValueError(f"'{name}' has {len(indices)} points, not one.")
    return indices[0]


def vertex_region(points):
    """Return a region of vertices at the given points, e.g. of control points that
    are not nodes of the meshes of the sections."""
    points = np.asarray(points, dtype=float).reshape(-1, 3)
    cells = np.arange(len(points)).reshape(-1, 1)
    return fem.RegionVertex(fem.Mesh(points, cells, "vertex"))


def points_at(points, coordinates, atol=1e-8):
    """Return a mask of the points at the given coordinates (like ``np.isclose``).
    Every coordinate needs a point, otherwise a ``ValueError`` is raised."""
    coordinates = np.atleast_2d(np.asarray(coordinates, dtype=float))
    close = np.isclose(points[:, None], coordinates, atol=atol).all(axis=2)
    missing = coordinates[~close.any(axis=0)]
    if len(missing):
        raise ValueError(f"There is no point at {missing.tolist()}.")
    return close.any(axis=1)


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


# --- embedded in generated scripts with face sets ---
# boundary regions by cell type of the solid cells (no tetrahedrons in FElupe 12)
BOUNDARY_REGIONS = {
    "hexahedron": fem.RegionHexahedronBoundary,
    "hexahedron20": fem.RegionQuadraticHexahedronBoundary,
    "hexahedron27": fem.RegionTriQuadraticHexahedronBoundary,
}


def boundary_faces(mesh, plane=None, centers=None, atol=None):
    """Return the boundary region of faces of the outer surface of a mesh: the faces
    on a plane ``(axis, value)``, or the faces with the given centers (the mean of
    the points of a face, the nearest face within ``atol``, by default 1e-6 of the
    size of the mesh). Picked faces are selected by the points of their faces on
    their cells; a ``ValueError`` is raised if these select more faces, e.g. both
    sides of a plate that is one cell thick."""
    if mesh.cell_type not in BOUNDARY_REGIONS:
        raise NotImplementedError(
            f"Faces of {mesh.cell_type} cells have no boundary region in FElupe."
        )
    region = BOUNDARY_REGIONS[mesh.cell_type]
    points = mesh.points
    if plane is not None:
        axis, value = plane
        tolerance = 1e-8 if atol is None else atol
        return region(mesh, mask=np.isclose(points[:, axis], value, atol=tolerance))

    # the nearest outer face of every center
    outer = region(mesh, grad=False)
    faces = outer.mesh.cells_faces
    centers = np.atleast_2d(np.asarray(centers, dtype=float))
    if atol is None:
        atol = 1e-6 * np.linalg.norm(np.ptp(points[np.unique(mesh.cells)], axis=0))
    distance = np.linalg.norm(
        points[faces].mean(axis=1)[:, None] - centers[None], axis=2
    )
    nearest = distance.argmin(axis=0)
    missing = centers[distance[nearest, np.arange(len(centers))] > atol]
    if len(missing):
        raise ValueError(f"There is no face with the center {missing.tolist()}.")
    chosen = np.unique(nearest)

    # the boundary region of the cells of the chosen faces (each cell once) and of
    # the points of these faces
    cells = {tuple(c): i for i, c in enumerate(np.sort(mesh.cells, axis=1))}
    owners = sorted(
        {cells[tuple(c)] for c in np.sort(outer.mesh.cells[chosen], axis=1)}
    )
    selected = mesh.copy()
    selected.update(cells=mesh.cells[owners])
    mask = np.zeros(len(points), dtype=bool)
    mask[faces[chosen]] = True
    result = region(selected, mask=mask)
    if len(result.mesh.cells) != len(chosen):
        raise ValueError(
            f"The points of the {len(chosen)} faces select {len(result.mesh.cells)} "
            "faces; take the faces of one side, or a plane."
        )
    return result


# --- embedded in generated scripts with meshes of scripts ---
def script_mesh(file, parameters, item=None):
    """Run a Python script that makes a mesh, with the parameters as variables, and
    return its variable ``mesh`` as a meshio mesh. The mesh is a ``fem.Mesh``, a
    ``fem.MeshContainer``, a ``meshio.Mesh`` or a dict of names and meshes, of which
    ``item`` is taken."""
    import runpy

    namespace = runpy.run_path(str(file), init_globals=dict(parameters))
    if "mesh" not in namespace:
        raise ValueError(f"The script '{file}' makes no variable 'mesh'.")
    mesh = namespace["mesh"]
    if isinstance(mesh, dict):
        if item not in mesh:
            raise ValueError(
                f"The mesh of '{file}' is a dict of {list(mesh)}: take one of them, "
                f"not {item!r}."
            )
        mesh = mesh[item]
    elif item is not None:
        raise ValueError(f"The mesh of '{file}' is not a dict with an item {item!r}.")
    if isinstance(mesh, (fem.Mesh, fem.MeshContainer)):
        mesh = mesh.as_meshio()
    if not isinstance(mesh, meshio.Mesh):
        raise TypeError(
            f"The mesh of '{file}' is a {type(mesh).__name__}, not a fem.Mesh, a "
            "fem.MeshContainer, a meshio.Mesh or a dict of them."
        )
    return mesh


def run_mesh_script(file, parameters, item=None, tag=None, cell_type=None):
    """Return the solid cells of the mesh of a script, like ``volume_cells()``."""
    mesh = script_mesh(file, parameters, item)
    return volume_cells(mesh, tag=tag, cell_type=cell_type)


# --- embedded in generated scripts with linear solvers ---
def spsolve(A, b):
    """Solve a linear system with ``scipy.sparse.linalg.spsolve``, the linear solver
    of FElupe before v12."""
    from scipy.sparse import linalg

    return linalg.spsolve(A, b)


def iterative_solver(method, rtol, maxiter=None):
    """Return a linear solver ``solver(A, b)`` with an iterative method of
    ``scipy.sparse.linalg`` (``minres``, ``cg``, ``gmres`` or ``bicgstab``) and a
    relative tolerance of the norm of the residual. It raises if the method does not
    converge, so that the Newton iteration fails instead of continuing with a poor
    solution."""
    from scipy.sparse import linalg

    solve = getattr(linalg, method)

    def solver(A, b):
        x, info = solve(A, b, rtol=rtol, maxiter=maxiter)
        if info != 0:
            within = f" within maxiter={maxiter}" if maxiter else ""
            raise RuntimeError(
                f"The linear solver {method} did not converge to rtol={rtol}"
                f"{within} (info={info}). Allow more iterations (maxiter) or take a "
                "direct solver (SuperLU or spsolve)."
            )
        return x

    return solver
