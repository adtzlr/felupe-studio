# Changelog

All notable changes of FElupe Studio (the web app and the Python package `felupe_studio`, released together with the same version).

## [Unreleased]

### Added

- Point sets at a bound of the meshes and on a cylinder: *At a bound* (`select: {bound: "max", axis: "z"}`) selects the points at the smallest or largest coordinate of the meshes of the sections, without the control points, so that the top of a model stays selected when its mesh changes; *On a cylinder* (`select: {radius, axis, center}`) the points at a distance from an axis parallel to x, y or z, e.g. a sleeve of a bushing. A picked plane at a bound of the meshes creates a point set at the bound (`z == max`). The viewport marks their points and warns about a plane, bound or cylinder without points (#181).
- Parameters of the model: `parameter.add` is a named number with an optional quantity (length, force or stress, with the unit of the model settings), a range, a step, *Integer* and a description. The *Mesh* tab has a *Parameter* button next to *Model settings*; the browser lists the parameters below the settings with their value and range; a value outside of its range and fractions of an integer parameter are issues. The script defines them as variables at its top (`radius = 50.0  # mm`). The first step of parametric projects (#154): meshes made by scripts use them next (#180).

### Changed

- The default tolerance of the Newton-Raphson method is 0.01 (FElupe's default is 1.49e-8), like the force criterion of commercial codes: the norm of the residual forces relative to the norm of the reaction forces. The generated script always passes it (`job.evaluate(x0=field, tol=0.01)`), the form shows it as the placeholder. In the golden cases a job takes about half the time, and the forces deviate by less than 1 % of the largest force. Projects without a tolerance are not migrated: their results change slightly; set *Tolerance* to e.g. 1e-6 for curves that are fitted to test data. The golden cases compared with converged references set `tol: 1.49e-8` (#176).

### Fixed

- The labels of a dialog that creates an object point to its own fields: with an object selected, the properties and the dialog had fields of the same ids, so a click on a label of the dialog focused the field of the properties (#181).
- The contour settings: the selects stay inside the popover (they took the width of their longest option), the popover is wide enough for *Cool–warm (centered at 0)* and stays inside the window (#177).

## [0.3.0] - 2026-11-12

Settings, results display, project archives and pressures: the units of a model, more material models (tensortrax), the settings of the solver in the properties, contour settings with the minimum and maximum of a contour and playing the substeps, project archives (`.felupe.zip`) with Save as, face sets and pressures. Projects of schema versions 1 (v0.1) and 2 (v0.2) are migrated when they are opened; projects saved with v0.3 have schema version 3. Archives are plain ZIP files with the project file, its mesh files and optionally the FElupe script (ADR 0007); face sets are stored by planes or by the centers of their faces (ADR 0008).

### Added

- Screenshots of the model, the results and a pressure in the user guide and the README, made from the sample *Rubber block with a rigid plate* with `docs/make_screenshots.py` (Playwright); the guide documents face sets, pressures and the new shortcuts (#143).
- Pressures: `pressure.add` acts on the faces of a face set (`fem.SolidBodyPressure`), positive onto the faces, per deformed area. It is an item of the steps with the point loads, ramped as a factor of its pressure, and drawn as arrows normal to the faces. New golden case `block_pressure` (#105).
- Face sets: `faceset.add` selects faces of the boundary of a section, on a plane or by the centers of picked faces (Shift+click in the viewport), e.g. for pressures. The script makes a boundary region of the merged mesh of the section with the helper `boundary_faces()` and a field of it, linked to the merged field (only in scripts with face sets). The browser lists them under *Face Sets*, the viewport draws them; a face set on tetrahedrons is an issue, because FElupe 12 has no boundary regions of tetrahedrons. ADR 0008; the surfaces of quadratic cells tell the face of every triangle (`curved`) (#142).
- Save in the project's format and *Save project as…* (Ctrl+Shift+S): a project is a project file (`.felupe.json`) or a project archive (`.felupe.zip`, with its mesh files); *Save project* keeps the format without asking. A project opened from an archive or a sample is an archive, a new one becomes an archive with its first mesh file. *Save project as…* chooses the name and the format, for an archive the FElupe script (the unpacked folder runs with `python <name>.py`), and lists the mesh files with their sizes and the missing ones (#150).
- Open project archives: *Open project*, the Open button and a drop on the window accept `.felupe.zip` (and any ZIP file), and open the project with its mesh files in one step; files that the project does not use are listed. A project opened from an archive is saved as an archive. Opening a project replaces the mesh files of the previous one (a project that references a file of the same name no longer uses the old mesh), and with unsaved changes the app asks first (#149).
- Project archives: the format `<name>.felupe.zip` (a plain ZIP file with the project file, its mesh files and optionally the FElupe script, ADR 0007) and a module that writes it deterministically and reads it, also when a user zipped the folder of a project; with fflate in a chunk of its own (#148).
- Play the substeps: ▷ beside the slider of the substeps (or Space) plays them in a loop at 1–20 substeps per second; the curve and the control points follow. The next scenes are loaded ahead while playing, and the loaded scenes are kept, so substeps that were shown once are shown at once (#141).
- Minimum and maximum of the contour: *Min/Max* in the results toolbar marks them with labels of their values, a dot at a node or the outlines of the outer faces of a cell. A click on a label or a marker shows the node or the cell and its section (and whether it is inside); a click elsewhere or Esc hides it. A label takes the face nearest to the camera that is not hidden by the model, or is dimmed; the picture export draws the labels. The scalar bar of the displacement reads *Displacement magnitude*. New in Python: `extremes` in the meta data of `felupe_studio.results.scene()` (#140).
- Contour settings in a popover beside *Contour*: the color map (Turbo, Viridis, Cool–warm centered at zero for signed values, Grayscale), continuous or 6–20 bands, and the range of the substep, over all substeps of the job or manual, with an extra color for values outside of it. The app draws the scalar bar (with the swatches of the extra color), also in the picture export; the settings are kept in the browser. New in Python: `felupe_studio.results.ranges(job, quantity)` (#139).
- Context menu of an object in the browser: right click, a ⋯ button (on hover, at the selected object, always on touch screens) or Shift+F10, with *Duplicate*, *Rename*, *Show/Hide* and *Delete* (disabled with the objects that use it). *Duplicate* (Ctrl+D) copies the object with the next free name (`rubber_2`) right after the original as one undo step and selects it; references are not copied into other objects, and the model settings cannot be duplicated. H shows or hides the selected object. The menus of the header, the ribbon and the browser share one list component (#138).
- More material models of tensortrax (`fem.Hyperelastic`): Yeoh (C10, C20, C30), third-order deformation (C10, C01, C11, C20, C30), Ogden (one to three terms μᵢ, αᵢ as lists), Arruda-Boyce (C1, limit) and extended tube (Gc, delta, Ge, beta), each with an optional bulk modulus. They are definitions of the material registry of the schema with labels, units, bounds and the defaults of the FElupe examples; Ogden needs as many exponents as moduli (`x-same-length`, checked in the form and the validation) and no exponent of zero. The *Materials* tab groups the models in menus (*Neo-Hooke ▾*, *Polynomial ▾*, *Micromechanical ▾*, by `x-group`), so it stays one row. Golden cases `cube_<model>` pull a cube to a stretch of 2 and compare the curve with `fem.ViewMaterialIncompressible` (#136).
- Scale of an imported mesh: `mesh.import` has a `scale` (default 1) that multiplies the coordinates after reading, before the cell sets, e.g. 1000 for a mesh in m of a model in mm. The import dialog shows the size of the mesh and suggests the scale for a mesh that is very small or very large for the units of the model (smaller than 1 mm or larger than 10 m; without units, smaller than 0.01 or larger than 10000). The viewer, the point sets and the points, the checks of the interfaces and the script use the scaled coordinates (#135).
- The volumetric part of the u-p-J formulation: the section property *Volumetric part* (`volumetric`, only with u-p-J) chooses the strain energy U(J) of `fem.NearlyIncompressible`, *volume-ratio* K/2 (J − 1)² (default), *stretch* 9K/2 (J^⅓ − 1)² or *log* K/2 ln(J)², with the formulas in the options. The script passes it only if it is not the default; the browser shows it at the section. Tests compare all three with FElupe; a golden case (`bar_volumetric_log`) pulls a bar with a small bulk modulus and *log*. The bulk modulus of a section shows the unit of the model (#134).
- Settings of the Newton-Raphson method and of the cutback of a job: *Max. iterations* (`maxiter`) next to the tolerance, and with a cutback its *Factor*, *Max. cutbacks* and *Growth* (`cutback: {factor, max_cutbacks, growth}`, the parameters of `fem.CutbackPlugin`), each optional with the default of FElupe. The script passes only the given ones; the job panel shows *Newton iteration 3 of 16*. Optional groups of fields in the forms show their hint. A golden case (`bar_cutback`) needs a cutback by a smaller factor (#133).
- Units of the model: the new command `model.settings` (at most one, *Model settings* in the *Mesh* tab) says what the numbers mean, the units of lengths (mm, m) and forces (N, kN); stresses follow (MPa, GPa, Pa, kPa). FElupe has no units, nothing is converted. The forms show the units at their labels (from `x-quantity` of the schema), also at the rows of the ramps; the browser at the values, the results at the scalar bar, the tooltips, the control points and the curve, and the CSV of curves and control points in the header (e.g. `u_x [mm]`); the script gets a comment. Rotations are always in rad. The samples *Rubber mount in shear* and *Rubber block with a rigid plate* are in mm and N (#132).
- Script view: the ribbon tab **Script** shows the FElupe script of the model instead of the viewport, as it is exported and updated after every change, with highlighted Python and line numbers. The lines of the selected object are highlighted, a click on a line selects its object; *Copy* and *Download*. `felupe_studio.codegen.object_lines()` finds the lines of the objects (#130).
- Keyboard shortcuts: Ctrl+S save, Ctrl+O open, Ctrl+Enter solve, Delete and F2 for the selected object, Esc clears the selection; F, 1–4 and N in the views; ←, →, Home and End step through the substeps; `?` opens the overview. One list (`core/shortcuts.ts`) feeds the handlers, the overview, the menus (with `aria-keyshortcuts`) and the tooltips. Not while typing, except saving and solving (#129).
- A welcome panel for an empty model: *Import mesh*, *Open project*, the samples as cards with a picture, and links to the user guide and the tutorial. The pictures (`thumbnail.svg`) are made by `make_samples.py` from the models, in the colors and the default view of the viewport; the Samples dialog shows them too (#127).
- **File** and **Help** menus in the header: File has new, open, samples, save and the exports; Help links the user guide, the command reference and a new issue, lists the keyboard shortcuts and shows *About* (versions of the app, FElupe, Python, Pyodide, NumPy, SciPy, meshio and tensortrax, the load time, the license, the Pyodide benchmark). The menus work with the keyboard (#126).

### Changed

- Polish of the properties: hints without the key of the schema in front (the key, e.g. `C10`, is in the tooltip of the label C₁₀); numbers right-aligned with digits of equal width; an issue of the validation is shown at the field that has it (a reference, the formulation, the coordinates, the axes of a load case, the ramped items, the name), the others below the form without the index of the command; *Apply* and *Reset* only after a change, Enter applies and Esc resets (also in *Help ▸ Keyboard shortcuts*); *Curve boundary* of a job is *Curve*, and an empty selection of all reads *all (default)* (#137).
- Schema version 3 (for `model.settings` and the settings of the cutback); projects of version 1 and 2 are migrated when they are opened: `"cutback": true` becomes `"cutback": {}`.
- Narrow windows (up to 1000 px): the browser and the properties are drawers over the views instead of squeezing the viewport (a button in the header opens the browser, a selection closes it and opens the properties, Esc closes them); the ribbon is one row that scrolls, and the header keeps one line. The layout below 800 px no longer stacks the panels below the viewport (#131).

- The overlays of the viewports have fixed places and never overlap: the panels and messages at the bottom are stacked between the axes and the job panel, the cards of the results form one column on the right, and in a narrow view (also with the properties open) the job panel spans the width at the bottom while the legend and the cards move below the view toolbar. The tips are shorter and quieter (#128).
- The header keeps icon buttons for Open, Save, Export, Undo and Redo; New and Samples are in the File menu. The ribbon tab *Tools* is gone, its benchmark link is in Help ▸ About (#126).
- One set of design tokens (colors, type, spacing, radii, shadows, stacking) and consistent components: all inputs and selects share one style (also in the results and the curve), buttons have hover and a clear disabled state, one focus ring for keyboard navigation, overlays on the viewport share one surface; a test keeps the styles on the tokens (#125).

## [0.2.0] - 2026-11-11

Multi-point constraints: control points, rigid connections of point sets with rotation points, point loads, and steps that ramp several items with their own values. Projects of schema version 1 (v0.1) are migrated when they are opened; projects saved with v0.2 have schema version 2. With a user guide and a command reference.

### Added

- Documentation: a [user guide](docs/guide.md) with a tutorial, and a [command reference](docs/reference.md) generated from the schema (`python docs/make_reference.py`); the schema describes all properties, which the forms show as hints (#33).
- Sample *Rubber block with a rigid plate*: a multi-point constraint with a rotation point, moved and tilted in one step (#102).
- Results of control points: displacement and force (rotation and moment of a rotation point) on hover, in a card per substep and as CSV of all substeps (#101).
- Point loads (`load.add`, `fem.PointLoad`) on point sets and control points, ramped by the steps as a factor of the force; force-controlled curves; arrows in the viewport (#100).
- Multi-point constraints in the viewport: lines from the center to the connected points, also displaced in the results, and a warning for points that a boundary prescribes as well (#99).
- Curves of rotation points show the moment over the rotation (*Moment–rotation*); the properties say when values are rotations (#98).
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

[0.3.0]: https://github.com/adtzlr/felupe-studio/releases/tag/v0.3.0
[0.2.0]: https://github.com/adtzlr/felupe-studio/releases/tag/v0.2.0
[0.1.0]: https://github.com/adtzlr/felupe-studio/releases/tag/v0.1.0
