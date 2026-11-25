"""The axes of the cylindrical constraints (#422), like ``app/src/core/cylindrical.ts``.

A cylindrical constraint holds or moves its points radially (r), around (theta) and
along (z) an axis through a center. The directions are those of each point about
the axis; FElupe evaluates them in the deformed configuration, with the base
vectors turned by the prescribed arc length around the axis. In a 2D model, the
axis is z.
"""

# the axis by default, and the only axis of a 2D model
AXIS = (0, 0, 1)


def axis(command):
    """The axis of a cylindrical constraint as written, with its default, as floats.

    Examples
    --------
    >>> axis({"axis": [1, 0, 0]})
    [1.0, 0.0, 0.0]
    >>> axis({})
    [0.0, 0.0, 1.0]
    """
    return [float(v) for v in command.get("axis", AXIS)]
