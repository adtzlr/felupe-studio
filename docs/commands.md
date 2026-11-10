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
| `mesh.import`       | mesh                        |                                          | meshio, optional integer cell data `tag`                                                                                                                             |
| `mesh.merge`        | merge setting (at most one) |                                          | `fem.field.merge([...], decimals=...)`: merges points that agree to `decimals`, e.g. files of different mesh generators; without it only identical points are merged |
| `cellset.from_tag`  | cell set                    | mesh (imported with a tag)               | `fem.Mesh(points, cells[tag == value], cell_type)`                                                                                                                   |
| `cellset.from_file` | cell set                    | mesh                                     | all cells of the mesh                                                                                                                                                |
| `material.add`      | material                    |                                          | `NeoHooke`, `NeoHookeCompressible`, `LinearElasticLargeStrain`                                                                                                       |
| `section.add`       | section                     | cell set, material                       | `u`: `FieldContainer` + `SolidBody`; `u-p-J`: `FieldsMixed` + `NearlyIncompressible(bulk)`                                                                           |
| `pointset.add`      | point set                   |                                          | coordinate (`x == 0`, with `atol`) or point ids                                                                                                                      |
| `boundary.add`      | boundary                    | point set                                | `fem.Boundary` on the merged field, `constrained` components                                                                                                         |
| `step.add`          | step                        | sections (default: all), ramped boundary | `fem.Step`, `fem.math.linsteps([start, end], num)`                                                                                                                   |
| `job.add`           | job                         | steps, curve boundary                    | `fem.Job` or `fem.CharacteristicCurve`                                                                                                                               |

## Validation

`felupe_studio.commands.validate(document)` raises a `ValidationError` with all messages, `errors(document)` returns them as a list. Besides the schema, it checks:

- names are unique within the command list, at most 24 characters, no Python keywords and not reserved for the generated script (`field`, `points`, `boundaries`, … and the prefixes `field_`, `solid_`, `region_`, `ramp_`),
- references point to an object of the right kind that was created before,
- `cellset.from_tag` refers to a mesh imported with a `tag`,
- a `NeoHooke` material without `bulk` is only used in a `u-p-J` section.

## Checks with the mesh data

`felupe_studio.checks.check(document, directory)` reads the mesh files and returns a JSON report (`ok`, `messages`, `cells`, `interfaces`):

- **Cell assignment:** every solid cell of an imported mesh belongs to exactly one section; unassigned cells and cells in more than one section are reported per mesh.
- **Interfaces:** the section meshes are merged on identical points (or with the `decimals` of `mesh.merge`), like `fem.field.merge` in the generated script. For every pair of sections that touch, the report counts the shared points and the _hanging_ points: points on the surface of one section that lie on a face of the other one without being one of its points (tolerance 1e-6 of the model diagonal). Hanging points are not connected, e.g. at a non-conforming interface or if the coordinates of two files differ slightly.

Example messages: `192 / 192 cells assigned once.` and `Interface left_body / right_body: 25 shared points, 0 hanging.`

## Generated script

`felupe_studio.codegen(document)` validates the command list and returns a FElupe script that only needs FElupe, NumPy and meshio. Its structure does not depend on the order of the commands:

1. meshes (`volume_cells()` keeps the solid cells of a meshio file and ignores lower-dimensional blocks) and cell sets
2. materials
3. a region and a field container per section, merged with `fem.field.merge([...])` into the top-level `field`
4. solid bodies, created after the merge (required for items with an internal state)
5. point sets on `field.mesh_container.points` and `boundaries` on `field[0]`
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

`app/src/core/registry.ts` adds what the schema does not know: labels, hints, placeholders, defaults of new objects, the ribbon tab of a command and the prefix of suggested names (`material_1`). A test checks that every field of every variant has a registry entry, and that the form validation rejects what the schema rejects.

The ribbon (`app/src/core/ribbon.ts`) shows one button per command of a tab (the `tab` of the registry), or one button per variant if the variant selects a schema definition, e.g. one button per material model. A button opens a dialog with the form of a new object: a suggested name, the defaults of the registry and the latest object of the right kind for references. A command whose required references do not exist yet is disabled with the reason ("Create a cell set and a material first."); commands marked `single` (the merge setting) are disabled once the model has one.

Changes are applied with the model store: `store.update(name, command)` is one undo step, and if an object is renamed, the references of the other commands follow.

### Adding a material model

1. Schema: a definition `Material<Model>` with `model` as a constant and its `parameters`, added to `MaterialAdd.oneOf` (`python/felupe_studio/commands.schema.json`); run `npm run schema:types`.
2. Code generation: an entry in `MATERIALS` (`python/felupe_studio/codegen.py`) with the FElupe class and the order of its arguments.
3. Registry: the label of the model and labels, hints and defaults of new parameters (`app/src/core/registry.ts`).
4. Tests: a golden case or a code generation test that runs the model with FElupe.

The form appears without further code.

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
- **Open** accepts a project file together with its mesh files (select several files, or drop them on the window). Several mesh files without a project are offered in the import dialog.
- A mesh whose file is not loaded, cannot be read or lacks its cell tag is marked in the browser; its properties show the file state with **Choose file…**, which stores the chosen file under the name the mesh references.

The files are kept in the browser (`app/src/core/meshfiles.ts`) and written into the working directory of Python in the worker, where `felupe_studio.meshes.load()` reads them with meshio exactly like the generated script (`volume_cells`): a summary for the dialog (`inspect()`) and the outer surface for the viewport, from one read. meshio is served as a pinned wheel next to FElupe (`config.wheels` in `app/package.json`). The files are not kept across a reload of the page yet (#57).

## Viewport (app)

The viewport draws the imported meshes with the WebGL2 viewer of FElupe ([ADR 0004](adr/0004-viewer.md)), a pinned copy in `app/src/vendor/felupe-viewer/`.

- `felupe_studio.scene.surface()` triangulates the outer surface of the solid cells with FElupe (`triangulate_surface`), like `mesh.plot()`: flat faces for linear cells, subdivided curved faces for quadratic cells, and the edges of the faces. The arrays go to the main thread as little-endian bytes (`float32` coordinates, `uint32` indices) and are drawn without copies.
- Every mesh has a categorical color by its position in the model, so hiding a mesh (eye in the browser) does not repaint the others. With more than one mesh, a legend names them. A ninth and further mesh is gray instead of a generated color.
- The toolbar fits the model into the view and sets the camera onto the xy-, xz- or yz-plane or isometric. Drag to rotate, shift-drag (or right-drag) to pan, scroll to zoom, double-click to reset. The camera fits the model when it is first shown and keeps its rotation, zoom and pan while the model changes.
- The app talks to the viewer only through the adapter `app/src/viewer/viewer.ts`: meshes with colors of groups of cells, point markers, arrows and camera presets. The scenes are built by pure functions (`app/src/viewer/scene.ts`), tested without WebGL.
