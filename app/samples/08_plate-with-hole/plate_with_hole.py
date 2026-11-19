"""A quarter of a plate with a hole, in the xy-plane.

FElupe Studio runs this script with the parameters of the model as variables: the
radius of the hole, the half width of the square plate and the fineness. The
quarter is made of two patches between the arc of the hole and the edges x = width
and y = width, which meet at 45 degrees.
"""

import felupe as fem
import numpy as np

# the parameters of the model, or these values if the script runs alone
radius = globals().get("radius", 10)
width = globals().get("width", 40)
cells = globals().get("cells", 8)


def patch(start, end, edge):
    """The cells between the arc of the hole and an edge of the plate."""
    phi = np.linspace(start, end, cells + 1)
    arc = fem.mesh.Line(n=cells + 1)
    arc.update(points=radius * np.column_stack([np.cos(phi), np.sin(phi)]))
    outer = fem.mesh.Line(n=cells + 1)
    outer.update(points=edge(phi))
    return fem.mesh.fill_between(arc, outer, n=cells + 1).flip()


right = patch(
    0,
    np.pi / 4,
    lambda phi: np.column_stack([np.full_like(phi, width), width * np.tan(phi)]),
)
top = patch(
    np.pi / 4,
    np.pi / 2,
    lambda phi: np.column_stack(
        [width * np.cos(phi) / np.sin(phi), np.full_like(phi, width)]
    ),
)
mesh = fem.MeshContainer([right, top], merge=True, decimals=8).stack()
