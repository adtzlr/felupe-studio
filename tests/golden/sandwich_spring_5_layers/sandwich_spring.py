"""A rubber-metal sandwich spring: rubber discs, steel sheets.

FElupe Studio runs this script with the parameters of the model as variables:
radius, layers, height, sheet and cells. It makes a dict of two meshes on the same
points, the rubber and the metal, from the bottom: a sheet, then a rubber layer and
a sheet per layer.
"""

import felupe as fem
import numpy as np

disc = fem.Circle(radius=radius, n=cells)

# the thickness and the number of cells through it of every layer, from the bottom
thickness = [sheet] + [height, sheet] * layers
divisions = [1] + [2, 1] * layers
bottom = np.concatenate([[0], np.cumsum(thickness)[:-1]])
parts = [
    disc.expand(n=n + 1, z=t).translate(z, axis=2)
    for t, n, z in zip(thickness, divisions, bottom, strict=True)
]

# all layers on the same points, merged at the faces between them
stack = fem.MeshContainer(parts, merge=True, decimals=8)
mesh = {
    "rubber": fem.MeshContainer(stack.meshes[1::2]).stack(),
    "metal": fem.MeshContainer(stack.meshes[0::2]).stack(),
}
