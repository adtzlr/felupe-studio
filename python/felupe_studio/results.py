"""Results of the jobs of the last run for the viewer of the app.

The runner records the values of all fields of the top-level field container after
every converged substep of a job (:class:`Recorder`). :func:`scene` restores the
fields of a substep (in-place: the fields of the sections share their values with the
top-level field container, see :func:`felupe.field.merge`) and returns the outer
surface of every section with the displacements of its points and the values of a
quantity, like :class:`felupe.ViewSolid` and the plotting backend ``"webgl"`` of
FElupe: the displacements at the points, the principal values of the logarithmic
strain and of the Cauchy stress (and its von Mises equivalent) as the means of the
quadrature points of every cell.

The surfaces are triangulated once per section (``triangulate_surface`` of FElupe,
subdivided for quadratic cells) and returned as little-endian bytes, like
:func:`felupe_studio.scene.surface`.
"""

import json

import felupe as fem
import numpy as np
from felupe.math import eigvalsh, equivalent_von_mises
from felupe.view._surface import polynomial_order, triangulate_surface

# the quantities by key: the kind of data, the component (None for the magnitude of
# vectors) and the label of the scalar bar
QUANTITIES = {
    "displacement": ("displacement", None, "Displacement"),
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
}

# corner points of cell types of regions which are not drawn by their points, e.g.
# the bubble point of the MINI element
CORNERS = {"tetra5": ("tetra", 4)}

_state = {"namespace": None, "sections": [], "records": {}, "surfaces": {}}


def reset(namespace, sections):
    """Start the results of a run: the namespace of its script and the names of the
    sections."""
    _state.update(namespace=namespace, sections=list(sections), records={})
    _state["surfaces"] = {}


class Recorder(fem.Plugin):
    """A plugin that records the values of all fields after every substep."""

    def __init__(self, job, field):
        self.job = job
        self.field = field
        _state["records"][job] = []

    def after_substep(self, context, state):
        values = [f.values.copy() for f in self.field.fields]
        _state["records"][self.job].append(values)


def substeps(job):
    """Return the number of recorded substeps of a job."""
    return len(_state["records"].get(job, []))


def _surface(section):
    """Return the triangulated surface of the cells of a section (cached), with the
    cells and the points of its mesh."""
    if section not in _state["surfaces"]:
        field = _state["namespace"][f"field_{section}"]
        mesh = field[0].region.mesh
        cell_type, corners = CORNERS.get(mesh.cell_type, (mesh.cell_type, None))
        cells = mesh.cells[:, :corners] if corners else mesh.cells
        drawn = fem.Mesh(mesh.points, cells, cell_type)
        order = polynomial_order(drawn)
        surface = triangulate_surface(drawn, subdivisions=order)
        _state["surfaces"][section] = (surface, cells, order)
    return _state["surfaces"][section]


def _data(kind, section):
    """Return the data of a section of the current values of the fields: at the
    points (displacements) or at the cells (the means of the quadrature points)."""
    namespace = _state["namespace"]
    field = namespace[f"field_{section}"]
    if kind == "displacement":
        return field[0].values
    if kind == "strain":
        values = field.evaluate.strain(tensor=False).mean(-2).T
    else:
        stress = namespace[f"solid_{section}"].evaluate.cauchy_stress(field)
        if kind == "mises":
            return equivalent_von_mises(stress).mean(-2).reshape(-1, 1)
        values = eigvalsh(stress).mean(-2).T
    # the principal values from the largest to the smallest one
    return -np.sort(-values, axis=1)


def _bytes(array, dtype):
    return np.ascontiguousarray(array, dtype=dtype).tobytes()


def scene(job, substep, quantity):
    """Return the result of a substep of a job for the viewer.

    Parameters
    ----------
    job : str
        The name of the job.
    substep : int
        The substep, counted from 1 over all steps of the job.
    quantity : str
        A key of :data:`QUANTITIES`.

    Returns
    -------
    tuple of str and list of dict
        The JSON text of the label, of where the values are given (``"point"`` or
        ``"cell"``) and of their ``range`` over all cells of all sections (``None``
        without finite values), and the surface of every section: its ``name``,
        ``positions`` (three coordinates per point of the surface), ``displacement``
        (three components per point), ``triangles``, ``faces`` (to shade the faces of
        linear cells flat; ``None`` for curved faces), ``edges`` and ``values`` as
        bytes.
    """
    records = _state["records"].get(job)
    if not records:
        raise KeyError(f"No results of the job '{job}'.")
    if not 1 <= substep <= len(records):
        raise IndexError(f"The job '{job}' has {len(records)} substeps.")
    kind, component, label = QUANTITIES[quantity]

    # the values of the fields of the substep, in-place (shared with the sections)
    field = _state["namespace"]["field"]
    for f, values in zip(field.fields, records[substep - 1], strict=True):
        f.values[:] = values

    at = "point" if kind == "displacement" else "cell"
    surfaces = []
    low, high = np.inf, -np.inf
    for section in _state["sections"]:
        surface, cells, order = _surface(section)
        mesh = _state["namespace"][f"field_{section}"][0].region.mesh
        u = _state["namespace"][f"field_{section}"][0].values
        displacement = surface.interpolate(u)
        if kind == "displacement":
            # the values at the points of the cells (not of bubbles) and the surface
            used = u[np.unique(cells)]
            if component is None:
                values = np.linalg.norm(displacement, axis=1)
                data = np.linalg.norm(used, axis=1)
            else:
                values = displacement[:, component]
                data = used[:, component]
        else:
            data = _data(kind, section)[:, component]
            values = data[surface.owners]
        finite = np.concatenate([data, values])
        finite = finite[np.isfinite(finite)]
        if finite.size:
            low, high = min(low, finite.min()), max(high, finite.max())
        surfaces.append(
            {
                "name": section,
                "positions": _bytes(surface.interpolate(mesh.points), "<f4"),
                "displacement": _bytes(displacement, "<f4"),
                "triangles": _bytes(surface.triangles, "<u4"),
                "faces": _bytes(surface.faces, "<u4") if order == 1 else None,
                "edges": _bytes(surface.edges, "<u4"),
                "values": _bytes(values, "<f4"),
            }
        )

    meta = {
        "label": label,
        "at": at,
        "range": [float(low), float(high)] if low <= high else None,
    }
    return json.dumps(meta), surfaces
