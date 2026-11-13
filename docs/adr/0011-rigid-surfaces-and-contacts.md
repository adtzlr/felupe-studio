# 0011 Rigid surfaces and contacts

Status: Accepted

## Context

FElupe 12 has contacts of points with rigid surfaces: `fem.ContactRigidPlane` and `fem.ContactRigidCylinder` connect points of a field to a center point of the same field. A point that penetrates the plane or the cylinder is pushed back by a penalty, only in compression, with Coulomb friction and an optional elastic slip of sticking points. With `items`, the penalty is a multiplier of the mean stiffness of the solid bodies at the points, FElupe's recommendation. Contacts are items of the steps like multi-point constraints. Use cases are a spring pressed between plates (the example ex06 of FElupe), a roller and a tube around a bushing (#187).

Control points (ADR 0006) are vertices of their own mesh, merged into the field, and point sets of one point. Boundaries move them, and the curve of a job may be a boundary of one.

## Decision

- **A rigid surface is an object** (`rigid.add {name, coordinates, shape}`, #219): a reference point with a plane `{normal}` through it or a cylinder `{radius, axis, inside}` whose axis goes through it. The reference point is a vertex like the control points and a point set of one point named like the surface. So boundaries move the surface (ramped by the steps), a point load acts on it and the curve of a job on its boundary is the contact force over its displacement. A rigid surface does not rotate: FElupe keeps its normal and its axis. The reference point needs boundaries in all components (no stiffness of its own). A boundary of a point set that selects it counts, e.g. of a plane through it (#222).
- **A contact connects points to a surface** (`contact.add {name, points, surface, friction, multiplier, elastic_slip}`, #220): the points of a point set or of a face set may touch the surface. A point set takes the points of the cells of the sections only, not the vertices of control points on it. Several contacts may share one surface, and one point set may touch several surfaces, e.g. the points on the outer surface (`select: {surface: true}`, #222) of a spring and its two end stops.
- **The penalties follow the stiffness**: `items` are the solid bodies of all sections, and `multiplier` (default 1) scales the penalty. The script assembles the stiffness of the solid bodies once before the contacts, because a contact would otherwise assemble them with its own field, which fails with the vertices of the control points.
- **Contacts are constraints of the steps**: items of `fem.Step` with the multi-point constraints (`constraints`, default all).
- **2D models** (ADR 0010, #221): a plane is a line in the xy-plane (`normal=[nx, ny]`) and a cylinder a circle about z (`fem.ContactRigidCylinder` without an axis). The commands are the same as in 3D, with z = 0. In an axisymmetric model the penalty of a point does not follow its radius, so it needs a large multiplier (e.g. 1000) for an exact contact pressure.
- **The viewport** draws a plane as a translucent rectangle with an arrow of its normal and a cylinder as a translucent tube (in 2D a strip and a disc or ring). In the results, they move with their reference points. A selected contact highlights its points and its surface. The results of the reference points are those of the control points (card *Control points*, CSV).

## Consequences

- A surface is drawn, moved, hidden and plotted as one thing; a contact only says which points touch which surface with which friction.
- The golden cases compare contacts with prescribed displacements: a block pressed by a plane without and with friction, a plate in plane strain and an axisymmetric cylinder pressed by a line (within 1e-3, the penetration of the penalty), and check the points of a roller on a block and on a plate. The sample *Hyperelastic spring with end stops* agrees with the example ex06 of FElupe within 1e-3.
- A plate that is bonded to a face and is an end stop at the same time is one rigid surface whose reference point is on the plane of the face: the boundaries of the face move it, and the curve of the face is the force of the whole plate.
- Not supported: contact between two deformable bodies or of a body with itself (general contact, e.g. felupe-contact), rotating rigid surfaces, other shapes than planes and cylinders, and a contact whose friction or multiplier changes from step to step.

## Alternatives

- **The shape at the contact** (one object less): a surface touched by several point sets would be defined several times, and it could not be drawn, moved or plotted as one thing.
- **The shape at `point.add`**: a control point is a point; a rigid surface is a point with a shape. A kind of its own keeps the forms and the browser clear (group *Rigid Surfaces*).
- **Rigid bodies of their own (with rotations)**: a multi-point constraint with a rotation point already moves points rigidly; FElupe's contacts keep the normal and the axis of a surface.
