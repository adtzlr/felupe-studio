# 0009 Meshes made by scripts

Status: Accepted

## Context

Parametric projects (#154) need meshes that follow parameters: the radius of a disc, the number of layers of a sandwich spring, the fineness of the mesh of a bushing. FElupe makes such meshes in a few lines (`fem.Cube`, `expand`, `revolve`, `fill_between`, …, see the FElupe examples). Mesh tools in the GUI are planned (#193), but they need a model of dimensions and many forms. A Python script is the general way, and a script that runs with FElupe alone is the way FElupe users already work.

## Decision

A mesh object made by a script is a command of its own, `mesh.script {name, file, parameters, item, tag, cell_type}`, next to `mesh.import`.

- The script is a **file next to the project**, like a mesh file: opened with the project, kept in the browser and in project archives (ADR 0007), and reported if it is missing. It is not text inside the project file, so it can be edited and run with any editor and Python.
- It runs with the **parameters of the model** (`parameter.add`, #180) as variables: all of them, or the listed ones (`parameters`). It makes a variable `mesh`: a `fem.Mesh`, a `fem.MeshContainer`, a `meshio.Mesh` (with cell data for tags) or a **dict of names and meshes**. One mesh object takes **one item** of a dict (`item`), like one mesh object of a file takes one type of cells. A dict of a rubber and a metal mesh is two mesh objects with their own cell sets and sections.
- The generated script calls an embedded helper, only in scripts with mesh scripts:

```python
rubber_mesh = run_mesh_script(
    "sandwich_spring.py", {"radius": radius, "layers": layers}, item="rubber"
)
```

  `script_mesh()` runs the file with `runpy.run_path(file, init_globals=parameters)` and converts its mesh to meshio; `run_mesh_script()` takes its solid cells like `volume_cells()` of a mesh file. Both are reserved names. The parameters are passed as a dict, so a parameter may have any name, also `item` or `file`. Every mesh object runs the script once; a script is fast compared with a job.
- In the app, the worker makes the mesh with the same function (`felupe_studio.meshes.make`) and summarizes it like a mesh file (cells, bounds, tags, surfaces). The made meshes are kept by **file, item and parameter values**: a change of a parameter makes the meshes that use it again, a replaced script makes all of its meshes again, and old meshes are forgotten.
- An **error of the script** is the state of its mesh object, a note in the browser that blocks Solve, with the **traceback of the script** (only its frames) in the properties.

## Consequences

- The viewer, point sets, face sets, the checks and the jobs use a made mesh like an imported one; only reading the file differs (`meshStatus` in the app).
- A project runs Python code of its own in the worker (Pyodide, no access to local files or the network beyond what the worker has). The open dialog of parametric projects (#183) says so before a project is opened.
- A script named like the FElupe script of a project archive (`<name>.py`) stays a script of a mesh when the archive is read.

## Alternatives

- **Code inside the project file**: one file less, but no editor, no `python spring.py` for testing, and long strings in JSON. Possible later for small user-defined materials (#192).
- **One mesh object per script with all items**: a command would make several objects, against ADR 0003 (one command, one named object).
- **Mesh tools in the GUI first** (#193): the better way for structured meshes in the long run, but much more work; scripts cover every mesh now and the tools can make the same meshes later.
