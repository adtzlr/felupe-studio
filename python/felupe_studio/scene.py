"""The outer surface of a mesh for the viewer of the app.

:func:`surface` triangulates the outer surface of the solid cells of a mesh file with
FElupe (``felupe.view._surface.triangulate_surface``), like the plotting backend
``"webgl"`` of FElupe does for ``mesh.plot()``, and returns the flat arrays of the
scene of the viewer as little-endian bytes: ``float32`` for coordinates and ``uint32``
for indices. The Pyodide worker hands them to the main thread without copying them
into lists.

The cells of a mesh are colored and hidden in the app by cell sets and sections,
which take the cells of a tag value (or all cells). Therefore, every region of
cells with the same values of all tags is triangulated on its own: its surface is
closed also at the interfaces to other regions, e.g. if a section is hidden.
"""

import felupe as fem
import numpy as np
from felupe.view._surface import polynomial_order, triangulate_surface


def _bytes(array, dtype):
    return np.ascontiguousarray(array, dtype=dtype).tobytes()


def regions(cells, tags):
    """Return the region of every cell: the cells of a region have the same values of
    all tags (one region without tags)."""
    if not tags:
        return np.zeros(cells, dtype=np.int64)
    keys = np.column_stack([np.asarray(v) for v in tags.values()])
    return np.unique(keys, axis=0, return_inverse=True)[1].ravel()


def surface(solid, tags=None):
    """Triangulate the outer surface of the solid cells of a mesh, region by region.

    Parameters
    ----------
    solid : types.SimpleNamespace
        The points, the cell type and the cells of the solid cells of a mesh, see
        ``volume_cells`` in :mod:`felupe_studio._helpers`.
    tags : dict of ndarray or None, optional
        Integer cell data of the cells by name (default is None). Every region of
        cells with the same values of all tags gets a closed surface.

    Returns
    -------
    dict
        ``positions`` (three coordinates per point of the surface), ``triangles``
        (three points per triangle, oriented outwards), ``faces`` (the face of a cell
        of every triangle, to shade the faces of linear cells flat; ``None`` for
        curved faces of quadratic cells), ``edges`` (two points per segment of the
        edges of the faces) and ``owners`` (the solid cell of every triangle) as
        bytes, ``tags`` (the ``int32`` values of the tags of the cells as bytes by
        name), ``nodes`` (the ``float64`` coordinates of the points of the cells, to
        preview point sets) and the number of ``cells``.
    """
    points = np.asarray(solid.points, dtype=float)
    points = np.pad(points, ((0, 0), (0, 3 - points.shape[1])))
    cells = np.asarray(solid.cells)
    tags = tags or {}
    region = regions(len(cells), tags)

    # the curved faces of quadratic cells are subdivided like in mesh.plot()
    order = polynomial_order(fem.Mesh(points, cells[:1], solid.cell_type))

    parts = {key: [] for key in ["positions", "triangles", "faces", "edges", "owners"]}
    npoints = nfaces = 0
    for r in np.unique(region):
        ids = np.flatnonzero(region == r)
        mesh = fem.Mesh(points, cells[ids], solid.cell_type)
        result = triangulate_surface(mesh, subdivisions=order)
        positions = result.interpolate(points)
        parts["positions"].append(positions)
        parts["triangles"].append(result.triangles + npoints)
        parts["edges"].append(result.edges + npoints)
        parts["faces"].append(result.faces + nfaces)
        parts["owners"].append(ids[result.owners])
        npoints += len(positions)
        nfaces += int(result.faces.max(initial=-1)) + 1

    def stack(key, shape):
        return np.concatenate(parts[key]) if parts[key] else np.zeros(shape)

    return {
        "positions": _bytes(stack("positions", (0, 3)), "<f4"),
        "triangles": _bytes(stack("triangles", (0, 3)), "<u4"),
        "faces": _bytes(stack("faces", 0), "<u4") if order == 1 else None,
        "edges": _bytes(stack("edges", (0, 2)), "<u4"),
        "owners": _bytes(stack("owners", 0), "<u4"),
        "tags": {name: _bytes(values, "<i4") for name, values in tags.items()},
        "nodes": _bytes(points[np.unique(cells)], "<f8"),
        "cells": len(cells),
    }
