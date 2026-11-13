# 0010 2D models

Status: Accepted

## Context

FElupe solves plane strain and axisymmetric models with 2D cells (`triangle`, `quad` and their quadratic variants) and the fields `fem.FieldPlaneStrain` and `fem.FieldAxisymmetric` (`dim=2`), mixed fields with `fem.FieldsMixed(..., planestrain=True)` or `axisymmetric=True` (#175). Their deformation gradient and stresses are 3×3, their displacements and forces have two components. The axisymmetric field of FElupe takes x as the axis of rotation and y as the radius, and integrates over the circumference (dV = 2πr dA). A rotation point of a multi-point constraint of a 2D model has the rotation about z as its first component; FElupe locks the second one.

The commands, the viewer and the results of felupe-studio were made for 3D models: three components of boundaries, loads, symmetry planes and load cases, faces of 3D cells, scenes with three coordinates.

## Decision

A model is 3D or 2D by `analysis` of `model.settings`: `3d` (the default, so existing projects stay valid), `plane-strain` or `axisymmetric`, one type per model.

- **The commands keep three components.** A 2D model is the plane z = 0 of a 3D one: coordinates, centers and forces have a z that must be 0, boundaries, symmetry planes and load cases have no z, and the validation (Python and app, shared cases) reports a z where a 2D model has none. The script takes x and y (`[:dim]`). So the forms, the schema and the commands of 2D and 3D models are the same, and the type of a model can be changed with its commands.
- **Rotations about z.** The rotation point of a plane strain model keeps the meaning of a 3D model: a boundary of it constrains z (the rotation about z), a point load at it is a moment about z. The script maps them to the first component of FElupe (`skip=(0, 1)`, `values=[M_z, 0]`), and the runner maps the rotation and the moment back to three components with z, so the curve is _Moment–rotation_ with φz and Mz in 2D and in 3D. A rotation point of an axisymmetric model is an issue: a rotation about z is no motion of an axisymmetric body.
- **Meshes.** A 2D model has 2D cells, a 3D model 3D cells, also of mesh files and mesh scripts (`volume_cells(..., dim=2)` raises a clear message otherwise). The z of the points of a mesh file is dropped.
- **Face sets** of a 2D model are edges of quads, with the boundary regions of quads (`ensure_3d=True`) and a field of the class of the model; FElupe 12 has no boundary regions of triangles. The command stays `faceset.add`: its faces are the faces of the cells, which are edges for 2D cells.
- **Results** have three components with z = 0 (scenes, extremes, exports, control points), so the viewer, the contours and the exports are those of 3D models. A curve of a 2D model has two components (x and y), of a rotation point three. The forces are per unit thickness (plane strain) or totals over the circumference (axisymmetric); the script says so in a comment.
- **The viewport** opens a model in the plane z = 0 onto the xy-plane (_Iso_ returns to it), draws no boundaries in z (except the rotation about z) and takes the sides of the 2D cells as the faces of the sections: drawn as strips, picked as the nearest side of a clicked cell.

## Consequences

- Projects, forms, the command line and the schema need no 2D variants; switching the analysis shows what does not fit as issues.
- The golden cases compare 2D models with 3D models (a plane strain plate and a rotated end against the bar with fixed z) and with analytical forces (an axisymmetric cylinder in tension and under a pressure).
- Not supported: plane stress (FElupe has it only for linear elasticity), mixed 2D and 3D models, face sets of triangles, a revolved view of an axisymmetric model.

## Alternatives

- **Two components in the commands of 2D models:** exact, but every command, form and validation would need variants by the type of the model, and a model could not change its type.
- **The convention of FElupe for rotation points** (the rotation about z as the component x): fewer mappings, but the same command would mean a rotation about x in 3D and about z in 2D.
- **Edge sets as a command of their own:** clearer names, but the same selection, script and pressures as face sets.
