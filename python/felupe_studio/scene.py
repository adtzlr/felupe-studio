"""The outer surface of a mesh for the viewer of the app.

:func:`surface` triangulates the outer surface of the solid cells of a mesh file with
FElupe (``felupe.view._surface.triangulate_surface``), like the plotting backend
``"webgl"`` of FElupe does for ``mesh.plot()``, and returns the flat arrays of the
scene of the viewer as little-endian bytes: ``float32`` for coordinates and ``uint32``
for indices. The Pyodide worker hands them to the main thread without copying them
into lists.
"""

import felupe as fem
import numpy as np
from felupe.view._surface import polynomial_order, triangulate_surface


def _bytes(array, dtype):
    return np.ascontiguousarray(array, dtype=dtype).tobytes()


def surface(solid):
    """Triangulate the outer surface of the solid cells of a mesh.

    Parameters
    ----------
    solid : types.SimpleNamespace
        The points, the cell type and the cells of the solid cells of a mesh, see
        ``volume_cells`` in :mod:`felupe_studio._helpers`.

    Returns
    -------
    dict
        ``positions`` (three coordinates per point of the surface), ``triangles``
        (three points per triangle, oriented outwards), ``faces`` (the face of a cell
        of every triangle, to shade the faces of linear cells flat; ``None`` for
        curved faces of quadratic cells), ``edges`` (two points per segment of the
        edges of the faces) and ``owners`` (the solid cell of every triangle) as
        bytes, and the number of ``cells``.
    """
    points = np.asarray(solid.points, dtype=float)
    points = np.pad(points, ((0, 0), (0, 3 - points.shape[1])))
    mesh = fem.Mesh(points, np.asarray(solid.cells), solid.cell_type)

    # the curved faces of quadratic cells are subdivided like in mesh.plot()
    order = polynomial_order(mesh)
    result = triangulate_surface(mesh, subdivisions=order)

    return {
        "positions": _bytes(result.interpolate(points), "<f4"),
        "triangles": _bytes(result.triangles, "<u4"),
        "faces": _bytes(result.faces, "<u4") if order == 1 else None,
        "edges": _bytes(result.edges, "<u4"),
        "owners": _bytes(result.owners, "<u4"),
        "cells": len(mesh.cells),
    }
