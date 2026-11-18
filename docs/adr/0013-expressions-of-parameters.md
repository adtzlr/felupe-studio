# 0013 Expressions of parameters

Status: Accepted

## Context

Parameters (`parameter.add`, #180) are named numbers of a model with a quantity, a range and a step. The generated script defines them as variables at its top, and today only mesh scripts use them (#182, ADR 0009). The other commands hold numbers. A parametric model therefore stops at its mesh: the shear of the sandwich spring cannot follow its height, and a point set cannot be `z == height` (#242).

The numbers of the commands are read in many places: the code generation (Python), the validation (Python and TypeScript, with shared cases), the viewer (planes of point sets, arrows of boundaries, rigid surfaces, control points), the forms, the MCP server (ADR 0012) and the checks. The app must know the values without Python: the viewer and the validation run before the runtime is loaded. The schema describes the file format for the app, the package and AI agents (ADR 0003, 0012). The schema has about 80 number fields, among them integer fields such as the substeps of a ramp, and lists such as coordinates, the components of a boundary or the terms of an Ogden material.

## Decision

- **Form: a string in place of a number.** A number field holds a number, as now, or an expression of the parameters as a JSON string, e.g. `"end": "0.25 * layers * height"` or `"value": "height"`. A number field never held a string, so a string there is an expression. There is no marker such as a leading `=` and no object such as `{"=": "…"}`.
- **Grammar**, the same in Python and TypeScript:
  - **Allowed:**
    - decimal numbers (also `1e-3`);
    - the names of the parameters;
    - `+ - * / **` (power binds right, before unary minus);
    - parentheses;
    - the functions `sqrt`, `exp`, `log`, `sin`, `cos`, `tan`, `abs`, `min` and `max` (angles in radians);
    - the constant `pi`.
  - **Not allowed:** other names, attributes, indexing, comparisons, strings or calls of anything else.
  - **Evaluation:** Python and TypeScript parse an expression with the same small recursive-descent parser (ASCII numbers and names only), without `eval`, and compute with doubles. Shared cases list expressions with their values (to 1e-12 relative) or their error messages, and the fields of the commands that may hold an expression.
- **Fields:** every number of a command may be an expression, also the items of lists. There are three exceptions:
  - the fields of `parameter.add` (a parameter is a number: its value, range and step);
  - numbers that name things (`cellset.from_tag` `value`, the point `ids` of a point set);
  - `mesh.merge` `decimals`.

  An integer field (e.g. `ramp.num`, `maxiter`) needs an integer value.
- **Schema:** a number field that may hold an expression gets the types `["number", "string"]` (`["integer", "string"]`), with its constraints such as `minimum` unchanged; JSON Schema applies them to numbers only. The schema stays the truth of the file format: the generated TypeScript types say `number | string`, and agents see the expressions in the schema.
- **Values:** an expression is evaluated with the values of the parameters, integer parameters as integers, like the script. It takes the unit of its field; the quantities of the parameters are not checked against it. The parameters may stand anywhere in the command list, since the script defines them at its top; a parameter cannot use an expression itself.
- **Validation**, in the shared validation of Python and TypeScript, in this order:
  1. The schema checks the command list as it is.
  2. Then the expressions:
     - errors of syntax;
     - unknown names (*'hieght' is not a parameter*);
     - functions that are not allowed;
     - division by zero and non-finite values;
     - integer fields with a value that is not an integer;
     - values out of the bounds of their fields in the schema, e.g. `minimum`.

     The messages name the field and the expression, e.g. *'ramp.num' of 'loading': '2 * cells - 8' is 0, it must be at least 1.* A command list with such problems is not checked further.
  3. The **resolved** command list (with the values) is checked by the other rules.
- **Script:** the expression as written, in parentheses unless it is one name or number, with `np.` before the functions and `pi` (`np.sqrt`, `np.pi`), e.g. `fem.math.linsteps([0, (0.25 * layers * height)], num=10)`. Where the code generation computes with a value (e.g. `num + 1`), it uses the value.
- **App:**
  - **Two lists:** the store keeps the command list as written (the history, the files, the forms). A resolved list, recomputed when the commands or the values of the parameters change, feeds the viewer, the validation, the checks and the hints. A changed parameter, e.g. in the open dialog of the parameters, moves the point sets, arrows and rigid surfaces that depend on it.
  - **Forms:** a number field takes a number or an expression and shows the value of an expression with its unit.
- **Names:** renaming a parameter renames it in the expressions. Deleting a parameter that an expression uses leaves an issue (an unknown name).
- **Schema version 3, additive:** projects without expressions are unchanged. A project with expressions does not open in v0.5 and earlier.

## Consequences

- **One source of numbers:** a model is parametric beyond its mesh, e.g. a ramp, a material constant or a coordinate follows a parameter. The script stays readable, because it is the expression as written over variables at its top. Agents (ADR 0012) can write expressions too.
- **Two copies in the app:**
  - Every reader of numbers in the app reads the resolved commands: the viewer, the checks and the validation of values. The TypeScript types make this explicit: the commands as written have `number | string`, the resolved ones `number`.
  - The forms need an input that takes text. The code generation needs a value that knows its expression: a float or int whose `repr` is the expression and whose arithmetic gives plain numbers.
- **The implementation comes in two PRs:**
  1. The core: the grammar in Python and TypeScript with the shared cases, the schema, the validation, the resolved commands in the app (its readers of numbers) and in the package (codegen, checks, MCP), renaming and deleting parameters, and a golden case with expressions.
  2. The forms: number fields with expressions and their values; the open dialog of the parameters with live updates; docs.

## Alternatives

- **An object `{"=": "0.25 * layers * height"}`:** unambiguous even beside strings, but verbose to read and to write; a number field never held a string, so a string is unambiguous already.
- **A leading `=` in the file** (like a spreadsheet): extra noise in the file and in the script. The app may still accept a leading `=` in a field and drop it.
- **Only some fields** (ramps, coordinates, material constants): less work, but surprising in a form, and every exception needs a rule. Fields that name things are the only exceptions.
- **Python's `eval` with restricted globals:** unsafe (attributes, dunder names), and the app needs the same evaluation without Python.
- **Evaluation in the worker (Pyodide) only:** the app needs the values before the runtime is loaded and without a round trip, e.g. for the viewer and the validation.
- **Expressions in parameters** (a parameter of other parameters): useful, but it needs an order of evaluation and checks of cycles; later, if asked for.
