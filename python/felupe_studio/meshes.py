"""Inspect mesh files for the import dialog of the app.

:func:`inspect` reads a mesh file with meshio, like the generated script does (see
``volume_cells`` in :mod:`felupe_studio._helpers`), and returns a JSON-serializable
summary: the number of points, the solid cells of every cell type with their bounds
and the cell data arrays that can be used as tags for cell sets, and the ignored cell
blocks. Like ``fem.mesh.read()`` gives one mesh per cell block, a file with more than
one type of solid cells becomes one mesh per cell type in the app. :func:`load` adds
the outer surfaces for the viewer (:mod:`felupe_studio.scene`), from the same read.
"""

import json
from pathlib import Path

import meshio
import numpy as np

from ._helpers import REGIONS, solid_types, volume_cells
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
        block) and, if the file has solid cells that FElupe supports, ``solids``: one
        entry per type of solid cells in the order of the file with ``cell_type``,
        ``cells``, ``bounds`` and ``tags`` (name and values with their number of
        cells, and the names of Gmsh physical groups as ``label``). ``unsupported``
        lists solid cells without a region in FElupe (e.g. wedges) and ``ignored``
        the lower-dimensional cell types. Otherwise ``error`` explains what is wrong.
    """
    return _read(filename)[0]


def _read(filename):
    """:func:`inspect` and the solid cells by cell type (empty if the file cannot be
    used)."""
    path = Path(filename)
    result = {"file": path.name}
    try:
        mesh = meshio.read(path)
    except (Exception, SystemExit) as error:
        # meshio raises many different errors, and calls sys.exit() if no reader fits
        reason = "" if isinstance(error, SystemExit) else f": {error}"
        result["error"] = f"meshio could not read the file{reason}".rstrip(".") + "."
        return result, {}

    result["points"] = len(mesh.points)
    result["blocks"] = [{"type": b.type, "cells": len(b.data)} for b in mesh.cells]
    if not mesh.cells:
        result["error"] = "The file has no cells."
        return result, {}

    types = solid_types(mesh)
    supported = ", ".join(REGIONS)
    if not types:
        found = ", ".join(sorted({b.type for b in mesh.cells}))
        result["error"] = f"The file needs solid cells ({supported}); found {found}."
        return result, {}

    solids = {t: volume_cells(mesh, cell_type=t) for t in types if t in REGIONS}
    unsupported = [t for t in types if t not in REGIONS]
    result.update(
        solids=[],
        unsupported=[
            {"type": t, "cells": len(volume_cells(mesh, cell_type=t).cells)}
            for t in unsupported
        ],
        ignored=sorted({b.type for b in mesh.cells} - set(types)),
    )
    if not solids:
        result["error"] = (
            f"FElupe has no region for {', '.join(unsupported)} cells; "
            f"supported are {supported}."
        )
        return result, {}

    for cell_type, solid in solids.items():
        blocks = [i for i, b in enumerate(mesh.cells) if b.type == cell_type]
        points = np.asarray(solid.points)[np.unique(solid.cells)]
        result["solids"].append(
            {
                "cell_type": cell_type,
                "cells": len(solid.cells),
                "bounds": [points.min(axis=0).tolist(), points.max(axis=0).tolist()],
                "tags": _tags(mesh, blocks),
            }
        )
    return result, solids


def load(filename):
    """:func:`inspect` as a JSON string and the outer surfaces of the solid cells by
    cell type (:func:`felupe_studio.scene.surface`, empty if the file cannot be
    used), from one read of the file (for the Pyodide worker)."""
    info, solids = _read(filename)
    surfaces = {cell_type: surface(solid) for cell_type, solid in solids.items()}
    return json.dumps(info), surfaces
