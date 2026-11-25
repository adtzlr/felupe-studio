# Command reference

<!-- Generated from python/felupe_studio/commands.schema.json by
     `python docs/make_reference.py`. Do not edit. -->

Every command of a project creates one named object. The [user guide](guide.md) shows how the commands work together, [commands.md](commands.md) how they become a FElupe script.

A project file is a JSON document `{"schema_version": 3, "commands": [...]}`. Every command has the key `command` and a unique `name`; other commands reference the object by its name. Older project files are migrated when they are opened.

## Names

Name of an object, unique within the command list. Used as a Python identifier in the generated script; at most 24 characters keep the script readable.

A name matches `^[A-Za-z_][A-Za-z0-9_]*$` and has at most 24 characters. Reserved, because the script uses them: `BOUNDARY_REGIONS`, `BoundarySwitch`, `CONDENSED`, `CORNERS`, `CylindricalCurve`, `CylindricalCurvePlugin`, `DIMENSIONS`, `EDGES`, `Held`, `REGIONS`, `SimpleNamespace`, `base_vectors`, `boundaries`, `boundary_faces`, `boundary_switch`, `cell_volumes`, `condensed_region`, `control_points`, `embed`, `fem`, `field`, `fields_without_volume`, `has_volume`, `hold_dual_fields`, `iterative_solver`, `meshio`, `mixed_field`, `mixed_region`, `nearly_incompressible`, `np`, `pick`, `points`, `points_at`, `pypardiso`, `run_mesh_script`, `script_mesh`, `single_point`, `single_precision`, `solid_points`, `solid_types`, `spsolve`, `surface_points`, `vertex_region`, `volume_cells`, `with_volume`; names starting with `field_`, `solid_`, `region_`, `ramp_`; and the keywords of Python.

## Expressions

A number of a command (*or an expression* below) may be an expression of the parameters as a string, e.g. `"end": "0.25 * layers * height"` (#242, [ADR 0013](adr/0013-expressions-of-parameters.md)): numbers, the names of the parameters, `pi`, `+ - * / **`, parentheses and the functions `sqrt`, `exp`, `log`, `sin`, `cos`, `tan`, `abs`, `min` and `max`. It is evaluated with the values of the parameters, the script shows it as written. A parameter whose value is an expression is a derived parameter ([ADR 0021](adr/0021-derived-parameters.md)). The range and the step of `parameter.add`, the numbers that name things (a tag, ids) and the decimals of `mesh.merge` are numbers. See [Expressions of parameters](commands.md#expressions-of-parameters).

## Commands

- [`model.settings`](#modelsettings): The settings of the model, at most once.
- [`parameter.add`](#parameteradd): A parameter of the model: a number, e.g. a dimension or the number of cells of a mesh made by a script, or a derived parameter, an expression of other parameters (ADR 0021).
- [`mesh.import`](#meshimport): Import a mesh file (read with meshio).
- [`mesh.script`](#meshscript): A mesh made by a Python script next to the project, e.g. with the mesh tools of FElupe.
- [`mesh.generate`](#meshgenerate): A mesh made by a mesh tool of FElupe (ADR 0019): a primitive like a line, a rectangle or a cube, or an operation on meshes of the model before (made by tools, of files or of scripts), like expand or revolve.
- [`mesh.merge`](#meshmerge): Merge points of the sections whose coordinates agree to the given number of decimals (fem.field.merge(..., decimals)).
- [`cellset.from_tag`](#cellsetfrom_tag): Cell set of all cells of a mesh with the given tag value.
- [`cellset.from_file`](#cellsetfrom_file): Cell set of all cells of a mesh.
- [`material.add`](#materialadd): Add a material to the material library.
- [`section.add`](#sectionadd): Assign a material and a formulation to a cell set.
- [`pointset.add`](#pointsetadd): Points of the merged mesh selected by a plane, at a bound of the meshes, on a cylinder, on the outer surface, of the cells of a section, by the coordinates of points or by point ids.
- [`point.add`](#pointadd): A control point that is not a node of the meshes, e.g. the center point of a multi-point constraint.
- [`rigid.add`](#rigidadd): A rigid surface (#219): a reference point with a plane or a cylinder.
- [`faceset.add`](#facesetadd): Faces of the boundary of a section, e.g. for a pressure: on a plane, or the faces with the given centers (picked in the viewport).
- [`boundary.add`](#boundaryadd): Prescribe displacement components of a point set (fem.Boundary).
- [`loadcase.add`](#loadcaseadd): A load case of FElupe (fem.dof) on the merged field: the boundaries of a standard test.
- [`symmetry.add`](#symmetryadd): Symmetry planes normal to x, y or z (fem.dof.symmetry): on a plane, the displacement component normal to it is zero and the components in the plane are free.
- [`mpc.add`](#mpcadd): A multi-point constraint (fem.MultiPointConstraint): the points of a point set follow a center point rigidly, connected by a penalty.
- [`cartesian.add`](#cartesianadd): A Cartesian constraint (fem.CartesianConstraint, #421): the points of a point set held or moved in the directions of a rotated coordinate system by a penalty, the other directions free, e.g. points that slide on an inclined plane.
- [`cylindrical.add`](#cylindricaladd): A cylindrical constraint (fem.CylindricalConstraint, #422): the points of a point set held or moved radially, around and along an axis by a penalty, the other directions free, e.g. points that slide in a rigid sleeve (radially only) or the end of a bushing that is turned (around the axis).
- [`contact.add`](#contactadd): A contact of points with a rigid surface (#220): fem.ContactRigidPlane or fem.ContactRigidCylinder, an item of the steps like the constraints.
- [`load.add`](#loadadd): A point load (fem.PointLoad): a force at every point of a point set or at a control point, an item of the steps.
- [`pressure.add`](#pressureadd): A pressure on the faces of a face set (fem.SolidBodyPressure), an item of the steps: a force per deformed area, normal to the faces.
- [`step.add`](#stepadd): A step with its items and boundaries (all by default), optionally ramping items, each with its own values (fem.Step).
- [`job.add`](#jobadd): A job evaluating steps one after another (fem.Job).

### `model.settings`

The settings of the model, at most once. The units say what the numbers mean: FElupe has no units, nothing is converted.

| Property | Type | Required | Description |
| --- | --- | --- | --- |
| `name` | name | yes | Name of the object. |
| `analysis` | `3d`, `plane-strain` or `axisymmetric` |  | The type of the model: 3D (the default) or 2D, as plane strain (fem.FieldPlaneStrain, the forces per unit thickness) or axisymmetric (fem.FieldAxisymmetric: x is the axis of rotation, y the radius, the forces are the totals over the circumference). A 2D model has 2D cells (triangles and quads) and the components x and y. |
| `precision` | `double` or `single` |  | The precision of the model (ADR 0016): double (float64, the default) or single (float32: the regions, the fields, the stresses and the linear equation system in half the memory). The accuracy of single precision depends on the model: the results of a job have an estimate of the round-off of the forces relative to the reaction forces; stiff parts bonded to soft ones, e.g. steel to rubber, need double precision. |
| `units` | object |  | The units of lengths and forces, which give the units of the stresses (e.g. mm and N give MPa). Without units, the numbers have none. |
| `units.length` | `mm` or `m` | yes | Unit of the coordinates and the displacements. |
| `units.force` | `N` or `kN` | yes | Unit of the forces. |

### `parameter.add`

A parameter of the model: a number, e.g. a dimension or the number of cells of a mesh made by a script, or a derived parameter, an expression of other parameters (ADR 0021). The generated script defines it as a variable at its top.

| Property | Type | Required | Description |
| --- | --- | --- | --- |
| `name` | name | yes | Name of the object. |
| `value` | number (or an expression) | yes | The value of the parameter: a number, or an expression of other parameters (a derived parameter, ADR 0021), e.g. layers * height + (layers - 1) * sheet. A derived parameter is computed: it has no min, max and step. |
| `quantity` | `length`, `force` or `stress` |  | The physical quantity of the value, for its unit of the model settings (e.g. mm for a length). Without it, the value has no unit. |
| `min` | number |  | The smallest value. |
| `max` | number |  | The largest value. |
| `step` | number > 0 |  | The step of the value, e.g. of a slider. |
| `integer` | boolean |  | The value is an integer, e.g. a number of layers or cells (default false); the range and the step are integers too. |
| `description` | string |  | What the parameter is, in a few words, e.g. Radius of the disc. |

### `mesh.import`

Import a mesh file (read with meshio).

| Property | Type | Required | Description |
| --- | --- | --- | --- |
| `name` | name | yes | Name of the object. |
| `file` | string | yes | File name of the mesh, e.g. specimen.vtu. |
| `tag` | string |  | Name of an integer cell data array used to split the mesh into cell sets, e.g. material or gmsh:physical. |
| `cell_type` | `tetra`, `tetra10`, `hexahedron`, `hexahedron20`, `hexahedron27`, `triangle`, `triangle6`, `quad`, `quad8` or `quad9` |  | Type of the solid cells to import, if the file has more than one (one mesh per cell type). The 2D cells of a 3D model are a construction mesh, e.g. a profile to revolve or expand, without cell sets. |
| `scale` | number > 0 (or an expression) |  | Factor of the coordinates of the points, e.g. 1000 for a mesh in m of a model in mm. The points are multiplied after reading, before the cell sets; point sets and points are in the scaled coordinates. Default `1`. |
| `color` | string |  | An own color of a mesh, a cell set or a section in the viewport (Color by: Meshes, Cell sets or Sections) and its legend, as #rrggbb, e.g. #7f8c8d; without it, the color of its position among the objects of its kind in the model. A property of the model, not of the script: the generated script is the same. |

### `mesh.script`

A mesh made by a Python script next to the project, e.g. with the mesh tools of FElupe. The script runs with the parameters of the model as variables and makes a variable mesh: a fem.Mesh, a fem.MeshContainer, a meshio.Mesh or a dict of names and meshes (one mesh object per item).

| Property | Type | Required | Description |
| --- | --- | --- | --- |
| `name` | name | yes | Name of the object. |
| `file` | string | yes | File name of the script, e.g. bushing.py. |
| `parameters` | names of parameters (unique) |  | The parameters of the model that the script gets as variables (default: all). |
| `item` | string |  | The item of a dict of meshes, e.g. soft. |
| `tag` | string |  | Name of an integer cell data array of a meshio.Mesh used to split the mesh into cell sets. |
| `cell_type` | `tetra`, `tetra10`, `hexahedron`, `hexahedron20`, `hexahedron27`, `triangle`, `triangle6`, `quad`, `quad8` or `quad9` |  | Type of the solid cells to take, if the mesh has more than one. The 2D cells of a 3D model are a construction mesh, e.g. a profile to revolve or expand, without cell sets. |
| `color` | string |  | An own color of a mesh, a cell set or a section in the viewport (Color by: Meshes, Cell sets or Sections) and its legend, as #rrggbb, e.g. #7f8c8d; without it, the color of its position among the objects of its kind in the model. A property of the model, not of the script: the generated script is the same. |

### `mesh.generate`

A mesh made by a mesh tool of FElupe (ADR 0019): a primitive like a line, a rectangle or a cube, or an operation on meshes of the model before (made by tools, of files or of scripts), like expand or revolve. Every tool is a definition below (the registry of the mesh tools): its label, its FElupe call, the dimensions of its points and its cells and its cell type (x-dimension), and its parameters. A mesh whose points and cells have the dimension of the model can have cell sets; a lower one is a construction mesh.

Every variant has a `name`, the name of the object.

#### Point (`tool: "Point"`)

A point (fem.mesh.Point): one vertex with one coordinate.

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `a` (a) | number | yes | The coordinate of the point. Default `0`. |

#### Line (`tool: "Line"`)

A line along x (fem.mesh.Line): line cells between n points from a to b.

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `a` (a) | number | yes | The coordinate of the start. Default `0`. |
| `b` (b) | number | yes | The coordinate of the end, larger than a. Default `1`. |
| `n` (n) | integer ≥ 2 | yes | The number of points (at least 2). Default `2`. |

#### Rectangle (`tool: "Rectangle"`)

A rectangle in the xy-plane (fem.Rectangle): quads between the corners a and b, with n points per axis.

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `a` (a) | list of 2 numbers | yes | The corner with the smallest coordinates x and y. Default `[0, 0]`. |
| `b` (b) | list of 2 numbers | yes | The corner with the largest coordinates x and y. Default `[1, 1]`. |
| `n` (n) | list of 2 integers ≥ 2 | yes | The number of points per axis x and y (at least 2). Default `[2, 2]`. |

#### Cube (`tool: "Cube"`)

A cube (fem.Cube): hexahedrons between the corners a and b, with n points per axis.

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `a` (a) | list of 3 numbers | yes | The corner with the smallest coordinates x, y and z. Default `[0, 0, 0]`. |
| `b` (b) | list of 3 numbers | yes | The corner with the largest coordinates x, y and z. Default `[1, 1, 1]`. |
| `n` (n) | list of 3 integers ≥ 2 | yes | The number of points per axis x, y and z (at least 2). Default `[2, 2, 2]`. |

#### Circle (`tool: "Circle"`)

A circle in the xy-plane (fem.Circle): quads in quarters of a circle about the centerpoint, each with a square inside, with n points on the edges of a quarter. The sections are the start angles of the quarters, e.g. 0 for a quarter circle or 0, 90, 180, 270 for a full circle.

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `radius` (radius) | number > 0 | yes | The radius of the circle. Default `1`. |
| `centerpoint` (centerpoint) | list of 2 numbers | yes | The center of the circle, x and y. Default `[0, 0]`. |
| `n` (n) | integer ≥ 2 | yes | The number of points on the edges of a quarter (at least 2). Default `2`. |
| `sections` (sections) | list of 1 to 4 numbers | yes | The start angles of the quarters in degrees, at least 90 apart, e.g. 0 for a quarter circle or 0, 90, 180, 270 for a full circle. Default `[0, 90, 180, 270]`. |

#### Triangle (`tool: "Triangle"`)

A triangle in the xy-plane (fem.mesh.Triangle): three quad sections between the corners a, b and c, counterclockwise, with n points on the edges of a section.

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `a` (a) | list of 2 numbers | yes | The first corner, x and y. Default `[0, 0]`. |
| `b` (b) | list of 2 numbers | yes | The second corner, x and y, counterclockwise from a. Default `[1, 0]`. |
| `c` (c) | list of 2 numbers | yes | The third corner, x and y, counterclockwise from b. Default `[0, 1]`. |
| `n` (n) | integer ≥ 2 | yes | The number of points on the edges of a section (at least 2). Default `2`. |

#### Expand (`tool: "expand"`)

Expand a mesh along a new axis (mesh.expand): a point to a line, a line to quads in the xy-plane, quads to hexahedrons along z, with n points over the length z.

Inputs (`inputs`): one mesh. The mesh that the tool takes: a mesh of the model before, made by a tool, of a file or of a script.

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `n` (n) | integer ≥ 2 | yes | The number of points along the new axis (at least 2). Default `11`. |
| `z` (z) | number > 0 | yes | The length along the new axis. Default `1`. |

#### Revolve (`tool: "revolve"`)

Revolve a mesh about an axis (mesh.revolve): a point to a line, a line to quads, quads to hexahedrons, with n points over the angle phi.

Inputs (`inputs`): one mesh. The mesh that the tool takes: a mesh of the model before, made by a tool, of a file or of a script.

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `n` (n) | integer ≥ 2 | yes | The number of points over the angle (at least 2). Default `11`. |
| `phi` (φ) | number > 0, ≤ 360 | yes | The angle of revolution in degrees, at most 360. Default `180`. |
| `axis` (axis) | axis: `x`, `y` or `z` | yes | The axis of revolution. Default `x`. |

#### Embed (`tool: "embed"`)

Embed a mesh into one dimension more (embed, e.g. np.pad of the points): its points get the coordinate value of the new axis, its cells stay, e.g. a line into the plane y = value.

Inputs (`inputs`): one mesh. The mesh that the tool takes: a mesh of the model before, made by a tool, of a file or of a script.

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `value` (value) | number | yes | The coordinate of the points on the new axis. Default `0`. |

#### Translate (`tool: "translate"`)

Move a mesh along an axis (mesh.translate).

Inputs (`inputs`): one mesh. The mesh that the tool takes: a mesh of the model before, made by a tool, of a file or of a script.

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `move` (move) | number | yes | The distance along the axis. Default `0`. |
| `axis` (axis) | axis: `x`, `y` or `z` | yes | The axis of the move. Default `x`. |

#### Rotate (`tool: "rotate"`)

Rotate a mesh about an axis through a center (mesh.rotate); a mesh of 2D points turns about z.

Inputs (`inputs`): one mesh. The mesh that the tool takes: a mesh of the model before, made by a tool, of a file or of a script.

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `angle_deg` (angle) | number | yes | The angle of rotation in degrees. Default `0`. |
| `axis` (axis) | axis: `x`, `y` or `z` | yes | The axis of rotation. Default `z`. |
| `center` (center) | list of 2 to 3 numbers |  | The center of rotation, one coordinate per dimension of the points (default: the origin). |

#### Mirror (`tool: "mirror"`)

Mirror a mesh at a plane normal to an axis (mesh.mirror), at the coordinate value of the axis.

Inputs (`inputs`): one mesh. The mesh that the tool takes: a mesh of the model before, made by a tool, of a file or of a script.

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `axis` (axis) | axis: `x`, `y` or `z` | yes | The axis normal to the plane of the mirror. Default `x`. |
| `value` (value) | number | yes | The coordinate of the plane on the axis. Default `0`. |

#### Fill between (`tool: "fill_between"`)

Fill the cells between two meshes of the same cells and points (fem.mesh.fill_between): quads between two lines in a plane, hexahedrons between two quad meshes in space, with n points from the first mesh to the second.

Inputs (`inputs`): 2 meshes. The two meshes of the model before, from the first to the second, of the same cell type and number of points, e.g. two lines embedded in a plane.

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `n` (n) | integer ≥ 2 | yes | The number of points from the first mesh to the second (at least 2). Default `11`. |

#### Add runouts (`tool: "add_runouts"`)

Add runouts to a mesh (mesh.add_runouts), e.g. the concave free surfaces of a rubber body between metal parts: the points move perpendicular to the axis by a relative amount, most at the centerpoint.

Inputs (`inputs`): one mesh. The mesh that the tool takes: a mesh of the model before, made by a tool, of a file or of a script.

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `values` (values) | list of 1 to 2 numbers | yes | The relative amount of the runouts, one per coordinate perpendicular to the axis (one of 2D points, two of 3D points). Default `[0.1]`. |
| `axis` (axis) | axis: `x`, `y` or `z` | yes | The axis of the runouts. Default `x`. |
| `centerpoint` (centerpoint) | list of 2 to 3 numbers |  | The center of the runouts, one coordinate per dimension of the points (default: the origin). |
| `exponent` (exponent) | number > 0 |  | The shape of the runouts: the higher, the steeper the transition (default 5). |
| `normalize` (normalize) | number |  | Keep the shape of the ends, the runouts become indents. |

#### Stack (`tool: "stack"`)

Stack several meshes of the same cells and points into one (fem.MeshContainer(meshes, merge=True, decimals).stack()): the points of all meshes, with the points at the same place merged, and the cells of all meshes, e.g. a profile of several rectangles that is revolved at once.

Inputs (`inputs`): 2 or more meshes, each once. The meshes that the tool stacks: two or more meshes of the model before, of the same cell type and dimension of the points.

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `decimals` (decimals) | integer ≥ 0, ≤ 15 | yes | Points whose coordinates agree to this number of decimals are merged (default 10), so meshes of different tools merge despite round-off errors. Default `10`. |

### `mesh.merge`

Merge points of the sections whose coordinates agree to the given number of decimals (fem.field.merge(..., decimals)). Without this command, only identical points are merged. Merged points take the rounded coordinates.

| Property | Type | Required | Description |
| --- | --- | --- | --- |
| `name` | name | yes | Name of the object. |
| `decimals` | integer ≥ 0, ≤ 15 | yes | Number of decimals of the point coordinates compared for merging, e.g. 6. |

### `cellset.from_tag`

Cell set of all cells of a mesh with the given tag value.

| Property | Type | Required | Description |
| --- | --- | --- | --- |
| `name` | name | yes | Name of the object. |
| `mesh` | name of a mesh | yes |  |
| `value` | integer | yes | Value of the tag of the cells, e.g. 1. |
| `color` | string |  | An own color of a mesh, a cell set or a section in the viewport (Color by: Meshes, Cell sets or Sections) and its legend, as #rrggbb, e.g. #7f8c8d; without it, the color of its position among the objects of its kind in the model. A property of the model, not of the script: the generated script is the same. |

### `cellset.from_file`

Cell set of all cells of a mesh.

| Property | Type | Required | Description |
| --- | --- | --- | --- |
| `name` | name | yes | Name of the object. |
| `mesh` | name of a mesh | yes |  |
| `color` | string |  | An own color of a mesh, a cell set or a section in the viewport (Color by: Meshes, Cell sets or Sections) and its legend, as #rrggbb, e.g. #7f8c8d; without it, the color of its position among the objects of its kind in the model. A property of the model, not of the script: the generated script is the same. |

### `material.add`

Add a material to the material library. Every model is a definition below (the material registry): its label, the FElupe class or tensortrax function, and its parameters with label, description, bounds and default.

Every variant has a `name`, the name of the object.

#### Linear elastic (small strain) (`model: "LinearElasticSmallStrain"`)

Linear-elastic material for small strains and small rotations (fem.LinearElastic): the stress of the symmetric part of the displacement gradient. Not for large rotations or large strains.

FElupe: `fem.LinearElastic`

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `E` (E) | number > 0 | yes | Young's modulus. Default `1`. |
| `nu` (ν) | number ≥ -1, < 0.5 | yes | Poisson's ratio. Default `0.3`. |

#### Linear elastic (large strain) (`model: "LinearElasticLargeStrain"`)

Linear-elastic material formulated for large deformations (fem.LinearElasticLargeStrain).

FElupe: `fem.LinearElasticLargeStrain`

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `E` (E) | number > 0 | yes | Young's modulus. Default `1`. |
| `nu` (ν) | number ≥ -1, < 0.5 | yes | Poisson's ratio. Default `0.3`. |

#### Neo-Hooke (`model: "NeoHooke"`)

Isotropic hyperelastic Neo-Hookean material (fem.NeoHooke). Without a bulk modulus it needs the u-p-J formulation.

FElupe: `fem.NeoHooke`

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `mu` (μ) | number > 0 | yes | Shear modulus. Default `1`. |
| `bulk` (K) | number > 0 |  | Bulk modulus. Without it, the material is incompressible and needs the u-p-J formulation. |

Optional: the Mullins effect (`mullins`), see [The Mullins effect](#the-mullins-effect).

#### Neo-Hooke (compressible) (`model: "NeoHookeCompressible"`)

Compressible isotropic hyperelastic Neo-Hookean material (fem.NeoHookeCompressible).

FElupe: `fem.NeoHookeCompressible`

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `mu` (μ) | number > 0 | yes | Shear modulus. Default `1`. |
| `lmbda` (λ) | number ≥ 0 | yes | First Lamé parameter. Default `2`. |

#### Mooney-Rivlin (`model: "MooneyRivlin"`)

Isotropic hyperelastic Mooney-Rivlin material (fem.Hyperelastic with fem.mooney_rivlin). The shear modulus is 2 (C10 + C01). Without a bulk modulus it needs the u-p-J formulation.

FElupe: `fem.mooney_rivlin`

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `C10` (C₁₀) | number > 0 | yes | Material parameter of the first invariant. Default `0.4`. |
| `C01` (C₀₁) | number | yes | Material parameter of the second invariant. Default `0.1`. |
| `bulk` (K) | number > 0 |  | Bulk modulus. Without it, the material is incompressible and needs the u-p-J formulation. |

Optional: the Mullins effect (`mullins`), see [The Mullins effect](#the-mullins-effect).

#### Yeoh (`model: "Yeoh"`)

Isotropic hyperelastic Yeoh material (fem.Hyperelastic with fem.yeoh): a cubic polynomial of the first invariant. The shear modulus is 2 C10. Without a bulk modulus it needs the u-p-J formulation.

FElupe: `fem.yeoh`

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `C10` (C₁₀) | number > 0 | yes | Material parameter of the linear term of the first invariant. Default `0.5`. |
| `C20` (C₂₀) | number | yes | Material parameter of the quadratic term of the first invariant. Default `-0.1`. |
| `C30` (C₃₀) | number | yes | Material parameter of the cubic term of the first invariant. Default `0.02`. |
| `bulk` (K) | number > 0 |  | Bulk modulus. Without it, the material is incompressible and needs the u-p-J formulation. |

Optional: the Mullins effect (`mullins`), see [The Mullins effect](#the-mullins-effect).

#### Third-order deformation (`model: "ThirdOrderDeformation"`)

Isotropic hyperelastic third-order deformation material (fem.Hyperelastic with fem.third_order_deformation): terms of the first and second invariant up to the third order. The shear modulus is 2 (C10 + C01). Without a bulk modulus it needs the u-p-J formulation.

FElupe: `fem.third_order_deformation`

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `C10` (C₁₀) | number > 0 | yes | Material parameter of the linear term of the first invariant. Default `0.5`. |
| `C01` (C₀₁) | number | yes | Material parameter of the linear term of the second invariant. Default `0.1`. |
| `C11` (C₁₁) | number | yes | Material parameter of the mixed term of the first and second invariant. Default `0.01`. |
| `C20` (C₂₀) | number | yes | Material parameter of the quadratic term of the first invariant. Default `-0.1`. |
| `C30` (C₃₀) | number | yes | Material parameter of the cubic term of the first invariant. Default `0.02`. |
| `bulk` (K) | number > 0 |  | Bulk modulus. Without it, the material is incompressible and needs the u-p-J formulation. |

Optional: the Mullins effect (`mullins`), see [The Mullins effect](#the-mullins-effect).

#### Ogden (`model: "Ogden"`)

Isotropic hyperelastic Ogden material (fem.Hyperelastic with fem.ogden): up to three terms of the principal stretches, each with a modulus μi and an exponent αi. The shear modulus is the sum of the moduli. Without a bulk modulus it needs the u-p-J formulation.

FElupe: `fem.ogden`

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `mu` (μᵢ) | list of 1 to 3 numbers | yes | Moduli of the terms, one to three, as many as exponents. Default `[1.0, 0.2]`. |
| `alpha` (αᵢ) | list of 1 to 3 numbers ≠ 0 | yes | Stretch exponents of the terms, one per modulus, not zero. Default `[1.7, -1.5]`. |
| `bulk` (K) | number > 0 |  | Bulk modulus. Without it, the material is incompressible and needs the u-p-J formulation. |

Optional: the Mullins effect (`mullins`), see [The Mullins effect](#the-mullins-effect).

#### Arruda-Boyce (`model: "ArrudaBoyce"`)

Isotropic hyperelastic Arruda-Boyce material, the eight-chain model (fem.Hyperelastic with fem.arruda_boyce). The chains lock at the limiting stretch. Without a bulk modulus it needs the u-p-J formulation.

FElupe: `fem.arruda_boyce`

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `C1` (C₁) | number > 0 | yes | Shear modulus of the chain network (the initial shear modulus for a large limiting stretch). Default `1.0`. |
| `limit` (λₘ) | number > 1 | yes | Limiting stretch at which the chains are locked. Default `3.2`. |
| `bulk` (K) | number > 0 |  | Bulk modulus. Without it, the material is incompressible and needs the u-p-J formulation. |

Optional: the Mullins effect (`mullins`), see [The Mullins effect](#the-mullins-effect).

#### Extended tube (`model: "ExtendedTube"`)

Isotropic hyperelastic extended tube material of Kaliske and Heinrich (fem.Hyperelastic with fem.extended_tube): a cross-link and a tube constraint contribution. The shear modulus is Gc + Ge. Without a bulk modulus it needs the u-p-J formulation.

FElupe: `fem.extended_tube`

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `Gc` (Gc) | number ≥ 0 | yes | Cross-link modulus. Default `0.1867`. |
| `delta` (δ) | number ≥ 0 | yes | Finite extensibility of the chains. Default `0.09693`. |
| `Ge` (Ge) | number ≥ 0 | yes | Constraint (tube) modulus. Default `0.2169`. |
| `beta` (β) | number > 0, ≤ 1 | yes | Exponent of the tube constraint. Default `0.2`. |
| `bulk` (K) | number > 0 |  | Bulk modulus. Without it, the material is incompressible and needs the u-p-J formulation. |

#### Linear elastic (`model: "LinearElastic"`)

Linear-elastic material in terms of a strain (fem.MaterialStrain with fem.linear_elastic) in a framework: small strain or Total Lagrange. It needs the displacement formulation u, or the three-field variation u-p-J-three-field.

FElupe: `fem.MaterialStrain` of `fem.linear_elastic`

Framework (`framework`): `small-strain`, `total-lagrange`, `co-rotational`, `seth-hill`, default `small-strain`.

Strain exponent (`strain_exponent`): The strain exponent m of the Seth-Hill strain (only, and required, with the framework seth-hill): 0 for the logarithmic (Hencky) strain, 1 for the Biot strain (like co-rotational), 2 for the Green-Lagrange strain (like total-lagrange), -2 for the Euler-Almansi strain.

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `E` (E) | number > 0 | yes | Young's modulus (converted with ν into the Lamé constants λ and μ). Default `210000`. |
| `nu` (ν) | number ≥ -1, < 0.5 | yes | Poisson's ratio. Default `0.3`. |

#### Elastic-plastic, isotropic hardening (`model: "LinearElasticPlasticIsotropicHardening"`)

Linear-elastic-plastic material with linear isotropic hardening (fem.MaterialStrain with fem.linear_elastic_plastic_isotropic_hardening, the return mapping algorithm of von Mises plasticity) in a framework: small strain or Total Lagrange. Its state variables are the equivalent plastic strain and the plastic strain tensor. It needs the displacement formulation u, or the three-field variation u-p-J-three-field.

FElupe: `fem.MaterialStrain` of `fem.linear_elastic_plastic_isotropic_hardening`, state variables `(1, (3, 3))`

Framework (`framework`): `small-strain`, `total-lagrange`, `co-rotational`, `seth-hill`, default `small-strain`.

Strain exponent (`strain_exponent`): The strain exponent m of the Seth-Hill strain (only, and required, with the framework seth-hill): 0 for the logarithmic (Hencky) strain, 1 for the Biot strain (like co-rotational), 2 for the Green-Lagrange strain (like total-lagrange), -2 for the Euler-Almansi strain.

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `E` (E) | number > 0 | yes | Young's modulus (converted with ν into the Lamé constants λ and μ). Default `210000`. |
| `nu` (ν) | number ≥ -1, < 0.5 | yes | Poisson's ratio. Default `0.3`. |
| `sigma_y` (σy) | number > 0 | yes | Initial yield stress (uniaxial). Default `250`. |
| `K` (K) | number ≥ 0 | yes | Isotropic hardening modulus: the yield stress grows by K times the equivalent plastic strain. Default `1000`. |

#### The Mullins effect

The Mullins effect of Ogden and Roxburgh (fem.OgdenRoxburgh): the material is softer after it was loaded, when it is unloaded and loaded again up to the largest strain energy density of its load history, and stiff again above it. The stress is scaled by a softening of the strain energy density and of its maximum, a state variable of every quadrature point; the bulk modulus is not softened.

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `r` (r) | number > 1 | yes | Reciprocal of the largest softening: with r = 3, the stiffness is softened to 1 - 1/3 = 2/3 at most. Default `3`. |
| `m` (m) | number > 0 | yes | Initial softening modulus, a strain energy density: the smaller, the faster the material softens below the maximum of its load history. Default `1`. |
| `beta` (β) | number ≥ 0 | yes | The part of the softening modulus that grows with the maximum strain energy density of the load history (m + β ψmax). Default `0.1`. |

### `section.add`

Assign a material and a formulation to a cell set. Each section becomes a solid body. Every formulation is a definition below (the formulation registry, ADR 0024): its label, the solid body and the fields of FElupe, the cell types and the material that it takes, and its properties.

Every variant has a `name`, the name of the object.

#### Displacement (u) (`formulation: "u"`)

The displacement formulation u: a field of the displacements only (fem.SolidBody). The material has a volumetric part of its own: its bulk modulus, or a compressible or a strain-based model.

FElupe: the solid body `fem.SolidBody` of the fields `u`, all cell types. The material has a volumetric part of its own. When to use it: for a material with a volumetric part of its own: its bulk modulus, or a compressible or a strain-based model.

| Property | Type | Required | Description |
| --- | --- | --- | --- |
| `cellset` | name of a cell set | yes |  |
| `material` | name of a material | yes |  |
| `color` | string |  | An own color of a mesh, a cell set or a section in the viewport (Color by: Meshes, Cell sets or Sections) and its legend, as #rrggbb, e.g. #7f8c8d; without it, the color of its position among the objects of its kind in the model. A property of the model, not of the script: the generated script is the same. |

#### Nearly incompressible ▸ Automatic (`formulation: "u-p-J"`)

The nearly incompressible formulation u-p-J of the displacements, the pressure and the volume ratio, for a material without a volumetric part: the section adds it with its bulk modulus. It chooses its way by the cell type when the script runs: linear hexahedrons and quads condense the pressure and the volume ratio of every cell (fem.SolidBodyNearlyIncompressible, like u-p-J-condensed); the other cells have mixed fields (fem.FieldsMixed with fem.NearlyIncompressible, like u-p-J-mixed), linear tetrahedra and triangles with a bubble point (MINI).

FElupe: the solid body `nearly_incompressible` of the fields `automatic`, all cell types. The material is the isochoric part of a strain energy: the section adds the volumetric part. When to use it: condensed per cell of linear hexahedrons and quads, else mixed fields; for a material without a bulk modulus.

| Property | Type | Required | Description |
| --- | --- | --- | --- |
| `cellset` | name of a cell set | yes |  |
| `material` | name of a material | yes |  |
| `bulk` | number > 0 (or an expression) | yes | Bulk modulus of the nearly incompressible formulation. |
| `volumetric` | `volume-ratio`, `stretch` or `log` |  | The volumetric part U(J) of the strain energy with the bulk modulus K (fem.NearlyIncompressible): volume-ratio K/2 (J - 1)², stretch 9K/2 (J^(1/3) - 1)² or log K/2 ln(J)². Default `volume-ratio`. |
| `color` | string |  | An own color of a mesh, a cell set or a section in the viewport (Color by: Meshes, Cell sets or Sections) and its legend, as #rrggbb, e.g. #7f8c8d; without it, the color of its position among the objects of its kind in the model. A property of the model, not of the script: the generated script is the same. |

#### Nearly incompressible ▸ Condensed per cell (`formulation: "u-p-J-condensed"`)

Nearly incompressible, condensed per cell (u-p-J-condensed): a field of the displacements only, whose solid body condenses the constant pressure and volume ratio of every cell (fem.SolidBodyNearlyIncompressible, Q1/P0 of linear and Q2/P0 of quadratic cells). It takes hexahedrons and quads, linear or quadratic, and a material without a volumetric part: the section adds it with its bulk modulus.

FElupe: the solid body `fem.SolidBodyNearlyIncompressible` of the fields `condensed`, the cell types `hexahedron`, `hexahedron20`, `hexahedron27`, `quad`, `quad8` or `quad9`. The material is the isochoric part of a strain energy: the section adds the volumetric part. When to use it: hexahedrons and quads only, also quadratic (Q2/P0); no unknowns of p and J in the system.

| Property | Type | Required | Description |
| --- | --- | --- | --- |
| `cellset` | name of a cell set | yes |  |
| `material` | name of a material | yes |  |
| `bulk` | number > 0 (or an expression) | yes | Bulk modulus of the nearly incompressible formulation. |
| `volumetric` | `volume-ratio`, `stretch` or `log` |  | The volumetric part U(J) of the strain energy with the bulk modulus K (fem.NearlyIncompressible): volume-ratio K/2 (J - 1)², stretch 9K/2 (J^(1/3) - 1)² or log K/2 ln(J)². Default `volume-ratio`. |
| `color` | string |  | An own color of a mesh, a cell set or a section in the viewport (Color by: Meshes, Cell sets or Sections) and its legend, as #rrggbb, e.g. #7f8c8d; without it, the color of its position among the objects of its kind in the model. A property of the model, not of the script: the generated script is the same. |

#### Nearly incompressible ▸ Mixed fields (`formulation: "u-p-J-mixed"`)

Nearly incompressible on mixed fields (u-p-J-mixed): the displacements, the pressure and the volume ratio are fields of their own (fem.FieldsMixed with fem.NearlyIncompressible), of every cell type: linear tetrahedra and triangles with a bubble point (MINI), and a constant pressure and volume ratio per cell of linear hexahedrons and quads. It takes a material without a volumetric part: the section adds it with its bulk modulus.

FElupe: the solid body `fem.NearlyIncompressible` of the fields `mixed`, all cell types. The material is the isochoric part of a strain energy: the section adds the volumetric part. When to use it: every cell type; the pressure and the volume ratio are unknowns of the system.

| Property | Type | Required | Description |
| --- | --- | --- | --- |
| `cellset` | name of a cell set | yes |  |
| `material` | name of a material | yes |  |
| `bulk` | number > 0 (or an expression) | yes | Bulk modulus of the nearly incompressible formulation. |
| `volumetric` | `volume-ratio`, `stretch` or `log` |  | The volumetric part U(J) of the strain energy with the bulk modulus K (fem.NearlyIncompressible): volume-ratio K/2 (J - 1)², stretch 9K/2 (J^(1/3) - 1)² or log K/2 ln(J)². Default `volume-ratio`. |
| `color` | string |  | An own color of a mesh, a cell set or a section in the viewport (Color by: Meshes, Cell sets or Sections) and its legend, as #rrggbb, e.g. #7f8c8d; without it, the color of its position among the objects of its kind in the model. A property of the model, not of the script: the generated script is the same. |

#### Nearly incompressible ▸ Three-field variation (`formulation: "u-p-J-three-field"`)

The three-field variation (u-p-J-three-field) of the displacements, the pressure and the volume ratio on mixed fields (fem.FieldsMixed with fem.ThreeFieldVariation), of every cell type like u-p-J-mixed. It takes any material with a volumetric part of its own: its bulk modulus, or a compressible or a strain-based model, also with state variables. The section has no bulk modulus. The slowest way of u-p-J.

FElupe: the solid body `fem.ThreeFieldVariation` of the fields `mixed`, all cell types. The material has a volumetric part of its own. When to use it: any material with a volumetric part, also compressible or strain-based; the slowest.

| Property | Type | Required | Description |
| --- | --- | --- | --- |
| `cellset` | name of a cell set | yes |  |
| `material` | name of a material | yes |  |
| `color` | string |  | An own color of a mesh, a cell set or a section in the viewport (Color by: Meshes, Cell sets or Sections) and its legend, as #rrggbb, e.g. #7f8c8d; without it, the color of its position among the objects of its kind in the model. A property of the model, not of the script: the generated script is the same. |

#### Isochoric part only (third medium) (`formulation: "u-isochoric"`)

The displacement formulation u-isochoric: a field of the displacements only (fem.SolidBody), with a material without a bulk modulus whose strain energy has no volumetric part, e.g. air as a third medium between the parts of a model that come into contact.

FElupe: the solid body `fem.SolidBody` of the fields `u`, all cell types. The material has no volumetric part, and the section adds none. When to use it: for a material without a bulk modulus whose volume changes freely, e.g. air as a third medium.

| Property | Type | Required | Description |
| --- | --- | --- | --- |
| `cellset` | name of a cell set | yes |  |
| `material` | name of a material | yes |  |
| `color` | string |  | An own color of a mesh, a cell set or a section in the viewport (Color by: Meshes, Cell sets or Sections) and its legend, as #rrggbb, e.g. #7f8c8d; without it, the color of its position among the objects of its kind in the model. A property of the model, not of the script: the generated script is the same. |

### `pointset.add`

Points of the merged mesh selected by a plane, at a bound of the meshes, on a cylinder, on the outer surface, of the cells of a section, by the coordinates of points or by point ids.

| Property | Type | Required | Description |
| --- | --- | --- | --- |
| `name` | name | yes | Name of the object. |
| `select` | one of the variants below | yes |  |

Variants of `select`:

#### By a plane

Points with the given coordinate, e.g. x == 0.

| Property | Type | Required | Description |
| --- | --- | --- | --- |
| `select.axis` | axis: `x`, `y` or `z` | yes |  |
| `select.value` | number (or an expression) | yes |  |
| `select.atol` | number > 0 (or an expression) |  | Absolute tolerance (default 1e-8). |

#### At a bound

Points at the smallest or largest coordinate of the meshes of the sections, e.g. z == max (without the control points). They follow a mesh whose size changes.

| Property | Type | Required | Description |
| --- | --- | --- | --- |
| `select.bound` | `min` or `max` | yes | The smallest (min) or the largest (max) coordinate. |
| `select.axis` | axis: `x`, `y` or `z` | yes |  |
| `select.atol` | number > 0 (or an expression) |  | Absolute tolerance (default 1e-8). |

#### On a cylinder

Points on a cylinder: at the distance radius from the line through the center parallel to the axis, e.g. a sleeve of a bushing.

| Property | Type | Required | Description |
| --- | --- | --- | --- |
| `select.radius` | number > 0 (or an expression) | yes | The radius of the cylinder. |
| `select.axis` | axis: `x`, `y` or `z` | yes | The direction of the axis of the cylinder. |
| `select.center` | three numbers `[x, y, z]` |  | A point on the axis of the cylinder (default: the origin). |
| `select.atol` | number > 0 (or an expression) |  | Absolute tolerance (default 1e-8). |

#### `surface` (`surface: true`)

The points on the outer surface of the meshes of the sections (without the control points), e.g. the points that may touch a rigid surface: the points of the faces which belong to one cell, of 2D models of the edges.

| Property | Type | Required | Description |
| --- | --- | --- | --- |
| `select.surface` | `true` | yes |  |

#### By coordinates

The points at the given coordinates, one point each, e.g. picked nodes. A coordinate without a point is an error of the script.

| Property | Type | Required | Description |
| --- | --- | --- | --- |
| `select.points` | list of three numbers `[x, y, z]` (at least 1) | yes |  |
| `select.atol` | number > 0 (or an expression) |  | Absolute tolerance (default 1e-8). |

#### `section`

The points of the cells of a section, e.g. of a rigid part whose points are all moved by boundaries.

| Property | Type | Required | Description |
| --- | --- | --- | --- |
| `select.section` | name of a section | yes |  |

#### By ids

Points given by their ids, e.g. picked in the viewer.

| Property | Type | Required | Description |
| --- | --- | --- | --- |
| `select.ids` | integers ≥ 0 (at least 1, unique) | yes |  |

### `point.add`

A control point that is not a node of the meshes, e.g. the center point of a multi-point constraint. It is a point set of one point: all control points form a mesh of vertices that is merged with the fields of the sections.

| Property | Type | Required | Description |
| --- | --- | --- | --- |
| `name` | name | yes | Name of the object. |
| `coordinates` | three numbers `[x, y, z]` | yes | The coordinates x, y and z of a point. |

### `rigid.add`

A rigid surface (#219): a reference point with a plane or a cylinder. The reference point is a vertex like the control points and a point set of one point, so boundaries move the surface; it does not rotate. Contacts connect points of the model to it.

| Property | Type | Required | Description |
| --- | --- | --- | --- |
| `name` | name | yes | Name of the object. |
| `coordinates` | three numbers `[x, y, z]` | yes | The reference point: a point of the plane, or of the axis of the cylinder. |
| `shape` | one of the variants below | yes |  |

Variants of `shape`:

#### `normal`

A plane through the reference point.

| Property | Type | Required | Description |
| --- | --- | --- | --- |
| `shape.normal` | three numbers `[x, y, z]` | yes | The outward normal of the plane, towards the points that touch it. |

#### On a cylinder

A cylinder whose axis goes through the reference point.

| Property | Type | Required | Description |
| --- | --- | --- | --- |
| `shape.radius` | number > 0 (or an expression) | yes | The radius of the cylinder. |
| `shape.axis` | three numbers `[x, y, z]` | yes | The direction of the axis of the cylinder. |
| `shape.inside` | boolean |  | The points are inside the cylinder (a tube around them), else outside (a roller). |

### `faceset.add`

Faces of the boundary of a section, e.g. for a pressure: on a plane, or the faces with the given centers (picked in the viewport). The script makes a boundary region of the faces and a field of it, linked to the merged field. Faces of tetrahedrons have no boundary region in FElupe 12.

| Property | Type | Required | Description |
| --- | --- | --- | --- |
| `name` | name | yes | Name of the object. |
| `section` | name of a section | yes | The section whose boundary has the faces. |
| `select` | one of the variants below | yes |  |

Variants of `select`:

#### By a plane

The faces of the boundary on a plane with the given coordinate, e.g. z == 20.

| Property | Type | Required | Description |
| --- | --- | --- | --- |
| `select.axis` | axis: `x`, `y` or `z` | yes |  |
| `select.value` | number (or an expression) | yes |  |
| `select.atol` | number > 0 (or an expression) |  | Absolute tolerance of the coordinates of the points (default 1e-8). |

#### By centers

The faces of the boundary with the given centers (the mean of the points of a face), e.g. picked faces. A center without a face is an error of the script.

| Property | Type | Required | Description |
| --- | --- | --- | --- |
| `select.centers` | list of three numbers `[x, y, z]` (at least 1) | yes |  |
| `select.atol` | number > 0 (or an expression) |  | Absolute tolerance of the centers (default 1e-6 of the size of the section). |

### `boundary.add`

Prescribe displacement components of a point set (fem.Boundary).

| Property | Type | Required | Description |
| --- | --- | --- | --- |
| `name` | name | yes | Name of the object. |
| `pointset` | name of a point set, control point or rigid surface | yes |  |
| `constrained` | list of axis: `x`, `y` or `z` (at least 1, unique) | yes | Constrained displacement components; all others are free. |
| `value` | number or list of 1 to 3 numbers (or an expression) |  | Prescribed displacement of the constrained components (default 0): one number for all of them, or one number per constrained component in the order x, y, z (e.g. a point set that moves diagonally); a rotation in rad at a rotation point. |

### `loadcase.add`

A load case of FElupe (fem.dof) on the merged field: the boundaries of a standard test. It is referenced like a boundary: a step ramps its moving end faces, a job records the reaction force of its (first) moving end face.

Every variant has a `name`, the name of the object.

#### Uniaxial (`type: "uniaxial"`)

Uniaxial tension or compression along an axis (fem.dof.uniaxial). The end face at the largest coordinate moves.

FElupe: `fem.dof.uniaxial`

| Property | Type | Required | Description |
| --- | --- | --- | --- |
| `axis` | axis: `x`, `y` or `z` |  | Direction of the loading (default x). |
| `clamped` | boolean |  | Rigid end faces: no transversal displacements of the moving (and, without symmetry, the opposite) end faces. Default `false`. |
| `symmetry` | boolean |  | Symmetry planes at x = 0, y = 0 and z = 0 (a quarter or an eighth of a model). Without them, the opposite end faces are at the smallest coordinates. Default `true`. |

#### Biaxial (`type: "biaxial"`)

Equi-biaxial tension along two axes (fem.dof.biaxial). The end faces at the largest coordinates move.

FElupe: `fem.dof.biaxial`

| Property | Type | Required | Description |
| --- | --- | --- | --- |
| `axis` | axis: `x`, `y` or `z` |  | First direction of the loading (default x). |
| `second` | axis: `x`, `y` or `z` |  | Second direction of the loading (default y). |
| `clamped` | boolean |  | Rigid end faces: no transversal displacements of the moving (and, without symmetry, the opposite) end faces. Default `false`. |
| `symmetry` | boolean |  | Symmetry planes at x = 0, y = 0 and z = 0 (a quarter or an eighth of a model). Without them, the opposite end faces are at the smallest coordinates. Default `true`. |

#### Planar (`type: "planar"`)

Planar (pure shear) tension along an axis with a constant width along a second axis (fem.dof.biaxial without a move of the second axis).

FElupe: `fem.dof.biaxial`

| Property | Type | Required | Description |
| --- | --- | --- | --- |
| `axis` | axis: `x`, `y` or `z` |  | Direction of the loading (default x). |
| `second` | axis: `x`, `y` or `z` |  | Direction of the constant width (default y). |
| `clamped` | boolean |  | Rigid end faces: no transversal displacements of the moving (and, without symmetry, the opposite) end faces. Default `false`. |
| `symmetry` | boolean |  | Symmetry planes at x = 0, y = 0 and z = 0 (a quarter or an eighth of a model). Without them, the opposite end faces are at the smallest coordinates. Default `true`. |

#### Shear (`type: "shear"`)

Simple shear between the end faces normal to an axis (fem.dof.shear). The face at the largest coordinate moves along the shear direction.

FElupe: `fem.dof.shear`

| Property | Type | Required | Description |
| --- | --- | --- | --- |
| `axis` | axis: `x`, `y` or `z` |  | Direction of the shear (default x). |
| `normal` | axis: `x`, `y` or `z` |  | Normal of the sheared end faces (default y). |
| `compression` | number (or an expression) |  | Displacement of the moving face along the normal, held during the shear (default 0). |
| `symmetry` | boolean |  | Symmetry plane normal to the third axis at its zero coordinate. Default `true`. |

### `symmetry.add`

Symmetry planes normal to x, y or z (fem.dof.symmetry): on a plane, the displacement component normal to it is zero and the components in the plane are free. A half, a quarter or an eighth of a model, without a load case.

| Property | Type | Required | Description |
| --- | --- | --- | --- |
| `name` | name | yes | Name of the object. |
| `axes` | list of axis: `x`, `y` or `z` (at least 1, unique) | yes | The normals of the symmetry planes. |
| `x` | number (or an expression) |  | Coordinate of the plane normal to x (default 0), only with x in axes. |
| `y` | number (or an expression) |  | Coordinate of the plane normal to y (default 0), only with y in axes. |
| `z` | number (or an expression) |  | Coordinate of the plane normal to z (default 0), only with z in axes. |

### `mpc.add`

A multi-point constraint (fem.MultiPointConstraint): the points of a point set follow a center point rigidly, connected by a penalty. With a rotation point, they also rotate about the center point.

| Property | Type | Required | Description |
| --- | --- | --- | --- |
| `name` | name | yes | Name of the object. |
| `points` | name of a point set or control point | yes | The point set of the connected points. |
| `center` | name of a point set or control point | yes | The center point: a control point or a point set of one point. |
| `constrained` | list of axis: `x`, `y` or `z` (at least 1, unique) | yes | The connected components (skip the others). All of them with a rotation point. |
| `multiplier` | number > 0 (or an expression) |  | The penalty of the relative displacements (default 1000). |
| `rotation` | name of a point set or control point |  | The rotation point: a control point or a point set of one point, whose values are the rotations about the center point in rad (its coordinates are not used). |

### `cartesian.add`

A Cartesian constraint (fem.CartesianConstraint, #421): the points of a point set held or moved in the directions of a rotated coordinate system by a penalty, the other directions free, e.g. points that slide on an inclined plane. The coordinate system is fixed in space: e1, e2 and e3 = e1 × e2, normalized by the script. An item of the steps; a ramp of a step moves the points like a boundary, and it may be the curve of a job.

| Property | Type | Required | Description |
| --- | --- | --- | --- |
| `name` | name | yes | Name of the object. |
| `points` | name of a point set or control point | yes | The point set of the constrained points. |
| `e1` | three numbers `[x, y, z]` | yes | The first base vector e1 of the coordinate system, e.g. the normal of an inclined plane. |
| `e2` | three numbers `[x, y, z]` |  | The second base vector e2, orthogonal to e1 (default 0, 1, 0). None in a 2D model: there, e2 is e1 turned by 90° about z. |
| `constrained` | list of `1`, `2` or `3` (at least 1, unique) | yes | The constrained directions of e1, e2 and e3 (skip the others). |
| `value` | number or list of 1 to 3 numbers (or an expression) |  | Prescribed displacement in the constrained directions (default 0): one number for all of them, or one number per constrained direction in the order 1, 2, 3. |
| `multiplier` | number > 0 (or an expression) |  | The penalty per point and direction (default 1000). |

### `cylindrical.add`

A cylindrical constraint (fem.CylindricalConstraint, #422): the points of a point set held or moved radially, around and along an axis by a penalty, the other directions free, e.g. points that slide in a rigid sleeve (radially only) or the end of a bushing that is turned (around the axis). The directions r, theta and z are those of each point about the axis, evaluated in the deformed configuration; in a 2D model (plane strain), the axis is z and the directions are r and theta. An item of the steps; a ramp of a step moves the points like a boundary, and it may be the curve of a job.

| Property | Type | Required | Description |
| --- | --- | --- | --- |
| `name` | name | yes | Name of the object. |
| `points` | name of a point set or control point | yes | The point set of the constrained points, none of them on the axis if they are constrained radially or around it. |
| `center` | three numbers `[x, y, z]` |  | A point on the axis (default: the origin). |
| `axis` | three numbers `[x, y, z]` |  | The direction of the axis (default 0, 0, 1; any length). In a 2D model, the axis is z. |
| `constrained` | list of `r`, `theta` or `z` (at least 1, unique) | yes | The constrained directions: radially (r), around the axis (theta) and along it (z); the others are free. |
| `value` | number or list of 1 to 3 numbers (or an expression) |  | Prescribed displacement in the constrained directions (default 0): one number for all of them, or one number per constrained direction in the order r, theta, z. Around the axis, the arc length on the undeformed radius: the points at the radius R turn by the angle value / R. |
| `multiplier` | number > 0 (or an expression) |  | The penalty per point and direction (default 1000). |

### `contact.add`

A contact of points with a rigid surface (#220): fem.ContactRigidPlane or fem.ContactRigidCylinder, an item of the steps like the constraints. The penalty of the contact is a factor of the mean stiffness of the solid bodies at the points.

| Property | Type | Required | Description |
| --- | --- | --- | --- |
| `name` | name | yes | Name of the object. |
| `points` | name of a point set, control point or face set | yes | The points that may touch the surface: a point set, or the points of a face set. |
| `surface` | name of a rigid surface | yes | The rigid surface. |
| `friction` | number ≥ 0 (or an expression) |  | The Coulomb friction coefficient (default 0, without friction). |
| `multiplier` | number > 0 (or an expression) |  | The factor of the penalty of the contact, times the mean stiffness of the solid bodies at the points (default 1). |
| `elastic_slip` | number > 0 (or an expression) |  | The allowable elastic slip of sticking points (default none: a constant tangential penalty), e.g. 0.5 % to 1 % of the size of a cell. |

### `load.add`

A point load (fem.PointLoad): a force at every point of a point set or at a control point, an item of the steps. A ramp of a step scales the force.

| Property | Type | Required | Description |
| --- | --- | --- | --- |
| `name` | name | yes | Name of the object. |
| `points` | name of a point set, control point or rigid surface | yes | The point set or the control point of the load. |
| `force` | three numbers `[x, y, z]` | yes | The force fx, fy, fz at every point. |

### `pressure.add`

A pressure on the faces of a face set (fem.SolidBodyPressure), an item of the steps: a force per deformed area, normal to the faces. A positive pressure pushes onto the faces, a negative one pulls. A ramp of a step scales the pressure.

| Property | Type | Required | Description |
| --- | --- | --- | --- |
| `name` | name | yes | Name of the object. |
| `faces` | name of a face set | yes | The face set of the pressure. |
| `pressure` | number (or an expression) | yes | The pressure; positive pushes onto the faces. |

### `step.add`

A step with its items and boundaries (all by default), optionally ramping items, each with its own values (fem.Step).

| Property | Type | Required | Description |
| --- | --- | --- | --- |
| `name` | name | yes | Name of the object. |
| `sections` | names of sections (at least 1, unique) |  | Sections whose solid bodies are items of the step (default: all). |
| `constraints` | names of multi-point constraints, Cartesian constraints, cylindrical constraints or contacts (at least 1, unique) |  | Multi-point constraints, Cartesian and cylindrical constraints and contacts that are items of the step (default: all). |
| `loads` | names of point loads or pressures (at least 1, unique) |  | Point loads and pressures that are items of the step (default: all). |
| `boundaries` | names of boundaries, load cases or symmetry planes (at least 1, unique) |  | Boundaries, load cases and symmetry planes of the step (default: all). A boundary that the step does not have is off in it: its points are free, and its reaction force is released at once. |
| `switched_on` | `step` or `job` |  | The values of the boundaries that the step switches on, those that the step evaluated before it does not have: the displacements of their points at the start of the step (default), or at the start of the job (of a boundary that was on then, its values then). A ramp of such a boundary is relative to these values. |
| `ramp` | object |  | Ramp the values of items with fem.math.linsteps([start, end], num), with the same number of increments for all items. |
| `ramp.num` | integer ≥ 1 (or an expression) | yes | Increments of the step. |
| `ramp.items` | list of objects (at least 1) | yes | The ramped items, each with its own values. |
| `ramp.items[].target` | name of a boundary, load case, point load, pressure, Cartesian constraint or cylindrical constraint | yes | The ramped boundary, load case, Cartesian or cylindrical constraint, point load or pressure. |
| `ramp.items[].start` | number or list of 1 to 3 numbers (or an expression) |  | Value at the start of the step (default 0); of a boundary with several constrained components one number for all of them, or one per component in the order x, y, z (of a Cartesian constraint per direction in the order 1, 2, 3, of a cylindrical constraint r, theta, z). |
| `ramp.items[].end` | number or list of 1 to 3 numbers (or an expression) | yes | Value at the end of the step; of a boundary with several constrained components one number for all of them, or one per component in the order x, y, z (of a Cartesian constraint per direction in the order 1, 2, 3, of a cylindrical constraint r, theta, z). |

### `job.add`

A job evaluating steps one after another (fem.Job). With a curve, the force-displacement curve of a boundary, a load case, a Cartesian or cylindrical constraint or a point load is recorded (fem.CharacteristicCurve).

| Property | Type | Required | Description |
| --- | --- | --- | --- |
| `name` | name | yes | Name of the object. |
| `steps` | names of steps (at least 1) | yes | Steps evaluated one after another, in this order; a step may be repeated, e.g. load, unload, load. |
| `curve` | name of a boundary, load case, point load, Cartesian constraint or cylindrical constraint |  | The boundary, load case, Cartesian or cylindrical constraint or point load of the force-displacement curve. Of a Cartesian constraint, the displacement of its first point and the force of the solid bodies at its points, in its directions 1, 2 and 3. Of a cylindrical constraint, the displacement of its first point in its directions r, theta (the arc length on its undeformed radius) and z, and the sum of the forces of the solid bodies at its points, each in the directions r, theta and z of its point: of points on one radius R, the moment about the axis is R times the force around it. |
| `tol` | number > 0 (or an expression) |  | Tolerance of the Newton-Raphson method: the norm of the residual forces relative to a reference force, the reaction forces or the forces between the items (e.g. of a pressure on a solid body), if they are larger (default 0.01, like commercial codes). |
| `maxiter` | integer ≥ 1 (or an expression) |  | The maximum number of Newton iterations of a substep (default 16). |
| `solver` | object |  | The linear solver of the Newton iterations (Job.evaluate(solver=...)); without it, SuperLU of FElupe. |
| `solver.type` | `superlu`, `spsolve`, `pardiso` or `iterative` | yes | SuperLU of FElupe (fem.solve.SuperLUSolver, the default), spsolve of SciPy (the default of FElupe before v12), PARDISO of Intel oneMKL (pypardiso.spsolve: multithreaded, only in Python on the computer with the package pypardiso, #308) or an iterative method of SciPy. |
| `solver.method` | `minres`, `cg`, `gmres` or `bicgstab` | if `type` is `iterative` | The iterative method of scipy.sparse.linalg: minres (symmetric, also indefinite), cg (symmetric positive definite), gmres or bicgstab. |
| `solver.rtol` | number > 0, < 1 (or an expression) |  | Relative tolerance of the iterative method, relative to the norm of the residual forces (default: the tolerance of the job / 100). |
| `solver.maxiter` | integer ≥ 1 (or an expression) |  | The maximum number of iterations of the iterative method (default of SciPy). |
| `solver.precision` | `double` or `single` |  | The precision of the linear equation system of a direct solver: double (float64, the default) or single (float32: the matrix, the right-hand side and the factorization, the increment back in double precision). The model, the residual forces and the results stay in double precision; the factorization needs half the memory, and the Newton-Raphson method a few more iterations at tight tolerances. PARDISO in single precision needs a PyPardiso that factorizes in float32. |
| `cutback` | object |  | Retry a substep that does not converge with smaller increments (fem.CutbackPlugin); without a value, a parameter has the default of FElupe. |
| `cutback.factor` | number > 0, < 1 (or an expression) |  | The factor by which the increment is reduced after a failed attempt (default 0.5). |
| `cutback.max_cutbacks` | integer ≥ 1 (or an expression) |  | The maximum number of successive cutbacks of the increment (default 10): the smallest increment of a substep is factor ** max_cutbacks. |
| `cutback.growth` | number ≥ 1 (or an expression) |  | The factor by which the increment is increased after a converged increment (default 2.0); 1 keeps the increment. |
