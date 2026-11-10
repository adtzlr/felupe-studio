# Commands

Every action in FElupe Studio is a command. A project is a command list:

```json
{
  "schema_version": 1,
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

## Commands of schema version 1

| Command             | Creates                     | References                               | FElupe                                                                                                                                                               |
| ------------------- | --------------------------- | ---------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `mesh.import`       | mesh                        |                                          | meshio, optional integer cell data `tag` and `cell_type` (one mesh per type of solid cells)                                                                          |
| `mesh.merge`        | merge setting (at most one) |                                          | `fem.field.merge([...], decimals=...)`: merges points that agree to `decimals`, e.g. files of different mesh generators; without it only identical points are merged |
| `cellset.from_tag`  | cell set                    | mesh (imported with a tag)               | `fem.Mesh(points, cells[tag == value], cell_type)`                                                                                                                   |
| `cellset.from_file` | cell set                    | mesh                                     | all cells of the mesh                                                                                                                                                |
| `material.add`      | material                    |                                          | a model of the material registry, see below                                                                                                                          |
| `section.add`       | section                     | cell set, material                       | `u`: `FieldContainer` + `SolidBody`; `u-p-J`: `FieldsMixed` + `NearlyIncompressible(bulk)`, linear tetrahedra as MINI element                                        |
| `pointset.add`      | point set                   |                                          | coordinate (`x == 0`, with `atol`) or point ids                                                                                                                      |
| `boundary.add`      | boundary                    | point set                                | `fem.Boundary` on the merged field, `constrained` components                                                                                                         |
| `loadcase.add`      | boundary (a group)          |                                          | `fem.dof.uniaxial`, `fem.dof.biaxial` (also planar), `fem.dof.shear` on the merged field                                                                             |
| `step.add`          | step                        | sections (default: all), ramped boundary | `fem.Step`, `fem.math.linsteps([start, end], num)`                                                                                                                   |
| `job.add`           | job                         | steps, curve boundary                    | `fem.Job` or `fem.CharacteristicCurve`, with `cutback`: `plugins=[fem.CutbackPlugin()]`                                                                              |

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
- A ramp of a step may also move further boundaries with the same values (`ramp.also`), e.g. two explicit boundaries of an equi-biaxial test.
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
- references point to an object of the right kind that was created before,
- `cellset.from_tag` refers to a mesh imported with a `tag`,
- a material whose model has an optional `bulk` (e.g. `NeoHooke`, `MooneyRivlin`) is only used without `bulk` in a `u-p-J` section.

## Checks with the mesh data

`felupe_studio.checks.check(document, directory)` reads the mesh files and returns a JSON report (`ok`, `messages`, `cells`, `interfaces`):

- **Cell assignment:** every solid cell of an imported mesh belongs to exactly one section; unassigned cells and cells in more than one section are reported per mesh.
- **Interfaces:** the section meshes are merged on identical points (or with the `decimals` of `mesh.merge`), like `fem.field.merge` in the generated script. For every pair of sections that touch, the report counts the shared points and the _hanging_ points: points on the surface of one section that lie on a face of the other one without being one of its points (tolerance 1e-6 of the model diagonal). Hanging points are not connected, e.g. at a non-conforming interface or if the coordinates of two files differ slightly.

Example messages: `192 / 192 cells assigned once.` and `Interface left_body / right_body: 25 shared points, 0 hanging.`

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

## Forms (app)

The forms of the app are not written per command. `app/src/core/form.ts` derives them from the schema:

| Schema                                                                    | Field                                                                        |
| ------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| `name`                                                                    | name field, checked for the pattern, reserved names and duplicates           |
| reference to a `Name` (single or array)                                   | selection of the objects of that kind that are defined before the edited one |
| `string`, `number`, `integer`                                             | text and number fields with the ranges of the schema                         |
| `enum`, array of an `enum`                                                | selection, checkboxes                                                        |
| `oneOf` of definitions with a constant (`model`) or of objects (`select`) | variant selection that switches the fields below                             |
| optional object (`ramp`)                                                  | checkbox that switches a group of fields on and off                          |
| `if` / `then` / `else` (`bulk` of a section)                              | field that is only shown and required for a condition                        |

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

The history bar below shows the command list in order: a click selects the object, objects with issues are marked, and the arrows step back and forward (undo, redo).

## Mesh files (app)

A project file references mesh files by name; their content lives next to it. In the app:

- **Import mesh** (ribbon, `mesh.import` on the command line, or opening/dropping a single mesh file) opens a dialog: choose or drop the file, see its cells, points, bounds and ignored lower-dimensional blocks, and create the mesh together with its cell sets in one undo step: one cell set per value of a cell tag (named after Gmsh physical groups if the file has them), one with all cells, or none.
- **Files with more than one type of solid cells** (e.g. hexahedra and tetrahedra) give one mesh per cell type, like the meshes of the `MeshContainer` of `fem.mesh.read()`: a region of FElupe has one cell type. The dialog names them `<name>_<cell type>` and sets their `cell_type`; a tag value in cells of more than one type gives one cell set per type. The meshes share the points of the file, so `fem.field.merge()` connects them without `mesh.merge`. Wedges and pyramids have no region in FElupe; they are listed as not imported. A direct transition from hexahedra to tetrahedra shares the corner points, but a quad face meets two triangles: the displacements are not conforming inside these faces.
- **Open** accepts a project file together with its mesh files (select several files, or drop them on the window). Several mesh files without a project are offered in the import dialog.
- A mesh whose file is not loaded, cannot be read, lacks its cell tag or needs a `cell_type` (or names one the file does not have) is marked in the browser; its properties show the file state with **Choose file…**, which stores the chosen file under the name the mesh references.

The files are kept in the browser (`app/src/core/meshfiles.ts`) and written into the working directory of Python in the worker, where `felupe_studio.meshes.load()` reads them with meshio exactly like the generated script (`volume_cells`): a summary for the dialog (`inspect()`, one entry per type of solid cells) and the outer surfaces for the viewport, from one read. meshio is served as a pinned wheel next to FElupe (`config.wheels` in `app/package.json`). The files are not kept across a reload of the page yet (#57).

## Viewport (app)

The viewport draws the imported meshes with the WebGL2 viewer of FElupe ([ADR 0004](adr/0004-viewer.md)), a pinned copy in `app/src/vendor/felupe-viewer/`.

- `felupe_studio.scene.surface()` triangulates the outer surface of the solid cells with FElupe (`triangulate_surface`), like `mesh.plot()`: flat faces for linear cells, subdivided curved faces for quadratic cells, and the edges of the faces. Every region of cells with the same values of all cell tags is triangulated on its own, so its surface is closed also at the interfaces to other regions (cell sets and sections take the cells of a tag value or all cells). The arrays, with the values of the cell tags per cell, go to the main thread as little-endian bytes (`float32` coordinates, `uint32` indices, `int32` tags) and are drawn without copies.
- **Color by** (toolbar) colors the cells by mesh, cell set or section. By default, the viewport takes sections if the model has any, else cell sets, else meshes, until another one is chosen. Colors follow the position of an object in the model, so hiding an object does not repaint the others. The legend names the cell sets or sections with visible cells, and _No cell set_ or _No section_ for the other cells. Later cell sets win for cells in more than one. A ninth and further object is gray instead of a generated color.
- **Visibility:** the eye of a mesh, a cell set or a section in the browser hides its cells (and their edges). The surfaces of the remaining regions stay closed.
- **Point sets** are shown as markers on the nodes of the drawn meshes that they select, with the tolerances of `np.isclose` in the generated script (`atol` and the default `rtol = 1e-5`); the selected point set is highlighted, its eye hides it. Point sets of point ids refer to the merged mesh of the script and are not shown.
- **Picking:** a click (not a drag) on a face highlights all drawn faces in its plane and previews its points. A face normal to x, y or z offers **Create point set**: the coordinate is the exact coordinate of the nodes in the plane (not of the float32 surface), with a larger `atol` only if their spread needs it, and the name is `x_min`, `x_max` or e.g. `y_0_5`. Other faces are explained; point sets select planes normal to an axis. Escape or × clears the pick. A tip in the viewport explains the click until the first pick (or until it is dismissed; remembered in the browser).
- **Updates:** the build writes `version.json` with the build (the commit on GitHub Pages). An open app asks for it every ten minutes and when the page becomes visible again, without the HTTP cache, and offers **Reload** once a newer version is deployed; with a model, it asks to save the project first, because the project and its mesh files are not kept across a reload yet (#57).
- The toolbar fits the model into the view and sets the camera onto the xy-, xz- or yz-plane or isometric. Drag to rotate, shift-drag (or right-drag) to pan, scroll to zoom, double-click to reset. The camera fits the model when it is first shown and keeps its rotation, zoom and pan while the model changes.
- The app talks to the viewer only through the adapter `app/src/viewer/viewer.ts`: meshes with colors of groups of cells and hidden cells, the legend, point markers, arrows and camera presets. The scenes are built by pure functions (`app/src/viewer/scene.ts`), tested without WebGL.

## Running jobs (app)

**Solve** (header) runs the jobs of the model in the Pyodide worker. It is offered for a valid model with a job and loaded mesh files, once Python is loaded; otherwise its tooltip says what is missing.

- `felupe_studio.runner.run()` runs the generated script (`codegen(..., evaluate=False)`) and evaluates every job with a plugin (`fem.Plugin`) that reports the progress: the substeps of every step at the start, then every substep, Newton iteration (norm of the residuals), failed attempt and converged substep. The worker posts these events to the main thread while Python runs. The results are the number of substeps and the time per job and, for a characteristic curve, the displacements and forces of its boundary per substep (three components each). The namespace of the last run is kept in Python (`runner.LAST`) for the results of #28.
- The panel in the viewport shows the job, step, substep and Newton iteration with a progress bar, then the time per job and the force at the last substep of a curve. A failed run shows the exception and the full Python traceback; a failed Newton-Raphson method also suggests more substeps or the cutback.
- **Cutback** is a setting of the job (`cutback`, also in the generated script): `fem.CutbackPlugin` retries a substep that does not converge with smaller increments. The panel counts these attempts.
- **Cancel:** Python runs synchronously in the worker, so a run is cancelled by terminating the worker. A new worker loads Python again (Pyodide and the wheels come from the cache) and gets the mesh files again (`PyodideClient.restart()`).
- **tensortrax** (Mooney-Rivlin) is a pinned wheel that is loaded only before the first run of a model with one of its materials (`lazy` in `config.wheels`), so it does not add to the start-up time. FElupe was imported before, so `load_tensortrax()` reloads `felupe.constitution` to make `fem.Hyperelastic` available.
