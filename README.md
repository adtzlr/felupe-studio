# felupe-studio

A clickable GUI for [FElupe](https://github.com/adtzlr/felupe) that runs entirely in the browser.

Every node in the GUI is a FElupe object. Every action is a command; the command list is saved as a text-diffable project file and turned into a readable FElupe script, which runs in the browser with [Pyodide](https://pyodide.org) and can be exported.

Work in progress, see the [roadmap](https://github.com/adtzlr/felupe-studio/issues/1) and the [architecture decision records](docs/adr/).

**Non-goals for v0.1:** meshing from CAD, contact, multiple steps with changing boundaries, a server backend.

## Repository layout

| Path | Content |
| --- | --- |
| `app/` | The web app (TypeScript, Vite) |
| `python/felupe_studio/` | Python package: command list → FElupe script (runs in Pyodide and CPython) |
| `tests/` | Python tests |
| `docs/adr/` | Architecture decision records |

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

felupe-studio is licensed under the MIT license. [FElupe](https://github.com/adtzlr/felupe), which is loaded at runtime, is licensed under GPL-3.0-or-later.
