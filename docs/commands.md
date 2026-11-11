# Commands

Every action in FElupe Studio is a command. A project is a command list:

```json
{
  "schema_version": 3,
  "commands": [
    {
      "command": "mesh.import",
      "name": "specimen",
      "file": "specimen.vtu",
      "tag": "material"
    },
    {
      "command": "cellset.from_tag",
      "name": "soft",
      "mesh": "specimen",
      "value": 2
    }
  ]
}
```

The JSON schema [`python/felupe_studio/commands.schema.json`](../python/felupe_studio/commands.schema.json) is the single source of truth ([ADR 0003](adr/0003-command-interpretation.md)). The TypeScript types in `app/src/core/commands.ts` are generated from it with `npm run schema:types`; CI checks that they are up to date.

The [command reference](reference.md) lists all properties of the commands; it is generated from the schema by `python docs/make_reference.py`, and a test checks that it is up to date. The [user guide](guide.md) shows how to build a model in the app.

## Commands of schema version 3

| Command             | Creates                     | References                                                   | FElupe                                                                                                                                                               |
| ------------------- | --------------------------- | ------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `model.settings`    | settings (at most one)      |                                                              | the units of lengths and forces, a comment of the script; FElupe has no units, nothing is converted (see below)                                                      |
| `mesh.import`       | mesh                        |                                                              | meshio, optional integer cell data `tag`, `cell_type` (one mesh per type of solid cells) and `scale` of the coordinates                                              |
| `mesh.merge`        | merge setting (at most one) |                                                              | `fem.field.merge([...], decimals=...)`: merges points that agree to `decimals`, e.g. files of different mesh generators; without it only identical points are merged |
| `cellset.from_tag`  | cell set                    | mesh (imported with a tag)                                   | `fem.Mesh(points, cells[tag == value], cell_type)`                                                                                                                   |
| `cellset.from_file` | cell set                    | mesh                                                         | all cells of the mesh                                                                                                                                                |
| `material.add`      | material                    |                                                              | a model of the material registry, see below                                                                                                                          |
| `section.add`       | section                     | cell set, material                                           | `u`: `FieldContainer` + `SolidBody`; `u-p-J`: `FieldsMixed` + `NearlyIncompressible(bulk, volumetric)`, linear tetrahedra as MINI element                            |
| `pointset.add`      | point set                   |                                                              | coordinate (`x == 0`, with `atol`), coordinates of nodes (`points_at`, with `atol`) or point ids                                                                     |
| `point.add`         | point set (control point)   |                                                              | a mesh of vertices merged after the sections (`vertex_region`), `points_at` ([ADR 0006](adr/0006-control-points.md))                                                 |
| `boundary.add`      | boundary                    | point set                                                    | `fem.Boundary` on the merged field, `constrained` components                                                                                                         |
| `loadcase.add`      | boundary (a group)          |                                                              | `fem.dof.uniaxial`, `fem.dof.biaxial` (also planar), `fem.dof.shear` on the merged field                                                                             |
| `mpc.add`           | constraint                  | points, center, rotation                                     | `fem.MultiPointConstraint(field, points, centerpoint, skip, multiplier, rotationpoint)`, an item of the steps                                                        |
| `load.add`          | load                        | points                                                       | `fem.PointLoad(field, points, values=force)`, an item of the steps, ramped as `np.outer(ramp, force)`                                                                |
| `step.add`          | step                        | sections, constraints and loads (default: all), ramped items | `fem.Step`, `fem.math.linsteps([start, end], num)` per item                                                                                                          |
| `job.add`           | job                         | steps, curve boundary                                        | `fem.Job` or `fem.CharacteristicCurve`, with `cutback`: `plugins=[fem.CutbackPlugin(...)]`, with `tol` and `maxiter`: `evaluate(x0=field, tol=..., maxiter=...)`     |

## Load cases

A `loadcase.add` creates the boundaries of a standard test with `fem.dof` on the merged field, created without a displacement (`move=0`). It is referenced like a boundary: the ramp of a step moves its moving end faces, and a job records the reaction force over the displacement of its first moving end face.

| Type       | FElupe                              | Moving end faces (ramped)                           | Options                                    |
| ---------- | ----------------------------------- | --------------------------------------------------- | ------------------------------------------ |
| `uniaxial` | `fem.dof.uniaxial(field, axis)`     | `move` at the largest coordinate                    | `clamped`, `symmetry`                      |
| `biaxial`  | `fem.dof.biaxial(field, axes)`      | `move-right-<axis>` of both axes                    | `second`, `clamped`, `symmetry`            |
| `planar`   | `fem.dof.biaxial(field, axes)`      | `move-right-<axis>`; the second axis is held        | `second`, `clamped`, `symmetry`            |
| `shear`    | `fem.dof.shear(field, axes, moves)` | `move` of the face at the largest normal coordinate | `normal`, `compression` (held), `symmetry` |

- `symmetry` (default true, like FElupe) adds symmetry planes at x = 0, y = 0 and z = 0: the model is a quarter or an eighth. Without, the opposite end faces are at the smallest coordinates; a biaxial or planar test then moves them backwards (`move-left-<axis>`, ramped with negative values).
- `clamped` (default false) keeps the end faces rigid in the transversal directions. A uniaxial, biaxial or planar test needs symmetry planes or clamped end faces; the two axes of a test must differ. Like `fem.dof.biaxial`, the edges of clamped faces keep the transversal components.
- A step ramps a list of items (`ramp.items`), each with its own `start` (default 0) and `end`, and the same number of increments (`ramp.num`): `fem.math.linsteps([start, end], num)` per item in the `ramp` of `fem.Step`, one array for items with the same values. An item (`target`) is a boundary (its value), a load case (the displacement of its moving faces) or a point load (a factor of its force, #100), at most once per step. FElupe ramps every item with `update(value)`, so further kinds of items (pressures) only extend the kinds that `target` may reference (#90).
- Tests: an eighth of a cube of an incompressible Neo-Hookean material gives the analytical nominal stress of uniaxial (λ − λ⁻²), planar (λ − λ⁻³) and equi-biaxial (λ − λ⁻⁵) tension within 0.2 %, and a clamped uniaxial test equals explicit boundaries.

## Material models

The material models are the definitions `Material<Model>` of `material.add` in the command schema, the material registry. Every definition holds the label of the model (`x-label`), how FElupe creates it (`x-felupe`: a `class`, or a `function` of tensortrax for `fem.Hyperelastic`) and its parameters with label, description, bounds and default. The forms, the ribbon, the validation and the generated script read them from there (`felupe_studio.materials` in Python), so a new model needs a schema definition and tests, but no code in the app.

| Model                      | Label                         | FElupe                                                       | Parameters                              |
| -------------------------- | ----------------------------- | ------------------------------------------------------------ | --------------------------------------- |
| `NeoHooke`                 | Neo-Hooke                     | `fem.NeoHooke(mu, bulk)`                                     | μ `mu`, optional K `bulk`               |
| `NeoHookeCompressible`     | Neo-Hooke (compressible)      | `fem.NeoHookeCompressible(mu, lmbda)`                        | μ `mu`, λ `lmbda`                       |
| `MooneyRivlin`             | Mooney-Rivlin                 | `fem.Hyperelastic(fem.mooney_rivlin, C10, C01)` (tensortrax) | C₁₀ `C10`, C₀₁ `C01`, optional K `bulk` |
| `LinearElasticLargeStrain` | Linear elastic (large strain) | `fem.LinearElasticLargeStrain(E, nu)`                        | E `E`, ν `nu`                           |

A model with an optional bulk modulus is incompressible without it: a section with this material needs the `u-p-J` formulation (`fem.NearlyIncompressible(..., bulk)`). A bulk modulus marked `"x-felupe": "volumetric"` is added as `fem.Volumetric(bulk=...)`, e.g. `umat &= fem.Volumetric(bulk=5000.0)` for Mooney-Rivlin. The models of tensortrax need the package `tensortrax` in the generated script; the shear modulus of Mooney-Rivlin is 2 (C₁₀ + C₀₁).

## Validation

`felupe_studio.commands.validate(document)` raises a `ValidationError` with all messages, `errors(document)` returns them as a list. Besides the schema, it checks:

- names are unique within the command list, at most 24 characters, no Python keywords and not reserved for the generated script (`field`, `points`, `boundaries`, … and the prefixes `field_`, `solid_`, `region_`, `ramp_`),
- references point to an object of the right kind that was created before (the app keeps the command list in this order, see _Order of the commands_),
- `cellset.from_tag` refers to a mesh imported with a `tag`,
- a material whose model has an optional `bulk` (e.g. `NeoHooke`, `MooneyRivlin`) is only used without `bulk` in a `u-p-J` section.

## Checks with the mesh data

`felupe_studio.checks.check(document, directory)` reads the mesh files and returns a JSON report (`ok`, `messages`, `cells`, `interfaces`):

- **Cell assignment:** every solid cell of an imported mesh belongs to exactly one section; unassigned cells and cells in more than one section are reported per mesh.
- **Interfaces:** the section meshes are merged on identical points (or with the `decimals` of `mesh.merge`), like `fem.field.merge` in the generated script. For every pair of sections that touch, the report counts the shared points and the _hanging_ points: points on the surface of one section that lie on a face of the other one without being one of its points (tolerance 1e-6 of the model diagonal). Hanging points are not connected, e.g. at a non-conforming interface or if the coordinates of two files differ slightly.

Example messages: `192 / 192 cells assigned once.` and `Interface left_body / right_body: 25 shared points, 0 hanging.`

## Units

FElupe has no units: the numbers of a model only have to be consistent. The optional `units` of `model.settings` say what they mean, `length` (`mm` or `m`) and `force` (`N` or `kN`); stresses and moduli follow from them (mm and N: MPa, mm and kN: GPa, m and N: Pa, m and kN: kPa), moments are force times length. Nothing is converted: changing the units changes the meaning of the numbers, not the numbers. Rotations of rotation points are always in rad, the ramped values of point loads are factors of their force (no unit), strains have no unit.

The properties of the schema have their physical quantity in `x-quantity` (`length`, `displacement`, `force`, `stress` or `ramped`: the quantity of the ramped target, a displacement, a rotation or a factor). The app shows the units at the labels of the forms (e.g. `E [MPa]`), in the browser, at the curves, in the tooltips and the control points of the results, and at the scalar bar; the CSV of curves and control points has them in the header (e.g. `u_x [mm]`). The script gets them as a comment.

## Generated script

`felupe_studio.codegen(document)` validates the command list and returns a FElupe script that only needs FElupe, NumPy and meshio (and tensortrax for its models). Its structure does not depend on the order of the commands:

1. meshes (`volume_cells()` keeps the solid cells of a meshio file, of one cell type, and ignores lower-dimensional blocks) and cell sets
2. materials
3. a region and a field container per section, merged with `fem.field.merge([...])` into the top-level `field`. The region follows the cell type (`REGIONS`); for `u-p-J`, `mixed_region()` gives linear tetrahedra a bubble point (`tetra5`, `fem.RegionTetraMINI`), the other cell types keep their region (Q1/P0, Q2/P1, P2/P1 with the dual fields of `fem.FieldsMixed`). A test runs every cell type in both formulations.
4. solid bodies, created after the merge (required for items with an internal state)
5. point sets on `field.mesh_container.points`, load cases of `fem.dof` on `field` and `boundaries` on `field[0]`; the boundaries of a load case are added as `<load case>/<key>`
6. steps and jobs, evaluated with `job.evaluate(x0=field)` (skip with `evaluate=False`)

Generated scripts pass `ruff check` and `ruff format --check`. The tests run them with FElupe and compare with hand-written FElupe models.

## Model store (app)

`app/src/core/store.ts` holds the command list in the browser:

- `apply(edit)` with `add` (optionally at an index), `update` (also renames) and `remove`; an array of edits is one undo step and is applied completely or not at all
- `undo()`, `redo()` with up to 100 steps; `load(document)` replaces the model and clears the history
- derived state: `issues` (validation, `app/src/core/validate.ts`), `tree` (browser tree, `app/src/core/tree.ts`) and `dependents(name)`; `setReport(report)` adds the check report of the worker until the commands change
- `subscribe(listener)` for the UI

The TypeScript validation mirrors the Python validation. Both run the shared cases in `tests/data/validation_cases.json`, so their messages are identical; after changing a message, run `python tests/data/make_validation_cases.py`. Reserved names are part of the schema (`x-reserved`).

## Project files

A project is saved as `<name>.felupe.json`, the command list with a stable layout so that it diffs well:

- `schema_version` first, then `commands`; every command is one block that starts with `command` and `name`, the other keys follow in the order of the schema (unknown keys sorted at the end),
- two spaces of indentation and a newline at the end,
- numbers as written by JavaScript's `JSON.stringify` (e.g. `1e-8`, `0.0000025`).

The app (`app/src/core/project.ts`: `serialize`, `parse`) and Python (`felupe_studio.project`: `dumps`, `loads`) write byte-identical files; both are tested with `tests/data/*.felupe.json`. Loading checks the JSON schema (Ajv in the app, jsonschema in Python) but not the references between commands, so a file with a broken reference still opens and shows its issues in the browser.

Older files are brought to the current schema with `MIGRATIONS[version]`, one step per schema version; a file of a newer schema version is rejected with a hint to update FElupe Studio.

| From | To  | Migration                                                                                                                                         |
| ---- | --- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1    | 2   | The ramp of a step gets items with their own values: `{boundary, also, start, end, num}` becomes `{num, items: [{target, start, end}, …]}` (#90). |
| 2    | 3   | `"cutback": true` of a job becomes `"cutback": {}` (the settings of the cutback, #133), `false` is removed; `model.settings` is new (#132).       |

## Forms (app)

The form of the selected object is shown in the **properties panel** on the right of the viewport (#83). It opens when an object is selected (in the browser, in the history bar, with `select <name>` and after an object was created) and closes with ×; the selection stays, and a click on the object opens the panel again. The panel belongs to the Model workspace; on narrow screens it is shown below the browser.

The forms of the app are not written per command. `app/src/core/form.ts` derives them from the schema:

| Schema                                                                    | Field                                                                                                    |
| ------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `name`                                                                    | name field, checked for the pattern, reserved names and duplicates                                       |
| reference to a `Name` (single or array)                                   | selection of all objects of that kind (except the edited one), also of the ones created later; see below |
| `string`, `number`, `integer`                                             | text and number fields with the ranges of the schema                                                     |
| `enum`, array of an `enum`                                                | selection, checkboxes                                                                                    |
| `oneOf` of definitions with a constant (`model`) or of objects (`select`) | variant selection that switches the fields below                                                         |
| optional object (`ramp`)                                                  | checkbox that switches a group of fields on and off                                                      |
| array of objects (`ramp.items`)                                           | rows with a field per property, add and remove; a `unique` column offers an object in one row only       |
| `if` / `then` / `else` (`bulk` of a section)                              | field that is only shown and required for a condition                                                    |

`app/src/core/registry.ts` adds what the schema does not know: labels, hints, placeholders, defaults of new objects, the ribbon tab of a command and the prefix of suggested names (`material_1`). A test checks that every field of every variant has a label (from the registry or, for the material registry, from the schema), and that the form validation rejects what the schema rejects. An `initial` function adapts the defaults of a new object to the model: a new section takes the first cell set without a section, and `u-p-J` if its material is incompressible (no bulk modulus).

The ribbon (`app/src/core/ribbon.ts`) shows one button per command of a tab (the `tab` of the registry), or one button per variant if the variant selects a schema definition, e.g. one button per material model. A button opens a dialog with the form of a new object: a suggested name, the defaults of the registry and the latest object of the right kind for references. A command whose required references do not exist yet is disabled with the reason ("Create a cell set and a material first."); commands marked `single` (the merge setting) are disabled once the model has one.

Changes are applied with the model store: `store.update(name, command)` is one undo step, and if an object is renamed, the references of the other commands follow.

### Adding a material model

1. Schema: a definition `Material<Model>` with `model` as a constant, `x-label`, `x-felupe` (`class` or tensortrax `function`) and its `parameters` with `x-label`, `description`, bounds and `default`, added to `MaterialAdd.oneOf` (`python/felupe_studio/commands.schema.json`); run `npm run schema:types`.
2. Tests: the registry tests check the signature of FElupe and a stress-free state with a positive shear stiffness; add a golden case or a code generation test that runs the model with FElupe.

The form, the ribbon button and the code generation follow without further code (see [Material models](#material-models)).

## Command line (app)

The command line below the viewport accepts the same JSON as the project file (`app/src/core/commandline.ts`):

| Input                                                                           | Action                                                                                         |
| ------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `material.add {"name": "rubber", "model": "NeoHooke", "parameters": {"mu": 1}}` | create an object; a missing name is suggested, missing values get the defaults of the registry |
| `{"command": "material.add", ...}`                                              | the same, as one JSON object                                                                   |
| `section.add`                                                                   | open the dialog of a new section                                                               |
| `delete <name>`, `select <name>`                                                | delete (if unused) or select an object                                                         |
| `undo`, `redo`, `help`                                                          |                                                                                                |

A created command is checked like a form (`draftErrors`), keys that are not part of the command are reported instead of being dropped, and finally the command is validated against its own schema definition (`commandErrors` in `project.ts`, Ajv). On an error the line stays for correction.

Tab or Enter accepts a suggestion: command names and keywords for the first word, object names after `delete` and `select`, and after a command a JSON template with the defaults (one per material model). ↑/↓ move through the suggestions, or through the entered lines if no suggestions are shown; Escape closes the suggestions, a second Escape clears the line.

**Order of the commands:** a form offers every object of the right kind, also one that was created later (#80). After every edit, the store puts the command list into an order in which every reference points to an object before (`order()` in `app/src/core/validate.ts`, a stable topological order): a command that references a later object moves behind it, together with the commands that depend on it, and all other commands keep their order. A command without references (e.g. `mesh.import`, `material.add`) never moves. The reordering is part of the edit, so one undo restores it; the saved project file and the generated script are always in order.

The history bar below shows the command list in order: a click selects the object, objects with issues are marked, and the arrows step back and forward (undo, redo).

## Mesh files (app)

A project file references mesh files by name; their content lives next to it. In the app:

- **Import mesh** (ribbon, `mesh.import` on the command line, or opening/dropping a single mesh file) opens a dialog: choose or drop the file, see its cells, points, bounds and ignored lower-dimensional blocks, and create the mesh together with its cell sets in one undo step: one cell set per value of a cell tag (named after Gmsh physical groups if the file has them), one with all cells, or none.
- **Files with more than one type of solid cells** (e.g. hexahedra and tetrahedra) give one mesh per cell type, like the meshes of the `MeshContainer` of `fem.mesh.read()`: a region of FElupe has one cell type. The dialog names them `<name>_<cell type>` and sets their `cell_type`; a tag value in cells of more than one type gives one cell set per type. The meshes share the points of the file, so `fem.field.merge()` connects them without `mesh.merge`. Wedges and pyramids have no region in FElupe; they are listed as not imported. A direct transition from hexahedra to tetrahedra shares the corner points, but a quad face meets two triangles: the displacements are not conforming inside these faces.
- **Open** accepts a project file together with its mesh files (select several files, or drop them on the window). Several mesh files without a project are offered in the import dialog.
- A mesh whose file is not loaded, cannot be read, lacks its cell tag or needs a `cell_type` (or names one the file does not have) is marked in the browser; its properties show the file state with **Choose file…**, which stores the chosen file under the name the mesh references.

The files are kept in the browser (`app/src/core/meshfiles.ts`) and written into the working directory of Python in the worker, where `felupe_studio.meshes.load()` reads them with meshio exactly like the generated script (`volume_cells`): a summary for the dialog (`inspect()`, one entry per type of solid cells) and the outer surfaces for the viewport, from one read. meshio is served as a pinned wheel next to FElupe (`config.wheels` in `app/package.json`). They are kept across a reload of the page, see _Session in the browser_.

## Viewport (app)

The viewport draws the imported meshes with the WebGL2 viewer of FElupe ([ADR 0004](adr/0004-viewer.md)), a pinned copy in `app/src/vendor/felupe-viewer/`.

- `felupe_studio.scene.surface()` triangulates the outer surface of the solid cells with FElupe (`triangulate_surface`), like `mesh.plot()`: flat faces for linear cells, subdivided curved faces for quadratic cells, and the edges of the faces. Every region of cells with the same values of all cell tags is triangulated on its own, so its surface is closed also at the interfaces to other regions (cell sets and sections take the cells of a tag value or all cells). The arrays, with the values of the cell tags per cell, go to the main thread as little-endian bytes (`float32` coordinates, `uint32` indices, `int32` tags) and are drawn without copies.
- **Color by** (toolbar) colors the cells by mesh, cell set or section. By default, the viewport takes sections if the model has any, else cell sets, else meshes, until another one is chosen. Colors follow the position of an object in the model, so hiding an object does not repaint the others. The legend names the cell sets or sections with visible cells, and _No cell set_ or _No section_ for the other cells. Later cell sets win for cells in more than one. A ninth and further object is gray instead of a generated color.
- **Visibility:** the eye of a mesh, a cell set or a section in the browser hides its cells (and their edges). The surfaces of the remaining regions stay closed.
- **Point sets** are shown as markers on the nodes of the drawn meshes that they select, with the tolerances of `np.isclose` in the generated script (`atol` and the default `rtol = 1e-5`); the selected point set is highlighted, its eye hides it. Point sets of point ids refer to the merged mesh of the script and are not shown.
- **Point sets by nodes** (`select: {points: [[x, y, z], ...], atol}`, #92) store picked nodes by their coordinates, not by ids of the merged mesh, which change when sections are added or removed. The script selects them with `points_at(points, coordinates, atol=1e-8)` (a helper of the script, `np.isclose` of all three coordinates) and raises a `ValueError` for a coordinate without a point. In the properties, the coordinates are typed one point per line (`x, y, z`); the viewport warns about the coordinates of the selected point set without a node of the drawn meshes.
- **Control points** (`point.add {name, coordinates}`, #94) are points that are not nodes of the meshes, e.g. the center point of a multi-point constraint. All control points form one mesh of vertices whose field is merged after the fields of the sections (`region_control_points = vertex_region([...])`); a control point is a point set of one point, found by its coordinates, so boundaries and the curve of a job reference it like a point set. It has no stiffness of its own: every component needs a boundary or a multi-point constraint (as its center point, or all components as its rotation point). The results and exports show the cells of the sections only. See [ADR 0006](adr/0006-control-points.md).
- **Multi-point constraints** (`mpc.add {name, points, center, constrained, multiplier, rotation}`, #97) connect the points of a point set to a center point: `fem.MultiPointConstraint(field, points=np.flatnonzero(points), centerpoint=single_point(center, "center"), ...)`. The center point and the optional rotation point are control points (or point sets of one point; `single_point` raises a `ValueError` for another number of points). `constrained` are the connected components (`skip` for the others); with a rotation point, whose values are the rotations about the center point in rad, all components are connected. The constraints are items of the steps (`constraints`, default: all). The validation (shared cases) reports a rotation point with skipped components, control points at the same coordinates (the script merges them; place a rotation point beside the center point) and components of a control point without a boundary or a constraint (no stiffness).
- **Boundaries and curves of control points** (#98): a boundary of a center point moves the connected points rigidly (its components and value, ramped by a step); a boundary of a rotation point prescribes rotations about the center point in rad. The curve of a job on a boundary of a control point shows its reaction force over its displacement, on a rotation point the moment over the rotation (_Moment–rotation_, `φ` and `M`, also in the CSV: `phi_x`, `M_x`, …); the moment equals `results.moment` of the constraint. The properties of a rotation point and of its boundaries say that their values are rotations.
- **Point loads** (`load.add {name, points, force}`, #100) apply the force at every point of a point set or at a control point: `fem.PointLoad(field, points=..., values=[fx, fy, fz])`, an item of the steps (`loads`, default: all). A load is applied in full unless a step ramps it: a ramp item of a load is a factor of its force (`np.outer(ramp, force)`), and a load keeps its last value in the following steps. The curve of a job on a load is controlled by the force: `fem.CharacteristicCurve(boundary=load, items=[solids, constraints])` records the displacement of the first point of the load over the total force (the sum of the internal forces at its points). In the viewport, a load is drawn as arrows in the direction of its force.
- **Results of control points** (#101): after every substep, the runner records the displacement of every control point and the force of the constraints at it (the sum of `results.force` of the multi-point constraints: the reaction force of a boundary of the control point, or the force of a load at it); of a rotation point the rotation and the moment. The results show them in a card **Control points** (toolbar button **Points**) and in a tooltip on hover of a control point; **Export ▸ Control points (CSV)** writes all substeps (`substep, plate.u_x, …, plate.F_z`, of a rotation point `phi` and `M`; `felupe_studio.results.export(job, "csv")`).
- **Boundaries and load cases** (#82): a boundary draws a short stroke through every point of its point set along every fixed component (in the colors of the axis triad); a boundary that moves (a ramp of a step, with the end of the last step that ramps it, or a `value`) draws an arrow per point in the direction of its components and the sign of its value. Load cases draw the boundaries of `fem.dof` (`app/src/viewer/boundaries.ts`, computed on the nodes of the drawn meshes; `tests/test_boundary_symbols.py` writes what FElupe makes of a set of load cases into `boundaries.fixture.json`, which the app test compares). The eye of a boundary or load case hides its symbols, a selected one is highlighted. The size of the symbols follows the size of the model; more than 300 points of a boundary are thinned out. Point sets of point ids are not drawn.
- **Nodes** (view toolbar, #91) shows the nodes of the drawn meshes as small black dots, in the Model and the Results workspace (one setting for both; off by default): the points of the surfaces of the cells that are not hidden, without the points inside the subdivided faces of quadratic cells (`isnode` of `felupe_studio.scene.surface()`); in the results, displaced like the surfaces.
- **Picking:** a click (not a drag) on a face highlights all drawn faces in its plane and previews its points. A face normal to x, y or z offers **Create point set**: the coordinate is the exact coordinate of the nodes in the plane (not of the float32 surface), with a larger `atol` only if their spread needs it, and the name is `x_min`, `x_max` or e.g. `y_0_5`. Other faces are explained; point sets select planes normal to an axis. Escape or × clears the pick. A tip in the viewport explains the click until the first pick (or until it is dismissed; remembered in the browser). The panels at the bottom (tip, picked face or nodes, selected point set, messages) are stacked between the axes and the job panel and never overlap; in a narrow view the job panel spans the width and the other overlays stay above it (#128).
- **Picking nodes** (#93): with **Nodes** shown, a click within 8 pixels of a drawn node picks the node instead of the face (nodes behind the drawn faces are not picked); Shift+click adds or removes a node, a click beside the nodes picks a face again and Escape or × clears them. The picked nodes are highlighted and stored with the exact coordinates of the nodes of the meshes (not the float32 coordinates of the surface). The panel shows the coordinates of a single node and offers **Copy** (one point per line), **Create point set** (by nodes, named `node` or `nodes`) and, if a point set by nodes is selected, **Add to** it.
- **Control points** (#95) are drawn as cyan dots with a dark outline, also without **Nodes**; the selected one is highlighted and its eye hides it. A click within 8 pixels selects a control point (before nodes and faces). The browser lists them in a group **Points**, the properties call them _Control point_. Boundaries of a control point draw their symbols at it. A control point at a node of the meshes is merged with that node by the script; the viewport says so for the selected one. In the results, the control points are displaced like the surfaces (`points` of the scene of `felupe_studio.results`: name, position and displacement).
- **Control point at center** (#96): the selected point set (with the number of its points and the center of their bounding box), a picked face and picked nodes offer a control point at the center of the bounding box of their points. It opens the dialog of a new control point with these coordinates (and a name like `control_right`), so the point can be moved off the face before it is created. The coordinates are stored, not the point set: the control point does not move when the point set changes.
- **Multi-point constraints** (#99) are drawn as thin cyan lines from the center point to the connected points (thinned out for more than 300 points, like the symbols of the boundaries); the selected one is highlighted and its eye hides it. For the selected constraint, the viewport reports points that a boundary or a load case prescribes in a connected component as well, e.g. `glue: 25 points are also in edge (z): over-constrained.` In the results, the lines follow the displaced points (the nearest node of the result surfaces, or the displacement of a control point).
- **Updates:** the build writes `version.json` with the build (the commit on GitHub Pages). An open app asks for it every ten minutes and when the page becomes visible again, without the HTTP cache, and offers **Reload** once a newer version is deployed; with a model, it asks to save the project first, because the project and its mesh files are not kept across a reload yet (#57).
- The toolbar fits the model into the view and sets the camera onto the xy-, xz- or yz-plane or isometric. Drag to rotate, shift-drag (or right-drag) to pan, scroll to zoom, double-click to reset. The camera fits the model when it is first shown and keeps its rotation, zoom and pan while the model changes.
- The app talks to the viewer only through the adapter `app/src/viewer/viewer.ts`: meshes with colors of groups of cells and hidden cells, the legend, point markers, arrows and camera presets. The scenes are built by pure functions (`app/src/viewer/scene.ts`), tested without WebGL.

## Running jobs (app)

**Solve** (header) runs the jobs of the model in the Pyodide worker. It is offered for a valid model with a job and loaded mesh files, once Python is loaded; otherwise its tooltip says what is missing.

- `felupe_studio.runner.run()` runs the generated script (`codegen(..., evaluate=False, check_schema=False)`: the app validated the command list against the schema with Ajv, so the worker needs no `jsonschema`; the references are checked again) and evaluates every job with a plugin (`fem.Plugin`) that reports the progress: the substeps of every step at the start, then every substep, Newton iteration (norm of the residuals), failed attempt and converged substep. The worker posts these events to the main thread while Python runs. The results are the number of substeps and the time per job and, for a characteristic curve, the displacements and forces of its boundary per substep (three components each). The values of all fields after every converged substep are recorded for the results (see below).
- The panel in the viewport shows the job, step, substep and Newton iteration with a progress bar, in lines that do not wrap, so that it keeps its size while running (with a cutback, a line counts its retries); then the time per job and the force at the last substep of a curve. A failed run shows the exception and the full Python traceback; a failed Newton-Raphson method also suggests more substeps, the cutback or a looser tolerance.
- **Cutback** is a setting of the job (`cutback`, also in the generated script): `fem.CutbackPlugin` retries a substep that does not converge with smaller increments. Its parameters `factor`, `max_cutbacks` and `growth` are optional; without them, FElupe's defaults apply (0.5, 10 and 2.0), and only the given ones are written to the script. The panel counts these attempts.
- **Newton-Raphson method:** `tol` and `maxiter` of the job are passed to `job.evaluate()` if they are given (FElupe's defaults: 1.49e-8 and 16). The panel shows the iteration of the maximum, e.g. *Newton iteration 3 of 16*.
- **Tolerance** is a setting of the job (`tol`, also in the generated script): the tolerance of the Newton-Raphson method, i.e. the norm of the residual forces relative to the norm of the reaction forces. Without it, FElupe takes the square root of the machine epsilon (1.49e-8); a looser tolerance, e.g. 0.05, needs fewer iterations.
- **Cancel:** Python runs synchronously in the worker, so a run is cancelled by terminating the worker. A new worker loads Python again (Pyodide and the wheels come from the cache) and gets the mesh files again (`PyodideClient.restart()`).
- **tensortrax** (Mooney-Rivlin) is a pinned wheel that is loaded only before the first run of a model with one of its materials (`lazy` in `config.wheels`), so it does not add to the start-up time. FElupe was imported before, so `load_tensortrax()` reloads `felupe.constitution` to make `fem.Hyperelastic` available.

## Results (app)

**Show results** (job panel) or the **Results** workspace shows the last finished run: the deformed sections with a contour, like `fem.ViewSolid(field, solid).plot(...)` with the plotting backend `"webgl"` of FElupe.

- The ribbon chooses the job (with more than one), the contour, the substep (counted over all steps of the job, the last one first), the scale of the displacements and the transparent undeformed shape. For a characteristic curve, it shows the displacement and the force of the curve boundary at the substep.
- Contours: the displacement (magnitude or a component) at the points; the principal values (max., mid., min.) of the logarithmic strain and of the Cauchy stress and the von Mises equivalent of the Cauchy stress as the mean of the quadrature points of every cell. The range of the colors is the range of all cells of all sections at this substep (one scalar bar).
- `felupe_studio.results`: a plugin records copies of the values of all fields of the top-level field container after every substep. `scene(job, substep, quantity)` writes the values of a substep back into the fields in-place (the fields of the sections share them, see `fem.field.merge`) and evaluates the quantity per section. The outer surface of every section is triangulated once per run (`triangulate_surface`, subdivided for quadratic cells; the bubble points of the MINI element are left out). The arrays go to the main thread as bytes, like the surfaces of the meshes; the viewer adds the scaled displacements to the points.
- Only one scene is loaded at a time: while the slider of the substeps moves, the latest substep is loaded next. Scenes are loaded only while the Results workspace is shown. A new run replaces the results (also if it fails or is cancelled); results stay available after a change of the model, with a note.
- **Value under the pointer** (#85): hovering over the deformed sections shows a tooltip with the quantity of the contour and its value: for cell data the value of the cell of the hit face (_Cell 42 of block_, the index of the cell in its section), for point data the value of the nearest corner of the hit face with its three displacements (_Node 17 of block_, the index of the point in the merged mesh; a point inside a subdivided quadratic face has no node), marked with a ring. The hit test runs on the drawn (deformed and scaled) surfaces once per frame (`app/src/viewer/probe.ts`); the result scene has the cell of every triangle (`owners`) and the node of every point (`nodes`). Rotating, panning or zooming hides the tooltip.
- The recorded fields take memory in the worker: the values of all fields (float64) per substep.
- **Force-displacement curve** (a job with a curve boundary, `fem.CharacteristicCurve`): a card over the results shows the reaction force over the displacement of the curve boundary per substep, for a component (by default the one with the largest displacement at the end). The current substep is marked; hovering shows the values of the nearest substep, a click selects it. **Table** lists the values (a click on a row selects the substep), **CSV** downloads all components with the substeps and steps. **Curve** in the ribbon shows or hides the card.

## Session in the browser (app)

The app keeps the current project in the browser, so that a reload (or a crash of the tab) restores it: the project file (text), its file name, whether it has unsaved changes, and the mesh files that its `mesh.import` commands read. The undo history and the results are not kept; solve again after a reload.

- `app/src/core/session.ts`: IndexedDB database `felupe-studio` with the stores `session` (one record: project, file name, modified, names, sizes and SHA-256 hashes of the files) and `files` (the content by file name). A file whose hash did not change is not written again; files that the project does not import any more are removed. Only the last session is kept, also with several tabs (the last change wins).
- The session is written 0.4 s after the last change. If the mesh files do not fit into the storage of the browser, the project is kept without them; a storage that does not work does not break the app. The status bar says where the session is kept (_Kept in this browser_, _… without mesh files_, _Not kept in this browser_, with the reason as tooltip).
- On start, the last session is restored if the model is still empty; the mesh files are written into the worker and inspected again.
- **File ▸ New project** starts an empty project and clears the kept session; with unsaved changes it asks first. The data stays in this browser only: save the project file to keep it elsewhere.

## Samples (app)

**File ▸ Samples…** and the welcome panel of an empty model (#127) list finished models with a picture; **Open** loads one like a project file with its mesh files (a sample replaces the current model; the dialog warns about unsaved changes).

- The samples are folders in `app/public/samples` with a project file `model.felupe.json` and its mesh files, listed in `app/src/core/samples.json` (title, description, topics, mesh files), and a picture `thumbnail.svg`: the outer faces of the sections in the colors and the default view of the viewport, made from the model that the generated script builds (without evaluating the jobs). All of them are made by `app/scripts/make_samples.py` (units: mm, N, MPa); run it from the repository root after a change and commit the files.
- `tests/test_samples.py` checks that every sample is a canonical project file without errors, that its files exist and its picture is up to date, and solves it with FElupe. The material test is checked against the analytical curve of the incompressible Neo-Hooke model. The rubber block with a rigid plate (#102) shows control points, a multi-point constraint with a rotation point and a ramp with its own values per item; its test checks that the plate is moved by 8 mm and tilted by 0.1 rad.

## Script view (app)

The ribbon tab **Script** of the Model workspace shows the script of `felupe_studio.runner.script_view()` instead of the viewport: the exported script and the lines of its objects (`felupe_studio.codegen.object_lines()`, from the syntax tree of the script). An object owns its assignment and the parts of other statements about it: an entry of the boundaries, the region, field and solid body of a section, the ramps of a step, the evaluation of a job; lines about several objects (e.g. the merge of the fields) belong to none. The view is made again 0.25 s after a change (the latest request wins), highlights Python (`app/src/core/highlight.ts`), highlights the lines of the selected object and selects the object of a clicked line. A model with issues shows the issues instead.

## Exports (app)

**Export** (header, and the section *Export* of the File menu) lists the exports of the project; an export that is not possible says why. **Help** links the user guide and the command reference, lists the keyboard shortcuts and shows *About* (the versions of the app, FElupe, Python, Pyodide and the wheels, the load time, the license and the Pyodide benchmark).

- **Python script** (`<project>.py`): the FElupe script of the model, generated in the worker (`felupe_studio.runner.script()`, without the schema check, see _Running jobs_). It reads the mesh files from its folder, so it runs next to them with FElupe, meshio and NumPy (and tensortrax for Mooney-Rivlin).
- **Results of the job (XDMF)** (`<project>-<job>.xdmf`) and **Results of the substep (VTU)** (`<project>-<job>-<substep>.vtu`, the substep of the Results workspace), for ParaView: `felupe_studio.results.export()` writes the merged points that the cells use (without the bubble points of the MINI element) and one block of cells per section with meshio. Point data: `Displacement`; cell data (means of the quadrature points, the names of `fem.ViewSolid`): `Principal Values of Logarithmic Strain`, `Principal Values of Cauchy Stress`, `Equivalent of Cauchy Stress` and the index of the `Section`. The XDMF file is a time series with the substeps as time and the data inside the XML (`data_format="XML"`), so it is a single file without HDF5 (and h5py is not needed in the worker).
- **Picture of the view** (`<project>.png`, or `<project>-<job>-<substep>.png` in the Results workspace): the 3D view at the resolution of the screen, with the scalar bar, the legend and the axis triad on the background of the viewport. The vendored viewer does not keep its drawing buffer, so the canvas is copied in the animation frame after its next draw (`app/src/viewer/snapshot.ts`) and the overlays are drawn on top.
