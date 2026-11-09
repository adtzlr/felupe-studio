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

| Command             | Creates   | References                               | FElupe                                                                                     |
| ------------------- | --------- | ---------------------------------------- | ------------------------------------------------------------------------------------------ |
| `mesh.import`       | mesh      |                                          | meshio, optional integer cell data `tag`                                                   |
| `cellset.from_tag`  | cell set  | mesh (imported with a tag)               | `fem.Mesh(points, cells[tag == value], cell_type)`                                         |
| `cellset.from_file` | cell set  | mesh                                     | all cells of the mesh                                                                      |
| `material.add`      | material  |                                          | `NeoHooke`, `NeoHookeCompressible`, `LinearElasticLargeStrain`                             |
| `section.add`       | section   | cell set, material                       | `u`: `FieldContainer` + `SolidBody`; `u-p-J`: `FieldsMixed` + `NearlyIncompressible(bulk)` |
| `pointset.add`      | point set |                                          | coordinate (`x == 0`, with `atol`) or point ids                                            |
| `boundary.add`      | boundary  | point set                                | `fem.Boundary` on the merged field, `constrained` components                               |
| `step.add`          | step      | sections (default: all), ramped boundary | `fem.Step`, `fem.math.linsteps([start, end], num)`                                         |
| `job.add`           | job       | steps, curve boundary                    | `fem.Job` or `fem.CharacteristicCurve`                                                     |

## Validation

`felupe_studio.commands.validate(document)` raises a `ValidationError` with all messages, `errors(document)` returns them as a list. Besides the schema, it checks:

- names are unique within the command list, at most 24 characters, no Python keywords and not reserved for the generated script (`field`, `points`, `boundaries`, … and the prefixes `field_`, `solid_`, `region_`, `ramp_`),
- references point to an object of the right kind that was created before,
- `cellset.from_tag` refers to a mesh imported with a `tag`,
- a `NeoHooke` material without `bulk` is only used in a `u-p-J` section.

Checks that need the mesh data (unassigned cells, hanging interface points) follow in #14.

## Generated script

`felupe_studio.codegen(document)` validates the command list and returns a FElupe script that only needs FElupe, NumPy and meshio. Its structure does not depend on the order of the commands:

1. meshes (`volume_cells()` keeps the solid cells of a meshio file and ignores lower-dimensional blocks) and cell sets
2. materials
3. a region and a field container per section, merged with `fem.field.merge([...])` into the top-level `field`
4. solid bodies, created after the merge (required for items with an internal state)
5. point sets on `field.mesh_container.points` and `boundaries` on `field[0]`
6. steps and jobs, evaluated with `job.evaluate(x0=field)` (skip with `evaluate=False`)

Generated scripts pass `ruff check` and `ruff format --check`. The tests run them with FElupe and compare with hand-written FElupe models.
