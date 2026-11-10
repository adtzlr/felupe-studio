# felupe-studio

A clickable GUI for [FElupe](https://github.com/adtzlr/felupe) that runs entirely in the browser.

Every node in the GUI is a FElupe object. Every action is a command; the command list is saved as a text-diffable project file and turned into a readable FElupe script, which runs in the browser with [Pyodide](https://pyodide.org) and can be exported.

**Open the app:** <https://adtzlr.github.io/felupe-studio/>

Version 0.1 builds models of hyperelastic solids from mesh files: cell sets from cell tags, materials (Neo-Hooke, Mooney-Rivlin, …), sections with the `u` or `u-p-J` formulation, point sets (also by clicking a face), boundaries, load cases, steps and jobs. Solve runs in the browser with live progress; the results show the deformed shape with contours of the displacement, the strains and the stresses per substep, and the force-displacement curve. The FElupe script, the results (XDMF/VTU) and pictures of the view can be exported. See the [changelog](CHANGELOG.md), the [roadmap](https://github.com/adtzlr/felupe-studio/issues/1), the [commands](docs/commands.md) and the [architecture decision records](docs/adr/).

**Non-goals for v0.1:** meshing from CAD, contact, multiple steps with changing boundaries, a server backend.

## Repository layout

| Path | Content |
| --- | --- |
| `app/` | The web app (TypeScript, Vite) |
| `python/felupe_studio/` | Python package: command list → FElupe script (runs in Pyodide and CPython) |
| `tests/` | Python tests |
| `docs/adr/` | Architecture decision records |
| `docs/` | Commands, benchmarks and the [release checklist](docs/release.md) |

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
pip install -e ".[test]"
pytest
ruff check . && ruff format --check .
```

## License

felupe-studio is licensed under GPL-3.0-or-later, the same license as [FElupe](https://github.com/adtzlr/felupe).
