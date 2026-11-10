# 0006 Control points

Status: Accepted

## Context

A multi-point constraint (`fem.MultiPointConstraint`) connects points of the mesh to a control point, its center point, and optionally to a rotation point. These points are usually not nodes of the imported mesh: the center of a face plus an offset, or a point whose coordinates are not used at all (the rotation point). For a single mesh, FElupe adds such points with `fem.Mesh.add_points()`.

A model of felupe-studio has one field container per section, merged into the top-level field with `fem.field.merge`. The point sets of the script are masks of `field.mesh_container.points`, and point ids of the merged mesh change when a section is added or removed (#63, #92).

## Decision

A control point is a command of its own, `point.add {name, coordinates}`. All control points of a model form one mesh of vertices, with a field container of its own that is merged after the fields of the sections:

```python
region_control_points = vertex_region([[4, 0.5, 0.5]])
field_control_points = fem.FieldContainer([fem.Field(region_control_points, dim=3)])
field = fem.field.merge([field_section_hard, field_section_soft, field_control_points])

points = field.mesh_container.points
control = points_at(points, [4, 0.5, 0.5])
```

- `vertex_region(points)` is a helper of the script: `fem.RegionVertex` of a `fem.Mesh` with one `vertex` cell per point.
- A control point is a point set of one point (kind `pointset`), found by its coordinates like a point set by nodes. Boundaries, the curve of a job and later the constraints reference it by its name.
- The control point has no stiffness of its own. Until a constraint connects it, the validation requires a boundary of all components x, y and z on it (a problem in the app and in Python, with the shared validation cases).
- The results and exports show the cells of the sections only; the control point has no surface.
- `control_points`, `vertex_region`, `points_at` and `mixed_region` are reserved names.

A spike with FElupe 12 verified the pattern: a multi-point constraint from the points of an end face to a control point, a boundary on the control point and a characteristic curve converge.

## Consequences

- The fields and solid bodies of the sections are unchanged by control points; a section does not own a point that is not part of its cells.
- A control point keeps its identity when sections change, because it is found by its coordinates.
- A control point at the coordinates of a node of a mesh is merged with that node by `fem.field.merge` (it is the node then, with its stiffness); the app should warn about this (#95, #96).

## Alternatives

- `fem.Mesh.add_points()` on the mesh of a section: the point would belong to one section (and to its region and field), its id would depend on that section, and a model with several sections has no natural owner for it.
- Points by ids of the merged mesh: fragile, the ids change with the sections.
