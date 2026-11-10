"""Inspect mesh files for the import dialog of the app.

:func:`inspect` reads a mesh file with meshio, like the generated script does (see
``volume_cells`` in :mod:`felupe_studio._helpers`), and returns a JSON-serializable
summary: the number of points and solid cells, the ignored cell blocks, the bounds
and the cell data arrays that can be used as tags for cell sets. :func:`load` adds
the outer surface for the viewer (:mod:`felupe_studio.scene`), from the same read.
"""

import json
from pathlib import Path

import meshio
import numpy as np

from ._helpers import DIMENSIONS, REGIONS, volume_cells
from .scene import surface

# a cell data array with more distinct values is not offered as a tag
MAX_TAG_VALUES = 64


def _labels(mesh):
    """Names of the physical groups of solid cells (Gmsh): {value: name}."""
    labels = {}
    for name, data in (mesh.field_data or {}).items():
        data = np.ravel(data)
        if len(data) == 2 and int(data[1]) == 3:
            labels[int(data[0])] = name
    return labels


def _tags(mesh, blocks):
    """Integer-valued cell data arrays of the solid blocks, gmsh:physical first. The
    values of gmsh:physical carry the names of their physical groups as labels."""
    labels = _labels(mesh)
    tags = []
    for name, arrays in mesh.cell_data.items():
        try:
            values = np.concatenate([np.ravel(arrays[i]) for i in blocks])
        except (IndexError, ValueError):
            continue
        if values.dtype.kind not in "iuf" or len(values) == 0:
            continue
        if values.dtype.kind == "f" and not np.all(np.isfinite(values)):
            continue
        if not np.all(np.mod(values, 1) == 0):
            continue
        unique, counts = np.unique(values.astype(np.int64), return_counts=True)
        if len(unique) > MAX_TAG_VALUES:
            continue
        entries = []
        for v, c in zip(unique, counts, strict=True):
            entry = {"value": int(v), "cells": int(c)}
            if name == "gmsh:physical" and int(v) in labels:
                entry["label"] = labels[int(v)]
            entries.append(entry)
        tags.append({"name": name, "values": entries})
    order = {"gmsh:physical": 0, "gmsh:geometrical": 2}
    return sorted(tags, key=lambda t: order.get(t["name"], 1))


def inspect(filename):
    """Summarize a mesh file.

    Parameters
    ----------
    filename : str or Path
        The mesh file, in any format meshio reads.

    Returns
    -------
    dict
        ``file``, ``points``, ``blocks`` (type and number of cells of every cell
        block) and, if the file has one type of solid cells, ``cell_type``,
        ``cells``, ``ignored`` (lower-dimensional blocks), ``bounds`` and ``tags``
        (name and values with their number of cells, and the names of Gmsh physical
        groups as ``label``). Otherwise ``error`` explains
        what is wrong.
    """
    return _read(filename)[0]


def _read(filename):
    """:func:`inspect` and the solid cells (None if the file cannot be used)."""
    path = Path(filename)
    result = {"file": path.name}
    try:
        mesh = meshio.read(path)
    except (Exception, SystemExit) as error:
        # meshio raises many different errors, and calls sys.exit() if no reader fits
        reason = "" if isinstance(error, SystemExit) else f": {error}"
        result["error"] = f"meshio could not read the file{reason}".rstrip(".") + "."
        return result, None

    result["points"] = len(mesh.points)
    result["blocks"] = [{"type": b.type, "cells": len(b.data)} for b in mesh.cells]
    if not mesh.cells:
        result["error"] = "The file has no cells."
        return result, None

    try:
        solid = volume_cells(mesh)
    except ValueError:
        found = sorted({b.type for b in mesh.cells})
        supported = ", ".join(REGIONS)
        result["error"] = (
            f"The file needs one type of solid cells ({supported}); "
            f"found {', '.join(found)}."
        )
        return result, None

    dim = max(DIMENSIONS.get(b.type, 0) for b in mesh.cells)
    blocks = [i for i, b in enumerate(mesh.cells) if DIMENSIONS.get(b.type) == dim]
    ignored = [b.type for i, b in enumerate(mesh.cells) if i not in blocks]
    used = np.unique(solid.cells)
    points = np.asarray(solid.points)[used]
    result.update(
        cell_type=solid.cell_type,
        cells=len(solid.cells),
        ignored=sorted(set(ignored)),
        bounds=[points.min(axis=0).tolist(), points.max(axis=0).tolist()],
        tags=_tags(mesh, blocks),
    )
    return result, solid


def load(filename):
    """:func:`inspect` as a JSON string and the outer surface of the solid cells
    (:func:`felupe_studio.scene.surface`, None if the file cannot be used), from one
    read of the file (for the Pyodide worker)."""
    info, solid = _read(filename)
    return json.dumps(info), None if solid is None else surface(solid)
