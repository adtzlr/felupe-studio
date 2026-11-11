# Command reference

<!-- Generated from python/felupe_studio/commands.schema.json by
     `python docs/make_reference.py`. Do not edit. -->

Every command of a project creates one named object. The [user guide](guide.md) shows how the commands work together, [commands.md](commands.md) how they become a FElupe script.

A project file is a JSON document `{"schema_version": 3, "commands": [...]}`. Every command has the key `command` and a unique `name`; other commands reference the object by its name. Older project files are migrated when they are opened.

## Names

Name of an object, unique within the command list. Used as a Python identifier in the generated script; at most 24 characters keep the script readable.

A name matches `^[A-Za-z_][A-Za-z0-9_]*$` and has at most 24 characters. Reserved, because the script uses them: `DIMENSIONS`, `REGIONS`, `SimpleNamespace`, `boundaries`, `control_points`, `fem`, `field`, `meshio`, `mixed_region`, `np`, `points`, `points_at`, `single_point`, `vertex_region`, `volume_cells`; names starting with `field_`, `solid_`, `region_`, `ramp_`; and the keywords of Python.

## Commands

- [`model.settings`](#modelsettings): The settings of the model, at most once.
- [`mesh.import`](#meshimport): Import a mesh file (read with meshio).
- [`mesh.merge`](#meshmerge): Merge points of the sections whose coordinates agree to the given number of decimals (fem.field.merge(..., decimals)).
- [`cellset.from_tag`](#cellsetfrom_tag): Cell set of all cells of a mesh with the given tag value.
- [`cellset.from_file`](#cellsetfrom_file): Cell set of all cells of a mesh.
- [`material.add`](#materialadd): Add a material to the material library.
- [`section.add`](#sectionadd): Assign a material and a formulation to a cell set.
- [`pointset.add`](#pointsetadd): Points of the merged mesh selected by a plane, by the coordinates of points or by point ids.
- [`point.add`](#pointadd): A control point that is not a node of the meshes, e.g. the center point of a multi-point constraint.
- [`boundary.add`](#boundaryadd): Prescribe displacement components of a point set (fem.Boundary).
- [`loadcase.add`](#loadcaseadd): A load case of FElupe (fem.dof) on the merged field: the boundaries of a standard test.
- [`mpc.add`](#mpcadd): A multi-point constraint (fem.MultiPointConstraint): the points of a point set follow a center point rigidly, connected by a penalty.
- [`load.add`](#loadadd): A point load (fem.PointLoad): a force at every point of a point set or at a control point, an item of the steps.
- [`step.add`](#stepadd): A step with all boundaries, optionally ramping items, each with its own values (fem.Step).
- [`job.add`](#jobadd): A job evaluating steps one after another (fem.Job).

### `model.settings`

The settings of the model, at most once. The units say what the numbers mean: FElupe has no units, nothing is converted.

| Property | Type | Required | Description |
| --- | --- | --- | --- |
| `name` | name | yes | Name of the object. |
| `units` | object |  | The units of lengths and forces, which give the units of the stresses (e.g. mm and N give MPa). Without units, the numbers have none. |
| `units.length` | `mm` or `m` | yes | Unit of the coordinates and the displacements. |
| `units.force` | `N` or `kN` | yes | Unit of the forces. |

### `mesh.import`

Import a mesh file (read with meshio).

| Property | Type | Required | Description |
| --- | --- | --- | --- |
| `name` | name | yes | Name of the object. |
| `file` | string | yes | File name of the mesh, e.g. specimen.vtu. |
| `tag` | string |  | Name of an integer cell data array used to split the mesh into cell sets, e.g. material or gmsh:physical. |
| `cell_type` | `tetra`, `tetra10`, `hexahedron`, `hexahedron20` or `hexahedron27` |  | Type of the solid cells to import, if the file has more than one (one mesh per cell type). |

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

### `cellset.from_file`

Cell set of all cells of a mesh.

| Property | Type | Required | Description |
| --- | --- | --- | --- |
| `name` | name | yes | Name of the object. |
| `mesh` | name of a mesh | yes |  |

### `material.add`

Add a material to the material library. Every model is a definition below (the material registry): its label, the FElupe class or tensortrax function, and its parameters with label, description, bounds and default.

Every variant has a `name`, the name of the object.

#### Neo-Hooke (`model: "NeoHooke"`)

Isotropic hyperelastic Neo-Hookean material (fem.NeoHooke). Without a bulk modulus it needs the u-p-J formulation.

FElupe: `fem.NeoHooke`

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `mu` (μ) | number > 0 | yes | Shear modulus. Default `1`. |
| `bulk` (K) | number > 0 |  | Bulk modulus. Without it, the material is incompressible and needs the u-p-J formulation. |

#### Neo-Hooke (compressible) (`model: "NeoHookeCompressible"`)

Compressible isotropic hyperelastic Neo-Hookean material (fem.NeoHookeCompressible).

FElupe: `fem.NeoHookeCompressible`

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `mu` (μ) | number > 0 | yes | Shear modulus. Default `1`. |
| `lmbda` (λ) | number ≥ 0 | yes | First Lamé parameter. Default `2`. |

#### Mooney-Rivlin (`model: "MooneyRivlin"`)

Isotropic hyperelastic Mooney-Rivlin material (fem.Hyperelastic with fem.mooney_rivlin, needs tensortrax). The shear modulus is 2 (C10 + C01). Without a bulk modulus it needs the u-p-J formulation.

FElupe: `fem.mooney_rivlin`

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `C10` (C₁₀) | number > 0 | yes | Material parameter of the first invariant. Default `0.4`. |
| `C01` (C₀₁) | number | yes | Material parameter of the second invariant. Default `0.1`. |
| `bulk` (K) | number > 0 |  | Bulk modulus. Without it, the material is incompressible and needs the u-p-J formulation. |

#### Linear elastic (large strain) (`model: "LinearElasticLargeStrain"`)

Linear-elastic material formulated for large deformations (fem.LinearElasticLargeStrain).

FElupe: `fem.LinearElasticLargeStrain`

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `E` (E) | number > 0 | yes | Young's modulus. Default `1`. |
| `nu` (ν) | number ≥ -1, < 0.5 | yes | Poisson's ratio. Default `0.3`. |

### `section.add`

Assign a material and a formulation to a cell set. Each section becomes a solid body.

| Property | Type | Required | Description |
| --- | --- | --- | --- |
| `name` | name | yes | Name of the object. |
| `cellset` | name of a cell set | yes |  |
| `material` | name of a material | yes |  |
| `formulation` | `u` or `u-p-J` | yes | u: displacement field only. u-p-J: mixed fields (fem.FieldsMixed) for nearly incompressible materials. |
| `bulk` | number > 0 | if `formulation` is `u-p-J` | Bulk modulus of the nearly incompressible formulation (required for u-p-J). |

### `pointset.add`

Points of the merged mesh selected by a plane, by the coordinates of points or by point ids.

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
| `select.value` | number | yes |  |
| `select.atol` | number > 0 |  | Absolute tolerance (default 1e-8). |

#### By coordinates

The points at the given coordinates, one point each, e.g. picked nodes. A coordinate without a point is an error of the script.

| Property | Type | Required | Description |
| --- | --- | --- | --- |
| `select.points` | list of three numbers `[x, y, z]` (at least 1) | yes |  |
| `select.atol` | number > 0 |  | Absolute tolerance (default 1e-8). |

#### By ids

Points given by their ids, e.g. picked in the viewer.

| Property | Type | Required | Description |
| --- | --- | --- | --- |
| `select.ids` | list of integer ≥ 0 (at least 1, unique) | yes |  |

### `point.add`

A control point that is not a node of the meshes, e.g. the center point of a multi-point constraint. It is a point set of one point: all control points form a mesh of vertices that is merged with the fields of the sections.

| Property | Type | Required | Description |
| --- | --- | --- | --- |
| `name` | name | yes | Name of the object. |
| `coordinates` | three numbers `[x, y, z]` | yes | The coordinates x, y and z of a point. |

### `boundary.add`

Prescribe displacement components of a point set (fem.Boundary).

| Property | Type | Required | Description |
| --- | --- | --- | --- |
| `name` | name | yes | Name of the object. |
| `pointset` | name of a point set or control point | yes |  |
| `constrained` | list of axis: `x`, `y` or `z` (at least 1, unique) | yes | Constrained displacement components; all others are free. |
| `value` | number |  | Prescribed displacement of the constrained components (default 0); a rotation in rad at a rotation point. |

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
| `compression` | number |  | Displacement of the moving face along the normal, held during the shear (default 0). |
| `symmetry` | boolean |  | Symmetry plane normal to the third axis at its zero coordinate. Default `true`. |

### `mpc.add`

A multi-point constraint (fem.MultiPointConstraint): the points of a point set follow a center point rigidly, connected by a penalty. With a rotation point, they also rotate about the center point.

| Property | Type | Required | Description |
| --- | --- | --- | --- |
| `name` | name | yes | Name of the object. |
| `points` | name of a point set or control point | yes | The point set of the connected points. |
| `center` | name of a point set or control point | yes | The center point: a control point or a point set of one point. |
| `constrained` | list of axis: `x`, `y` or `z` (at least 1, unique) | yes | The connected components (skip the others). All of them with a rotation point. |
| `multiplier` | number > 0 |  | The penalty of the relative displacements (default 1000). |
| `rotation` | name of a point set or control point |  | The rotation point: a control point or a point set of one point, whose values are the rotations about the center point in rad (its coordinates are not used). |

### `load.add`

A point load (fem.PointLoad): a force at every point of a point set or at a control point, an item of the steps. A ramp of a step scales the force.

| Property | Type | Required | Description |
| --- | --- | --- | --- |
| `name` | name | yes | Name of the object. |
| `points` | name of a point set or control point | yes | The point set or the control point of the load. |
| `force` | three numbers `[x, y, z]` | yes | The force fx, fy, fz at every point. |

### `step.add`

A step with all boundaries, optionally ramping items, each with its own values (fem.Step).

| Property | Type | Required | Description |
| --- | --- | --- | --- |
| `name` | name | yes | Name of the object. |
| `sections` | names of sections (at least 1, unique) |  | Sections whose solid bodies are items of the step (default: all). |
| `constraints` | names of multi-point constraints (at least 1, unique) |  | Multi-point constraints that are items of the step (default: all). |
| `loads` | names of point loads (at least 1, unique) |  | Point loads that are items of the step (default: all). |
| `ramp` | object |  | Ramp the values of items with fem.math.linsteps([start, end], num), with the same number of increments for all items. |
| `ramp.num` | integer ≥ 1 | yes | Increments of the step. |
| `ramp.items` | list of objects (at least 1) | yes | The ramped items, each with its own values. |
| `ramp.items[].target` | name of a boundary, load case or point load | yes | The ramped boundary, load case or point load. |
| `ramp.items[].start` | number |  | Value at the start of the step (default 0). |
| `ramp.items[].end` | number | yes | Value at the end of the step. |

### `job.add`

A job evaluating steps one after another (fem.Job). With a curve, the force-displacement curve of a boundary, a load case or a point load is recorded (fem.CharacteristicCurve).

| Property | Type | Required | Description |
| --- | --- | --- | --- |
| `name` | name | yes | Name of the object. |
| `steps` | names of steps (at least 1, unique) | yes | Steps evaluated one after another. |
| `curve` | name of a boundary, load case or point load |  | The boundary, load case or point load of the force-displacement curve. |
| `tol` | number > 0 |  | Tolerance of the Newton-Raphson method: the norm of the residual forces relative to the reaction forces (default: the square root of the machine epsilon, 1.49e-8). |
| `maxiter` | integer ≥ 1 |  | The maximum number of Newton iterations of a substep (default 16). |
| `cutback` | object |  | Retry a substep that does not converge with smaller increments (fem.CutbackPlugin); without a value, a parameter has the default of FElupe. |
| `cutback.factor` | number > 0, < 1 |  | The factor by which the increment is reduced after a failed attempt (default 0.5). |
| `cutback.max_cutbacks` | integer ≥ 1 |  | The maximum number of successive cutbacks of the increment (default 10): the smallest increment of a substep is factor ** max_cutbacks. |
| `cutback.growth` | number ≥ 1 |  | The factor by which the increment is increased after a converged increment (default 2.0); 1 keeps the increment. |
