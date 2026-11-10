# Changelog

All notable changes of FElupe Studio (the web app and the Python package `felupe_studio`, released together with the same version).

## [Unreleased]

### Added

- Samples (header and empty model): four finished models with their mesh files, opened like a project file (#32).

### Fixed

- `u-p-J` with tetrahedrons in a model with more than one section (#76).

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
