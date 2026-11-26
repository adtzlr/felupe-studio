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
- **Formulations:** the formulation of every section takes the cells of its mesh,
  e.g. condensed per cell hexahedrons and quads only (#420), like
  ``formulationNotes()`` of the app.
- **Contacts between bodies:** the sections of a contact between bodies have faces
  that felupe-contact takes, of hexahedrons and quads (#462), like
  ``contactNotes()`` of the app.

:func:`check` returns a JSON-serializable report.
"""

from itertools import combinations
from pathlib import Path

import felupe as fem
import meshio
import numpy as np
from scipy.spatial import cKDTree

from . import meshtools
from ._helpers import run_mesh_script, volume_cells
from .codegen import analysis_of, parameter_value
from .commands import validate
from .expressions import resolve
from .formulations import cell_problem

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
# the edges of the 2D cells of 2D models (#175)
FACES.update(triangle=[[0, 1], [1, 2], [2, 0]], quad=[[0, 1], [1, 2], [2, 3], [3, 0]])
FACES.update(triangle6=FACES["triangle"], quad8=FACES["quad"], quad9=FACES["quad"])

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


def on_segments(points, candidates, segments, tol):
    """Return the candidate points which lie on one of the segments (the edges of
    the 2D cells of a 2D model)."""
    if len(candidates) == 0 or len(segments) == 0:
        return np.zeros(0, dtype=int)
    a = points[segments[:, 0]]
    ab = points[segments[:, 1]] - a
    length2 = np.einsum("ij,ij->i", ab, ab)
    found = []
    for p in candidates:
        x = points[p]
        t = np.einsum("ij,ij->i", x - a, ab) / np.where(length2 > 0, length2, 1)
        nearest = a + np.clip(t, 0, 1)[:, None] * ab
        if np.any(np.linalg.norm(nearest - x, axis=1) <= tol):
            found.append(p)
    return np.array(found, dtype=int)


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


def _meshes(commands, directory, dim):
    """The meshes of a command list by name, in the order of the commands like the
    script: the imported ones and those made by scripts with the parameters of the
    model (#182)."""
    meshes = {
        c["name"]: volume_cells(
            meshio.read(directory / c["file"]),
            tag=c.get("tag"),
            cell_type=c.get("cell_type"),
            scale=c.get("scale", 1),
            dim=dim,
        )
        for c in commands
        if c["command"] == "mesh.import"
    }
    values = {
        c["name"]: parameter_value(c)
        for c in commands
        if c["command"] == "parameter.add"
    }
    for c in commands:
        if c["command"] == "mesh.script":
            names = c.get("parameters", list(values))
            meshes[c["name"]] = run_mesh_script(
                directory / c["file"],
                {n: values[n] for n in names},
                item=c.get("item"),
                tag=c.get("tag"),
                cell_type=c.get("cell_type"),
                dim=dim,
            )
    # the meshes of the model made by tools, also of the meshes of files and scripts
    # (#438), not the construction meshes (ADR 0019), also not those of files and
    # scripts with 2D cells in a 3D model
    meshes.update(meshtools.generate(commands, values, meshes))
    return {
        name: meshes[name]
        for name, dimension in meshtools.dimensions(commands).items()
        if name in meshes and meshtools.model_mesh(dimension, dim)
    }


def _cellsets(commands, meshes):
    """The cell sets as indices of the cells of their mesh."""
    cellsets = {}
    for c in commands:
        if c["command"] == "cellset.from_tag":
            mesh = meshes[c["mesh"]]
            cellsets[c["name"]] = (c["mesh"], np.flatnonzero(mesh.tags == c["value"]))
        elif c["command"] == "cellset.from_file":
            cellsets[c["name"]] = (c["mesh"], np.arange(len(meshes[c["mesh"]].cells)))
    return cellsets


def _assignment(meshes, cellsets, sections, messages):
    """The cells of every mesh in no section or in several sections."""
    counts = {name: np.zeros(len(m.cells), dtype=int) for name, m in meshes.items()}
    owners = {name: [[] for _ in m.cells] for name, m in meshes.items()}
    for sec in sections:
        mesh, ids = cellsets[sec["cellset"]]
        counts[mesh][ids] += 1
        for i in ids:
            owners[mesh][i].append(sec["name"])

    report = {"total": 0, "unassigned": [], "multiple": []}
    for name, count in counts.items():
        report["total"] += len(count)
        unassigned = int(np.sum(count == 0))
        multiple = np.flatnonzero(count > 1)
        if unassigned:
            report["unassigned"].append({"mesh": name, "cells": unassigned})
            messages.append(
                f"{unassigned} of {len(count)} cells of mesh '{name}' are not "
                "assigned to a section."
            )
        if len(multiple):
            names = sorted({s for i in multiple for s in owners[name][i]})
            report["multiple"].append(
                {"mesh": name, "cells": len(multiple), "sections": names}
            )
            messages.append(
                f"{len(multiple)} cells of mesh '{name}' are assigned to more than "
                f"one section ({', '.join(names)})."
            )
    if not report["unassigned"] and not report["multiple"]:
        total = report["total"]
        messages.append(f"{total} / {total} cells assigned once.")
    return report


def _interfaces(commands, meshes, cellsets, sections, dim, messages):
    """The shared and the hanging points of every pair of sections, after merging
    the points like ``fem.field.merge``."""
    interfaces = []
    if len(sections) < 2:
        return interfaces
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
        # the triangles of the faces, or the edges of 2D cells
        tris.append(triangles(faces) if dim == 3 else np.vstack(faces))
    on = on_triangles if dim == 3 else on_segments

    for i, j in combinations(range(len(sections)), 2):
        shared = np.intersect1d(nodes[i], nodes[j])
        hanging = np.union1d(
            on(points, np.setdiff1d(surface[i], nodes[j]), tris[j], tol),
            on(points, np.setdiff1d(surface[j], nodes[i]), tris[i], tol),
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
    return interfaces


def _formulations(meshes, cellsets, sections, messages):
    """The sections of cells that their formulation does not take (#420), e.g.
    tetrahedrons condensed per cell."""
    problems = []
    for sec in sections:
        cell_type = meshes[cellsets[sec["cellset"]][0]].cell_type
        problem = cell_problem(sec, cell_type)
        if problem is not None:
            problems.append(
                {
                    "section": sec["name"],
                    "formulation": sec["formulation"],
                    "cell_type": cell_type,
                }
            )
            messages.append(problem)
    return problems


# the cells whose faces are a contact surface of felupe-contact (#462): it has the
# boundary regions of linear and quadratic hexahedrons and quads
CONTACT_CELLS = ("hexahedron", "hexahedron20", "hexahedron27", "quad", "quad8", "quad9")


def contact_problem(contact, section, cell_type):
    """Return why the cells of a section of a contact between bodies have no contact
    surface, or None (#462): the message of ``contactNotes()`` of the app.

    Examples
    --------
    >>> print(contact_problem("contact", "rubber", "tetra"))  # doctest: +ELLIPSIS
    Contact 'contact' between bodies: the tetra cells of 'rubber' have no faces ...
    >>> print(contact_problem("contact", "rubber", "hexahedron20"))
    None
    """
    if cell_type in CONTACT_CELLS:
        return None
    return (
        f"Contact '{contact}' between bodies: the {cell_type} cells of '{section}' "
        "have no faces for a contact in felupe-contact. Use hexahedrons or quads, "
        "linear or quadratic."
    )


def _contacts(commands, meshes, cellsets, sections, messages):
    """The contacts between bodies of sections of cells without a contact surface in
    felupe-contact (#462), e.g. tetrahedrons."""
    by_name = {sec["name"]: sec for sec in sections}
    problems = []
    for contact in commands:
        if contact["command"] != "bodycontact.add":
            continue
        names = dict.fromkeys([contact["section"], contact.get("primary")])
        for name in filter(None, names):
            cell_type = meshes[cellsets[by_name[name]["cellset"]][0]].cell_type
            problem = contact_problem(contact["name"], name, cell_type)
            if problem is not None:
                problems.append(
                    {
                        "contact": contact["name"],
                        "section": name,
                        "cell_type": cell_type,
                    }
                )
                messages.append(problem)
    return problems


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
        ``unassigned`` and ``multiple`` per mesh, ``interfaces`` with the
        number of ``shared`` and ``hanging`` points per pair of sections, and
        ``formulations`` with the sections of cells that their formulation does not
        take (``section``, ``formulation`` and ``cell_type``, #420), and
        ``contacts`` with the sections of contacts between bodies of cells without
        a contact surface (``contact``, ``section`` and ``cell_type``, #462).
    """
    validate(document)
    # the values of the expressions of the parameters (#242)
    commands = resolve(document)[0]["commands"]
    # the 2D cells of a 2D model (#175)
    dim = 3 if analysis_of(commands) == "3d" else 2
    meshes = _meshes(commands, Path(directory), dim)
    cellsets = _cellsets(commands, meshes)
    sections = [c for c in commands if c["command"] == "section.add"]
    messages = []
    # a mesh that a tool takes is a step of another mesh (ADR 0019), e.g. an imported
    # half of a mirrored whole (#438): its cells need a section only with a cell set
    steps = {
        name
        for c in commands
        if c["command"] == "mesh.generate"
        for name in c.get("inputs", [])
    } - {c["mesh"] for c in commands if c["command"].startswith("cellset.")}
    assigned = {name: mesh for name, mesh in meshes.items() if name not in steps}
    cells = _assignment(assigned, cellsets, sections, messages)
    interfaces = _interfaces(commands, meshes, cellsets, sections, dim, messages)
    formulations = _formulations(meshes, cellsets, sections, messages)
    contacts = _contacts(commands, meshes, cellsets, sections, messages)
    ok = (
        not cells["unassigned"]
        and not cells["multiple"]
        and all(face["hanging"] == 0 for face in interfaces)
        and not formulations
        and not contacts
    )
    return {
        "ok": ok,
        "messages": messages,
        "cells": cells,
        "interfaces": interfaces,
        "formulations": formulations,
        "contacts": contacts,
    }
