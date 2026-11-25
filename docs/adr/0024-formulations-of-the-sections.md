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
  - `x-hint`, when to use it: the hint of *Formulation* in the form (#420);
  - `description`;
  - `x-felupe`: `{body, fields, cells, material}`.
- **`x-felupe` of a formulation:**
  - `body`: the solid body of the script:
    - `fem.SolidBody` of the material;
    - `fem.SolidBodyNearlyIncompressible`, which condenses the pressure and the volume ratio of every cell (`u-p-J-condensed`, #420);
    - `fem.NearlyIncompressible` and `fem.ThreeFieldVariation`: the material of a `fem.SolidBody` on mixed fields, with the bulk modulus of the section or with the volumetric part of the material (`u-p-J-mixed`, `u-p-J-three-field`, #420);
    - `nearly_incompressible`, a helper of the script that chooses by the fields: `fem.SolidBodyNearlyIncompressible` of a field of the displacements only, else `fem.NearlyIncompressible` on the mixed fields (`u-p-J`).
  - `fields`: the region and the field container:
    - `u`: `REGIONS` and a field container of the displacements;
    - `condensed`: `condensed_region()`, the region of hexahedrons and quads, linear or quadratic, and a field container of the displacements (#420);
    - `mixed`: `mixed_region()` and `fem.FieldsMixed`: the displacements, the pressure and the volume ratio of every cell type (#420);
    - `automatic`: `mixed_region()` and `mixed_field()`, which condenses per cell of linear hexahedrons and quads, else mixed fields (`u-p-J`; before #420 its value was `mixed`).
  - `cells`: the cell types that it takes, or `all`: hexahedrons and quads of `u-p-J-condensed`, all cell types of the others.
  - `material`: the material that it takes:
    - `volumetric`: a material with a volumetric part of its own, a bulk modulus or a compressible or strain-based model (`u`, `u-p-J-three-field`);
    - `isochoric`: the isochoric part of a strain energy, without a volumetric part and not strain-based: the section adds the volumetric part (`u-p-J`, `u-p-J-condensed`, `u-p-J-mixed`);
    - `none`: a material without a volumetric part, and the section adds none (`u-isochoric`).
- **Python reads the registry** in `felupe_studio.formulations`: a `Formulation` of every definition (`formulations()`, `formulation_of(section)`), with `fits(material)`, `cells` and `dual` (the fields may have dual fields, which a step that leaves out the section holds, #428). `felupe_studio.sections` looks up a builder of the fields by `fields` (`FIELDS`) and one of the solid body by `body` (`BODIES`); `codegen` embeds the helpers of `u-p-J` for the fields `mixed` and the body `nearly_incompressible`, and `jobs` holds the dual fields of the formulations with `dual`. The helpers keep their names and their behaviour.
- **One rule, the material fits the formulation** (`section_material` and `sectionMaterial`), from `material` of the registry, replaces the four rules of today. It keeps their messages, and the formulations that it names are those of the registry that fit: the first formulation of the kind of material that it needs (`first()`), e.g. `'u'` for a material with a volumetric part, and the first other formulation of the same menu that takes the material (`sibling()`, #420), e.g. `'u-p-J-three-field'` beside `'u'`.
- **The cell types of a formulation** (#420) are checked with the mesh data: the app shows an issue at the section (`formulationNotes()` beside `faceSetNotes()`), which blocks *Solve*, `felupe_studio.checks` reports it (`cell_problem()`), and a helper of the script that takes some cell types only raises for the others (`condensed_region()`). The message names the formulations of the same menu that take the material and the cells (`alternatives()`), e.g. *Condensed per cell (u-p-J-condensed) takes hexahedrons and quads, not the tetra cells of 'rubber'. Use 'u-p-J' or 'u-p-J-mixed'.*
- **The app reads the same definitions** in `app/src/core/formulations.ts` (`FORMULATIONS`, `fits()`, `fitting()`, `first()`), for the rule and for `initialSection()`. The form switches the definition with *Formulation*, like the model of a material, with the formulations in the groups of the ribbon. The ribbon has one button per definition (`ribbonGroups()`); the formulations of a group form a menu once a group has more than one: *Nearly incompressible ▾* with *Automatic*, *Condensed per cell*, *Mixed fields* and *Three-field variation* (#420).
- **A new section of a button** takes the latest material that its formulation takes; a new section without a formulation (the command line) takes the first formulation that takes its material, e.g. `u-p-J` of an incompressible material, as before.
- **The documents of today stay valid:** every section of v0.10 is valid under one definition, so the schema version stays 3. The MCP server and the agent bridge take the schema; the reference of the commands is made from it.

## Consequences

- **A new formulation is a definition,** with a builder of its fields or its solid body in `felupe_studio.sections` if it needs one of its own, and the value of `material` that it takes. The form, the ribbon, the rule, the reference, the MCP server and the agent bridge follow. A test checks that every definition has the keys of the registry and a builder of its fields and of its body, and that no code compares the value of a formulation.
- **The generated scripts are unchanged,** byte for byte, for all golden cases, and so are their results.
- **The rule is checked for every pair** of a formulation and a kind of material (incompressible, with a bulk modulus, compressible, strain-based) in the shared validation cases, so both languages give the same messages.
- **The labels are in the schema:** *Displacement (u)*, *Nearly incompressible (u, p, J)* and *Isochoric part only (third medium)*. The ribbon of the Sections tab has three buttons instead of one *Section*; since #420, the menu *Nearly incompressible ▾* has the four ways of `u-p-J`, and the label of `u-p-J` is *Automatic*.
- **The ways of `u-p-J` (#420)** are three definitions, `u-p-J-condensed`, `u-p-J-mixed` and `u-p-J-three-field`, with a builder of their fields or of their solid body each, and `u-p-J` keeps its meaning (*Automatic*): the scripts of its golden cases are unchanged. The material `any` of the registry is gone: the three-field variation takes a material with a volumetric part of its own (`volumetric`), since without one the volume changes freely, as of a third medium.
- **The errors of the schema of a section are those of a `oneOf`,** e.g. a bulk modulus of `u` is not valid under any of its definitions, as for a material; the rules give the readable messages.
- **The messages keep their words:** the formulations they name come from the registry, but their sentences are per value of `material`, so a new value of `material` needs its message in both languages.

## Alternatives

- **An enum with a table in the code:** the values stay in the schema and their meaning in a table of each language. Two tables to keep in step, and the properties of a formulation (`bulk`, `volumetric`) still need conditions in the schema.
- **A second property for the method of `u-p-J`** (e.g. `method: condensed`): the formulation stays three values, and #420 adds a property. The form needs a condition for it, the ribbon has no button per way, and a property that means something only for one value is the `if`/`then`/`else` of today again.
- **The meaning in the helpers of the script only** (e.g. `mixed_field()` decides everything when the script runs): the app and the rules would not know which materials a formulation takes, and the script would carry every formulation.
- **One rule per formulation:** the rules of today, one more per formulation of #420.
