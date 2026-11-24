# 0024 The formulations of the sections

Status: Accepted

## Context

A section assigns a material and a formulation to a cell set (`section.add`), and the formulation says how FElupe solves it. Up to v0.10 it was an enum of `section.add` with three values: `u` (the displacements only), `u-p-J` (nearly incompressible, with the bulk modulus of the section) and `u-isochoric` (the displacements of a material without a volumetric part, e.g. air as a third medium, #241). What a value means was spread over the code:

- **The script:** `section_fields()` and `solid_body()` of `felupe_studio.sections` branched on `formulation != "u-p-J"`; `codegen` embedded the helpers of `u-p-J`, and `jobs` held the dual fields of the sections `u-p-J` that a step leaves out (#428, #429).
- **The helpers:** `mixed_field()` and `nearly_incompressible()` branch on the cell type when the script runs (#226).
- **The rules:** four of them in Python and in TypeScript, `section_bulk`, `section_isochoric`, `section_strain_based` and `section_volumetric` (#417), each for one formulation.
- **The schema:** an `if`/`then`/`else` for `bulk` and `volumetric`.
- **The app:** `initialSection()`, the labels of the registry, and one button *Section* in the ribbon.

v0.11 adds the explicit ways of `u-p-J` (#420): condensed per cell, mixed fields and the three-field variation. Each would add a branch to all of these places. The material models had the same problem and became a registry in the schema (#24, #136): one definition per model, which Python, the app, the forms, the ribbon and the reference read.

## Decision

- **The formulations are a registry in the command schema,** like the material models: `SectionAdd` is a `oneOf` of one definition per formulation, `SectionDisplacement` (`u`), `SectionNearlyIncompressible` (`u-p-J`) and `SectionIsochoric` (`u-isochoric`), each with `formulation` as a constant. A definition has the properties that its formulation takes: `bulk` (required) and `volumetric` belong to `u-p-J`, and the `if`/`then`/`else` is gone.
- **What a formulation says is its definition:**
  - `x-label`, the label of the form and of the button of the ribbon;
  - `x-group`, the menu of the ribbon, e.g. *Nearly incompressible*;
  - `description`;
  - `x-felupe`: `{body, fields, cells, material}`.
- **`x-felupe` of a formulation:**
  - `body`: the solid body of the script, `fem.SolidBody` or `nearly_incompressible` (the helper: `fem.SolidBodyNearlyIncompressible` of a field of the displacements only, else `fem.NearlyIncompressible` on the mixed fields).
  - `fields`: the region and the field container, `u` (`REGIONS` and a field container of the displacements) or `mixed` (`mixed_region()` and `mixed_field()`: the displacements, the pressure and the volume ratio, condensed per cell of linear hexahedrons and quads). #420 adds `condensed`.
  - `cells`: the cell types that it takes, or `all`. All three take all cell types; the cell types of a formulation as issues are #420.
  - `material`: the material that it takes:
    - `volumetric`: a material with a volumetric part of its own, a bulk modulus or a compressible or strain-based model (`u`);
    - `isochoric`: the isochoric part of a strain energy, without a volumetric part and not strain-based: the section adds the volumetric part (`u-p-J`);
    - `none`: a material without a volumetric part, and the section adds none (`u-isochoric`);
    - `any`: every material, e.g. the three-field variation of #420.
- **Python reads the registry** in `felupe_studio.formulations`: a `Formulation` of every definition (`formulations()`, `formulation_of(section)`), with `fits(material)`, `cells` and `dual` (the fields may have dual fields, which a step that leaves out the section holds, #428). `felupe_studio.sections` looks up a builder of the fields by `fields` (`FIELDS`) and one of the solid body by `body` (`BODIES`); `codegen` embeds the helpers of `u-p-J` for the fields `mixed` and the body `nearly_incompressible`, and `jobs` holds the dual fields of the formulations with `dual`. The helpers keep their names and their behaviour.
- **One rule, the material fits the formulation** (`section_material` and `sectionMaterial`), from `material` of the registry, replaces the four rules of today. It keeps their messages, and the formulations that it names are those of the registry that fit: the first formulation of the kind of material that it needs (`first()`), e.g. `'u'` for a material with a volumetric part.
- **The app reads the same definitions** in `app/src/core/formulations.ts` (`FORMULATIONS`, `fits()`, `fitting()`, `first()`), for the rule and for `initialSection()`. The form switches the definition with *Formulation*, like the model of a material, with the formulations in the groups of the ribbon. The ribbon has one button per definition (`ribbonGroups()`); the formulations of a group form a menu once a group has more than one (#420: *Nearly incompressible*).
- **A new section of a button** takes the latest material that its formulation takes; a new section without a formulation (the command line) takes the first formulation that takes its material, e.g. `u-p-J` of an incompressible material, as before.
- **The documents of today stay valid:** every section of v0.10 is valid under one definition, so the schema version stays 3. The MCP server and the agent bridge take the schema; the reference of the commands is made from it.

## Consequences

- **A new formulation is a definition,** with a builder of its fields or its solid body in `felupe_studio.sections` if it needs one of its own, and the value of `material` that it takes. The form, the ribbon, the rule, the reference, the MCP server and the agent bridge follow. A test checks that every definition has the keys of the registry and a builder of its fields and of its body, and that no code compares the value of a formulation.
- **The generated scripts are unchanged,** byte for byte, for all golden cases, and so are their results.
- **The rule is checked for every pair** of a formulation and a kind of material (incompressible, with a bulk modulus, compressible, strain-based) in the shared validation cases, so both languages give the same messages.
- **The labels are in the schema:** *Displacement (u)*, *Nearly incompressible (u, p, J)* and *Isochoric part only (third medium)*. The ribbon of the Sections tab has three buttons instead of one *Section*.
- **The errors of the schema of a section are those of a `oneOf`,** e.g. a bulk modulus of `u` is not valid under any of its definitions, as for a material; the rules give the readable messages.
- **The messages keep their words:** the formulations they name come from the registry, but their sentences are per value of `material`, so a new value of `material` needs its message in both languages.

## Alternatives

- **An enum with a table in the code:** the values stay in the schema and their meaning in a table of each language. Two tables to keep in step, and the properties of a formulation (`bulk`, `volumetric`) still need conditions in the schema.
- **A second property for the method of `u-p-J`** (e.g. `method: condensed`): the formulation stays three values, and #420 adds a property. The form needs a condition for it, the ribbon has no button per way, and a property that means something only for one value is the `if`/`then`/`else` of today again.
- **The meaning in the helpers of the script only** (e.g. `mixed_field()` decides everything when the script runs): the app and the rules would not know which materials a formulation takes, and the script would carry every formulation.
- **One rule per formulation:** the rules of today, one more per formulation of #420.
