# 0018 The script in parts, an emitter per command type

Status: Accepted

## Context

`codegen()` turns the command list into the FElupe script (ADR 0004). It has grown with every version, and it is now one function of 559 lines with a cyclomatic complexity of 105 (ruff C901). Every section of the script is in it: the meshes, the regions and fields of the sections, the point sets, the boundaries, the constraints, the contacts, the steps and the jobs. So are the values that several sections share, e.g. the dimension of a 2D model, the precision, the load cases, the rotation points.

Version 0.7 adds to the script in two places. The mesh tools (#193) add a `mesh.generate` per step of a mesh, with a registry of tools. PyPardiso (#308) adds a solver. A change of one section today means reading all of `codegen()`.

The script itself is fine. It is what users read and export, and the golden tests compare it byte for byte (`tests/golden/*/script.py`).

## Decision

- **The script is a fixed sequence of parts:**
  1. the header and the comments of the settings, with `DTYPE`
  2. the parameters
  3. the helpers
  4. the meshes and the cell sets
  5. the materials
  6. the sections: their regions and fields, the control points, the merge, the solid bodies
  7. the point sets
  8. the face sets
  9. the load cases and the symmetry planes
  10. the boundaries
  11. the constraints, the contacts, the point loads and the pressures
  12. the steps
  13. the jobs and their evaluation

  Each part is a function of the context that returns its lines, none if the model has nothing of it. `codegen()` validates and resolves the command list, builds the context and joins the parts. The order of the parts is the order in which FElupe needs its objects; it is not the order of the commands.
- **An emitter per command type within a part:** a function `(context, command) -> lines` for the lines of one object, in a registry by command type, e.g. `mesh.import`, `mesh.script`, `cellset.from_tag`, `pointset.add`, `mpc.add`, `contact.add`. A part calls the emitters of its commands in their order, adding the comment of the part. A new command type is a new emitter, registered with its part. `mesh.generate` of the mesh tools dispatches one level deeper, into a registry of the tools.
- **The context is computed once:**
  - the resolved commands by type (ADR 0013);
  - the analysis (the dimension, the axes, the class of the fields, the flag of the mixed fields);
  - the precision (`astype`, `dtype` of ADR 0016) and the units;
  - the derived sets that several parts use: the load cases, the point loads and the pressures, the rotation points of the constraints, the control points, the names of the face sets, and whether point sets need the points of the solid cells.

  Emitters read it and do not compute it again.
- **The helpers that a script embeds** are a table of blocks, each with its condition on the context, e.g. the helpers of the mixed fields if a section is `u-p-J`. Their text stays in `_helpers.py`.
- **Flat modules:** the Pyodide worker copies `python/felupe_studio/*.py` flat into the browser, and the wheel lists them, so there are no subpackages.
  - `codegen.py` keeps the public API: `codegen`, `object_lines`, `solver_source`, `solver_rtol`, `evaluate_options`, `TOL`, `parameter_value`, `parameter_line`, `analysis_of`, `MARKER`. It also holds the context and the sequence of the parts.
  - `formatting.py` has the Python source formatted like ruff would (`_str`, `_wrap`, `_call`, `_List`, `_Dict`, the line length of 88).
  - Modules by topic have the parts and their emitters, e.g. meshes and sections, sets and boundaries, items, steps and jobs. `materials.py` and `loadcases.py` stay as they are.
  - No module above about 400 lines.
- **Limits:** no function of the code generation above a complexity of 15 (#313).
- **The script does not change:** the golden scripts stay byte-identical, and the refactoring is done in steps that each keep them so. `object_lines()` (the lines of an object in the script view) keeps working on the syntax tree of the script, independent of the parts.

## Consequences

- A change of one section of the script is a change of one part or one emitter. A new command type, e.g. `mesh.generate`, is a new emitter in its part. The mesh tools of #193 and the solver of #308 build on this.
- The code generation has more functions, but each is short. The context documents the values that several parts share, instead of local variables of one function.
- Imports from `felupe_studio.codegen` stay valid: the tests, the runner, the MCP server and the checks.
- `object_lines()` could later use the parts to know the lines of an object without parsing the script. That is not needed now.

## Alternatives

- **An AST builder** (`ast` and `ast.unparse`, or a formatter afterwards): `ast.unparse` loses the comments and the formatting of the script, so the golden scripts and the script that users read would change. ruff is not available in Pyodide.
- **Templates of the parts** (e.g. Jinja): the wrapping of long calls like ruff, the lists and the dicts are logic, not text. Templates would move the logic into a template language without tests.
- **Emitting in the order of the commands:** FElupe needs its objects in an order, e.g. the merge of the fields before the boundaries. The order of the commands is the order of the user.
- **A subpackage `codegen/`:** the Pyodide worker copies the package flat.
