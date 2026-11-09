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
