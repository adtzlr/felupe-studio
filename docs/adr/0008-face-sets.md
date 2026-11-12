# 0008 Face sets

Status: Accepted

## Context

A pressure (#105) and later other surface loads act on faces, not on points. FElupe integrates them over a boundary region: `fem.RegionHexahedronBoundary(mesh, mask=...)` (and the quadratic variants) takes the outer faces of the cells of a mesh whose points are all in a point mask, and a field on this region, linked to the field of the solid, is the field of `fem.SolidBodyPressure`. FElupe 12 has no boundary regions of tetrahedrons (`fem.RegionBoundary` raises for them).

A model of felupe-studio has one field container per section, merged with `fem.field.merge`, which reloads the region of every section with the merged mesh (ADR 0006). Ids of points and faces of the merged mesh change when a section is added or removed.

## Decision

A face set is a command of its own, `faceset.add {name, section, select}`: faces of the boundary of one section.

- **On a plane** (`select: {axis, value, atol}`), like a point set: the outer faces of the section whose points are all on the plane (`np.isclose`, `atol` 1e-8).
- **By their centers** (`select: {centers: [[x, y, z], ...], atol}`), e.g. faces picked in the viewport: the center of a face is the mean of its points (4 of a linear face, 8 or 9 of a quadratic one). Every center takes the nearest outer face of the section within `atol` (by default 1e-6 of the size of the section, so that rounded or merged coordinates still find their face). Faces are stored by their centers, not by ids, for the same reason as the points of point sets and control points (ADR 0006).

The script makes the faces with a helper, after the merge, on the merged mesh of the section:

```python
region_lid = boundary_faces(region_rubber_block.mesh, plane=(2, 20))
field_lid = fem.FieldContainer([fem.Field(region_lid, dim=3)])
field_lid.link(field)
```

- `boundary_faces(mesh, plane=None, centers=None, atol=None)` and `BOUNDARY_REGIONS` (by cell type) are embedded only in scripts with face sets; they are reserved names.
- FElupe selects faces by a mask of points. For picked faces the helper takes the boundary region of the cells of the chosen faces (each cell once) with the points of these faces as mask. This is exact also for a ring of faces around a face that is not picked; it raises a `ValueError` if the points still select other faces, e.g. both sides of a plate one cell thick (use two face sets or a plane).
- A face set of a section of tetrahedrons is an issue of the model in the app (a note at the face set, Solve is blocked); the helper raises a `NotImplementedError`.

In the app, the faces of a section are the triangles of the drawn surface of its mesh, grouped by the face of their cell (`faces` of linear cells, `curved` of `felupe_studio.scene.surface()` for quadratic cells) and owned by a cell of the section; a face of two cells of the section (an interface of cell tags inside it) is not on its boundary. Their centers come from the exact coordinates of the nodes (not the float32 surface), like the script.

## Consequences

- Face sets keep their identity when sections change; the pressure of #105 takes a face set and its field.
- Faces of tetrahedrons need an upstream change in FElupe.
- An explicit selection of faces in `fem.RegionBoundary` (e.g. by indices of cell faces) would make the selection of picked faces exact in all cases; until then, the helper reports the ambiguous case.

## Alternatives

- **Ids of faces** (cell and local face): change with the cells of the sections and with the merge, like point ids.
- **A point set as face set** (all faces whose points are in a point set): simple, but a face set of picked faces would also take the faces enclosed by them, and a point set of a plane already selects faces of other sections.
- **One face set for all sections:** a boundary region needs one mesh and one cell type; a pressure on faces of two sections takes two face sets.
