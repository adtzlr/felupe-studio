# 0019 Mesh tools

Status: Accepted

## Context

The meshes of a model come from mesh files and from Python scripts (ADR 0009). FElupe makes structured meshes in a few lines with its mesh tools: the primitives `Point`, `Line`, `Rectangle` and `Cube`, and the operations `expand`, `revolve`, `fill_between`, `translate`, `rotate`, `mirror` and `add_runouts`. The bushing of FElupe's ex05 and the metacone of ex15 are made like this. Version 0.7 makes such meshes in the app (#193 for the primitives, #314 for the operations), as objects of the model with expressions of parameters (ADR 0013).

The tools change the dimensions of a mesh (FElupe 12.1.1):

| FElupe                                              | Cells                                          | Points                               |
| --------------------------------------------------- | ---------------------------------------------- | ------------------------------------ |
| `fem.mesh.Point(a)`                                 | vertex (0D)                                    | 1D                                   |
| `fem.mesh.Line(a, b, n)`                            | line (1D)                                      | 1D                                   |
| `fem.Rectangle(a, b, n)`                            | quad (2D)                                      | 2D                                   |
| `fem.Cube(a, b, n)`                                 | hexahedron (3D)                                | 3D                                   |
| `mesh.expand(n, z)`, `mesh.revolve(n, phi)`         | one dimension more: vertex → line → quad → hexahedron | at least the dimension of the cells |
| `fem.mesh.fill_between(a, b, n)`                    | one dimension more than the two inputs          | those of the inputs                  |
| `translate`, `rotate`, `mirror`, `add_runouts`      | as the input                                   | as the input                         |
| `fem.MeshContainer(meshes, merge=True).stack()`     | as the inputs, of one cell type                | as the inputs                        |

So a mesh has two dimensions: of its **points** and of its **cells**. They differ e.g. for the two lines of `fill_between`, which ex05 puts into the plane with `np.pad`. The app is 3D, or 2D by the analysis of the model (ADR 0010).

## Decision

- **One command per step of a mesh:** `mesh.generate {name, tool, inputs, parameters}`, next to `mesh.import` and `mesh.script`.
  - Every step is a named mesh object (ADR 0003). A mesh made in several steps is a chain of objects, e.g. two lines, the face between them and the revolved body.
  - `inputs` are the names of earlier meshes made by tools. Imported meshes and meshes of scripts are no inputs for now: their dimensions are known only after reading them.
- **A registry of tools in the schema, like the materials (#136):** a definition per tool (`MeshLine`, `MeshRectangle`, …) with `tool` as its constant, its label and group, its FElupe call (`x-felupe`), the number of its inputs and its parameters with labels, descriptions, defaults, bounds and quantities. The forms, the validation and the script are made from it. A new tool is a new definition and an emitter of its line, not a new command type.
  - M35 (#193): `Point`, `Line`, `Rectangle`, `Cube`.
  - M36 (#314): `expand`, `revolve`, `fill_between`, `embed`, `translate`, `rotate`, `mirror`, `add_runouts`.
  - M48 (#394): `Circle`, `Triangle`, `stack` (a list of two or more inputs, `"inputs": "list"` in its `x-dimension`; the line of the script is `fem.MeshContainer([a, b, c], merge=True, decimals=10).stack()`).
  - Later: `triangulate`, `convert`, a cell tag per input of a stack.
- **The dimensions are known before Python runs.** Each definition has `x-dimension`:
  - for a primitive, the dimensions of its points and cells and its cell type, e.g. `{"points": 2, "cells": 2, "cell_type": "quad"}`;
  - for an operation, its output as a rule of its inputs (the same dimensions, one more dimension of the cells and the next cell type, one more dimension of the points), and what the inputs need, e.g. *cells of the dimension of the points* for `revolve`, or *two meshes of the same cell type* for `fill_between`.

  `dimensions(commands)` in Python and in the app (the same name) gives every made mesh the dimension of its points and of its cells and its cell type. The validation (shared cases) reports a tool that does not fit, e.g. *revolve needs a mesh whose cells have the dimension of its points*. Forms and rules that depend on the cell type, e.g. of a section, do not wait for the worker.
- **Model meshes and construction meshes.**
  - A mesh whose points and cells have the dimension of the model, with solid cells of its analysis, is a model mesh: hexahedrons or tetrahedrons of a 3D model, quads or triangles of a 2D model. Only a model mesh has cell sets (`cellset.from_file`; made meshes have no cell tags), and so sections, point sets and face sets.
  - Every other mesh is a construction mesh: an input of tools, drawn in the viewport, not part of the model. A cell set of a construction mesh is an issue, e.g. *'bottom' is a line mesh (1D); a cell set needs a 3D mesh*.
- **Axes and units follow FElupe and ADR 0010:**
  - A line lies along x, a rectangle in the xy-plane; `expand` adds the next axis, `revolve` turns about x (the axis of an axisymmetric model).
  - Vectors of the parameters have the length of the dimension of the points of the output: `a`, `b` and `n` of a rectangle have two components, of a cube three. The forms show as many fields.
  - The numbers of cells are integers of at least 2 points per edge. Lengths have the unit of the model, angles are in degrees like FElupe (`phi`, `angle_deg`).
  - The values may be expressions of the parameters (ADR 0013).
- **The script has one line per step, with the name of every step** (ADR 0018: the emitter of `mesh.generate` dispatches into the registry of the tools). Every mesh stays a variable, so the line of each object is found (`object_lines()`) and a later step may take any earlier mesh:

  ```python
  # meshes made with FElupe
  bottom = fem.mesh.Line(a=-50.0, b=50.0, n=6)
  bottom_plane = embed(bottom, value=30.0)
  top = fem.mesh.Line(a=-30.0, b=30.0, n=6)
  top_plane = embed(top, value=60.0)
  face = fem.mesh.fill_between(bottom_plane, top_plane, n=8)
  runouts = face.add_runouts(axis=1, centerpoint=[0, 45], values=[0.2], normalize=True)
  rubber = runouts.revolve(n=19, phi=360)
  ```

  The meshes are `fem.Mesh` objects, which the cell sets and the regions take like the meshes of files. Helpers of operations that FElupe does not have, e.g. `embed`, are embedded only in scripts that use them.
- **The worker makes the meshes with the lines of the script.**
  - A request with the resolved commands of the chain of a mesh (the mesh and its inputs, recursively) runs the lines of their emitters in Python (`felupe_studio.meshes.generate`), so the app and the script make the same mesh. It summarizes the result like the mesh of a script: the cells, the bounds and the surfaces.
  - The made meshes are kept by their chain, like the meshes of scripts by file, item and parameter values: a change of a value makes only the meshes again that depend on it.
  - An error of FElupe, e.g. a mesh with too few points, is the state of the mesh object with its message, like the error of a script.
- **The viewport and the browser:**
  - The viewport draws a construction mesh with three coordinates, the missing ones zero (a line on the x-axis, a rectangle in the xy-plane): its lines as segments, its 2D cells as light faces with their edges, its vertices as points. It cannot be picked for point sets. A mesh that another tool uses is hidden by default, like the history of a CAD model (#314).
  - The browser shows a made mesh below the mesh that uses it, like the cell sets below their mesh, e.g. the face below the revolved body. A mesh that several tools use stays at the top of the group; the details of the others name it.

## Consequences

- Meshes of the FElupe examples are made in the app, with parameters and expressions, and the script reads like FElupe written by hand. A sample can make its mesh with the tools instead of a script (#314).
- The dimensions and cell types of made meshes are known from the commands alone: the validation of the app, of the MCP server and of the command line needs no Python run for them.
- The schema gets one command type and a registry; adding it is additive, so projects without made meshes open unchanged and the schema version stays 3.
- The viewer draws lines and points of lower meshes, which it did not before; the summary of a made mesh describes cells of every dimension, not only solid cells.
- Imported meshes and meshes of scripts cannot be transformed by the tools yet. A later extension would read their dimensions in the worker.

## Alternatives

- **A command type per tool** (`mesh.line`, `mesh.expand`, …): many command types, each with its own validation and form. A registry is data, like the materials, and the forms come from the schema.
- **One command with a list of operations** (a recipe): fewer objects, but the meshes between the steps would not be objects: they could not be selected, drawn or taken by two tools (`fill_between` takes two meshes).
- **The dimensions from the worker** after the meshes are made: a simpler registry, but the validation would depend on a Python run, and the forms could not know the length of a vector before.
- **Points always in 3D** (padded with zeros): the tools of FElupe rely on the dimension of the points (`expand` adds an axis), so the script would not be the one of FElupe.
- **Reusing names in the script** (`face = face.add_runouts(...)`): shorter, but a mesh between the steps would have no variable, and its line could not be shown for its object.
- **Meshes of scripts only** (ADR 0009): every mesh is possible, but a user writes Python, and the values of a mesh are not fields of the app.
