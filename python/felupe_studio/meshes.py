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
import traceback
from pathlib import Path

import meshio
import numpy as np

from ._helpers import REGIONS, script_mesh, solid_types, volume_cells
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


def _tag_arrays(mesh, blocks):
    """Integer-valued cell data arrays of the solid blocks that can be used as tags
    (at most MAX_TAG_VALUES values of 32 bits), gmsh:physical first."""
    arrays = {}
    for name, data in mesh.cell_data.items():
        try:
            values = np.concatenate([np.ravel(data[i]) for i in blocks])
        except (IndexError, ValueError):
            continue
        if values.dtype.kind not in "iuf" or len(values) == 0:
            continue
        if values.dtype.kind == "f" and not np.all(np.isfinite(values)):
            continue
        if not np.all(np.mod(values, 1) == 0):
            continue
        if np.abs(values).max() >= 2**31:
            continue
        values = values.astype(np.int64)
        if len(np.unique(values)) > MAX_TAG_VALUES:
            continue
        arrays[name] = values
    order = {"gmsh:physical": 0, "gmsh:geometrical": 2}
    return dict(sorted(arrays.items(), key=lambda item: order.get(item[0], 1)))


def _tags(mesh, arrays):
    """The values of the tags with their number of cells. The values of
    gmsh:physical carry the names of their physical groups as labels."""
    labels = _labels(mesh)
    tags = []
    for name, values in arrays.items():
        unique, counts = np.unique(values, return_counts=True)
        entries = []
        for v, c in zip(unique, counts, strict=True):
            entry = {"value": int(v), "cells": int(c)}
            if name == "gmsh:physical" and int(v) in labels:
                entry["label"] = labels[int(v)]
            entries.append(entry)
        tags.append({"name": name, "values": entries})
    return tags


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
    """:func:`inspect` and the solid cells with their tag arrays by cell type (empty
    if the file cannot be used)."""
    path = Path(filename)
    result = {"file": path.name}
    try:
        mesh = meshio.read(path)
    except (Exception, SystemExit) as error:
        # meshio raises many different errors, and calls sys.exit() if no reader fits
        reason = "" if isinstance(error, SystemExit) else f": {error}"
        result["error"] = f"meshio could not read the file{reason}".rstrip(".") + "."
        return result, {}
    return _summary(mesh, result)


def _summary(mesh, result):
    """:func:`_read` of a meshio mesh, with ``result`` as the start of the summary."""
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

    solids = {
        t: volume_cells(mesh, cell_type=t, dim=None) for t in types if t in REGIONS
    }
    unsupported = [t for t in types if t not in REGIONS]
    result.update(
        solids=[],
        unsupported=[
            {"type": t, "cells": len(volume_cells(mesh, cell_type=t, dim=None).cells)}
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

    tags = {}
    for cell_type, solid in solids.items():
        blocks = [i for i, b in enumerate(mesh.cells) if b.type == cell_type]
        points = np.asarray(solid.points)[np.unique(solid.cells)]
        # the bounds of 2D cells in the plane z = 0 (#175)
        points = np.pad(points, ((0, 0), (0, 3 - points.shape[1])))
        tags[cell_type] = _tag_arrays(mesh, blocks)
        result["solids"].append(
            {
                "cell_type": cell_type,
                "cells": len(solid.cells),
                "bounds": [points.min(axis=0).tolist(), points.max(axis=0).tolist()],
                "tags": _tags(mesh, tags[cell_type]),
            }
        )
    return result, {t: (solid, tags[t]) for t, solid in solids.items()}


def load(filename):
    """:func:`inspect` as a JSON string and the outer surfaces of the solid cells by
    cell type (:func:`felupe_studio.scene.surface`, empty if the file cannot be
    used), from one read of the file (for the Pyodide worker)."""
    info, solids = _read(filename)
    surfaces = {t: surface(solid, tags) for t, (solid, tags) in solids.items()}
    return json.dumps(info), surfaces


def make(filename, parameters, item=None):
    """:func:`load` of the mesh made by a script (#182): the script runs with the
    parameters as variables (like ``run_mesh_script()`` of the generated script), and
    its mesh (or the item of a dict of meshes) is summarized like a mesh file. An
    error of the script is the ``error`` of the summary, with its ``traceback``."""
    path = Path(filename)
    result = {"file": path.name}
    try:
        mesh = script_mesh(path, parameters, item)
    except (Exception, SystemExit) as error:
        result["error"] = f"{type(error).__name__}: {error}"
        # the frames of the script, not those of FElupe Studio
        trace = traceback.TracebackException.from_exception(error)
        frames = [f for f in trace.stack if Path(f.filename).name == path.name]
        trace.stack = traceback.StackSummary.from_list(frames)
        result["traceback"] = "".join(trace.format())
        return json.dumps(result), {}
    info, solids = _summary(mesh, result)
    surfaces = {t: surface(solid, tags) for t, (solid, tags) in solids.items()}
    return json.dumps(info), surfaces


def make_json(filename, parameters, item=None):
    """:func:`make` with the parameters as JSON text, for the worker."""
    return make(filename, json.loads(parameters), item)
