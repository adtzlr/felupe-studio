"""A rubber-metal bushing, like the example ex05 of FElupe.

FElupe Studio runs this script with the parameters of the model as variables:
the lengths of the sleeves, their thickness, the runout of the rubber and the
fineness of the mesh. The inner sleeve is inside at the radius 25, the outer sleeve
outside at the radius 65 (the point sets of the model). It makes a dict of the
rubber and the metal meshes, revolved about the x axis.
"""

import felupe as fem
import numpy as np

# the parameters of the model, or these values if the script runs alone
inner_length = globals().get("inner_length", 100)
outer_length = globals().get("outer_length", 60)
sleeve = globals().get("sleeve", 5)
runout = globals().get("runout", 0.2)
cells_axial = globals().get("cells_axial", 5)
cells_radial = globals().get("cells_radial", 7)
cells_around = globals().get("cells_around", 18)

# the inside of the inner sleeve and the outside of the outer sleeve
INNER, OUTER = 25, 65
inside, outside = INNER + sleeve, OUTER - sleeve

# the section of the rubber between two lines in the xy plane, with runouts
bottom = fem.mesh.Line(a=-inner_length / 2, b=inner_length / 2, n=cells_axial + 1)
top = fem.mesh.Line(a=-outer_length / 2, b=outer_length / 2, n=cells_axial + 1)
bottom.update(points=np.pad(bottom.points, ((0, 0), (0, 1)), constant_values=inside))
top.update(points=np.pad(top.points, ((0, 0), (0, 1)), constant_values=outside))
section = fem.mesh.fill_between(bottom, top, n=cells_radial + 1)
section = section.add_runouts(
    axis=1, centerpoint=[0, (inside + outside) / 2], values=[runout], normalize=True
)

# revolved about the x axis, with the sleeves
around = {"n": cells_around + 1, "phi": 360}
rubber = section.revolve(**around)
metal = fem.MeshContainer(
    [
        fem.Rectangle(
            a=(-inner_length / 2, INNER),
            b=(inner_length / 2, inside),
            n=(cells_axial + 1, 3),
        ).revolve(**around),
        fem.Rectangle(
            a=(-outer_length / 2, outside),
            b=(outer_length / 2, OUTER),
            n=(cells_axial + 1, 3),
        ).revolve(**around),
    ],
    merge=True,
).stack()
mesh = {"rubber": rubber, "metal": metal}
