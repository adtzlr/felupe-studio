# Releasing FElupe Studio

The web app and the Python package `felupe_studio` are released together with one version (`app/package.json` and `python/felupe_studio/__about__.py`; `tests/test_versions.py` checks that they agree). A release is a tag `vX.Y.Z` on `main` with a GitHub release; GitHub Pages always serves `main`.

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
- [ ] Picking: a click on a face creates a point set of its plane; with Nodes shown, Shift+click picks nodes; *Control point at center* creates a control point.
- [ ] Cancel a running job: Python loads again and Solve works again without opening the files again.
- [ ] A failing job (a large ramp with few substeps) shows the traceback; with cutback it runs.
- [ ] Exports: the Python script runs next to the mesh files with FElupe; the XDMF and the VTU open in ParaView; the PNG shows the view with its scalar bar.
- [ ] Reload: Pyodide and the wheels come from the cache (faster start).

### The release

- [ ] Tag `main`: `git tag -a vX.Y.Z -m "FElupe Studio X.Y.Z"` and `git push origin vX.Y.Z`.
- [ ] GitHub release of the tag with the section of `CHANGELOG.md` as notes and the link to the app.
- [ ] Set the date of the version in `CHANGELOG.md` (if it was not set before) and close the release issue.
