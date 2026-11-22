# felupe-studio

A graphical modeling environment for [FElupe](https://github.com/adtzlr/felupe): build, solve and evaluate finite element models of solids, entirely in the browser.

Every node in the GUI is a FElupe object. Every action is a command; the command list is saved as a text-diffable project file and turned into a readable FElupe script, which runs in the browser with [Pyodide](https://pyodide.org) and can be exported.

**Open the app:** <https://adtzlr.github.io/felupe-studio/>

![FElupe Studio with the sample "Hyperelastic block with a rigid plate"](docs/images/model.png)

FElupe Studio builds models of solids, hyperelastic (e.g. rubber) or elastic-plastic (e.g. steel), in 3D, in plane strain or axisymmetric, from mesh files, Python scripts or the mesh tools of FElupe, with parameters (also derived ones): cell sets from cell tags, materials (linear elastic for small or large strains; hyperelastic like Neo-Hooke, Mooney-Rivlin, Yeoh, Ogden, Arruda-Boyce, …, also with the Mullins effect; strain-based, also elastic-plastic), sections with the `u`, `u-p-J` or `u-isochoric` formulation (e.g. air as a third medium), point sets (by a plane, at a bound, on a cylinder, on the outer surface, of a section, by picked surfaces or nodes), face sets, boundaries, symmetry planes and load cases, control points, multi-point constraints with rotation points (e.g. a rigid plate glued to a face), rigid planes and cylinders with contacts and friction, point loads and pressures, and steps that ramp several items with their own values and switch boundaries on and off, in jobs that may repeat a step for a load cycle. Solve runs in the browser with live results; the results show the deformed shape with contours of the displacement, the strains and the stresses per substep (at the cells or smooth at the points), the equivalent plastic strain and the maximum strain energy density of the Mullins effect, their minimum and maximum, the range of the contour of all or of chosen sections (the others in one color or hidden), the force-displacement (or moment-rotation) curve with free axes and the displacements and forces of the control points, and play the substeps. A plane normal to x, y or z cuts the view, also of the results, so the inside of a model is seen. The FElupe script, the results (XDMF/VTU/CSV), the meshes and pictures of the view can be exported; a project is saved as a text file or as an archive with its mesh files, with the save dialog of the system where the browser has one. The app has a dark and a light theme, and on a phone a compact layout.

Version 0.10 adds:
- **A cut through the model:** a plane normal to x, y or z cuts the view, so you see inside a model, e.g. the rubber of a bushing between its sleeves. In the results it cuts the undeformed model, so the cut face moves with the material and shows the values inside.
- **Steps that switch boundaries on and off:** a step may release a boundary, a load case or a symmetry plane, e.g. a clamp opened after a preload, and switch it on again where its points are or where they were at the start of the job. The view fades what is off in a selected step.
- **More mesh tools:** several meshes stacked into one, e.g. a profile of rectangles that is revolved at once, and circles and triangles.
- **The other sections of a range in one color or hidden,** e.g. the steel sleeves of a bushing in gray beside the contour of its rubber.
- **The save dialog of the system** in Chrome and Edge: a project and the exports go into a chosen folder, and *Save project* then writes into the same file again.

![The sample "Bushing with steel sleeves" cut at z = 0 through its axis: the von Mises stress of the rubber between the sleeves, with the range of the rubber and the sleeves in gray](docs/images/cut.png)

Version 0.9 added pictures for reports with a light theme, own colors of sections and cell sets, the range of a contour from chosen sections and the app on a phone. Version 0.8 added your own deployment under the name of an institute or a company ([your own deployment](docs/deployment.md)), load cycles with the Mullins effect and derived parameters. Version 0.7 added the mesh tools of FElupe in the app, PARDISO with Python on your computer and a fixed link of `felupe-studio serve`. Version 0.6 added expressions of parameters, Python on your computer (`felupe-studio serve`), agents on the open app and single precision. Version 0.5 added plasticity, the strains and stresses at the points, the samples of the engine mount and the metacone, and the MCP server. Version 0.4 added parameters and mesh scripts, 2D models, symmetry planes and contacts with rigid surfaces. See the [changelog](CHANGELOG.md).

![The app on a phone in portrait: the model, and the results with the row of the contour, Play and the substep, and the curve below the view](docs/images/phone.png)

![The results of the sample "Bushing with the Mullins effect" back at the start after its first load cycle: the maximum strain energy density that the rubber keeps, and the force-displacement curve of the first loading, the softer unloading and second loading and the loading on to 9 mm](docs/images/mullins.png)

![The results of the sample "Engine mount (FElupe ex07)": the von Mises stress at the points, with air in the cavities of the rubber, and the force-displacement curve of the horizontal shift](docs/images/engine-mount.png)

**Python on your computer:** `pip install "felupe-studio[serve]"`, then `felupe-studio serve` opens the same app with the Python of your computer instead of Pyodide: native NumPy and SciPy for large models, and mesh scripts with your own packages ([user guide](docs/guide.md#python-on-your-computer)).

**AI agents:** with `pip install "felupe-studio[serve,mcp]"`, `felupe-studio serve --agent` lets an agent like Claude Code or GitHub Copilot work on the model that is open in your browser. *Help ▸ Connect an agent* connects the tab; you see every change in the history and undo it, and you read a mesh script of the agent before it runs ([agents](docs/agents.md)). Headless, `felupe-studio-mcp` builds, checks and solves models with CPython, and you open the saved project in the app.

![An agent on the open app: it opened a sample, added a parameter and wrote a mesh script, which the user reads before it runs](docs/images/agent.png)

**Documentation:** the [user guide](docs/guide.md) with tutorials, the [command reference](docs/reference.md), how the [commands](docs/commands.md) become a FElupe script, the [MCP server](docs/agents.md) for AI agents, [your own deployment](docs/deployment.md) under your own name, the [architecture decision records](docs/adr/), the [changelog](CHANGELOG.md) and the [roadmap](https://github.com/adtzlr/felupe-studio/issues/399).

**Non-goals:** meshing from CAD, contact between deformable bodies (contacts are with rigid planes and cylinders), a server backend (the MCP server and `felupe-studio serve` run on your computer).

## Repository layout

| Path | Content |
| --- | --- |
| `app/` | The web app (TypeScript, Vite) |
| `python/felupe_studio/` | Python package: command list → FElupe script (runs in Pyodide and CPython), the MCP server for AI agents (`mcp.py`, CPython) and the local runtime of the app (`felupe-studio serve`: `serve.py`, `runtime.py`, CPython) |
| `tests/` | Python tests |
| `docs/adr/` | Architecture decision records |
| `docs/` | User guide, command reference (generated by `docs/make_reference.py`), screenshots (`docs/images`, made by `docs/make_screenshots.py`), commands, your own deployment, benchmarks and the [release checklist](docs/release.md) |

## Development

Web app:

```bash
cd app
npm install
npm run dev      # development server
npm test         # unit tests (Vitest)
npm run lint     # ESLint and Prettier
npm run build    # typecheck and production build
```

Python package:

```bash
pip install -e ".[test,mcp,serve]"
pytest            # the app in a browser: pytest -m e2e (Playwright, a built app)
ruff check . && ruff format --check .
```

## License

felupe-studio is licensed under GPL-3.0-or-later, the same license as [FElupe](https://github.com/adtzlr/felupe).
