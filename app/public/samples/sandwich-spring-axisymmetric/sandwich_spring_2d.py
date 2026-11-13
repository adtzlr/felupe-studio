"""A rubber-metal sandwich spring as an axisymmetric model.

The section of rubber discs between steel sheets in the xy-plane: x is the axis of
rotation, y the radius. FElupe Studio runs this script with the parameters of the
model as variables: radius, layers, height, sheet, cells and cells_height. It makes
a dict of two meshes on the same points, the rubber and the metal, along the axis:
a sheet, then a rubber layer and a sheet per layer.
"""

import felupe as fem
import numpy as np

# the parameters of the model, or these values if the script runs alone
radius = globals().get("radius", 50)
layers = globals().get("layers", 3)
height = globals().get("height", 8)
sheet = globals().get("sheet", 2)
cells = globals().get("cells", 10)
cells_height = globals().get("cells_height", 4)

# the thickness and the number of cells through it of every layer, along the axis:
# one cell through a sheet
thickness = [sheet] + [height, sheet] * layers
divisions = [1] + [cells_height, 1] * layers
start = np.concatenate([[0], np.cumsum(thickness)[:-1]])
parts = [
    fem.Rectangle(a=(x, 0), b=(x + t, radius), n=(n + 1, cells + 1))
    for t, n, x in zip(thickness, divisions, start, strict=True)
]

# all layers on the same points, merged at the edges between them
stack = fem.MeshContainer(parts, merge=True, decimals=8)
mesh = {
    "rubber": fem.MeshContainer(stack.meshes[1::2]).stack(),
    "metal": fem.MeshContainer(stack.meshes[0::2]).stack(),
}
