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
:func:`felupe_studio.scene.surface`. :func:`export` writes the results of a job as
a VTU file of a substep or as an XDMF time series of all substeps.
"""

import json
import os
import tempfile

import felupe as fem
import numpy as np
from felupe.math import eigvalsh, equivalent_von_mises
from felupe.view._surface import polynomial_order, triangulate_surface

from .scene import surface_nodes

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


def reset(namespace, sections, points=()):
    """Start the results of a run: the namespace of its script, the names of the
    sections and the names of the control points."""
    _state.update(
        namespace=namespace, sections=list(sections), points=list(points), records={}
    )
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


def _cells(section):
    """Return the cell type and the cells of a section, without the bubble points of
    the MINI element. The cells refer to the merged points."""
    mesh = _state["namespace"][f"field_{section}"][0].region.mesh
    cell_type, corners = CORNERS.get(mesh.cell_type, (mesh.cell_type, None))
    return cell_type, mesh.cells[:, :corners] if corners else mesh.cells


def _surface(section):
    """Return the triangulated surface of the cells of a section (cached), with the
    cells and the points of its mesh."""
    if section not in _state["surfaces"]:
        mesh = _state["namespace"][f"field_{section}"][0].region.mesh
        cell_type, cells = _cells(section)
        drawn = fem.Mesh(mesh.points, cells, cell_type)
        order = polynomial_order(drawn)
        surface = triangulate_surface(drawn, subdivisions=order)
        _state["surfaces"][section] = (surface, cells, order)
    return _state["surfaces"][section]


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
        ``"cell"``), of their ``range`` over all cells of all sections (``None``
        without finite values) and of the control ``points`` (``name``, ``position``
        and ``displacement``), and the surface of every section: its ``name``,
        ``positions`` (three coordinates per point of the surface), ``displacement``
        (three components per point), ``triangles``, ``faces`` (to shade the faces of
        linear cells flat; ``None`` for curved faces), ``edges``, ``values``,
        ``owners`` (the cell of the section of every triangle) and ``nodes`` (the
        point of the mesh of every point of the surface, -1 inside a subdivided
        face) as bytes.
    """
    kind, component, label = QUANTITIES[quantity]
    _restore(job, substep)

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
                "owners": _bytes(surface.owners, "<u4"),
                "nodes": _bytes(surface_nodes(surface), "<i4"),
            }
        )

    meta = {
        "label": label,
        "at": at,
        "range": [float(low), float(high)] if low <= high else None,
        "points": _control_points(),
    }
    return json.dumps(meta), surfaces


def _control_points():
    """Return the control points with their positions and current displacements."""
    namespace = _state["namespace"]
    field = namespace["field"]
    points = field.mesh_container.points
    result = []
    for name in _state.get("points", []):
        index = np.flatnonzero(namespace[name])[0]
        result.append(
            {
                "name": name,
                "position": points[index].tolist(),
                "displacement": field[0].values[index].tolist(),
            }
        )
    return result


# the cell data of the exports (like the names of felupe.ViewSolid) by kind
EXPORTED = {
    "Principal Values of Logarithmic Strain": "strain",
    "Principal Values of Cauchy Stress": "stress",
    "Equivalent of Cauchy Stress": "mises",
}


def _export_mesh():
    """Return the points used by the cells of all sections, the cell blocks (one per
    section, with the indices of the used points) and the used points."""
    blocks = [_cells(section) for section in _state["sections"]]
    points = _state["namespace"]["field"].region.mesh.points
    used = np.unique(np.concatenate([cells.ravel() for _, cells in blocks]))
    index = np.full(len(points), -1)
    index[used] = np.arange(len(used))
    return points[used], [(t, index[cells]) for t, cells in blocks], used


def _export_data(used):
    """Return the point data and the cell data of the current values of the fields."""
    field = _state["namespace"]["field"]
    point_data = {"Displacement": field[0].values[used]}
    cell_data = {
        name: [_data(kind, section) for section in _state["sections"]]
        for name, kind in EXPORTED.items()
    }
    cell_data["Section"] = [
        np.full(len(_cells(section)[1]), i)
        for i, section in enumerate(_state["sections"])
    ]
    return point_data, cell_data


def export(job, file_format, substep=None):
    """Return the results of a job as the bytes of a file.

    Parameters
    ----------
    job : str
        The name of the job.
    file_format : str
        ``"vtu"`` for a substep (the last one by default) or ``"xdmf"`` for all
        substeps of the job (a time series with the substeps as time, with the data
        inside the XML file, so that no HDF5 file is needed).
    substep : int or None, optional
        The substep of a VTU file, counted from 1 over all steps of the job.

    Notes
    -----
    The cells of every section are a block of cells with the merged points that
    the cells use (without the bubble points of the MINI element). The point data
    is the displacement, the cell data are the principal values of the logarithmic
    strain and of the Cauchy stress and the von Mises equivalent of the Cauchy
    stress (the means of the quadrature points of every cell, like
    :class:`felupe.ViewSolid`) and the index of the section.
    """
    import meshio

    if not _state["records"].get(job):
        raise KeyError(f"No results of the job '{job}'.")
    points, cells, used = _export_mesh()
    with tempfile.TemporaryDirectory() as folder:
        filename = os.path.join(folder, f"result.{file_format}")
        if file_format == "vtu":
            _restore(job, substep or substeps(job))
            point_data, cell_data = _export_data(used)
            meshio.Mesh(
                points, cells, point_data=point_data, cell_data=cell_data
            ).write(filename)
        elif file_format == "xdmf":
            with meshio.xdmf.TimeSeriesWriter(filename, data_format="XML") as writer:
                writer.write_points_cells(points, cells)
                for substep in range(1, substeps(job) + 1):
                    _restore(job, substep)
                    point_data, cell_data = _export_data(used)
                    writer.write_data(float(substep), point_data, cell_data)
        else:
            raise ValueError(f"Unknown file format '{file_format}'.")
        with open(filename, "rb") as file:
            return file.read()
