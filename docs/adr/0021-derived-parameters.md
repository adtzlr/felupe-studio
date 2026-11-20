# 0021 Derived parameters

Status: Accepted. Amends [ADR 0013](0013-expressions-of-parameters.md): a parameter may be an expression of other parameters.

## Context

Every number of a command may be an expression of the parameters (ADR 0013), but a parameter itself is a number: ADR 0013 left *a parameter of other parameters* for later, since it needs an order of evaluation and checks of cycles. So a value that several fields use is written as a formula in each of them, e.g. the total height of a sandwich spring, `layers * height + (layers - 1) * sheet`, for the z of a control point at its top, a point set at the top and the end of a ramp. A change of the formula is a change of all of them (#333).

What exists:

- **Parameters** (`parameter.add`, #180): a number with a quantity, a range and a step, and a flag for an integer. The script defines them at its top, so they may stand anywhere in the command list. The dialog of the parameters has a slider per parameter; mesh scripts get them as variables (ADR 0009); agents set them with `set_parameters` (ADR 0012, 0015).
- **Expressions** (ADR 0013): a JSON string where the schema takes a number (`["number", "string"]`), the same small parser in Python and TypeScript, shared cases of values and messages, a resolved command list in the app and in the package, the expression as written in the script.

## Decision

- **A derived parameter is a `parameter.add` whose `value` is an expression**, e.g. `{"command": "parameter.add", "name": "total_height", "value": "layers * height + (layers - 1) * sheet", "quantity": "length"}`. `value` takes `["number", "string"]` like every number field of ADR 0013; there is no second field. A derived parameter is computed, not set: the schema allows no `min`, `max` and `step` beside an expression, and keeps `quantity`, `integer` and `description`. The range and the step of a parameter stay numbers.
- **Order of evaluation:** the free parameters are their numbers. The derived parameters are evaluated in the order of their dependencies, the names that their expressions use, wherever they stand in the command list, like the script defines all parameters at its top. Parameters without a dependency between them keep the order of the command list. The other fields are evaluated with the values of all parameters, as before.
- **Problems**, with the messages of ADR 0013 at the field `value` of the parameter, e.g. *commands/4: 'value' of 'total_height': 'hieght' is not a parameter in 'layers * hieght'.*, in Python and TypeScript with shared cases:
  - a cycle: *'a' depends on itself.* or *'a' depends on itself through 'b'.* (*through 'b' and 'c'* for a longer cycle), at every parameter of the cycle;
  - unknown names, errors of syntax, functions that are not allowed and values that are not finite, as in other fields;
  - an integer derived parameter whose value is not an integer: *'layers / 2' is 1.5, not an integer.*

  A parameter or a field that uses a parameter with a problem gets no value and no message of its own: only the cause is reported. As in ADR 0013, a command list with problems of its expressions is not checked further.
- **Values:** an integer derived parameter is an int, like a free one; the others are floats. Its value is the value of its expression, so other expressions and mesh scripts compute with the same number as the script.
- **Script:** in the part of the parameters (ADR 0018), the derived parameters follow the free ones in their order of evaluation, as their expression as written, with `np.` before the functions like in other fields and with the unit as a comment; an integer one in `int(...)`, so the script computes with an int like the app:

  ```python
  layers = 3
  height = 8.0  # mm
  sheet = 2.0  # mm
  total_height = layers * height + (layers - 1) * sheet  # mm
  ```

- **Mesh scripts** (ADR 0009) get the derived parameters as variables like the free ones, all of them or those listed in `parameters` of `mesh.script`.
- **Names:** renaming a parameter renames it in the expressions of the derived parameters, as in all expressions. Deleting a parameter that a derived parameter uses leaves a problem at the derived parameter (*'height' is not a parameter*), like deleting one that any other expression uses (ADR 0013), instead of blocking the delete as #333 proposed: one rule for all expressions, and the problem names the parameter to fix or the step to undo.
- **App:**
  - The resolved command list has the values of the derived parameters, so the viewer, the checks and the hints read numbers, as before.
  - The dialog of the parameters lists the derived parameters below the free ones, with their expression and their value and without a slider; their values follow the sliders of the free ones.
  - The properties of a parameter take a number or an expression in *Value*; with an expression, *Minimum*, *Maximum* and *Step* are not offered, and the field shows the value with its unit.
- **Agents:** the MCP server and the agent bridge take the schema as it is, so an agent writes a derived parameter like any command. `set_parameters` of the agent bridge (ADR 0015) refuses a derived parameter (*'total_height' is derived from other parameters: change them, or its expression*), and its `parameters` give the expression and the value.
- **Schema version 3, additive:** projects without derived parameters are unchanged. A project with one does not open in v0.7 and earlier, and these say that it may be of a newer version (#344).

## Consequences

- **One formula, one place:** a value that several fields use is a parameter, e.g. the total height of the sandwich spring for its control point, its point set at the top and the end of its ramp.
- **The values of the parameters are a small evaluation of their own,** before the fields: a topological order of the derived parameters and their cycles, in Python (`felupe_studio.expressions`) and in TypeScript (`app/src/core/resolve.ts`). The two copies of `parameterValues` in the app become one.
- **Readers of a parameter's `value`** (the checks, the MCP server, the mesh scripts, the dialog, the tree) take the resolved value, not the number of the command.
- **The implementation comes in three PRs:**
  1. this record;
  2. the core: the schema, the evaluation in Python and TypeScript with the shared expression and validation cases, the script, the mesh scripts, the MCP server and `set_parameters`, and a golden case with a derived parameter;
  3. the app: the dialog of the parameters and the properties, the docs (guide, commands, reference) and the CHANGELOG.

## Alternatives

- **A field `expression` beside `value`:** two fields for one number, and a stale `value` beside the expression; a string in a number field is already the form of an expression (ADR 0013).
- **A command of its own, e.g. `parameter.derive`:** another kind in the browser, the references and the tools of agents, for the same name space and the same use.
- **The order of the command list** (a derived parameter only uses parameters before it): simpler, without cycles, but the parameters stand anywhere today (ADR 0013), and a new free parameter added later could not be used by an older derived one without moving it.
- **Blocking the delete of a used parameter** (#333): stricter, but a second rule beside ADR 0013, where a deleted parameter leaves a problem at the expressions that use it.
