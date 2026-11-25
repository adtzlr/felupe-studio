"""The coordinate systems of the Cartesian constraints (#421), like
``app/src/core/cartesian.ts``.

A Cartesian constraint holds or moves its points in the directions of a rotated
coordinate system that is fixed in space: the base vectors e1, e2 and e3 = e1 × e2,
normalized. In a 2D model, e2 is e1 turned by 90° about z. The generated script
computes the same matrix with ``base_vectors()`` of its helpers.
"""

from math import hypot

# the second base vector of a 3D model by default
E2 = (0, 1, 0)

# the tolerance of orthogonal base vectors, like np.allclose() of FElupe
TOLERANCE = 1e-8


def norm(vector):
    """The length of a vector."""
    return hypot(*vector)


def unit(vector):
    """A vector of length one (None for a vector of zero length)."""
    length = norm(vector)
    return None if length == 0 else [float(v) / length for v in vector]


def cross(a, b):
    """The cross product of two vectors of three components."""
    return [
        a[1] * b[2] - a[2] * b[1],
        a[2] * b[0] - a[0] * b[2],
        a[0] * b[1] - a[1] * b[0],
    ]


def vectors(command):
    """The base vectors e1 and e2 as written, with the default of e2 (in 3D), as
    floats.

    Examples
    --------
    >>> vectors({"e1": [1, 0, 1]})
    ([1.0, 0.0, 1.0], [0.0, 1.0, 0.0])
    """
    e1 = [float(v) for v in command["e1"]]
    e2 = [float(v) for v in command.get("e2", E2)]
    return e1, e2


def orthogonal(e1, e2):
    """Whether two base vectors (of non-zero length) are orthogonal."""
    a, b = unit(e1), unit(e2)
    return abs(sum(x * y for x, y in zip(a, b, strict=True))) <= TOLERANCE


def base_vectors(command, dim=3):
    """The normalized base vectors of the coordinate system of a Cartesian constraint,
    as rows: e1, e2 and e3 of a 3D model, e1 and e1 turned by 90° about z of a 2D
    model (of two components). None if a base vector has zero length.

    Examples
    --------
    >>> base_vectors({"e1": [0, 0, 2], "e2": [1, 0, 0]})
    [[0.0, 0.0, 1.0], [1.0, 0.0, 0.0], [0.0, 1.0, 0.0]]
    >>> base_vectors({"e1": [0, 2, 0]}, dim=2)
    [[0.0, 1.0], [-1.0, 0.0]]
    """
    e1, e2 = vectors(command)
    if dim == 2:
        e1 = unit(e1[:2])
        return None if e1 is None else [e1, [-e1[1], e1[0]]]
    e1, e2 = unit(e1), unit(e2)
    if e1 is None or e2 is None:
        return None
    return [e1, e2, unit(cross(e1, e2)) or [0.0, 0.0, 0.0]]
