"""A cut of the view through the undeformed model (#395, ADR 0022).

A plane normal to the axis x, y or z at a coordinate hides one half of the model:
``"+"`` the half beyond the plane (e.g. x > value), ``"-"`` the half before it
(x < value). :func:`cut` clips the outer surface of the cells at the plane and adds
the cut face, the section of the cells by the plane, both in the undeformed
configuration. Like the outer surface of FElupe (``triangulate_surface``), a cut
interpolates the values at the points of the mesh to its points
(:attr:`Cut.interpolation`). So the cut face moves with the deformation and shows the
values inside, and the app draws it like the outer surface: the vendored viewer stays
unchanged (ADR 0004).

The cells are cut through the triangles of their faces, triangulated like the outer
surface (subdivided for quadratic cells), each with the center of its cell as a
tetrahedron. A quad of two cut cells is triangulated at its center instead, so both
cells cut it alike. The section of a tetrahedron by a plane is a triangle or a quad,
with its points on the edges of the tetrahedron, interpolated linearly from the two
points of an edge. The faces of the cells at the outer surface are those of the
outer surface, so the cut face meets the clipped outer surface without a gap. The
edges of the cut face are the lines where the faces of the cells cross the plane. A
2D model has no cut face: its cells are clipped at a line, which is drawn as an
edge.

A point on the plane belongs to the hidden half, so a plane through points of the
mesh cuts the cells on the visible side at their faces: the cut face is made of
these faces, with the values of the visible cells. Everything is vectorized with
NumPy and SciPy, without loops over the cells.
"""

from dataclasses import dataclass
from types import SimpleNamespace

import numpy as np
from felupe.view._surface import CORNERS, FACES, _element, _template
from scipy.sparse import csr_matrix, identity, vstack

AXES = {"x": 0, "y": 1, "z": 2}

# the cells of 2D models, whose cut is a line without a cut face
PLANAR = ("quad", "triangle")


def plane(cut):
    """Return the plane of a cut as a tuple of the axis (0, 1 or 2), the coordinate
    and the sign of the hidden half (1 for ``"+"``, -1 for ``"-"``), or None without a
    cut.

    Parameters
    ----------
    cut : dict or None
        The ``axis`` (``"x"``, ``"y"`` or ``"z"``), the coordinate ``value`` and the
        hidden ``half`` (``"+"``, the default, or ``"-"``) of a cut, or None.
    """
    if not cut:
        return None
    axis = cut.get("axis")
    if axis not in AXES:
        raise ValueError(f"The axis of a cut is x, y or z, not {axis!r}.")
    half = cut.get("half", "+")
    if half not in ("+", "-"):
        raise ValueError(f"The hidden half of a cut is '+' or '-', not {half!r}.")
    value = float(cut.get("value", 0.0))
    if not np.isfinite(value):
        raise ValueError("The coordinate of a cut must be finite.")
    return AXES[axis], value, 1 if half == "+" else -1


@dataclass
class Cut:
    """The outer surface of cells clipped at a plane, with the cut face.

    Attributes
    ----------
    interpolation : scipy.sparse.csr_matrix
        The matrix of shape ``(npoints, nmesh)``, which interpolates the values at the
        points of the mesh to the points of the cut, like the one of the outer surface
        of FElupe.
    triangles : ndarray
        Three points per triangle: first the ``outer`` triangles of the clipped outer
        surface, then those of the cut face, oriented towards the hidden half.
    owners : ndarray
        The cell of every triangle.
    faces : ndarray
        The face of every triangle: of the outer surface, or one per cell on the cut
        face.
    edges : ndarray
        Two points per segment: the clipped edges of the outer surface and the lines
        where the faces of the cells cross the plane.
    outer : int
        The number of triangles of the clipped outer surface.
    sources : ndarray
        The triangle of the outer surface of every triangle of the clipped outer
        surface (``outer`` of them), e.g. to pick the faces of the cells.
    """

    interpolation: csr_matrix
    triangles: np.ndarray
    owners: np.ndarray
    faces: np.ndarray
    edges: np.ndarray
    outer: int
    sources: np.ndarray

    def interpolate(self, values):
        """Return the values at the points of the cut, interpolated from the values at
        the points of the mesh of shape ``(nmesh, ...)``."""
        values = np.asarray(values)
        shape = values.shape
        result = self.interpolation @ values.reshape(shape[0], -1)
        return result.reshape(-1, *shape[1:])


def _point(p):
    """The points of the cut at points of the base (pairs of the same point)."""
    return np.stack([p, p], axis=-1)


def _crossing(a, b, s):
    """The points of the cut on the edges from kept points ``a`` to hidden points
    ``b``, as pairs of points: the point ``b`` itself if it is on the plane."""
    on = s[b] == 0
    return np.stack([np.where(on, b, a), b], axis=-1)


def _clip(triangles, hidden, s):
    """Return the kept parts of triangles (as pairs of points, of shape ``(n, 3, 2)``)
    and the triangle of each, with the orientation of the triangles."""
    h = hidden[triangles]
    count = h.sum(axis=1)
    parts = [_point(triangles[count == 0])]
    parents = [np.flatnonzero(count == 0)]

    # one hidden point c: the quad a, b and the points on the edges b-c and c-a
    one = np.flatnonzero(count == 1)
    at = np.argmax(h[one], axis=1)
    a, b, c = (triangles[one, (at + k) % 3] for k in (1, 2, 0))
    bc, ac = _crossing(b, c, s), _crossing(a, c, s)
    parts += [np.stack([_point(a), _point(b), bc], 1), np.stack([_point(a), bc, ac], 1)]
    parents += [one, one]

    # two hidden points: the triangle of the kept point a
    two = np.flatnonzero(count == 2)
    at = np.argmin(h[two], axis=1)
    a, b, c = (triangles[two, (at + k) % 3] for k in (0, 1, 2))
    parts.append(np.stack([_point(a), _crossing(a, b, s), _crossing(a, c, s)], 1))
    parents.append(two)
    return np.concatenate(parts), np.concatenate(parents)


def _clip_edges(edges, hidden, s):
    """Return the kept parts of edges as pairs of points, of shape ``(n, 2, 2)``."""
    h = hidden[edges]
    kept = _point(edges[~h.any(axis=1)])
    mixed = h[:, 0] != h[:, 1]
    a = np.where(h[mixed, 0], edges[mixed, 1], edges[mixed, 0])
    b = np.where(h[mixed, 0], edges[mixed, 0], edges[mixed, 1])
    return np.concatenate([kept, np.stack([_point(a), _crossing(a, b, s)], 1)])


def _lines(triangles, hidden, s):
    """Return the lines where triangles cross the plane, as pairs of points of shape
    ``(n, 2, 2)``."""
    h = hidden[triangles]
    count = h.sum(axis=1)
    order = np.argsort(h, axis=1, kind="stable")
    v = np.take_along_axis(triangles, order, axis=1)
    one, two = v[count == 1], v[count == 2]
    return np.concatenate(
        [
            np.stack(
                [
                    _crossing(one[:, 0], one[:, 2], s),
                    _crossing(one[:, 1], one[:, 2], s),
                ],
                1,
            ),
            np.stack(
                [
                    _crossing(two[:, 0], two[:, 1], s),
                    _crossing(two[:, 0], two[:, 2], s),
                ],
                1,
            ),
        ]
    )


def _sections(tetrahedrons, hidden, s):
    """Return the triangles of the sections of tetrahedrons by the plane (as pairs of
    points, of shape ``(n, 3, 2)``) and the tetrahedron of each."""
    h = hidden[tetrahedrons]
    count = h.sum(axis=1)
    order = np.argsort(h, axis=1, kind="stable")
    v = np.take_along_axis(tetrahedrons, order, axis=1)
    x = lambda rows, i, j: _crossing(v[rows, i], v[rows, j], s)  # noqa: E731

    # one hidden point (3) or one kept point (0): a triangle
    one = np.flatnonzero(count == 1)
    three = np.flatnonzero(count == 3)
    # two hidden points: the quad on the edges 0-2, 0-3, 1-3 and 1-2
    two = np.flatnonzero(count == 2)
    parts = [
        np.stack([x(one, 0, 3), x(one, 1, 3), x(one, 2, 3)], 1),
        np.stack([x(three, 0, 1), x(three, 0, 2), x(three, 0, 3)], 1),
        np.stack([x(two, 0, 2), x(two, 0, 3), x(two, 1, 3)], 1),
        np.stack([x(two, 0, 2), x(two, 1, 3), x(two, 1, 2)], 1),
    ]
    return np.concatenate(parts), np.concatenate([one, three, two, two])


def _shared(base, npoints):
    """Return a number of every point of the base: its point of the mesh, if it is
    one, or else the number of the first point of the base with the same weights
    after the points of the mesh. So the points of the cut are shared by neighbouring
    cells and by the outer surface, e.g. on an edge between the same points."""
    base = base.copy()
    base.sort_indices()
    lengths = np.diff(base.indptr)
    result = npoints + np.arange(base.shape[0])
    for length in np.unique(lengths[lengths > 0]):
        rows = np.flatnonzero(lengths == length)
        at = base.indptr[rows][:, None] + np.arange(length)
        indices, weights = base.indices[at], base.data[at]
        if length == 1:
            node = weights[:, 0] == 1.0
            result[rows[node]] = indices[node, 0]
            rows, indices, weights = rows[~node], indices[~node], weights[~node]
        keys = np.hstack([indices, np.round(weights, 12)])
        _, first, inverse = np.unique(
            keys, axis=0, return_index=True, return_inverse=True
        )
        result[rows] = npoints + rows[first][inverse.ravel()]
    return result


def _quads(template, n):
    """Return the quads of the subdivision of a quad template, oriented like its
    ring, with the points of the template."""
    ij = np.rint(template.params * n).astype(int)
    grid = np.empty((n + 1, n + 1), dtype=np.int64)
    grid[ij[:, 0], ij[:, 1]] = np.arange(len(ij))
    a, b = (x.ravel() for x in np.meshgrid(np.arange(n), np.arange(n)))
    return np.stack(
        [grid[a, b], grid[a + 1, b], grid[a + 1, b + 1], grid[a, b + 1]], axis=1
    )


def _faces(cells, cell_type, order, npoints):
    """Return the triangles of every face of every cell, with the matrix of their
    points (which interpolates the values at the points of the mesh) and the cell of
    every triangle.

    The points and the triangles of a face are those of the outer surface of FElupe
    (``triangulate_surface``), subdivided for quadratic cells, of the ring of the face
    in its cell. A quad that two of the cells share is triangulated at the center of
    every subdivision instead: the diagonal of a quad depends on the ring, i.e. on the
    cell, and both cells have to cut it alike."""
    kind = CORNERS[cell_type][0]
    element, _ = _element(cell_type, cells.shape[1])
    rings = FACES[kind]
    ncells, size = cells.shape

    # the quads that two of the cells share, by their sorted corners
    keys = np.concatenate(
        [
            np.pad(
                np.sort(cells[:, ring], axis=1),
                ((0, 0), (0, 4 - len(ring))),
                constant_values=-1,
            )
            for ring in rings
        ]
    )
    _, inverse, counts = np.unique(
        keys, axis=0, return_inverse=True, return_counts=True
    )
    shared = (counts[inverse.ravel()] > 1).reshape(len(rings), ncells)

    rows, triangles, owners = [], [], []
    offset = 0
    for f, ring in enumerate(rings):
        template = _template(len(ring), order)
        weights = template.weights(ring, element, size)
        local = [template.triangles]
        inner = np.zeros(ncells, dtype=bool)
        if len(ring) == 4:
            # the centers of the subdivisions, for the shared quads
            quads = _quads(template, order)
            center = len(weights) + np.arange(len(quads))
            weights = np.concatenate([weights, weights[quads].mean(axis=1)])
            local.append(
                np.concatenate(
                    [
                        np.column_stack([quads[:, k], quads[:, (k + 1) % 4], center])
                        for k in range(4)
                    ]
                )
            )
            inner = shared[f]
        count = len(weights)
        rows.append(
            csr_matrix(
                (
                    np.tile(weights.ravel(), ncells),
                    (
                        np.repeat(np.arange(ncells * count), size),
                        np.repeat(cells, count, axis=0).ravel(),
                    ),
                ),
                shape=(ncells * count, npoints),
            )
        )
        for which, tri in zip((~inner, inner), local, strict=False):
            of = np.flatnonzero(which)
            points = offset + of[:, None, None] * count + tri[None]
            triangles.append(points.reshape(-1, 3))
            owners.append(np.repeat(of, len(tri)))
        offset += ncells * count

    matrix = vstack(rows, format="csr")
    matrix.eliminate_zeros()
    faces = SimpleNamespace(
        triangles=np.concatenate(triangles), owners=np.concatenate(owners)
    )
    return faces, matrix


def cut(surface, points, cells, cell_type, plane, order=1):
    """Clip the outer surface of cells at a plane and cut the cells.

    Parameters
    ----------
    surface : felupe.view._surface.Surface
        The outer surface of the cells (``triangulate_surface`` of FElupe).
    points : ndarray
        The points of the mesh.
    cells : ndarray
        The cells of the outer surface, by the points of the mesh.
    cell_type : str
        The type of the cells.
    plane : tuple
        The axis, the coordinate and the sign of the hidden half, see :func:`plane`.
    order : int, optional
        The subdivisions of the faces of the cells, those of the outer surface
        (default is 1).

    Returns
    -------
    Cut
        The clipped outer surface and the cut face.
    """
    axis, value, sign = plane
    points = np.asarray(points, dtype=float)
    cells = np.asarray(cells)
    npoints = len(points)
    coordinate = points[:, axis] if axis < points.shape[1] else np.zeros(npoints)
    tolerance = 1e-9 * max(np.abs(points).max(initial=0.0), abs(value))

    def distance(x):
        # the signed distance to the plane, positive in the hidden half (on the plane:
        # zero, which is hidden)
        s = sign * (x - value)
        s[np.abs(s) <= tolerance] = 0.0
        return s

    outer = surface.interpolation.tocsr()
    s_outer = distance(outer @ coordinate)
    count = (s_outer[surface.triangles] >= 0).sum(axis=1)

    # the cells that cross the plane: by their points, and the owners of the clipped
    # triangles of the outer surface (a curved face may cross between its points)
    planar = CORNERS.get(cell_type, (None,))[0] in PLANAR
    crossing = np.zeros(len(cells), dtype=bool)
    if not planar:
        kept = distance(coordinate)[cells] < 0
        crossing = kept.any(axis=1) & ~kept.all(axis=1)
        crossing[surface.owners[(count == 1) | (count == 2)]] = True
    crossed = np.flatnonzero(crossing)

    # the base: the points of the outer surface, of the faces of the crossed cells
    # (on their own points) and the centers of the crossed cells
    blocks = [outer]
    if crossed.size:
        faces, of_faces = _faces(cells[crossed], cell_type, order, npoints)
        corners = CORNERS.get(cell_type, (None, cells.shape[1]))[1]
        centers = csr_matrix(
            (
                np.full(crossed.size * corners, 1 / corners),
                (
                    np.repeat(np.arange(crossed.size), corners),
                    cells[crossed, :corners].ravel(),
                ),
            ),
            shape=(crossed.size, npoints),
        )
        blocks += [of_faces, centers]
    base = vstack(blocks, format="csr")
    s = distance(base @ coordinate)
    hidden = s >= 0

    # the points of the base, shared by neighbouring cells and the outer surface
    nodes = _shared(base, npoints)
    s_nodes = np.zeros(npoints + base.shape[0])
    s_nodes[nodes] = s

    triangles, parents = _clip(surface.triangles, hidden, s)
    edges = [_clip_edges(surface.edges, hidden, s)]
    section = np.zeros((0, 3, 2), dtype=np.int64)
    owners = surface.owners[parents]
    face_numbers = surface.faces[parents]
    if planar:
        edges.append(_lines(surface.triangles, hidden, s))
    elif crossed.size:
        offset = outer.shape[0]
        center = offset + of_faces.shape[0] + faces.owners
        tetrahedrons = np.column_stack([faces.triangles + offset, center])
        section, of_section = _sections(tetrahedrons, hidden, s)
        edges.append(_lines(faces.triangles + offset, hidden, s))
        cell = faces.owners[of_section]
        owners = np.concatenate([owners, crossed[cell]])
        first = int(surface.faces.max(initial=-1)) + 1
        face_numbers = np.concatenate([face_numbers, first + cell])

    # the points of the cut, numbered once by a key of their pair of points: in 64
    # bits, since an index (np.intp) is 32 bits in Pyodide (wasm32), where the key
    # overflowed for more than 46,340 points (#442)
    pairs = np.concatenate(
        [triangles.reshape(-1, 2), section.reshape(-1, 2)]
        + [e.reshape(-1, 2) for e in edges]
    )
    pairs = nodes[pairs].astype(np.int64)
    size = npoints + base.shape[0]
    unique, inverse = np.unique(pairs[:, 0] * size + pairs[:, 1], return_inverse=True)
    a, b = unique // size, unique % size
    same = a == b
    t = np.where(same, 0.0, s_nodes[a] / np.where(same, -1.0, s_nodes[a] - s_nodes[b]))
    rows = np.arange(len(unique))
    weights = csr_matrix(
        (
            np.concatenate([1 - t, t]),
            (np.concatenate([rows, rows]), np.concatenate([a, b])),
        ),
        shape=(len(unique), size),
    )
    of_nodes = vstack([identity(npoints, format="csr"), base], format="csr")
    interpolation = (weights @ of_nodes).tocsr()
    interpolation.eliminate_zeros()

    index = inverse.ravel()
    ntriangles = len(triangles) + len(section)
    all_triangles = index[: 3 * ntriangles].reshape(-1, 3)
    segments = index[3 * ntriangles :].reshape(-1, 2)

    # the cut face towards the hidden half, without triangles of no area
    nouter = len(triangles)
    positions = interpolation @ np.pad(points, ((0, 0), (0, 3 - points.shape[1])))
    p = positions[all_triangles[nouter:]]
    normal = np.cross(p[:, 1] - p[:, 0], p[:, 2] - p[:, 0])[:, axis] * sign
    flip = normal < 0
    all_triangles[nouter:][flip] = all_triangles[nouter:][flip][:, [0, 2, 1]]
    area = np.full(ntriangles, np.inf)
    area[nouter:] = np.abs(normal)
    distinct = (
        (all_triangles[:, 0] != all_triangles[:, 1])
        & (all_triangles[:, 1] != all_triangles[:, 2])
        & (all_triangles[:, 2] != all_triangles[:, 0])
    )
    keep = distinct & (area > tolerance**2)

    # the edges once, without segments of no length
    segments = np.unique(np.sort(segments, axis=1), axis=0)
    segments = segments[segments[:, 0] != segments[:, 1]]

    return Cut(
        interpolation=interpolation,
        triangles=all_triangles[keep],
        owners=owners[keep],
        faces=face_numbers[keep],
        edges=segments,
        outer=int(keep[:nouter].sum()),
        sources=parents[keep[:nouter]],
    )
