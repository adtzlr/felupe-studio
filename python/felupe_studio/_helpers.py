"""Helpers of the generated scripts.

The part below the marker is copied verbatim into every generated script (see
:mod:`felupe_studio.codegen`), so a script runs without FElupe Studio. The same code
is used by :mod:`felupe_studio.checks`.
"""

import felupe as fem
import meshio
import numpy as np

# --- embedded in generated scripts ---
# regions by cell type of the solid cells: of 3D models, and of 2D models (plane
# strain or axisymmetric, #175)
REGIONS = {
    "tetra": fem.RegionTetra,
    "tetra10": fem.RegionQuadraticTetra,
    "hexahedron": fem.RegionHexahedron,
    "hexahedron20": fem.RegionQuadraticHexahedron,
    "hexahedron27": fem.RegionTriQuadraticHexahedron,
    "triangle": fem.RegionTriangle,
    "triangle6": fem.RegionQuadraticTriangle,
    "quad": fem.RegionQuad,
    "quad8": fem.RegionQuadraticQuad,
    "quad9": fem.RegionBiQuadraticQuad,
}

# topological dimension of meshio cell types (wedges and pyramids are solid cells
# without a region in FElupe)
DIMENSIONS = {
    **dict.fromkeys(["line", "line3"], 1),
    **dict.fromkeys(["triangle", "triangle6", "quad", "quad8", "quad9"], 2),
    **dict.fromkeys(["wedge", "wedge15", "pyramid", "pyramid13"], 3),
    **dict.fromkeys(["tetra", "tetra10", "hexahedron", "hexahedron20"], 3),
    "hexahedron27": 3,
}


def solid_types(mesh):
    """Return the types of the solid cells of a meshio mesh, in the order of blocks:
    the cells of the highest dimension, e.g. the quads of a 2D mesh but not the
    quads of the faces of a mesh of hexahedrons."""
    dimension = max((DIMENSIONS.get(b.type, 0) for b in mesh.cells), default=0)
    if dimension < 2:
        return []
    types = [b.type for b in mesh.cells if DIMENSIONS.get(b.type) == dimension]
    return list(dict.fromkeys(types))


def volume_cells(mesh, tag=None, cell_type=None, scale=1.0, dim=3):
    """Return the solid cells of a meshio mesh as a ``fem.Mesh``, with the points
    multiplied by the scale and the tags of its cells as ``tags`` (None without a
    tag). So the mesh of a file is an input of the mesh tools like a mesh made by
    them (#438). Lower-dimensional cell blocks (e.g. boundary faces) are ignored. A
    mesh with more than one type of solid cells needs the cell type to take. The
    cells are 3D cells, or 2D cells for a 2D model (plane strain or axisymmetric)
    with ``dim=2``. The points of 2D cells have the coordinates x and y only (the z
    of a mesh file is dropped).

    The 2D cells of a 3D model, given by their ``cell_type``, are a construction
    mesh, e.g. a profile to revolve or expand into a body (#438)."""
    types = solid_types(mesh)
    given = cell_type is not None
    if cell_type is None and len(types) == 1:
        cell_type = types[0]
    if cell_type not in types:
        raise ValueError(f"Expected the type of solid cells to take, one of {types}.")
    if dim == 3 and DIMENSIONS[cell_type] == 2 and not given:
        raise ValueError(
            f"The mesh has {cell_type} cells, which are 2D cells: set the analysis "
            "of the model settings to plane strain or axisymmetric, or take them as "
            f"a construction mesh with cell_type={cell_type!r}, e.g. a profile to "
            "revolve."
        )
    if dim == 2 and DIMENSIONS[cell_type] == 3:
        raise ValueError(
            f"The mesh has {cell_type} cells, which are 3D cells: a 2D model (plane "
            "strain or axisymmetric) has 2D cells."
        )
    blocks = [i for i, b in enumerate(mesh.cells) if b.type == cell_type]
    cells = np.vstack([mesh.cells[i].data for i in blocks])
    tags = None
    if tag is not None:
        tags = np.concatenate([np.ravel(mesh.cell_data[tag][i]) for i in blocks])
    points = mesh.points if scale == 1 else mesh.points * scale
    if DIMENSIONS[cell_type] == 2:
        points = np.asarray(points)[:, :2]
    solid = fem.Mesh(points, cells, cell_type)
    solid.tags = tags
    return solid


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
    points = np.atleast_2d(np.asarray(points, dtype=float))
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


# --- embedded in generated scripts with mixed fields ---
def mixed_region(mesh):
    """Return the region of the mixed fields (u-p-J) of a mesh. Linear tetrahedra and
    triangles get a bubble point in every cell (MINI element), the dual fields are
    linear.

    Only the points of the cells are kept: the dual fields of tetrahedra are fields of
    the points, and a point of another section would be a free degree of freedom
    without stiffness. ``fem.field.merge`` merges the points of the sections again."""
    used, cells = np.unique(mesh.cells, return_inverse=True)
    mesh = fem.Mesh(mesh.points[used], cells.reshape(mesh.cells.shape), mesh.cell_type)
    if mesh.cell_type == "tetra":
        bubble = fem.mesh.add_midpoints_volumes(mesh, cell_type_new="tetra5")
        return fem.RegionTetraMINI(bubble)
    if mesh.cell_type == "triangle":
        bubble = fem.mesh.add_midpoints_faces(mesh, cell_type_new="triangle4")
        return fem.RegionTriangleMINI(bubble)
    return REGIONS[mesh.cell_type](mesh)


# --- embedded in generated scripts with automatic u-p-J sections ---
def mixed_field(region, **kwargs):
    """Return the field container of a section with the u-p-J formulation. Linear
    hexahedrons and quads have the displacements only: their pressure and volume
    ratio are constant in every cell and condensed by
    ``fem.SolidBodyNearlyIncompressible`` (see ``nearly_incompressible``). Other cells
    get the mixed fields of the displacements, the pressure and the volume ratio,
    ``fem.FieldsMixed`` (with ``planestrain=True`` or ``axisymmetric=True`` of 2D
    models)."""
    if region.mesh.cell_type in ("hexahedron", "quad"):
        # the precision of a model in single precision (#297)
        dtype = kwargs.get("dtype")
        if kwargs.get("axisymmetric"):
            field = fem.FieldAxisymmetric(region, dim=2, dtype=dtype)
        elif kwargs.get("planestrain"):
            field = fem.FieldPlaneStrain(region, dim=2, dtype=dtype)
        else:
            field = fem.Field(region, dim=3, dtype=dtype)
        return fem.FieldContainer([field])
    return fem.FieldsMixed(region, n=3, **kwargs)


def nearly_incompressible(umat, field, bulk, volumetric="volume-ratio"):
    """Return the solid body of a section with the u-p-J formulation: of a field of the
    displacements only (``mixed_field`` of linear hexahedrons and quads)
    ``fem.SolidBodyNearlyIncompressible``, which condenses the pressure and the volume
    ratio of every cell, else ``fem.SolidBody`` with ``fem.NearlyIncompressible`` on
    the mixed fields. Both are the same three-field formulation."""
    if len(field.fields) == 1:
        return fem.SolidBodyNearlyIncompressible(
            umat, field, bulk=bulk, volumetric=volumetric
        )
    umat = fem.NearlyIncompressible(umat, bulk=bulk, volumetric=volumetric)
    return fem.SolidBody(umat, field)


# --- embedded in generated scripts with sections condensed per cell ---
# the cell types whose pressure and volume ratio fem.SolidBodyNearlyIncompressible
# condenses per cell (u-p-J-condensed, #420)
CONDENSED = ("hexahedron", "hexahedron20", "hexahedron27", "quad", "quad8", "quad9")


def condensed_region(mesh):
    """Return the region of a mesh of hexahedrons or quads, linear or quadratic, of a
    section condensed per cell (u-p-J-condensed, #420): its solid body
    ``fem.SolidBodyNearlyIncompressible`` condenses the constant pressure and volume
    ratio of every cell. Other cells raise a ``ValueError``: a constant pressure of
    tetrahedrons and triangles would lock."""
    if mesh.cell_type not in CONDENSED:
        raise ValueError(
            "Condensed per cell (u-p-J-condensed) takes hexahedrons and quads, not "
            f"{mesh.cell_type} cells. Use 'u-p-J' or 'u-p-J-mixed'."
        )
    return REGIONS[mesh.cell_type](mesh)


# --- embedded in generated scripts with steps that leave out u-p-J sections ---
class Held(fem.Boundary):
    """A boundary that holds all points of a field where they are (#428): its value
    is the values of the field when a substep starts, so a given value is ignored."""

    def __init__(self, field):
        super().__init__(field, mask=np.ones(field.region.mesh.npoints, dtype=bool))

    @property
    def value(self):
        return self.field.values.ravel()[self.dof]

    @value.setter
    def value(self, value):
        pass


def hold_dual_fields(field, *containers):
    """Return the boundaries of a step that hold the dual fields of the sections that
    it leaves out (#428): the fields after the first one of their field containers,
    e.g. the pressure and the volume ratio of mixed fields, at their values at the
    start of the step. Only the solid body of a section has stiffness for them, so
    without it they would make the system singular. They are fields of the top-level
    field, at the slots of the field containers; a field container of the
    displacements only (``mixed_field`` of linear hexahedrons and quads) has none."""
    boundaries = {}
    for container in containers:
        slots = getattr(container, "slots", None) or range(len(container.fields))
        for slot in slots[1:]:
            boundaries[f"field[{slot}]"] = Held(field[slot])
    return boundaries


# --- embedded in generated scripts with face sets ---
# boundary regions by cell type of the solid cells (no tetrahedrons and triangles in
# FElupe 12); the faces of the 2D cells of 2D models are their edges
BOUNDARY_REGIONS = {
    "hexahedron": fem.RegionHexahedronBoundary,
    "hexahedron20": fem.RegionQuadraticHexahedronBoundary,
    "hexahedron27": fem.RegionTriQuadraticHexahedronBoundary,
    "quad": fem.RegionQuadBoundary,
    "quad8": fem.RegionQuadraticQuadBoundary,
    "quad9": fem.RegionBiQuadraticQuadBoundary,
}


def boundary_faces(mesh, plane=None, centers=None, atol=None):
    """Return the boundary region of faces of the outer surface of a mesh: the faces
    on a plane ``(axis, value)``, or the faces with the given centers (the mean of
    the points of a face, the nearest face within ``atol``, by default 1e-6 of the
    size of the mesh). Picked faces are selected by the points of their faces on
    their cells; a ``ValueError`` is raised if these select more faces, e.g. both
    sides of a plate that is one cell thick. The faces of 2D cells are their edges,
    with the normals of the edges in the xy-plane (``ensure_3d=True``)."""
    if mesh.cell_type not in BOUNDARY_REGIONS:
        raise NotImplementedError(
            f"Faces of {mesh.cell_type} cells have no boundary region in FElupe."
        )
    region = BOUNDARY_REGIONS[mesh.cell_type]
    options = {"ensure_3d": True} if mesh.dim == 2 else {}
    points = mesh.points
    if plane is not None:
        axis, value = plane
        tolerance = 1e-8 if atol is None else atol
        mask = np.isclose(points[:, axis], value, atol=tolerance)
        return region(mesh, mask=mask, **options)

    # the nearest outer face of every center
    outer = region(mesh, grad=False, **options)
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
    result = region(selected, mask=mask, **options)
    if len(result.mesh.cells) != len(chosen):
        raise ValueError(
            f"The points of the {len(chosen)} faces select {len(result.mesh.cells)} "
            "faces; take the faces of one side, or a plane."
        )
    return result


# --- embedded in generated scripts with surface point sets ---
# the edges of 2D cells: their corners and their mid point (2D cells of the MINI
# element have a bubble point inside)
EDGES = {
    "triangle": [[0, 1], [1, 2], [2, 0]],
    "triangle4": [[0, 1], [1, 2], [2, 0]],
    "triangle6": [[0, 1, 3], [1, 2, 4], [2, 0, 5]],
    "quad": [[0, 1], [1, 2], [2, 3], [3, 0]],
    "quad8": [[0, 1, 4], [1, 2, 5], [2, 3, 6], [3, 0, 7]],
    "quad9": [[0, 1, 4], [1, 2, 5], [2, 3, 6], [3, 0, 7]],
}


def surface_points(meshes, points):
    """Return a mask of the points on the outer surface of meshes with the given
    points, e.g. the meshes of the sections with the merged points (#222): the points
    of the faces which belong to one cell, like the surface of ``mesh.plot()``, or of
    the edges which belong to one cell of 2D cells. Faces or edges of two meshes at
    an interface are inside."""
    from felupe.view._surface import triangulate_surface

    mask = np.zeros(len(points), dtype=bool)
    if all(mesh.cell_type in EDGES for mesh in meshes):
        blocks = [m.cells[:, edge] for m in meshes for edge in EDGES[m.cell_type]]
        corners = np.vstack([np.sort(block[:, :2], axis=1) for block in blocks])
        _, inverse, counts = np.unique(
            corners, axis=0, return_inverse=True, return_counts=True
        )
        once = np.split(
            counts[inverse.ravel()] == 1, np.cumsum([len(b) for b in blocks])[:-1]
        )
        for block, outer in zip(blocks, once, strict=True):
            mask[block[outer]] = True
        return mask
    # the cells of the MINI element without their bubble points
    corners = {"tetra5": ("tetra", 4)}
    solids = []
    for mesh in meshes:
        cell_type, npoints = corners.get(mesh.cell_type, (mesh.cell_type, None))
        solids.append(fem.Mesh(points, mesh.cells[:, :npoints], cell_type))
    surface = triangulate_surface(solids)
    mask[np.unique(surface.interpolation.tocsr().indices)] = True
    return mask


# --- embedded in generated scripts with meshes of scripts ---
def script_mesh(file, parameters, item=None):
    """Run a Python script that makes a mesh, with the parameters as variables, and
    return its variable ``mesh`` as a meshio mesh. The mesh is a ``fem.Mesh``, a
    ``fem.MeshContainer``, a ``meshio.Mesh`` or a dict of names and meshes, of which
    ``item`` is taken. A mesh without cells raises a ``ValueError`` that shows how to
    make an empty part instead."""
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
    if not any(len(block.data) for block in mesh.cells):
        # an empty part is one degenerate cell of its cell type (#418)
        cell_type, npoints = "hexahedron", 8
        if mesh.cells and np.ndim(mesh.cells[0].data) == 2:
            cell_type, npoints = mesh.cells[0].type, np.shape(mesh.cells[0].data)[1]
        dim = 2 if DIMENSIONS.get(cell_type) == 2 else 3
        name = "The mesh" if item is None else f"The mesh {item!r}"
        raise ValueError(
            f"{name} of '{file}' has no cells. Make an empty part one degenerate "
            f"cell of its cell type, e.g. fem.Mesh(points=np.zeros((1, {dim})), "
            f'cells=np.zeros((1, {npoints}), dtype=int), cell_type="{cell_type}"): '
            "its section has no volume and is off in every step."
        )
    return mesh


def run_mesh_script(file, parameters, item=None, tag=None, cell_type=None, dim=3):
    """Return the solid cells of the mesh of a script as a ``fem.Mesh`` with the tags
    of its cells, like ``volume_cells()``."""
    mesh = script_mesh(file, parameters, item)
    return volume_cells(mesh, tag=tag, cell_type=cell_type, dim=dim)


# the cell types of the corners of the cells of the MINI element
CORNERS = {"tetra5": ("tetra", 4), "triangle4": ("triangle", 3)}


def cell_volumes(mesh):
    """Return the volumes of the cells of a mesh, the areas of 2D cells (#429): the
    sums of the differential volumes ``dV`` of their region, of every cell measured
    from its first point. So a degenerate cell, whose points are all one point, has a
    volume of exactly zero, also a quadratic cell. A cell of the MINI element is
    measured by its corners."""
    cell_type, corners = CORNERS.get(mesh.cell_type, (mesh.cell_type, None))
    cells = np.asarray(mesh.cells)[:, :corners]
    region = REGIONS[cell_type](fem.Mesh(mesh.points, cells, cell_type), grad=False)
    points = np.asarray(region.mesh.points, dtype=float)[region.mesh.cells]
    points = points - points[:, :1]
    volumes = np.zeros(len(cells))
    # one quadrature point at a time, for the memory of large meshes
    for q, weight in enumerate(region.quadrature.weights):
        dXdr = np.einsum("caI,aJ->IJc", points, region.element_dhdr[..., q])
        volumes += fem.math.det(dXdr) * weight
    return volumes


def has_volume(solid):
    """Whether the cells of a solid body have a volume (#429): not a section of one
    degenerate cell for an empty part (#418), whose forces and stiffness are NaN."""
    return cell_volumes(solid.field[0].region.mesh).sum() != 0


def with_volume(*solids):
    """Return the solid bodies with a volume, the items of a step (#429)."""
    return [solid for solid in solids if has_volume(solid)]


def fields_without_volume(*solids):
    """Return the field containers of the solid bodies without volume, whose dual
    fields a step holds like those of a section that it leaves out (#428, #429)."""
    return [solid.field for solid in solids if not has_volume(solid)]


# --- embedded in generated scripts with user-defined materials ---
def run_material_script(file, parameters):
    """Run a Python script that makes a material (ADR 0025), with the parameters as
    variables, and return its variable ``umat``: a constitutive model of FElupe with
    the methods ``gradient`` and ``hessian``, e.g. ``fem.NeoHooke(mu=mu, bulk=bulk)``.
    """
    import runpy

    namespace = runpy.run_path(str(file), init_globals=dict(parameters))
    if "umat" not in namespace:
        raise ValueError(f"The script '{file}' makes no variable 'umat'.")
    umat = namespace["umat"]
    missing = [m for m in ("gradient", "hessian") if not callable(getattr(umat, m, 0))]
    if missing:
        methods = " and ".join(missing)
        raise TypeError(
            f"The umat of '{file}' is a {type(umat).__name__} without the "
            f"method{'s' if len(missing) > 1 else ''} {methods} of a constitutive "
            "model of FElupe, e.g. fem.NeoHooke(mu=mu, bulk=bulk)."
        )
    return umat


# --- embedded in generated scripts with strain energy functions of files ---
def material_function(file, name):
    """Return the strain energy density function ``name`` of a Python file (#424): a
    function of the right Cauchy-Green deformation tensor ``C``, a tensor of
    tensortrax, and of its arguments, e.g. ``strain_energy(C, mu)``, which
    ``fem.Hyperelastic`` differentiates."""
    import inspect
    import runpy

    namespace = runpy.run_path(str(file))
    function = namespace.get(name)
    if not callable(function):
        # the functions defined in the file
        names = [
            key
            for key, value in namespace.items()
            if inspect.isfunction(value) and value.__module__ == "<run_path>"
        ]
        functions = f" Its functions: {', '.join(names)}." if names else ""
        raise ValueError(f"The script '{file}' has no function '{name}'.{functions}")
    return function


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


def single_precision(solver):
    """Return a linear solver ``solver(A, b)`` which solves in single precision
    (``float32``): the matrix, the right-hand side and the factorization need half the
    memory. The increment is returned in the precision of the right-hand side, so the
    residual forces and the convergence check of the Newton iteration stay in double
    precision (ADR 0016)."""

    def solve(A, b):
        return solver(A.astype(np.float32), b.astype(np.float32)).astype(b.dtype)

    return solve


# --- embedded in generated scripts with embedded meshes ---
def embed(mesh, value=0.0):
    """Return a mesh with one dimension more of its points, with the coordinate value
    on the new axis, e.g. a line in the plane y = value (ADR 0019)."""
    points = np.pad(mesh.points, ((0, 0), (0, 1)), constant_values=value)
    return fem.Mesh(points, mesh.cells, mesh.cell_type)


# --- embedded in generated scripts with the cell tags of made meshes ---
def tags_of(mesh, *inputs):
    """Return the cell tags of a mesh made by a tool of meshes with cell tags (#438):
    the tags of the inputs, concatenated like the cells of a stack, repeated per layer
    of the cells of the mesh, e.g. of an expand or a revolve. A tool that moves the
    points keeps the cells, and so their tags."""
    tags = np.concatenate([np.ravel(m.tags) for m in inputs])
    if len(tags) == 0 or len(mesh.cells) % len(tags):
        raise ValueError(
            f"The {len(mesh.cells)} cells of the mesh are no layers of the "
            f"{len(tags)} cells of its inputs, whose tags it would take."
        )
    return np.tile(tags, len(mesh.cells) // len(tags))


# --- embedded in generated scripts with steps that switch boundaries ---
def pick(boundaries, names):
    """Return the boundaries of a step (#393): those of the names, and all boundaries
    of a load case or a symmetry plane of the names (named ``<name>/<key>``)."""
    return {k: v for k, v in boundaries.items() if k.split("/")[0] in names}


class BoundarySwitch(fem.Plugin):
    """The values of the boundaries that a step switches on (#393), those that the
    step evaluated before it does not have: the displacements of their points at the
    start of the step, or at the start of the job for the steps of ``job_start`` (of
    a boundary that was on then, its values then). A ramp of such a boundary in the
    step is relative to these values. A boundary that a step does not have is off:
    FElupe frees its degrees of freedom. One plugin for all jobs, which continue one
    after another."""

    def __init__(self, job_start=()):
        self.job_start = list(job_start)
        # the names of the boundaries of the step evaluated last (None before)
        self.last = None
        # the values of the boundaries of the job at its start
        self.start = {}
        # the boundaries that the step switches on, with their values
        self.switched = {}

    @staticmethod
    def prescribed(boundary, value):
        """The values of the prescribed degrees of freedom of a boundary for its
        value: one value for all, or one per prescribed component of its points."""
        value = np.asarray(value, dtype=float)
        if value.ndim == 0:
            return np.full(boundary.dof.size, float(value))
        if value.size == boundary.dof.size:
            return value.ravel()
        return np.tile(value.ravel(), boundary.points.size)

    @staticmethod
    def displacements(boundary):
        """The displacements of the prescribed degrees of freedom of a boundary."""
        return boundary.field.values.ravel()[boundary.dof].copy()

    def before_job(self, context, state):
        self.start = {}
        for step in context.job.steps:
            for name, boundary in step.boundaries.items():
                if self.last is None or name in self.last:
                    self.start[name] = self.prescribed(boundary, boundary.value)
                else:
                    self.start[name] = self.displacements(boundary)

    def before_step(self, context, state):
        step, self.switched = context.step, {}
        for name, boundary in step.boundaries.items():
            if self.last is None or name in self.last:
                continue
            if any(step is s for s in self.job_start):
                values = self.start[name]
            else:
                values = self.displacements(boundary)
            boundary.update(values)
            self.switched[boundary] = values
        self.last = set(step.boundaries)

    def before_substep(self, context, state):
        # the ramp of a boundary switched on by the step, from its values
        for boundary, values in self.switched.items():
            if boundary in state.values:
                ramped = self.prescribed(boundary, state.values[boundary])
                state.values[boundary] = values + ramped


# --- embedded in generated scripts with Cartesian constraints ---
def base_vectors(e1, e2=None):
    """Return the rotation matrix of a Cartesian constraint (#421): its normalized base
    vectors as columns, e1, e2 and e3 = e1 x e2. Of a 2D model (e1 of two
    components), e2 is e1 turned by 90° about z."""
    e1 = np.asarray(e1, dtype=float)
    if e2 is None:
        e1 = e1 / np.linalg.norm(e1)
        return np.array([[e1[0], -e1[1]], [e1[1], e1[0]]])
    vectors = np.column_stack([e1, e2, np.cross(e1, e2)])
    return vectors / np.linalg.norm(vectors, axis=0)


# --- embedded in generated scripts with the curve of a cylindrical constraint ---
class CylindricalCurvePlugin(fem.CharacteristicCurvePlugin):
    """Record the curve of a cylindrical constraint (#422) in its directions r, theta
    and z (of a 2D model r and theta): the displacement of its first point, around the
    axis the arc length on its undeformed radius, and the sum of the forces of the
    items at its points, each in the directions of its deformed position. Of points
    on one radius R, the moment about the axis is R times the force around it."""

    def after_substep(self, context, state):
        constraint, field = self.boundary, context.substep.x
        points, dim = constraint.points, field[0].dim

        def padded(values):
            return np.pad(values, [(0, 0), (0, 3 - dim)])

        forces = sum(item.results.force for item in self.items).toarray().ravel()
        forces = padded(np.split(forces, field.offsets)[0].reshape(-1, dim)[points])
        dX = padded(constraint.mesh.points[points]) - constraint.center
        dx = dX + padded(field[0].values[points])
        axis = constraint.axis
        radial = dx - np.outer(dx @ axis, axis)
        rho = np.linalg.norm(radial, axis=1, keepdims=True)
        e_r = np.divide(radial, rho, out=np.zeros_like(radial), where=rho > 0)
        force = [np.sum(forces * e) for e in (e_r, np.cross(axis, e_r), axis)]
        # the first point: its angle about the axis, continued over the substeps
        e_r0, e_t0, _ = constraint.basis[0].T
        radius = constraint.radius[0]
        angle = np.arctan2(dx[0] @ e_t0, dx[0] @ e_r0)
        if self.x and radius > 0:
            before = self.x[-1][1] / radius
            angle += 2 * np.pi * np.round((before - angle) / (2 * np.pi))
        u = [rho[0, 0] - radius, radius * angle, (dx[0] - dX[0]) @ axis]
        self.x.append(np.array(u[:dim]))
        self.y.append(np.array(force[:dim]))
        self.res = context.substep


class CylindricalCurve(fem.CharacteristicCurve):
    """A characteristic curve of a cylindrical constraint (#422): ``x``, ``y`` and
    ``plot()`` in its directions r, theta and z, see ``CylindricalCurvePlugin``."""

    def __init__(self, steps, boundary, items, *, plugins=None):
        self.cylindrical = CylindricalCurvePlugin(boundary=boundary, items=items)
        plugins = [*(plugins or []), self.cylindrical]
        super().__init__(steps, boundary, items, plugins=plugins)
        self.plot = self.cylindrical.plot

    x = property(lambda self: self.cylindrical.x)
    y = property(lambda self: self.cylindrical.y)
