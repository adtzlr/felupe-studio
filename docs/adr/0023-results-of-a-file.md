# 0023 The results of a file

Status: Accepted

## Context

The results of a job live in the Python worker as long as the run: the fields of the sections, recorded per substep, and the state variables (#191, #346). `felupe_studio.results.scene()` and `ranges()` restore a substep and evaluate the strains and the stresses of the solid bodies of the namespace of the run. A reload, a new project or a new run loses them. *Export ▸ Results of the job* writes them as an XDMF time series for ParaView (`felupe_studio.results.export()`): the merged points that the cells use, one block of cells per section, the point data `Displacement`, the cell data of the strains, the stresses and the index of the `Section`, with the strains and the stresses at the points too if they were exported there (#231). The data are inside the XML (`data_format="XML"`): h5py is not in Pyodide.

#414 asks to show such a file again in the Results workspace, whatever model is open. The file has no model: no commands, no solid bodies, no materials, no steps, no control points and no curve. The app takes the model of the results from the commands of the run: the sections, 2D or not, the units and the quantities of the contour (`quantityGroups()`).

## Decision

- **The XDMF export is the input format,** read with meshio's `TimeSeriesReader` (`felupe_studio.resultfile`). A file needs the point data `Displacement` and the cell data `Section`; any other file is an error, and the shown results stay. No VTU (one substep, no time series), no XDMF of other tools.
- **The names of the sections, the units of the model and its nodes are written into the export,** as an `Information` of its domain: `Name="felupe-studio"`, `Value` the JSON `{"sections": [...], "units": {...}, "nodes": [...]}` (`results.INFORMATION`), with the node of the model of every point of the file. ParaView and meshio ignore it. A file without it, e.g. of v0.10, has the sections *Section 0*, *Section 1*, … (the values of `Section`, as in ParaView), no units and its points as the nodes.
- **With the values at the points, every section has its own points in the file** (VTU and XDMF): a point of two sections is there twice, with the values of each section, as in the view. Before, the export had the means of the sections at their common points, which differ from the view at an interface. The import puts the points of every section back at the nodes of the model (`nodes`), so its scenes are those of the run, also at the points. At the cells, the sections share their points as before: the displacement is the same in both sections.
- **meshio merges the blocks of neighbouring sections of the same cell type,** so the sections are split by the cell data `Section`, not by the blocks. A section of two cell types is an error.
- **Two sources of results in Python,** the last run or a file, with the same eight methods: `mesh(section)`, `displacement(section)`, `data(kind, section, method)`, `restore(job, substep)`, `substeps(job)`, `method(method)`, `shift()` and `control_points(job, substep)`. `scene()` and `ranges()` take everything of a substep from the source (`_source()`) and nothing from the namespace. `_Run` wraps the existing functions of the run; `ResultFile` the arrays of the file. `results.show(source)` resets the results and shows a source; `reset()` of a new run shows the run again.
- **Nothing is computed again from a file.** The values are the data of the file: at the cells, and at the points of every section as they were exported if the file has them; a method at the points takes the point data, else the cells (`method()`), and nothing is projected (`shift()` is true). The contour offers the quantities of the file only. A file of 2D cells is a 2D model, its points in the plane.
- **One job per file:** the name of the file without its extension; a substep is a time of the file. The control points, the constraints, the rigid surfaces and the steps are not in the file.
- **The request `import-results`** sends the name and the bytes of the file; the answer is the description of the file (`ResultFile` of `app/src/worker/protocol.ts`): its job, substeps, sections, `planar`, `units` and quantities. The same on both runtimes (ADR 0005, ADR 0014).
- **In the app, a file is a finished run without commands:** `JobRunner.importResults()` makes a new generation of results of the job of the file, with the file as `imported`, and without the state of a run. So the scenes, the cache of scenes, the player, the cut and the ranges take it unchanged. Not while the jobs run; a run that starts while the file is read wins.
- **What the view takes of the model of the results is one function,** `resultModel(run)` of `app/src/core/results.ts`: the sections, 2D or not, the units and the groups of the quantities, of the commands of a run or of the description of a file. `viewOf()` takes the displacement for a quantity that the results do not have.
- **The results of a file replace those of the last run,** in the app and in Python, like a new run: one set of results at a time, and memory for one.
- **The exports of the results need a run:** the file is the export.

## Consequences

- **The XDMF export is a format to keep readable:** the names of its data (`Displacement`, the names of `fem.ViewSolid`, `Equivalent Plastic Strain`, `Maximum Strain Energy Density`), the cell data `Section` and the `Information` of the export. A change of them needs a reader of the old files; the tests read files without the `Information`.
- **A scene of a file is that of its run,** byte for byte, at the cells and at the points of the method of the export, with the nodes of the model (the tests compare both, also cut, with two sections of one and of two cell types): the sources share the code of the scenes, the ranges, the extremes and the cut.
- **The source has eight methods:** a new kind of data of the results, e.g. a further state variable, needs a method or a name of the export for both sources; the tests of the file against the run catch a missing one.
- **Memory:** meshio parses the XML of all substeps at once, about 3.5 times the size of the file, and the file keeps all substeps. In CPython, 8000 hexahedrons with 11 substeps take 1.0 s for a file of 23 MB ([Benchmarks](../benchmarks.md#the-results-of-a-file-414)). A large file can be too much for Pyodide on a phone.
- **A file with the values at the points has the sections apart:** ParaView shows them as pieces that touch, with the jumps of the values at an interface like the view, and their interfaces as inner faces, e.g. with some opacity (*Clean to Grid* merges the points again, with the values of one section). The file is a bit larger, by the common points (the two bars of `bar_two_materials`: 350 points instead of 325). A VTU at the points read as a mesh (`mesh.import`) has its sections not connected; meshio does not read a time series as a mesh. A file of v0.10 at the points still has the means at the common points.
- **The values at the points of a file are those of its method of export:** every method at the points shows them.
- **2D is known from the cells only:** plane strain and axisymmetric look the same.
- **Not yet:** the MCP server and the agent bridge, *Open project* or a drop of an `.xdmf` (still a mesh), two results at once.

## Alternatives

- **A results file of its own** (e.g. NumPy arrays in a ZIP, or with the project): it could carry everything of a run, but a second format beside the one for ParaView, and the exported files of v0.10 would not open.
- **The results in the project archive** (ADR 0007): the file grows with every substep, and a project without the model of the results would not open.
- **Restoring the run from the file:** fields and solid bodies of the model to evaluate the strains and the stresses again, e.g. with other methods at the points. It needs the model of the file, which #414 does not ask for, and a model that matches the file.
- **The sections from the blocks of the file:** meshio merges neighbouring blocks of the same cell type, and ParaView shows the sections by `Section` too.
- **The names of the sections as field data** of meshio: the XDMF writer of meshio writes no field data, and the time series reader reads none.
- **The means of the sections at their common points** (the export of v0.10): one connected mesh, but at an interface not the values of the view, and an imported file not its run.
- **The values at the points of every section as point data of their own** (e.g. `Equivalent of Cauchy Stress (rubber)`), in the connected mesh: a set of arrays per section, with no values outside it, larger by the number of sections.
- **One grid per section** (a spatial collection of XDMF, blocks named by the sections in ParaView): neither meshio's time series writer nor its reader has it, and a reader of our own for it.
- **The sections apart also at the cells:** the cells do not need it (the displacements are the same), and the mesh of the file would not be connected without a reason.
- **The node numbers as point data:** once per substep in the time series of meshio, and one more array in ParaView.
- **A file beside the results of the run:** two sets of results in Python, and a choice of them in every request of the results.
- **VTU files:** one substep per file; a series of them needs a folder or a `.pvd`, which the browser does not open as one file.
- **Reading the file in the app (TypeScript):** the scenes, the cut and the extremes are made in Python; a second implementation of them.
