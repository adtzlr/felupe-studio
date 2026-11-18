"""The section of a metacone, a conical rubber-metal spring.

Like the example ex15 of FElupe: two rubber layers between three steel sheets in
the xy-plane of an axisymmetric model (x is the axis, y the radius).

FElupe Studio runs this script with the parameters of the model as variables: the
thickness of the sheets, the number of cells along the layers and through a rubber
layer. The sheets are lines expanded to cells; the rubber layers get runouts at
their free ends, the cone is rotated by 15 degrees and the inner and the outer
sleeve are made flat (at the radii 2 and 8 + the thickness of the sheets). With the
default values, the mesh is the one of ex15.
"""

import felupe as fem
import numpy as np

# the parameters of the model, or these values if the script runs alone
sheet = globals().get("sheet", 0.5)
cells = globals().get("cells", 20)
cells_layer = globals().get("cells_layer", 10)

# the sheets: their inner radius and their start and end along the axis
n = cells + 1
lines = []
for radius, start, end in [(2, 0, 13), (4.5, -0.2, 10), (6.5, -0.4, 7)]:
    for offset in (0, sheet):
        line = fem.mesh.Line(a=start, b=end, n=n).expand(n=1)
        lines.append(line.translate(radius + offset, axis=1))

# a sheet, a rubber layer, a sheet, a rubber layer and a sheet
layers = [2, cells_layer + 1, 2, cells_layer + 1, 2]
faces = fem.MeshContainer(
    [
        first.fill_between(second, n=layers)
        for first, second, layers in zip(lines[:-1], lines[1:], layers, strict=True)
    ]
)

# the runouts of the rubber layers at their free ends
for layer, runout in [(1, 3), (3, 7)]:
    face = faces[layer]
    used = np.unique(face.cells)
    moved = face.add_runouts(
        [runout],
        centerpoint=face.points[used].mean(axis=0) - np.array([2, 0]),
        axis=1,
        exponent=2.5,
        mask=used,
        normalize=True,
    )
    faces.points[:] = moved.points

# the points of the first and the last line, rotated to the cone, flat sleeves
faces.points[:n] = faces.points[n : 2 * n]
faces.points[-n:] = faces.points[-2 * n : -n]
faces.points[:] = faces[0].rotate(15, axis=2).points
faces[0].y[:n] = 2
faces[-1].y[-n:] = 8 + sheet

# the rubber and the metal on the same points, merged at the lines between them
rubber, metal = fem.MeshContainer(
    [faces.stack([1, 3]), faces.stack([0, 2, 4])], merge=True, decimals=4
)
mesh = {"rubber": rubber, "metal": metal}
