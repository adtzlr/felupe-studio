# Releasing FElupe Studio

The web app and the Python package `felupe_studio` are released together with one version (`app/package.json` and `python/felupe_studio/__about__.py`; `tests/test_versions.py` checks that they agree). A release is a tag `vX.Y.Z` on `main` with a GitHub release; GitHub Pages always serves `main`. The tag also publishes the Python package on [PyPI](https://pypi.org/p/felupe-studio) (`.github/workflows/release.yml`, #275).

**Once, before the first release on PyPI:** a *pending publisher* of the project `felupe-studio` on PyPI (*Your projects ▸ Publishing*, or *Account settings ▸ Publishing*): the owner `adtzlr`, the repository `felupe-studio`, the workflow `release.yml` and the environment `pypi`. Then an environment `pypi` in the settings of the repository (*Settings ▸ Environments*), optionally with the maintainer as a required reviewer. Trusted publishing needs no token.

## Checklist

### Before the tag

- [ ] The issues of the milestone are closed and CI is green on `main`.
- [ ] The version is set in `app/package.json`, `app/package-lock.json` (run `npm install` in `app/`) and `python/felupe_studio/__about__.py`.
- [ ] `CHANGELOG.md` has the section of the version with its date.
- [ ] The pinned wheels (`config.wheels` in `app/package.json`) are the versions of the golden tests (`FELUPE_VERSION` in `.github/workflows/ci.yml`).

### Smoke test of the deployed page

With real Pyodide, after the deployment of `main` has finished. Use the cases in `tests/golden` (a `commands.json` and its mesh files, opened together).

- [ ] Desktop Chrome and Firefox, and one phone: the page loads, the status bar shows the versions of FElupe and the load time.
- [ ] `bar_two_materials` (`u` and `u-p-J`): Solve shows progress, then Show results; the contours of displacement, strain and stress change with the substep; the curve matches `results.json` of the case.
- [ ] `bar_mooney_rivlin`: Solve loads tensortrax first and runs.
- [ ] `bar_cell_types` (hexahedrons and tetrahedrons in one mesh file) shows results; with the formulation of a section changed to `u-p-J`, the tetrahedrons use the MINI element.
- [ ] Every sample (File ▸ Samples…) opens, solves and shows results. *Hyperelastic block with a rigid plate*: the top face stays plane and tilts with the plate; the control points show the force at `plate` and the moment at `tilt`; Export ▸ Control points (CSV) has all substeps.
- [ ] A project file of the previous schema version (e.g. saved with the previous release) opens and is migrated; saved again, it has the current schema version.
- [ ] Archives: a sample opens as `<id>.felupe.zip`; *Save project* downloads the archive, which opens again in one step (also a folder of a project zipped by hand); *Save project as…* with the script: the unpacked folder runs with `python <name>.py`.
- [ ] Units: *Model settings* with mm and N; the forms, the browser, the curve and the scalar bar show the units.
- [ ] Face sets and pressures: on the sample *Hyperelastic block with a rigid plate*, a face set of a side face (click, *Create face set*) and a pressure on it ramped by the step; it solves, and the side face bulges in (positive) or out (negative).
- [ ] Results: the contour settings (color map, bands, range over all substeps), *Min/Max* with its labels, and playing the substeps (Space).
- [ ] Picking: a click on a face creates a point set of its plane; a second click on the surface excludes it, a third one deselects it, also by taps on a phone or a tablet; with Nodes shown, Shift+click picks nodes and a click on a picked node deselects it; on a phone, a long press picks a single face (a ring shows it) and adds a node; *Control point at center* creates a control point.
- [ ] Parameters and mesh scripts: *Sandwich spring with parameters* asks for its parameters when it opens; with 5 layers instead of 3 it opens with the higher stack and is softer; *Show* reads the script; *All parameters…* changes them later. An error in a mesh script (e.g. a wrong name) is an issue of the mesh with its traceback.
- [ ] 2D models: *Axisymmetric sandwich spring* and *Plate with a hole in plane strain* open onto the xy-plane, solve, and show their results in 2D; the plate shows the concentration of the stress at the hole.
- [ ] Contact: *Hyperelastic spring with end stops* solves; the point set `outer` highlights the surface, the contact `lower_stop` its points and its plane; in the results the plates move with their reference points and the force rises steeply at the end of the compression.
- [ ] Strain-based materials: the Materials tab has the menus *Linear elasticity*, *Hyperelasticity* and *Strain-based elasticity*. The golden case `plasticity_cube` (steel pulled beyond its yield stress and unloaded) solves; its curve matches `results.json`, the force goes back to zero at a remaining strain, and the contour *Equivalent plastic strain* is above zero. With the framework *Seth-Hill* the form asks for the *Strain exponent m*.
- [ ] Values at the points: on *Plate with a hole in plane strain*, the contour settings ▸ *Values at* ▸ *Points: projected* gives a smooth contour with a larger peak at the hole than *Cells*; the VTU of the substep has the stresses as point data.
- [ ] Samples of v0.5: *Engine mount (FElupe ex07)* solves its two jobs; the curve of `horizontal` is Fx over ux, there and back. *Metacone (FElupe ex15)* asks for its parameters and solves; the force is about -517 N at the end. *Elastic-plastic plate with a hole*: the curve unloads elastically and crosses zero force at about 0.054 mm; the contour *Equivalent plastic strain* is largest at the hole.
- [ ] Export mesh: the menu of a mesh in the browser ▸ *Export mesh…* writes a VTU that opens in ParaView, also of a mesh script with the current parameters.
- [ ] Live results: *Show live results* during a run shows the growing curve and the scenes; *Live results* off shows the curve only.
- [ ] Cancel a running job: Python loads again and Solve works again without opening the files again.
- [ ] A failing job (a large ramp with few substeps) shows the traceback; with cutback it runs.
- [ ] Exports: the Python script runs next to the mesh files with FElupe; the XDMF and the VTU open in ParaView; the PNG shows the view with its scalar bar.
- [ ] Reload: Pyodide and the wheels come from the cache (faster start).

### Local checks

- [ ] MCP server (CPython): `pip install -e ".[mcp]"` in a clone, and the wheel: `python -m build`, then `tests/check_wheel.py` with the Python of a fresh environment, from another folder (CI does both); `felupe-studio-mcp --help`; added to an agent (e.g. `claude mcp add felupe-studio -- felupe-studio-mcp`), it opens a sample, solves it and saves the project, which opens in the app.
- [ ] Local runtime: `pip install "felupe-studio[serve]"` from the wheel (or `-e ".[serve]"` and `npm run build` in a clone), `felupe-studio serve` opens the app with *local Python* in the status bar; a sample with a mesh script shows the script first, solves and shows results; *Cancel* of a running job starts a new process; *About* lists the local versions.
- [ ] Extra samples: `EXTRA_SAMPLES_DIR=<folder> npm run build` (and `npm run dev`) shows them under *More samples*; they open and solve.
- [ ] Screenshots: `python docs/make_screenshots.py` (with the real Pyodide) makes the images of the guide and the README of this version.

### The release

- [ ] Tag `main`: `git tag -a vX.Y.Z -m "FElupe Studio X.Y.Z"` and `git push origin vX.Y.Z`.
- [ ] The workflow *Release* of the tag passes: the tag is the version, the wheel (with the built app) works outside of a clone, also `felupe-studio serve`, and the package is on PyPI (`pip install "felupe-studio[mcp,serve]==X.Y.Z"` in a fresh environment).
- [ ] GitHub release of the tag with the section of `CHANGELOG.md` as notes and the link to the app.
- [ ] Set the date of the version in `CHANGELOG.md` (if it was not set before) and close the release issue.
