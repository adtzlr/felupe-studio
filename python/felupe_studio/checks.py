"""Checks of a model that need the mesh data.

- **Cell assignment:** every solid cell of an imported mesh belongs to exactly one
  section. Unassigned cells are not part of the model, cells in two sections are
  counted twice.
- **Interfaces:** the meshes of the sections are merged on identical points (or on
  points that agree to the decimals of ``mesh.merge``), like
  :func:`felupe.field.merge` does it in the generated script. Points of one section
  that lie on the surface of another section without being one of its points are
  *hanging*: they are not connected, e.g. at a non-conforming interface or if the
  coordinates of two files differ slightly.

:func:`check` returns a JSON-serializable report.
"""

from itertools import combinations
from pathlib import Path

import felupe as fem
import meshio
import numpy as np
from scipy.spatial import cKDTree

from ._helpers import volume_cells
from .commands import validate

# faces of the solid cells by their corner points (VTK ordering, quadratic cells
# start with their corner points)
FACES = {
    "tetra": [[0, 2, 1], [0, 1, 3], [1, 2, 3], [0, 3, 2]],
    "hexahedron": [
        [0, 3, 2, 1],
        [4, 5, 6, 7],
        [0, 1, 5, 4],
        [1, 2, 6, 5],
        [2, 3, 7, 6],
        [3, 0, 4, 7],
    ],
}
FACES.update(tetra10=FACES["tetra"])
FACES.update(hexahedron20=FACES["hexahedron"], hexahedron27=FACES["hexahedron"])

# relative tolerance (to the diagonal of the model) of a point on a surface
TOLERANCE = 1e-6


def boundary_faces(cells, cell_type):
    """Return the faces (corner points) which belong to exactly one cell."""
    local = FACES[cell_type]
    nverts = {len(face) for face in local}
    faces = []
    for n in sorted(nverts):
        ids = [face for face in local if len(face) == n]
        f = cells[:, ids].reshape(-1, n)
        _, index, counts = np.unique(
            np.sort(f, axis=1), axis=0, return_index=True, return_counts=True
        )
        faces.append(f[index[counts == 1]])
    return faces


def triangles(faces):
    """Split faces with three or four corner points into triangles."""
    tri = [f for f in faces if f.shape[1] == 3]
    quads = [f for f in faces if f.shape[1] == 4]
    for q in quads:
        tri.extend([q[:, [0, 1, 2]], q[:, [0, 2, 3]]])
    return np.vstack(tri) if tri else np.zeros((0, 3), dtype=int)


def on_triangles(points, candidates, tri, tol):
    """Return the candidate points which lie on one of the triangles."""
    if len(candidates) == 0 or len(tri) == 0:
        return np.zeros(0, dtype=int)

    vertices = points[tri]  # (ntri, 3, dim)
    centroids = vertices.mean(axis=1)
    radius = np.linalg.norm(vertices - centroids[:, None], axis=2).max() + tol
    tree = cKDTree(centroids)

    found = []
    for p in candidates:
        x = points[p]
        for t in tree.query_ball_point(x, radius):
            a, b, c = vertices[t]
            n = np.cross(b - a, c - a)
            area2 = np.linalg.norm(n)
            if area2 == 0:
                continue
            n /= area2
            if abs(np.dot(x - a, n)) > tol:
                continue
            # barycentric coordinates of the projected point
            y = x - np.dot(x - a, n) * n
            v0, v1, v2 = b - a, c - a, y - a
            d00, d01, d11 = v0 @ v0, v0 @ v1, v1 @ v1
            d20, d21 = v2 @ v0, v2 @ v1
            denom = d00 * d11 - d01 * d01
            v = (d11 * d20 - d01 * d21) / denom
            w = (d00 * d21 - d01 * d20) / denom
            eps = tol / np.sqrt(area2)
            if v >= -eps and w >= -eps and v + w <= 1 + eps:
                found.append(p)
                break
    return np.array(found, dtype=int)


def check(document, directory="."):
    """Check the cell assignment and the interfaces of the sections of a model.

    Parameters
    ----------
    document : dict
        The command list. It is validated first.
    directory : str or Path, optional
        Directory of the mesh files (default is the current directory).

    Returns
    -------
    dict
        ``ok`` (bool), ``messages`` (list of str), ``cells`` with ``total``,
        ``unassigned`` and ``multiple`` per mesh, and ``interfaces`` with the
        number of ``shared`` and ``hanging`` points per pair of sections.
    """
    validate(document)
    commands = document["commands"]
    directory = Path(directory)

    meshes = {
        c["name"]: volume_cells(
            meshio.read(directory / c["file"]),
            tag=c.get("tag"),
            cell_type=c.get("cell_type"),
            scale=c.get("scale", 1),
        )
        for c in commands
        if c["command"] == "mesh.import"
    }

    # cell sets as indices of the cells of their mesh
    cellsets = {}
    for c in commands:
        if c["command"] == "cellset.from_tag":
            mesh = meshes[c["mesh"]]
            cellsets[c["name"]] = (c["mesh"], np.flatnonzero(mesh.tags == c["value"]))
        elif c["command"] == "cellset.from_file":
            cellsets[c["name"]] = (c["mesh"], np.arange(len(meshes[c["mesh"]].cells)))

    sections = [c for c in commands if c["command"] == "section.add"]

    # cell assignment
    counts = {name: np.zeros(len(m.cells), dtype=int) for name, m in meshes.items()}
    owners = {name: [[] for _ in m.cells] for name, m in meshes.items()}
    for sec in sections:
        mesh, ids = cellsets[sec["cellset"]]
        counts[mesh][ids] += 1
        for i in ids:
            owners[mesh][i].append(sec["name"])

    messages = []
    report_cells = {"total": 0, "unassigned": [], "multiple": []}
    for name, count in counts.items():
        report_cells["total"] += len(count)
        unassigned = int(np.sum(count == 0))
        multiple = np.flatnonzero(count > 1)
        if unassigned:
            report_cells["unassigned"].append({"mesh": name, "cells": unassigned})
            messages.append(
                f"{unassigned} of {len(count)} cells of mesh '{name}' are not "
                "assigned to a section."
            )
        if len(multiple):
            names = sorted({s for i in multiple for s in owners[name][i]})
            report_cells["multiple"].append(
                {"mesh": name, "cells": len(multiple), "sections": names}
            )
            messages.append(
                f"{len(multiple)} cells of mesh '{name}' are assigned to more than "
                f"one section ({', '.join(names)})."
            )
    if not report_cells["unassigned"] and not report_cells["multiple"]:
        total = report_cells["total"]
        messages.append(f"{total} / {total} cells assigned once.")

    # interfaces, after merging the points like fem.field.merge
    interfaces = []
    if len(sections) > 1:
        section_meshes = []
        for sec in sections:
            mesh, ids = cellsets[sec["cellset"]]
            m = meshes[mesh]
            section_meshes.append(fem.Mesh(m.points, m.cells[ids], m.cell_type))
        decimals = next(
            (c["decimals"] for c in commands if c["command"] == "mesh.merge"), None
        )
        container = fem.MeshContainer(section_meshes, merge=True, decimals=decimals)
        points = container.points
        diagonal = np.linalg.norm(points.max(axis=0) - points.min(axis=0))
        tol = TOLERANCE * diagonal

        nodes, surface, tris = [], [], []
        for m in container.meshes:
            faces = boundary_faces(m.cells, m.cell_type)
            nodes.append(np.unique(m.cells))
            surface.append(np.unique(np.concatenate([f.ravel() for f in faces])))
            tris.append(triangles(faces))

        for i, j in combinations(range(len(sections)), 2):
            shared = np.intersect1d(nodes[i], nodes[j])
            hanging = np.union1d(
                on_triangles(points, np.setdiff1d(surface[i], nodes[j]), tris[j], tol),
                on_triangles(points, np.setdiff1d(surface[j], nodes[i]), tris[i], tol),
            )
            if len(shared) == 0 and len(hanging) == 0:
                continue
            pair = [sections[i]["name"], sections[j]["name"]]
            interfaces.append(
                {"sections": pair, "shared": len(shared), "hanging": len(hanging)}
            )
            text = (
                f"Interface {pair[0]} / {pair[1]}: {len(shared)} shared points, "
                f"{len(hanging)} hanging."
            )
            if len(hanging):
                text += (
                    " Hanging points are not connected: the meshes are not "
                    "conforming or their coordinates differ."
                )
            messages.append(text)

    ok = (
        not report_cells["unassigned"]
        and not report_cells["multiple"]
        and all(face["hanging"] == 0 for face in interfaces)
    )
    return {
        "ok": ok,
        "messages": messages,
        "cells": report_cells,
        "interfaces": interfaces,
    }
