"""A sandwich spring: hyperelastic discs between steel sheets.

FElupe Studio runs this script with the parameters of the model as variables:
radius, layers, height, sheet, cells and cells_height. It makes a dict of two meshes
on the same points, the soft and the metal one, from the bottom: a sheet, then a
soft layer and a sheet per layer.
"""

import felupe as fem
import numpy as np

# the parameters of the model, or these values if the script runs alone
radius = globals().get("radius", 50)
layers = globals().get("layers", 3)
height = globals().get("height", 8)
sheet = globals().get("sheet", 2)
cells = globals().get("cells", 4)
cells_height = globals().get("cells_height", 2)

disc = fem.Circle(radius=radius, n=cells)

# the thickness and the number of cells through it of every layer, from the bottom:
# one cell through a sheet
thickness = [sheet] + [height, sheet] * layers
divisions = [1] + [cells_height, 1] * layers
bottom = np.concatenate([[0], np.cumsum(thickness)[:-1]])
parts = [
    disc.expand(n=n + 1, z=t).translate(z, axis=2)
    for t, n, z in zip(thickness, divisions, bottom, strict=True)
]

# all layers on the same points, merged at the faces between them
stack = fem.MeshContainer(parts, merge=True, decimals=8)
mesh = {
    "soft": fem.MeshContainer(stack.meshes[1::2]).stack(),
    "metal": fem.MeshContainer(stack.meshes[0::2]).stack(),
}
