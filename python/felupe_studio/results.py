"""Results of the jobs of the last run for the viewer of the app.

The runner records the values of all fields of the top-level field container after
every converged substep of a job (:class:`Recorder`). :func:`scene` restores the
fields of a substep (in-place: the fields of the sections share their values with the
top-level field container, see :func:`felupe.field.merge`) and returns the outer
surface of every section with the displacements of its points and the values of a
quantity, like :class:`felupe.ViewSolid` and the plotting backend ``"webgl"`` of
FElupe: the displacements at the points, the principal values of the logarithmic
strain and of the Cauchy stress (and its von Mises equivalent) as the means of the
quadrature points of every cell, or at the points (#231, see :data:`METHODS`).

The surfaces are triangulated once per section (``triangulate_surface`` of FElupe,
subdivided for quadratic cells) and returned as little-endian bytes, like
:func:`felupe_studio.scene.surface`. :func:`ranges` gives the range of a quantity
of every substep of a job. Both give the ranges also per section, so the app takes
the range of a contour from chosen sections (#377). :func:`export` writes the
results of a job as a VTU file of a substep or as an XDMF time series of all
substeps.

The scenes and the ranges take the meshes and the data of a source: the last run,
or a file of results exported before (#414, :mod:`felupe_studio.resultfile`), which
:func:`show` shows instead of the results of the last run.
"""

import json
import os
import tempfile
import xml.etree.ElementTree as ET

import felupe as fem
import numpy as np
from felupe.math import eigvalsh, equivalent_von_mises
from felupe.view._surface import polynomial_order, triangulate_surface

from . import cuts
from .scene import surface_nodes

# the quantities by key: the kind of data, the component (None for the magnitude of
# vectors) and the label of the scalar bar
QUANTITIES = {
    "displacement": ("displacement", None, "Displacement magnitude"),
    "displacement_x": ("displacement", 0, "Displacement x"),
    "displacement_y": ("displacement", 1, "Displacement y"),
    "displacement_z": ("displacement", 2, "Displacement z"),
    "strain_max": ("strain", 0, "Max. principal logarithmic strain"),
    "strain_mid": ("strain", 1, "Mid. principal logarithmic strain"),
    "strain_min": ("strain", 2, "Min. principal logarithmic strain"),
    "stress_max": ("stress", 0, "Max. principal Cauchy stress"),
    "stress_mid": ("stress", 1, "Mid. principal Cauchy stress"),
    "stress_min": ("stress", 2, "Min. principal Cauchy stress"),
    "stress_mises": ("mises", 0, "Von Mises equivalent Cauchy stress"),
    "plastic_strain": ("plastic", 0, "Equivalent plastic strain"),
    "mullins_energy": ("mullins", 0, "Max. strain energy density"),
}

# the state variables as quantities, the first one of a material: the equivalent
# plastic strain of an elastic-plastic material (#191) and the maximum strain energy
# density of the load history of the Mullins effect (#346)
STATE_VARIABLES = ("plastic", "mullins")

# the methods of the values of the strains and the stresses (#231): the means of the
# quadrature points of every cell, or at the points: the means of the cells averaged
# at the points, an L2 projection (fem.project) or the values of the quadrature
# points shifted to the points (fem.topoints, of cells whose quadrature points are at
# their points, e.g. linear hexahedrons)
METHODS = ("cells", "mean", "project", "topoints")

# corner points of cell types of regions which are not drawn by their points, e.g.
# the bubble point of the MINI element
CORNERS = {"tetra5": ("tetra", 4), "triangle4": ("triangle", 3)}


def _linear(linear, element):
    """Return the shape functions of a linear cell at the points of a cell."""
    return np.array([linear.function(point) for point in element.points])


# the linear cells (their type, number of points and region) of quadratic triangles
# and tetrahedrons and of the MINI elements, whose values are moved to the corner
# points (#231): their quadrature points are too few for an L2 projection with the
# quadratic shape functions. The other points of quadratic cells get the values of
# the linear shape functions (at their points).
LINEAR = {
    "tetra10": (
        "tetra",
        4,
        fem.RegionTetra,
        _linear(fem.Tetra(), fem.QuadraticTetra()),
    ),
    "triangle6": (
        "triangle",
        3,
        fem.RegionTriangle,
        _linear(fem.Triangle(), fem.QuadraticTriangle()),
    ),
    "tetra5": ("tetra", 4, fem.RegionTetra, None),
    "triangle4": ("triangle", 3, fem.RegionTriangle, None),
}

_state = {"namespace": None, "sections": [], "records": {}, "surfaces": {}}


def reset(namespace, sections, points=(), units=None, mullins=()):
    """Start the results of a run: the namespace of its script, the names of the
    sections and the names of the control points, the units of the model (the
    ``units`` of its settings, #132) for the headers of the exports and the names of
    the sections whose material has the Mullins effect (#346)."""
    _state.update(
        source=_RUN,
        namespace=namespace,
        sections=list(sections),
        points=list(points),
        units=units,
        mullins=set(mullins),
        records={},
        statevars={},
        controls={},
        ranges={},
        regions={},
        cuts={},
    )
    _state["surfaces"] = {}


def show(source):
    """Show the results of another source instead of those of the last run, e.g. of
    a file (#414, :class:`felupe_studio.resultfile.ResultFile`): its sections, without
    control points. It has the methods of the results of a run that the scenes and
    the ranges take, see :class:`_Run`."""
    reset(None, source.sections)
    _state["source"] = source


def _source():
    """Return the source of the results: the last run, or a file (#414)."""
    return _state.get("source", _RUN)


class Recorder(fem.Plugin):
    """A plugin that records the values of all fields after every substep, the state
    variables of the materials with a load history, e.g. the plastic strains (#191)
    or the maximum strain energy density of the Mullins effect (#346), and the
    displacements and forces of the control points (#101)."""

    def __init__(self, job, field):
        self.job = job
        self.field = field
        _state["records"][job] = []
        _state.setdefault("statevars", {})[job] = []
        _state.setdefault("controls", {})[job] = []

    def after_substep(self, context, state):
        values = [f.values.copy() for f in self.field.fields]
        _state["records"][self.job].append(values)
        namespace = _state["namespace"]
        solids = [s for s in _state["sections"] if _history(s)]
        _state["statevars"][self.job].append(
            {s: namespace[f"solid_{s}"].results.statevars.copy() for s in solids}
        )
        _state["controls"][self.job].append(_control_values(self.field))


def _history(section):
    """True if the material of a section has a load history: state variables of its
    own, e.g. the plastic strains of an elastic-plastic material (#191, see
    :func:`_plastic`) or the maximum strain energy density of the Mullins effect
    (#346), also in a ``fem.CompositeMaterial`` with a ``fem.Volumetric`` or in a
    nearly incompressible solid body. The stress of a restored substep needs them."""
    solid = _state["namespace"][f"solid_{section}"]
    if isinstance(getattr(solid, "umat", None), fem.MaterialStrain):
        return _plastic(section)
    statevars = solid.results.statevars
    return statevars is not None and len(statevars) > 0


def _plastic(section):
    """True if the material of a section has state variables of its own (#191), e.g.
    the equivalent plastic strain (the first one) and the plastic strain tensor of
    ``fem.linear_elastic_plastic_isotropic_hardening``. ``fem.MaterialStrain`` adds
    the strain and the stress of the last substep, which a linear-elastic material
    does not need to evaluate the stress of a restored substep."""
    solid = _state["namespace"][f"solid_{section}"]
    umat = getattr(solid, "umat", None)
    return isinstance(umat, fem.MaterialStrain) and umat.nstatevars > 0


def _mullins(section):
    """True if the material of a section has the Mullins effect (#346): its first
    state variable is the maximum strain energy density of the load history, also in
    a ``fem.CompositeMaterial`` with a ``fem.Volumetric`` after it or in a nearly
    incompressible solid body."""
    return section in _state.get("mullins", ())


def _has(kind, section):
    """True if the material of a section has a state variable as a quantity."""
    return _plastic(section) if kind == "plastic" else _mullins(section)


# the items of the steps whose forces act on the control points: the multi-point
# constraints and the contacts with rigid surfaces (#220)
CONSTRAINTS = (
    fem.MultiPointConstraint,
    fem.ContactRigidPlane,
    fem.ContactRigidCylinder,
)


def _constraints():
    """Return the multi-point constraints and the contacts of the namespace of the
    run."""
    namespace = _state["namespace"]
    return [v for v in namespace.values() if isinstance(v, CONSTRAINTS)]


def _control_values(field):
    """Return the displacement and the force of every control point: the force of
    the constraints at the point after a converged substep (the reaction force of a
    boundary, or the force of a load at the point); of a rotation point, the
    rotation and the moment."""
    namespace = _state["namespace"]
    names = _state.get("points", [])
    if not names:
        return []
    dim = field[0].dim
    forces = np.zeros((len(field[0].values), dim))
    for constraint in _constraints():
        vector = constraint.results.force
        if vector is None:
            continue
        vector = vector.toarray().ravel() if hasattr(vector, "toarray") else vector
        first = np.split(np.asarray(vector).ravel(), field.offsets)[0]
        forces += first.reshape(-1, dim)
    rotations = _rotation_points() if dim == 2 else set()
    result = []
    for name in names:
        index = np.flatnonzero(namespace[name])[0]
        displacement, force = field[0].values[index], forces[index]
        result.append(
            {
                "displacement": _in_3d(displacement, name in rotations).tolist(),
                "force": _in_3d(force, name in rotations).tolist(),
            }
        )
    return result


def _in_3d(vector, rotation=False):
    """Return a vector of a point of a 2D model (#175) with three components: z is 0,
    and of a rotation point the first component is the rotation (or the moment)
    about z."""
    vector = np.asarray(vector, dtype=float)
    if len(vector) == 3:
        return vector
    return np.array([0, 0, vector[0]]) if rotation else np.append(vector, 0)


def _rotation_points():
    """Return the names of the control points that are rotation points."""
    namespace = _state["namespace"]
    indices = {
        c.rotationpoint
        for c in _constraints()
        if getattr(c, "rotationpoint", None) is not None
    }
    return {
        name
        for name in _state.get("points", [])
        if np.flatnonzero(namespace[name])[0] in indices
    }


def substeps(job):
    """Return the number of recorded substeps of a job."""
    return len(_state["records"].get(job, []))


def _cells(section):
    """Return the cell type and the cells of a section, without the bubble points of
    the MINI element. The cells refer to the merged points."""
    mesh = _state["namespace"][f"field_{section}"][0].region.mesh
    cell_type, corners = CORNERS.get(mesh.cell_type, (mesh.cell_type, None))
    return cell_type, mesh.cells[:, :corners] if corners else mesh.cells


def _surface(section):
    """Return the triangulated surface of the cells of a section (cached), with the
    mesh of the cells to draw (all points, the cells without the bubble points of
    the MINI element) and its polynomial order."""
    if section not in _state["surfaces"]:
        mesh = fem.Mesh(*_source().mesh(section))
        order = polynomial_order(mesh)
        surface = triangulate_surface(mesh, subdivisions=order)
        _state["surfaces"][section] = (surface, mesh, order)
    return _state["surfaces"][section]


def _drawn(section, plane=None):
    """Return the surface of a section to draw: its outer surface, or clipped at the
    plane of a cut with its cut face (#395). The geometry of a cut is kept per section
    until the next cut or run, so a new substep needs only the interpolation."""
    surface, mesh, order = _surface(section)
    if plane is None:
        return surface
    cached = _state.setdefault("cuts", {}).get(section)
    if cached is None or cached[0] != plane:
        result = cuts.cut(
            surface, mesh.points, mesh.cells, mesh.cell_type, plane, order
        )
        _state["cuts"][section] = cached = (plane, result)
    return cached[1]


def _3d(array):
    """Return points or vectors with three components: those of a 2D model (#175)
    in the plane z = 0."""
    array = np.asarray(array)
    return np.pad(array, [(0, 0)] * (array.ndim - 1) + [(0, 3 - array.shape[-1])])


def _restore(job, substep):
    """Write the values of the fields of a substep of a job back into the fields,
    in-place (shared with the fields of the sections)."""
    records = _state["records"].get(job)
    if not records:
        raise KeyError(f"No results of the job '{job}'.")
    if not 1 <= substep <= len(records):
        raise IndexError(f"The job '{job}' has {len(records)} substeps.")
    field = _state["namespace"]["field"]
    for f, values in zip(field.fields, records[substep - 1], strict=True):
        f.values[:] = values
    # the state variables of the substep (#191, #346): with them, the stress of an
    # elastic-plastic material or of the Mullins effect is the one of the substep (no
    # strain increment, the same maximum strain energy density)
    statevars = _state.get("statevars", {}).get(job, [])
    if len(statevars) >= substep:
        for section, values in statevars[substep - 1].items():
            solid = _state["namespace"][f"solid_{section}"]
            solid.results.statevars = values.copy()


def _cauchy_stress(solid, field):
    """Return the Cauchy stress of a solid body at the current values of its field. A
    nearly incompressible solid body (``fem.SolidBodyNearlyIncompressible``, #226)
    keeps the pressure and the volume ratio of its cells as a state, which an
    evaluation updates by a linearization at the previous one, e.g. of another
    substep. The first evaluation takes over the deformation, the second one has the
    exact volume ratio of the cells."""
    if isinstance(solid, fem.SolidBodyNearlyIncompressible):
        solid.evaluate.cauchy_stress(field)
    return solid.evaluate.cauchy_stress(field)


def _point_region(section):
    """Return the region to move the values of the quadrature points of a section to
    its points (cached, #231) and the shape functions of its linear cells at the
    points of its cells (or None).

    The region is the one of the displacement field, or of its linear cells for
    quadratic triangles and tetrahedrons and for the MINI elements (with the same
    quadrature points)."""
    regions = _state.setdefault("regions", {})
    if section not in regions:
        region = _state["namespace"][f"field_{section}"][0].region
        mesh = region.mesh
        functions = None
        if mesh.cell_type in LINEAR:
            cell_type, corners, Region, functions = LINEAR[mesh.cell_type]
            linear = fem.Mesh(mesh.points, mesh.cells[:, :corners], cell_type)
            region = Region(linear, quadrature=region.quadrature)
        regions[section] = region, functions
    return regions[section]


def _solve(matrix, rhs):
    """Solve the system of an L2 projection (#231) by the conjugate gradient method
    with a Jacobi preconditioner, one column of the right-hand sides after the other:
    the matrix is a mass matrix (symmetric and positive definite), faster than with a
    sparse direct solver for large meshes."""
    from scipy.sparse import diags
    from scipy.sparse.linalg import cg, spsolve

    preconditioner = diags(1 / matrix.diagonal())
    x = np.empty(rhs.shape)
    for j, b in enumerate(rhs.T):
        x[:, j], info = cg(matrix, b, rtol=1e-10, atol=0.0, M=preconditioner)
        if info != 0:
            x[:, j] = spsolve(matrix.tocsc(), b)
    return x


def method_of(method):
    """Return the method of the values of the strains and the stresses of the
    sections (#231): ``"project"`` instead of ``"topoints"`` if the quadrature points
    of the cells of a section are not at their points."""
    if method not in METHODS:
        raise ValueError(f"Unknown method '{method}', expected one of {METHODS}.")
    if method == "topoints" and not shift():
        return "project"
    return method


def shift():
    """Return whether the values of the quadrature points of all sections can be
    shifted to their points (``fem.topoints``, #231): their quadrature points are at
    their points (Gauss-Legendre, as many quadrature points as points)."""
    namespace = _state["namespace"]
    for section in _state["sections"]:
        region = namespace[f"field_{section}"][0].region
        quadrature = region.quadrature
        if not isinstance(quadrature, fem.GaussLegendre):
            return False
        if quadrature.npoints != region.mesh.cells.shape[1]:
            return False
    return True


def _quadrature_data(kind, section):
    """Return the strains, the stresses or a state variable of a section of the
    current values of the fields at the quadrature points: the components (the
    principal values, or the von Mises equivalent), the quadrature points and the
    cells as axes."""
    namespace = _state["namespace"]
    field = namespace[f"field_{section}"]
    if kind == "strain":
        return field.evaluate.strain(tensor=False)
    if kind in STATE_VARIABLES:
        # the first state variable of the material: the equivalent plastic strain
        # (#191) or the maximum strain energy density of the Mullins effect (#346),
        # zero in sections of other materials
        if _has(kind, section):
            return namespace[f"solid_{section}"].results.statevars[:1]
        region = field[0].region
        return np.zeros((1, region.quadrature.npoints, region.mesh.ncells))
    return _invariants(kind, _quadrature_tensor(kind, section))


def _quadrature_tensor(kind, section):
    """Return the logarithmic strain or the Cauchy stress tensor of a section at the
    quadrature points of the current values of the fields."""
    namespace = _state["namespace"]
    field = namespace[f"field_{section}"]
    if kind == "strain":
        return field.evaluate.strain(tensor=True)
    return _cauchy_stress(namespace[f"solid_{section}"], field)


def _invariants(kind, tensor):
    """Return the von Mises equivalent or the principal values of tensors (with the
    two axes of a tensor first)."""
    if kind == "mises":
        return equivalent_von_mises(tensor)[None]
    return eigvalsh(tensor)


# the upper triangle of a symmetric tensor, its six independent components
UPPER = np.triu_indices(3)


def _point_data(kind, section, method):
    """Return the strains, the stresses or a state variable of a section at its
    points (#231): the tensors are moved to the points, then their invariants
    are evaluated there (#274), so the von Mises stress is never negative and the
    principal values are those of the tensor at a point. The invariants of the
    quadrature points would overshoot and undershoot by a projection, e.g. a negative
    von Mises stress next to a soft region. A state variable, the equivalent plastic
    strain or the maximum strain energy density, is moved itself and clipped at
    zero."""
    if kind in STATE_VARIABLES:
        return np.maximum(_reduce(_quadrature_data(kind, section), section, method), 0)
    tensor = _quadrature_tensor(kind, section)
    data = _at(tensor[UPPER], section, method)
    tensors = np.empty((3, 3, len(data)))
    tensors[UPPER] = tensors[UPPER[::-1]] = data.T
    return -np.sort(-_invariants(kind, tensors).T, axis=1)


def _reduce(values, section, method):
    """Return the values of the quadrature points of a section at its cells (their
    means) or at its points (#231), with a component per column, the principal values
    from the largest to the smallest one."""
    return -np.sort(-_at(values, section, method), axis=1)


def _at(values, section, method):
    """Return the values of the quadrature points of a section at its cells (their
    means) or at its points (#231), with a component per column."""
    if method == "cells":
        data = values.mean(-2).T
    else:
        region, functions = _point_region(section)
        if method == "project":
            data = fem.project(values, region, solver=_solve)
        else:
            # (the points without cells of the region divide by zero, unused)
            with np.errstate(divide="ignore", invalid="ignore"):
                data = fem.topoints(values, region, mean=method == "mean")
        data = data.reshape(len(data), -1)
        if functions is not None:
            # the points of quadratic cells: interpolated linearly between corners
            cells = region.mesh.cells
            full = _state["namespace"][f"field_{section}"][0].region.mesh.cells
            data[full] = np.einsum("ij,cjk->cik", functions, data[cells])
    return data


def _data(kind, section, method="cells"):
    """Return the data of a section of the current values of the fields: at the
    points (displacements, or strains and stresses of a point method, #231) or at the
    cells (the means of the quadrature points)."""
    if kind == "displacement":
        return _state["namespace"][f"field_{section}"][0].values
    if method != "cells":
        return _point_data(kind, section, method)
    return _reduce(_quadrature_data(kind, section), section, method)


def _values(section, kind, component, method="cells", surfaces=None):
    """Return the data of a quantity of a section of the current values of the
    fields (at the points of the cells or at the cells), and its values and the
    displacements at the points of surfaces: by default of the outer surface, e.g.
    also of a cut (#395)."""
    surface, mesh, _ = _surface(section)
    surfaces = surfaces or [surface]
    u = _3d(_source().displacement(section))
    displacements = [s.interpolate(u) for s in surfaces]
    if kind == "displacement":
        # the values at the points of the cells (not of bubbles) and the surface
        used = u[np.unique(mesh.cells)]
        if component is None:
            return np.linalg.norm(used, axis=1), [
                (np.linalg.norm(d, axis=1), d) for d in displacements
            ]
        return used[:, component], [(d[:, component], d) for d in displacements]
    data = _source().data(kind, section, method)[:, component]
    if method == "cells":
        return data, [
            (data[s.owners], d) for s, d in zip(surfaces, displacements, strict=True)
        ]
    return data[np.unique(mesh.cells)], [
        (s.interpolate(data), d) for s, d in zip(surfaces, displacements, strict=True)
    ]


def _extend(bounds, *arrays):
    """Return the bounds (low, high) extended by the finite values of arrays."""
    low, high = bounds
    finite = np.concatenate([np.ravel(a) for a in arrays])
    finite = finite[np.isfinite(finite)]
    if finite.size:
        low, high = min(low, finite.min()), max(high, finite.max())
    return low, high


def _range(bounds):
    """The bounds as ``[low, high]``, or ``None`` without finite values."""
    low, high = bounds
    return [float(low), float(high)] if low <= high else None


def _union(ranges):
    """The range of ranges (``None`` without any)."""
    ranges = [r for r in ranges if r is not None]
    if not ranges:
        return None
    return [min(r[0] for r in ranges), max(r[1] for r in ranges)]


def ranges(job, quantity, method="cells"):
    """Return the ranges of a quantity of all substeps of a job, for a range of the
    contour over all substeps (#139), with the values of the strains and the
    stresses of a method of :data:`METHODS` (#231). The ranges are kept until the
    next run.

    Returns
    -------
    str
        The JSON text of the ``range`` of all sections, a list of ``[low, high]``
        per substep (``null`` without finite values) like the ``range`` of
        :func:`scene`, and of the ranges of every section (``sections``, by name),
        lists like it, for the range of chosen sections (#377).
    """
    kind, component, _ = QUANTITIES[quantity]
    source = _source()
    method = source.method(method) if kind != "displacement" else "cells"
    key = (job, quantity, method)
    cache = _state.setdefault("ranges", {})
    if key not in cache:
        count = source.substeps(job)
        sections = {section: [] for section in _state["sections"]}
        for substep in range(1, count + 1):
            source.restore(job, substep)
            for section, result in sections.items():
                data, [(values, _)] = _values(section, kind, component, method)
                result.append(_range(_extend((np.inf, -np.inf), data, values)))
        # all sections: the union of the sections of every substep
        cache[key] = {
            "range": [_union(r[i] for r in sections.values()) for i in range(count)],
            "sections": sections,
        }
    return json.dumps(cache[key])


def _bytes(array, dtype):
    return np.ascontiguousarray(array, dtype=dtype).tobytes()


def scene(job, substep, quantity, method="cells", cut=None):
    """Return the result of a substep of a job for the viewer.

    Parameters
    ----------
    job : str
        The name of the job.
    substep : int
        The substep, counted from 1 over all steps of the job.
    quantity : str
        A key of :data:`QUANTITIES`.
    method : str, optional
        The method of the values of the strains and the stresses, one of
        :data:`METHODS` (#231): ``"cells"`` (the means of the quadrature points of
        every cell, the default) or at the points: ``"mean"`` (the means of the cells
        averaged at the points), ``"project"`` (an L2 projection, ``fem.project``)
        or ``"topoints"`` (the values of the quadrature points shifted to the points,
        ``fem.topoints``; projected instead if the quadrature points of the cells of
        a section are not at their points, see :func:`method_of`). The values at the
        points are per section, discontinuous between sections.
    cut : dict or None, optional
        The ``axis``, the coordinate ``value`` and the hidden ``half`` of a cut of
        the view (default is None, see :func:`felupe_studio.cuts.plane`, #395): the
        surfaces are clipped at the plane through the undeformed model and closed by
        their cut faces, with the values inside. The ranges and the extremes stay
        those of the sections.

    Returns
    -------
    tuple of str and list of dict
        The JSON text of the label, of where the values are given (``"point"`` or
        ``"cell"``), of the ``method`` of the values of strains and stresses (see
        :func:`method_of`, not of displacements), of whether their values can be
        shifted to the points (``shift``, see :func:`shift`), of their ``range``
        over all cells of all sections (``None`` without finite values), of the
        ``extremes`` (``min`` and ``max`` with their ``value``, ``section``, ``at``,
        ``index`` of the node or the cell, whether it is at the ``surface``, its
        ``position`` and ``displacement``; ``None`` without finite values), of the
        ``range`` and the ``extremes`` of every section (``sections``, by name, for
        the range of chosen sections, #377), of the control ``points``
        (``name``, ``position`` and ``displacement``) and of the ``cut`` (if any),
        and the surface of every section: its ``name``, ``positions`` (three
        coordinates per point of the surface), ``displacement`` (three components
        per point), ``triangles``, ``faces`` (to shade the faces of linear cells
        flat; ``None`` for curved faces), ``edges``, ``values``, ``owners`` (the
        cell of the section of every triangle) and ``nodes`` (the point of the mesh
        of every point of the surface, -1 inside a subdivided face and on the cut
        face) as bytes. With a cut, a surface has the number of the
        triangles of the clipped outer surface (``outer``, those of the cut face
        follow) and the ``positions`` and the ``displacement`` of the nodes of the
        whole outer surface (``uncut``, as bytes).
    """
    _source().restore(job, substep)
    return current_scene(job, substep, quantity, method, cut)


def current_scene(job, substep, quantity, method="cells", cut=None):
    """Return the result of the current fields for the viewer, like :func:`scene`
    without restoring a substep: e.g. the live results of a running job after a
    converged substep (#207), whose fields are current."""
    source = _source()
    kind, component, label = QUANTITIES[quantity]
    method = source.method(method)
    at = "point" if kind == "displacement" or method != "cells" else "cell"
    surfaces = []
    # the ranges and the extremes of every section (#377)
    sections = {}
    plane = cuts.plane(cut)
    for section in _state["sections"]:
        surface, mesh, order = _surface(section)
        # the range of the outer surface, also of a cut (#395)
        drawn = _drawn(section, plane)
        shown = [surface] if drawn is surface else [surface, drawn]
        data, on = _values(section, kind, component, method, shown)
        sections[section] = {
            "range": _range(_extend((np.inf, -np.inf), data, on[0][0])),
            "extremes": _extremes(section, at, data) or None,
        }
        values, displacement = on[-1]
        result = {
            "name": section,
            "positions": _bytes(_3d(drawn.interpolate(mesh.points)), "<f4"),
            "displacement": _bytes(displacement, "<f4"),
            "triangles": _bytes(drawn.triangles, "<u4"),
            "faces": _bytes(drawn.faces, "<u4") if order == 1 else None,
            "edges": _bytes(drawn.edges, "<u4"),
            "values": _bytes(values, "<f4"),
            "owners": _bytes(drawn.owners, "<u4"),
            "nodes": _bytes(surface_nodes(drawn), "<i4"),
        }
        if drawn is not surface:
            # the triangles of the clipped outer surface, then the cut face, and the
            # nodes of the whole outer surface, e.g. for the point sets of the
            # constraints and the rigid surfaces of the view (#395)
            nodes = surface_nodes(surface) >= 0
            result["outer"] = drawn.outer
            result["uncut"] = {
                "positions": _bytes(
                    _3d(surface.interpolate(mesh.points))[nodes], "<f4"
                ),
                "displacement": _bytes(on[0][1][nodes], "<f4"),
            }
        surfaces.append(result)

    meta = {
        "label": label,
        "at": at,
        **({"method": method} if kind != "displacement" else {}),
        "shift": source.shift(),
        "range": _union(s["range"] for s in sections.values()),
        "extremes": _combined_extremes(sections.values()),
        "sections": sections,
        "points": source.control_points(job, substep),
        # the cut of the scene (#395), e.g. for the markers of the view
        **({"cut": cut} if plane is not None else {}),
    }
    return json.dumps(meta), surfaces


def _combined_extremes(sections):
    """Return the minimum and the maximum of the extremes of sections (``None``
    without any): of the first section with the smallest or the largest value."""
    extremes = {}
    for section in sections:
        for name, candidate in (section["extremes"] or {}).items():
            sign = -1 if name == "min" else 1
            if name not in extremes or (
                sign * candidate["value"] > sign * extremes[name]["value"]
            ):
                extremes[name] = candidate
    return extremes or None


def _extremes(section, at, data):
    """Return the minimum and the maximum of the finite data of a section (#140):
    the value, the section, the node (in the merged points) or the cell (of the
    section), whether it is at the surface, its position (of a cell: the center of
    its points) and its displacement."""
    finite = np.flatnonzero(np.isfinite(data))
    if not finite.size:
        return {}
    surface, mesh, _ = _surface(section)
    u = _3d(_source().displacement(section))
    nodes = np.unique(mesh.cells)
    # the nodes and the cells at the surface (the view marks an extreme inside)
    outer = surface_nodes(surface) if at == "point" else surface.owners
    result = {}
    for name, pick in (("min", np.argmin), ("max", np.argmax)):
        i = finite[pick(data[finite])]
        index = int(nodes[i] if at == "point" else i)
        points = [nodes[i]] if at == "point" else mesh.cells[i]
        position = _3d(mesh.points[points]).mean(axis=0)
        displacement = u[points].mean(axis=0)
        result[name] = {
            "value": float(data[i]),
            "section": section,
            "at": at,
            "index": index,
            "surface": bool(np.isin(index, outer)),
            "position": np.asarray(position).tolist(),
            "displacement": np.asarray(displacement).tolist(),
        }
    return result


def _control_points(job, substep):
    """Return the control points with their positions, and their displacements and
    forces of a substep (of a rotation point: rotations and moments)."""
    namespace = _state["namespace"]
    points = namespace["field"].mesh_container.points
    values = _state.get("controls", {}).get(job, [])
    values = values[substep - 1] if 1 <= substep <= len(values) else []
    rotations = _rotation_points()
    result = []
    for name, value in zip(_state.get("points", []), values, strict=False):
        index = np.flatnonzero(namespace[name])[0]
        result.append(
            {
                "name": name,
                "position": _in_3d(points[index]).tolist(),
                **value,
                **({"rotation": True} if name in rotations else {}),
            }
        )
    return result


def control_csv(job):
    """Return the displacements and forces of the control points of all substeps of
    a job as CSV text (of a rotation point: the rotations and the moments)."""
    if not _state["records"].get(job):
        raise KeyError(f"No results of the job '{job}'.")
    rotations = _rotation_points()
    units = _state.get("units")
    length, force = (units["length"], units["force"]) if units else (None, None)
    header = ["substep"]
    for name in _state.get("points", []):
        if name in rotations:
            quantities = [("phi", "rad"), ("M", units and f"{force} {length}")]
        else:
            quantities = [("u", length), ("F", force)]
        header += [
            f"{name}.{q}_{a}" + (f" [{unit}]" if unit else "")
            for q, unit in quantities
            for a in "xyz"
        ]
    rows = [",".join(header)]
    for substep, values in enumerate(_state["controls"][job], start=1):
        row = [str(substep)]
        for value in values:
            row += [repr(float(x)) for x in value["displacement"] + value["force"]]
        rows.append(",".join(row))
    return "\n".join(rows) + "\n"


# the cell data of the exports (like the names of felupe.ViewSolid) by kind
EXPORTED = {
    "Principal Values of Logarithmic Strain": "strain",
    "Principal Values of Cauchy Stress": "stress",
    "Equivalent of Cauchy Stress": "mises",
}

# the state variables of the exports by kind, of a model with a material that has
# them: the equivalent plastic strain (#191) and the maximum strain energy density of
# the Mullins effect (#346)
EXPORTED_STATE = {
    "Equivalent Plastic Strain": "plastic",
    "Maximum Strain Energy Density": "mullins",
}

# the name of the information of an XDMF export (#414): the names of the sections and
# the units of the model, for an import of the file
INFORMATION = "felupe-studio"


def _export_mesh():
    """Return the points used by the cells of all sections, the cell blocks (one per
    section, with the indices of the used points) and the used points."""
    blocks = [_cells(section) for section in _state["sections"]]
    points = _state["namespace"]["field"].region.mesh.points
    used = np.unique(np.concatenate([cells.ravel() for _, cells in blocks]))
    index = np.full(len(points), -1)
    index[used] = np.arange(len(used))
    # the points of 2D models in the plane z = 0, like the viewer (#175)
    return _3d(points[used]), [(t, index[cells]) for t, cells in blocks], used


def _export_data(used, method="cells"):
    """Return the point data and the cell data of the current values of the fields.
    A point method of the strains and the stresses (#231) adds them as point data,
    the means of the sections at their common points."""
    field = _state["namespace"]["field"]
    point_data = {"Displacement": _3d(field[0].values[used])}
    exported = dict(EXPORTED)
    for name, kind in EXPORTED_STATE.items():
        if any(_has(kind, section) for section in _state["sections"]):
            exported[name] = kind
    cell_data = {name: [] for name in exported}
    sums = {name: 0.0 for name in exported}
    count = np.zeros(len(field[0].values))
    for section in _state["sections"]:
        nodes = np.unique(_cells(section)[1])
        count[nodes] += 1
        for name, kind in exported.items():
            values = _quadrature_data(kind, section)
            cell_data[name].append(_reduce(values, section, "cells"))
            if method != "cells":
                data = np.zeros((len(count), len(values)))
                data[nodes] = _point_data(kind, section, method)[nodes]
                sums[name] = sums[name] + data
    if method != "cells":
        for name in exported:
            point_data[name] = (sums[name] / count[:, None])[used]
    cell_data["Section"] = [
        np.full(len(_cells(section)[1]), i)
        for i, section in enumerate(_state["sections"])
    ]
    return point_data, cell_data


def export(job, file_format, substep=None, method="cells"):
    """Return the results of a job as the bytes of a file.

    Parameters
    ----------
    job : str
        The name of the job.
    file_format : str
        ``"vtu"`` for a substep (the last one by default), ``"xdmf"`` for all
        substeps of the job (a time series with the substeps as time, with the data
        inside the XML file, so that no HDF5 file is needed) or ``"csv"`` for the
        displacements and forces of the control points of all substeps.
    substep : int or None, optional
        The substep of a VTU file, counted from 1 over all steps of the job.
    method : str, optional
        The method of the values of the strains and the stresses (#231), see
        :func:`scene`: with a method at the points, they are point data too, the
        means of the sections at their common points.

    Notes
    -----
    The cells of every section are a block of cells with the merged points that
    the cells use (without the bubble points of the MINI element). The point data
    is the displacement, the cell data are the principal values of the logarithmic
    strain and of the Cauchy stress and the von Mises equivalent of the Cauchy
    stress (the means of the quadrature points of every cell, like
    :class:`felupe.ViewSolid`), the equivalent plastic strain of a model with
    plasticity (#191), the maximum strain energy density of a model with the Mullins
    effect (#346) and the index of the section. With a method at the points,
    the strains and the stresses are point data too. An XDMF file has the names of
    the sections and the units of the model as its ``Information``
    :data:`INFORMATION` (JSON), so that the app imports it (#414).
    """
    import meshio

    if file_format == "csv":
        return control_csv(job).encode("utf-8")
    if not _state["records"].get(job):
        raise KeyError(f"No results of the job '{job}'.")
    method = method_of(method)
    points, cells, used = _export_mesh()
    with tempfile.TemporaryDirectory() as folder:
        filename = os.path.join(folder, f"result.{file_format}")
        if file_format == "vtu":
            _restore(job, substep or substeps(job))
            point_data, cell_data = _export_data(used, method)
            meshio.Mesh(
                points, cells, point_data=point_data, cell_data=cell_data
            ).write(filename)
        elif file_format == "xdmf":
            with meshio.xdmf.TimeSeriesWriter(filename, data_format="XML") as writer:
                writer.write_points_cells(points, cells)
                for substep in range(1, substeps(job) + 1):
                    _restore(job, substep)
                    point_data, cell_data = _export_data(used, method)
                    writer.write_data(float(substep), point_data, cell_data)
                # the names of the sections and the units, for an import (#414)
                information = {"sections": _state["sections"], "units": _state["units"]}
                ET.SubElement(
                    writer.domain,
                    "Information",
                    Name=INFORMATION,
                    Value=json.dumps(information),
                )
        else:
            raise ValueError(f"Unknown file format '{file_format}'.")
        with open(filename, "rb") as file:
            return file.read()


class _Run:
    """The results of the last run as a source of the scenes and the ranges: the
    fields of the namespace of its script, restored per substep. The results of a
    file (#414, :class:`felupe_studio.resultfile.ResultFile`) have these methods
    too."""

    @staticmethod
    def mesh(section):
        """Return the points, the cells to draw and their cell type of a section."""
        points = _state["namespace"][f"field_{section}"][0].region.mesh.points
        cell_type, cells = _cells(section)
        return points, cells, cell_type

    @staticmethod
    def displacement(section):
        """Return the displacements of the points of a section."""
        return _state["namespace"][f"field_{section}"][0].values

    data = staticmethod(_data)
    restore = staticmethod(_restore)
    substeps = staticmethod(substeps)
    method = staticmethod(method_of)
    shift = staticmethod(shift)
    control_points = staticmethod(_control_points)


_RUN = _Run()
