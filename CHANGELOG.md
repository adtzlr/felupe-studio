# Changelog

All notable changes of FElupe Studio (the web app and the Python package `felupe_studio`, released together with the same version).

## [Unreleased]

### Added

- Multi-point constraints (`mpc.add`, `fem.MultiPointConstraint`): the points of a point set follow a control point, optionally with a rotation point; items of the steps (#97).
- **Control point at center** of the selected point set, of a picked face or of picked nodes (#96).
- Control points in the viewport: drawn as markers (also displaced in the results), selected by a click, listed under **Points** in the browser (#95).
- Control points (`point.add`): points that are not nodes of the meshes, merged as a mesh of vertices and referenced like a point set, e.g. by a boundary (#94, ADR 0006).
- Picking nodes: with **Nodes** shown, a click picks a node, Shift+click more; create a point set of them, add them to the selected one or copy their coordinates (#93).
- Point sets by nodes: the coordinates of points, one per line, stored by coordinates instead of ids of the merged mesh; the viewport warns about coordinates without a node (#92).
- **Nodes** in the view toolbar shows the nodes of the visible meshes, also in the results (#91).
- A tolerance of the Newton-Raphson method per job (`tol`), e.g. 0.05 to loosen it (#106).
- Boundaries and load cases in the viewport: strokes of the fixed components and arrows of the moved boundaries, also of the load cases like `fem.dof` (#82).
- Results: hovering shows the value under the pointer, of a cell (strains, stresses) or of a node (displacements), with its cell or node (#85).
- Samples (header and empty model): four finished models with their mesh files, opened like a project file (#32).
- The properties of the selected object are shown in a panel on the right of the viewport, which opens on selection and can be closed; the browser has the left sidebar for itself (#83).
- The project and its mesh files are kept in the browser (IndexedDB), so a reload restores them; **New project** in the header starts an empty project and clears them (#57).

### Changed

- Schema version 2: a step ramps a list of items, each with its own start and end value and the same increments, e.g. a displacement and a rotation; *Also ramped* is gone. The properties edit them as rows. Projects of schema version 1 are migrated when they are opened, in the app and in `felupe_studio` (#90).

### Fixed

- The panel of a running job keeps its size: fixed lines for the position, the Newton iteration and the retries of a cutback, without wrapping (#108).
- `u-p-J` with tetrahedrons in a model with more than one section (#76).
- An object created later can be chosen in an existing object, e.g. a new material in a section; the command list is reordered so that every reference points to an object before (#80).
- Dropdowns no longer offer an option twice: the default axis of a load case is shown as e.g. `x (default)`, and *Also ramped* does not offer the ramped boundary (#88).

## [0.1.0] - 2026-11-10

The first release: a model of hyperelastic solids, from mesh files to results, in the browser.

### Model

- Import mesh files (VTU, Gmsh and the other formats of meshio) with one or more types of solid cells; cell sets from cell tags or from whole mesh files; merge points of meshes with a tolerance.
- Materials of the material registry: Neo-Hooke, Neo-Hooke (compressible), Mooney-Rivlin and linear-elastic (large strain).
- Sections with the displacement formulation (`u`) or the mixed formulation (`u-p-J`, MINI element for linear tetrahedrons) for every supported cell type.
- Point sets by a plane or by point ids, also by clicking a face in the viewport; boundaries, load cases of `fem.dof` (uniaxial, biaxial, planar, shear) and ramps of several boundaries.
- Steps and jobs, with a force-displacement curve of a boundary and an optional cutback.

### App

- Desktop layout bound to a command list with undo and redo: ribbon, browser, generated properties forms, command line and history.
- Project files (`.felupe.json`): a text-diffable command list.
- WebGL2 viewport with the viewer of FElupe: cells colored by mesh, cell set or section, visibility, point sets as markers, view toolbar and axis triad.
- Solve in a Pyodide worker with live progress (substeps, Newton iterations), cancel and the Python traceback of a failed run.
- Results: deformed shape with contours of the displacement, the principal logarithmic strains and Cauchy stresses and the von Mises stress per substep; the force-displacement curve with a table and CSV.
- Exports: the FElupe script of the model, the results as XDMF (all substeps) or VTU (a substep), and a PNG of the view.
- A service worker caches Pyodide and the wheels, so later visits start faster; a notice reports a newer deployment of the app.

### Python package

- `felupe_studio.codegen()`: the command list as a readable FElupe script, checked by golden tests against reference curves.
- JSON schema of the command list (schema version 1) as the single source of the app and of the package.

[0.1.0]: https://github.com/adtzlr/felupe-studio/releases/tag/v0.1.0
