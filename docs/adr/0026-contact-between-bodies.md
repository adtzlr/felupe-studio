# 0026 Contact between bodies

Status: Accepted

## Context

ADR 0011 connects points with rigid surfaces. It did not support a contact between two deformable bodies, or of a body with itself, e.g. a rubber buffer pressed on a plate that bends, or the walls of a tube or of a slit that touch each other.

felupe-contact, an extension package of FElupe, has `SolidBodyContact`:
- a surface-to-surface contact of the faces on the outline of the meshes of solid bodies, with a regularized penalty and optional Coulomb friction;
- an item of a `fem.Step` like a `SolidBody`;
- 3D, plane strain and axisymmetric fields;
- the boundary regions of linear and quadratic hexahedrons and quads.

It also has a Nitsche contact (`SolidBodyContactNitsche`), which v0.12 leaves out. felupe-contact 0.1.0 is on PyPI and a dependency of felupe-studio (#461). The app loads its wheel only for a model with a contact between bodies.

A spike (#460) ran `SolidBodyContact` in a script like the generated one. The contact takes the solid bodies of the sections after `fem.field.merge`, also with mixed fields and the vertices of control points, and the point sets of the script limit its faces.

## Decision

- **A command of its own,** `bodycontact.add {name, section, primary, points, points_primary, …}` (#462), beside `contact.add` of the rigid surfaces, of the kind *constraint*.
  - A project with it does not open in v0.11, which names the command (#344).
  - The forms of the two kinds of contact stay apart: a rigid surface and its points here, two sections there.
- **The arguments of `SolidBodyContact`, with its names and defaults:**
  - `section` and `primary` are the sections of the secondary and of the primary surface (`field`, `field_primary`). Without `primary`, the section is its own primary surface, so all bodies of its mesh may touch each other.
  - `points` and `points_primary` are point sets that limit the faces (`mask`, `mask_primary`).
  - The others are as in felupe-contact, e.g. `penalty_scale`, not `multiplier` of `contact.add`, so the script and the documentation of felupe-contact read alike.
  - `items` is not a field: felupe-contact estimates the penalty from the solid bodies of the sections.
  - The friction (`friction`, `elastic_slip`, `penalty_tangential`, `symmetric`) follows in #463.
- **The script** imports `SolidBodyContact` only if it has a contact between bodies, so the other scripts are unchanged. The contact is made after the solid bodies: `SolidBodyContact(solid_rubber, solid_steel, mask=..., penalty_scale=100)`.
- **The steps:**
  - The contact is a constraint of the steps (`constraints`, default all), but not by default of a step that leaves out one of its sections. A step that names it and leaves out one of its sections is an issue.
  - In a script with meshes of scripts, a section may have no volume (#429), and felupe-contact fails on a degenerate cell. So the contact is then `None` (`if has_volume(...) else None`), and the steps take the contacts that the script made (`*present(...)`).
- **The checks:**
  - Before *Solve*: the cells of its sections are hexahedrons or quads, linear or quadratic (`checks.contact_problem()`, `contactNotes()` of the app).
  - Rules of the commands: a point set of a control point, a section of the third medium (which fills the gap instead of a contact), and a step without its sections.
- **The warnings of felupe-contact,** e.g. *no contact will be detected* of one body without `self_contact`, are events `warning` of the run. The app shows them with the job, and the tool `solve` of the MCP server returns them.

## Consequences

- **Accuracy:** the golden cases compare the contact with the rubber body held by boundaries, without a contact. The difference is the penetration of the penalty:
  - 4.7e-3 for a block on a steel plate in 3D, and 4.6e-3 for a pad in plane strain, with `penalty_scale=100`, and 2.2e-2 with the default 10;
  - 1.6e-2 for a cylinder on a disc, axisymmetric with mixed fields, with `penalty_scale=100`.
- **Self-contact:** `slit_self_contact_plane_strain` closes the slit of one body with `self_contact`; without the contact, its arms pass through each other.
- **Single precision:** felupe-contact 0.1.0 assembles the contact in `float64`. FElupe then estimates the round-off of the `float32` forces of the solid bodies with the epsilon of `float64`, and the residual of a steel body in contact with rubber stalls above it, also at the default tolerance (adtzlr/felupe-contact#16). Such a model is solved in double precision; the self-contact of rubber converges.
- **Not supported:**
  - the Nitsche contact;
  - results of the contact, e.g. the contact pressure;
  - contact surfaces of tetrahedrons and triangles, and of face sets;
  - arguments that change from step to step.

## Alternatives

- **A variant of `contact.add`** (a `oneOf` of a rigid surface and of two sections): one command fewer. But v0.11 would report a missing `surface` instead of naming what it does not know, and the fields of the two would mix in one form.
- **Face sets as contact surfaces:** a face set is a boundary region of a section. felupe-contact takes field containers on boundary regions, but then it needs the items for its penalty and identifies the bodies by the cells of the boundary regions. The point sets of `mask` keep the solid bodies, so the penalty and the bodies come from the sections.
- **The names of `contact.add`** (`multiplier` for `penalty_scale`): consistent within felupe-studio, but the script would not read like felupe-contact, and the meaning differs (a factor of the stiffness at the points, or of an estimate per area).
