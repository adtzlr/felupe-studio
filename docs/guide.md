# User guide

FElupe Studio builds models of hyperelastic solids from mesh files, solves them with [FElupe](https://github.com/adtzlr/felupe) in the browser and shows the results. Nothing is installed and nothing is uploaded: Python runs in the browser with [Pyodide](https://pyodide.org).

**Open the app:** <https://adtzlr.github.io/felupe-studio/>

The first start downloads Python, NumPy, SciPy and FElupe; the browser keeps them for the next visits. The [command reference](reference.md) lists every property of every command, [commands.md](commands.md) explains how the commands become a FElupe script.

## The idea

Every object of a model is a FElupe object, and every action creates or changes a **command**: `mesh.import`, `material.add`, `boundary.add`, … The project file (`*.felupe.json`) is the list of these commands, a small text file that is easy to compare and to keep in version control. The commands are turned into a readable FElupe script, which is what runs when you solve and what you can export.

## The window

- **Header:** the menus **File** (new, open, samples, save and the exports) and **Help** (this guide, the command reference, the keyboard shortcuts and *About* with the versions of FElupe, Python and Pyodide), buttons for Open, Save, Export, Undo and Redo, and **Solve**.
- **Ribbon:** the workspaces **Model** and **Results**. The tabs of the model create its objects in the order in which a model is usually built: Mesh, Materials, Sections, Loads & BCs, Steps & Job. A button that cannot be used yet tells you what is missing, e.g. "Create a cell set and a material first."
- **Model browser** (left): the objects of the model in groups. A number at an object counts its issues. A click on an object selects it in the viewport and opens its **properties**, where you edit and **Apply** or **Delete** it.
- **Viewport:** the meshes with their point sets, boundaries, control points, constraints and loads. The toolbar has the views, *Fit*, *Color by* (mesh, cell set or section) and *Nodes*.
- **Footer:** the command line, the state of Python, the number of commands and issues, and the history: the commands in their order, with Undo (Ctrl+Z) and Redo (Ctrl+Shift+Z).

The project is kept in the browser with its mesh files: a reload restores it. To keep it, save the project file and keep it next to its mesh files.

## Samples

An empty model shows a welcome panel with *Import mesh*, *Open project* and the samples; **File ▸ Samples…** lists them too. A sample opens as a ready-made model with its mesh files. They show the features step by step:

| Sample | Shows |
| --- | --- |
| Bar of two materials | cell sets from a cell tag of a VTU file, the `u` and `u-p-J` formulations, a force-displacement curve |
| Material test: uniaxial tension | a load case with symmetry planes, compared with the analytical curve |
| Hexahedrons and tetrahedrons | a Gmsh file with two types of cells |
| Rubber mount in shear | three sections, the Mooney-Rivlin model, the shear load case |
| Rubber block with a rigid plate | control points, a multi-point constraint with a rotation point, a step with several ramps |

Open a sample, press **Solve** and look at the results; then change a value in the properties and solve again.

## Building a model

### 1. Mesh

**Import mesh** reads any mesh file that meshio reads, e.g. VTK (`.vtu`, `.vtk`), Gmsh (`.msh`), Abaqus (`.inp`), XDMF, Medit or Exodus; **Open project** accepts mesh files too. The solid cells are tetrahedrons or hexahedrons, linear or quadratic. A file with several types of cells gives one mesh per type.

The cells of a model come from **cell sets**: **Cell set of a mesh** takes all cells, **Cell set from tag** the cells with a value of an integer cell data array (the *Cell tag* of the import, e.g. `material` or `gmsh:physical`). The meshes are merged at their common points; **Merge points** also merges points that agree to a number of decimals, e.g. of meshes from different programs.

### 2. Materials and sections

The **Materials** tab has one button per material model: Neo-Hooke, Neo-Hooke (compressible), Mooney-Rivlin and linear elastic (large strain). A **Section** assigns a material and a formulation to a cell set: `u` with the displacements only, or `u-p-J` for (nearly) incompressible materials with a bulk modulus. Every section becomes a solid body.

### 3. Point sets

A **point set** selects points of the merged meshes:

- **by a plane:** click a face of the model. If the face is normal to x, y or z, *Create point set* creates the point set of its plane, e.g. `z == 0`.
- **by nodes:** turn on *Nodes* in the toolbar, click a node and Shift+click more nodes, then *Create point set*. The point set stores the coordinates of the nodes, not their numbers; *Copy* copies the coordinates.
- **by ids:** the ids of the points of the merged meshes, e.g. from a script.

A selected point set is highlighted in the viewport.

### 4. Boundaries and load cases

A **Boundary** prescribes displacement components of a point set: *Constrained* are the components, *Value* is the displacement (default 0). Components that are not constrained are free. To fix some components and move others, use two boundaries, e.g. `hold` with y and z and `move` with x.

A **Load case** creates the boundaries of a standard test at once (uniaxial, biaxial, planar, shear), optionally with symmetry planes. A step ramps the displacement of its moving end faces.

### 5. Control points, multi-point constraints and point loads

A **control point** is a point that is not a node of the meshes, e.g. the center of a rigid plate. *Control point at center* in the panel of a picked face, of picked nodes or of a selected point set creates one at the center of these points; then change its coordinates in the properties. A control point at the coordinates of a node is the node itself: the viewport warns about it.

A **Multi-point constraint** connects the points of a point set rigidly to a center point (a control point or a point set of one point). *Connected* are the components that follow the center point. With a **rotation point**, the points also rotate about the center point: the values of the rotation point are the rotations about x, y and z in rad, so a boundary of its y component with the value 0.1 tilts the points by 0.1 rad about the y axis. The viewport draws lines from the center point to the connected points.

A **control point needs a stiffness**: every component of it needs a boundary or a multi-point constraint. Otherwise the model has an issue, because the system of equations would be singular.

A **Point load** is a force at every point of a point set or at a control point. A ramp of a step scales the force from its start to its end value, so `end: 1` applies the full force.

### 6. Steps and jobs

A **Step** solves the model in increments. Its items are the sections, multi-point constraints and point loads (all of them, unless you choose some). *Ramped* lists the boundaries, load cases and point loads whose values change in the step, each with its own start and end value; *Increments* is the number of substeps of the step. All other boundaries keep their values.

A **Job** evaluates its steps one after another. With a *Curve boundary* (a boundary, a load case or a point load) it records the force-displacement curve. *Cutback* retries a substep that does not converge with smaller increments; *Tolerance* is the tolerance of the Newton-Raphson method, which you may loosen, e.g. to 0.05, for a first try of a hard model.

### 7. Solve

**Solve** runs the jobs. It is available when the model has a job, no issues and its mesh files; otherwise its tooltip tells you what is missing. The job panel shows the substep and the Newton iterations; *Cancel* stops the job. If a job fails, the panel shows the message and the Python traceback.

## Results

The **Results** workspace shows the deformed shape of a substep:

- *Contour*: the displacement, the logarithmic strains or the Cauchy stresses (principal values and von Mises).
- *Substep* and *Scale* of the displacements; *Undeformed* shows the shape before the deformation.
- *Curve*: the force-displacement curve with the current substep; download it as CSV.
- A hover over the model shows the value at the point under the pointer; *Nodes* shows the nodes of the deformed meshes.
- The control points show their displacements and forces in the substep (rotations and moments for rotation points); the export has them for all substeps.

## Exports

The **Export** menu has

- the **Python script** of the model: it runs with FElupe and meshio outside the app, next to the mesh files,
- the **results of the job** (XDMF) and of the **substep** (VTU), e.g. for ParaView,
- the **control points** (CSV): displacements and forces per substep,
- a **picture of the view** (PNG).

## The command line

Every button creates a command, and so does the command line in the footer. It accepts the JSON of the project file and completes what you type:

```text
material.add {"name": "rubber", "model": "NeoHooke", "parameters": {"mu": 1}}
material.add          opens the dialog of a new material
select rubber
delete rubber
undo · redo · help
```

## Tutorial: a rubber block with a rigid plate

The sample *Rubber block with a rigid plate* glues the top face of a rubber block to a rigid plate. The plate moves 8 mm sideways and tilts by 0.1 rad at the same time. To build it yourself, start a new project and import `block.vtu` of the sample (a block of 40 × 40 × 20 mm):

1. **Mesh:** *Cell set of a mesh* `all_cells` of the mesh `block`.
2. **Materials:** a *Mooney-Rivlin* material `rubber` with C10 = 0.4 and C01 = 0.1.
3. **Sections:** a section `rubber_block` of `all_cells` with `rubber`, the formulation `u-p-J` and the bulk modulus 2000.
4. **Point sets:** click the bottom face and create the point set `base` (`z == 0`), click the top face and create `top` (`z == 20`). The viewport suggests names; change them in the properties.
5. **Control points:** select `top`, click *Control point at center*, name the new control point `plate` and move it above the face to (20, 20, 25): this is the center of the plate. Create a second control point `tilt` at (20, 20, 30): its values are the rotations of the plate. Two control points at the same coordinates would be merged, therefore they are apart.
6. **Boundaries:** `fixed` holds x, y and z of `base`. `shift` constrains x of `plate`, `hold` its y and z. `tilt_y` constrains the rotation y of `tilt`, `tilt_lock` its rotations x and z.
7. **Multi-point constraint:** `glue` connects `top` to the center point `plate` in x, y and z, with the rotation point `tilt`.
8. **Step:** `shift_and_tilt` with 8 increments ramps `shift` to 8 and `tilt_y` to 0.1.
9. **Job:** `job` evaluates `shift_and_tilt` with the curve boundary `shift`.

**Solve** and open the results: the top face stays plane, moves with the plate and tilts with it. The curve is the force of the plate in x over its displacement; the control points show the reaction force at `plate` and the moment about y at `tilt`. Compare your model with the sample: the project files have the same commands.

## Limits of version 0.2

FElupe Studio has no meshing from CAD, no contact and no server. The boundaries of a model are the same in all steps; a step only ramps values. Surface loads (pressure) are planned, see the [roadmap](https://github.com/adtzlr/felupe-studio/issues/104).
