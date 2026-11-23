"""Inspect mesh files for the import dialog of the app.

:func:`inspect` reads a mesh file with meshio, like the generated script does (see
``volume_cells`` in :mod:`felupe_studio._helpers`), and returns a JSON-serializable
summary: the number of points, the solid cells of every cell type with their bounds
and the cell data arrays that can be used as tags for cell sets, and the ignored cell
blocks. Like ``fem.mesh.read()`` gives one mesh per cell block, a file with more than
one type of solid cells becomes one mesh per cell type in the app. :func:`load` adds
the outer surfaces for the viewer (:mod:`felupe_studio.scene`), from the same read.

The solid cells of the latest meshes are kept, so a cut of the view (#395) needs no
new read of a file or run of a script: :func:`load`, :func:`make` and
:func:`generate` with a ``cut`` cut the kept cells of their mesh. A new file of the
project forgets them (:func:`forget`).
"""

import json
import traceback
from collections import OrderedDict
from pathlib import Path

import meshio
import numpy as np

from ._helpers import REGIONS, cell_volumes, script_mesh, solid_types, volume_cells
from .scene import surface

# a cell data array with more distinct values is not offered as a tag
MAX_TAG_VALUES = 64

# the number of meshes whose solid cells are kept for cuts (#395)
KEPT = 16

# the summary and the solid cells of the latest meshes, by their function and its
# arguments, oldest first
_kept = OrderedDict()

# the formats of an exported mesh (#230): the extension, the name and the writer of
# meshio. XDMF needs h5py in meshio's writer of single meshes, which Pyodide lacks.
EXPORT_FORMATS = {
    "vtu": ("VTK unstructured grid", "vtu"),
    "vtk": ("VTK legacy", "vtk"),
    "msh": ("Gmsh", "gmsh"),
    "inp": ("Abaqus", "abaqus"),
    "bdf": ("Nastran", "nastran"),
}


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


def _tags(mesh, arrays, volumes):
    """The values of the tags with their number of cells and the volume of these
    cells (#429). The values of gmsh:physical carry the names of their physical
    groups as labels."""
    labels = _labels(mesh)
    tags = []
    for name, values in arrays.items():
        unique, counts = np.unique(values, return_counts=True)
        entries = []
        for v, c in zip(unique, counts, strict=True):
            volume = float(volumes[values == v].sum())
            entry = {"value": int(v), "cells": int(c), "volume": volume}
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
        ``cells``, ``volume`` (the area of 2D cells, zero of a degenerate cell for an
        empty part, #429), ``bounds`` and ``tags`` (name and values with their number
        and volume of cells, and the names of Gmsh physical groups as ``label``).
        ``unsupported``
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
    # also a file of empty cell blocks (#418)
    if not any(len(block.data) for block in mesh.cells):
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
        volumes = cell_volumes(solid)
        result["solids"].append(
            {
                "cell_type": cell_type,
                "cells": len(solid.cells),
                "volume": float(volumes.sum()),
                "bounds": [points.min(axis=0).tolist(), points.max(axis=0).tolist()],
                "tags": _tags(mesh, tags[cell_type], volumes),
            }
        )
    return result, {t: (solid, tags[t]) for t, solid in solids.items()}


def forget():
    """Forget the kept solid cells of the meshes, e.g. for a new file of the
    project."""
    _kept.clear()


def _mesh(key, read, cut):
    """The summary as a JSON string and the outer surfaces of the solid cells by
    cell type of a mesh: read with ``read()`` and kept by its key, or the kept solid
    cells cut (#395). ``read()`` returns the summary, the solid cells with their tags
    by cell type, and the surfaces of other meshes, e.g. of a construction mesh."""
    if cut is None or key not in _kept:
        _kept[key] = read()
        while len(_kept) > KEPT:
            _kept.popitem(last=False)
    _kept.move_to_end(key)
    info, solids, others = _kept[key]
    surfaces = {t: surface(solid, tags, cut) for t, (solid, tags) in solids.items()}
    return json.dumps(info), {**others, **surfaces}


def load(filename, cut=None):
    """:func:`inspect` as a JSON string and the outer surfaces of the solid cells by
    cell type (:func:`felupe_studio.scene.surface`, empty if the file cannot be
    used), from one read of the file (for the Pyodide worker). With a ``cut`` of the
    view (#395), the surfaces are cut (:func:`felupe_studio.cuts.plane`), of the kept
    cells of the latest read."""

    def read():
        return *_read(filename), {}

    return _mesh(("load", Path(filename).name), read, cut)


def make(filename, parameters, item=None, cut=None):
    """:func:`load` of the mesh made by a script (#182): the script runs with the
    parameters as variables (like ``run_mesh_script()`` of the generated script), and
    its mesh (or the item of a dict of meshes) is summarized like a mesh file. An
    error of the script is the ``error`` of the summary, with its ``traceback``. With
    a ``cut``, the kept cells of the latest run with these parameters are cut."""
    path = Path(filename)

    def read():
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
            return result, {}, {}
        return *_summary(mesh, result), {}

    key = ("make", path.name, json.dumps(parameters, sort_keys=True), item)
    return _mesh(key, read, cut)


def generate(commands, name, cut=None):
    """:func:`load` of a mesh made by the tools of FElupe (ADR 0019): the mesh
    ``name`` of the resolved commands of the tools that make it (with the values of
    their expressions), made with the lines of the script. A mesh of 2D or 3D cells
    is summarized like a mesh file, a mesh of lines or vertices (a construction mesh)
    by its points and cells, with the lines for the viewer. The summary has the
    ``dimension`` of the mesh; an error of FElupe is its ``error``. With a ``cut``,
    the kept cells of the latest mesh of these commands are cut, not the lines."""
    from . import meshtools
    from .scene import wire

    def read():
        result = {"file": name}
        try:
            mesh = meshtools.generate(commands)[name]
        except Exception as error:
            result["error"] = f"{type(error).__name__}: {error}"
            return result, {}, {}
        dimension = meshtools.dimensions(commands)[name]
        if dimension["cells"] < 2:
            result.update(
                points=int(mesh.npoints),
                blocks=[{"type": mesh.cell_type, "cells": int(mesh.ncells)}],
                solids=[],
                dimension=dimension,
            )
            return result, {}, {mesh.cell_type: wire(mesh)}
        made = meshio.Mesh(mesh.points, [(mesh.cell_type, mesh.cells)])
        info, solids = _summary(made, result)
        info["dimension"] = dimension
        return info, solids, {}

    return _mesh(("generate", json.dumps(commands, sort_keys=True), name), read, cut)


def generate_json(commands, name, cut=None):
    """:func:`generate` with the commands as JSON text, for the worker."""
    return generate(json.loads(commands), name, cut)


def make_json(filename, parameters, item=None, cut=None):
    """:func:`make` with the parameters as JSON text, for the worker. An item that is
    not a name is no item: JavaScript's null arrives as ``pyodide.ffi.jsnull``, not as
    None."""
    item = item if isinstance(item, str) else None
    return make(filename, json.loads(parameters), item, cut)


def export(
    filename, format="vtu", parameters=None, item=None, cell_type=None, scale=None
):
    """Return a mesh of the project as the bytes of a file of a format of
    :data:`EXPORT_FORMATS` (#230): the mesh file, or the mesh that a script makes
    with the parameters (and its item), as the model uses it. The file has the solid
    cells (of one cell type, if given) with their tags, and the points in 3D (z = 0
    of a 2D mesh), multiplied by the scale of a mesh file."""
    if format not in EXPORT_FORMATS:
        raise ValueError(
            f"Unknown format '{format}'; use one of {', '.join(EXPORT_FORMATS)}."
        )
    path = Path(filename)
    if parameters is None:
        mesh = meshio.read(path)
    else:
        mesh = script_mesh(path, parameters, item)
    return _write(mesh, path.name, format, cell_type, scale)


def export_generated(commands, name, format="vtu"):
    """Return a mesh made by the tools of FElupe (ADR 0019) as the bytes of a file of
    a format of :data:`EXPORT_FORMATS`, like :func:`export`: the mesh ``name`` of the
    resolved commands of the tools that make it. A mesh of lines or vertices (a
    construction mesh) has no solid cells to export."""
    from . import meshtools

    if format not in EXPORT_FORMATS:
        raise ValueError(
            f"Unknown format '{format}'; use one of {', '.join(EXPORT_FORMATS)}."
        )
    made = meshtools.generate(commands)[name]
    mesh = meshio.Mesh(made.points, [(made.cell_type, made.cells)])
    return _write(mesh, name, format)


def _write(mesh, name, format, cell_type=None, scale=None):
    """The solid cells of a meshio mesh (of one cell type, if given) with their tags
    as the bytes of a file of a format, the points in 3D and multiplied by a scale."""
    import tempfile

    types = [
        t
        for t in solid_types(mesh)
        if t in REGIONS and (cell_type is None or t == cell_type)
    ]
    if not types:
        raise ValueError(f"The mesh of '{name}' has no solid cells to export.")
    blocks = [i for i, b in enumerate(mesh.cells) if b.type in types]
    sizes = np.cumsum([len(mesh.cells[i].data) for i in blocks])[:-1]
    cell_data = {
        key: np.split(values.astype(np.int32), sizes)
        for key, values in _tag_arrays(mesh, blocks).items()
    }
    points = np.asarray(mesh.points, dtype=float)
    points = np.pad(points, ((0, 0), (0, 3 - points.shape[1])))
    if scale is not None:
        points = points * scale
    cells = [(mesh.cells[i].type, mesh.cells[i].data) for i in blocks]
    solid = meshio.Mesh(points, cells, cell_data=cell_data)
    with tempfile.TemporaryDirectory() as folder:
        target = Path(folder) / f"mesh.{format}"
        meshio.write(target, solid, file_format=EXPORT_FORMATS[format][1])
        return target.read_bytes()


def export_json(
    filename, format, parameters=None, item=None, cell_type=None, scale=None
):
    """:func:`export` with the parameters of a script as JSON text, for the worker
    (JavaScript's null or undefined as None: a mesh file)."""
    parameters = json.loads(parameters) if isinstance(parameters, str) else None
    item = item if isinstance(item, str) else None
    cell_type = cell_type if isinstance(cell_type, str) else None
    scale = scale if isinstance(scale, int | float) else None
    return export(filename, format, parameters, item, cell_type, scale)
