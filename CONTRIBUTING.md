# Contributing

Thanks for your interest in felupe-studio!

## Workflow

- Every change starts from an issue. Pick one from the [roadmap](https://github.com/adtzlr/felupe-studio/issues/1) or open a new one.
- Keep pull requests small and self-contained: one issue, one topic. Large features are split into several PRs.
- Decisions that shape the architecture get an [architecture decision record](docs/adr/).
- Wording follows FElupe: a mesh has points, cells and a cell type; a region applies a quadrature scheme to a finite element, mapped to the cells.

## Checks

Before opening a pull request, run:

```bash
cd app && npm run lint && npm test && npm run build
cd .. && ruff check . && ruff format --check . && pytest
```

## Complexity

The linters limit the complexity of a function, so that each function stays small enough to read and to test on its own:

| | Complexity | Lines |
|---|---|---|
| Python (`ruff`, C901) | 15 | |
| App (`eslint`): core, worker, viewer, agent | 20 | 150 |
| App (`eslint`): components and hooks in `src/ui` | 30 (warning) | 250 (warning) |

Lines count without blank lines and comments; tests are not limited. ESLint counts more branches than ruff (`?.`, `??`, `&&` and default values), hence its higher limit. A component counts its callbacks and its markup, so the limits of `src/ui` are higher and only warnings: a warning is a candidate to split, not a blocker.

Above a limit, split the function: commonly a registry by command type or by type of input instead of a long `switch`, or helpers for the branches of a walk. If a function cannot be split sensibly, say why where the check is disabled, e.g. the tools of a server as its nested functions:

```python
# the tools of the server are its nested functions, each of them small (#313)
def server(session=None):  # noqa: C901
```

```ts
// eslint-disable-next-line max-lines-per-function -- the tools are its nested handlers
```

## Golden tests

`tests/golden` holds complete cases: a command list, its mesh files, the expected generated script and the expected force-displacement curves. CI runs every case with FElupe and compares both. If a change of the generated script or of the results is intended, update the references and review the diff in the PR:

```bash
pytest tests/golden --update-golden
```

A new case is a new folder with a `commands.json` and its mesh files; run the command above once to create `script.py` and `results.json`. A case that is compared with a converged reference (an analytical solution or `fem.ViewMaterialIncompressible`) sets FElupe's tight tolerance `"tol": 1.49e-8` at its job; the others use the default of the app, 0.01.

## Brands

A build of the app has a brand (ADR 0020): a folder with a `brand.json`, given with `BRAND_DIR`. Without it, the build takes the default brand `app/brand/`, which is FElupe Studio itself.

```bash
cd app && BRAND_DIR=~/my-brand npm run build   # or npm run dev
```

```json
{
  "$schema": "https://raw.githubusercontent.com/adtzlr/felupe-studio/main/app/src/vite/brand.schema.json",
  "brand_version": 1,
  "name": "ACME FEM",
  "short_name": "ACME",
  "logo": "logo.svg",
  "icons": { "192": "icon-192.png", "512": "icon-512.png" },
  "storage": "acme-fem",
  "accent": "#e8590c",
  "welcome": "Simulate the rubber parts of ACME.",
  "links": {
    "help": "https://fem.acme.example/help",
    "issues": "mailto:fem@acme.example",
    "source": "https://gitlab.acme.example/fem/brand"
  },
  "samples": "samples",
  "pyodide": "self-hosted",
  "defaults": { "units": { "length": "mm", "force": "N" } }
}
```

- `name`, `short_name`, `logo`, `storage` and the links `help`, `issues` and `source` are required: a brand inherits no identity of FElupe Studio. `documentation` (*Help ▸ Command reference*) and `tutorial` (the welcome panel) are optional.
- `logo` is an SVG file of the brand folder: the header, the favicon and the manifest of an installed app. `icons` are PNG files of 192 × 192 and 512 × 512 px for an installed app; without them, the manifest has the logo only. `python app/scripts/make_icons.py <brand folder>` makes them from the logo, on the color of the bar of the app (with Playwright and Chromium, `CHROME` for another one).
- `storage` is the prefix of the browser storage of the app (lowercase letters, digits, `.`, `_` and `-`): the keys `<storage>.<name>` of `localStorage` and `sessionStorage`, the session `<storage>` in IndexedDB, the bytecode cache `/<storage>-pycache` and the cache `<storage>-runtime-v1` of the service worker. So two brands on one origin keep their data apart, e.g. two folders of the Pages of one GitLab group. `felupe-studio` is the prefix of FElupe Studio, with the names of today (and its bytecode cache `/pycache`).
- `accent` is the accent color of the app; without it, that of FElupe Studio. `welcome` is the text below the title of the welcome panel.
- `samples` is the folder of the samples of the brand, relative to the brand folder (see *Samples*); without it, the brand has no samples. `SAMPLES_DIR` beside `BRAND_DIR` is an error, so the brand folder is the whole configuration of a deployment.
- `pyodide` is where the app loads Pyodide from: `cdn` (`cdn.jsdelivr.net`, the default) or `self-hosted`, for a deployment without internet access or without third-party hosts. With `self-hosted`, the build copies Pyodide into `pyodide/v<version>/` of the app (about 30 MB): the core of the npm package `pyodide`, which `package.json` pins, and the packages that the worker loads (NumPy, SciPy, rich and their dependencies in `pyodide-lock.json`). It downloads the packages once into `app/node_modules/.cache/pyodide` and checks them against the SHA-256 of the lock file, so only the build needs internet access; behind a proxy, Node needs `NODE_USE_ENV_PROXY=1` for `HTTPS_PROXY`. The service worker caches a self-hosted Pyodide like that of the CDN. Where the CDN is reachable, keep it: the browser of a user loads the same files either way, and the deployment stays small. The wheel leaves a self-hosted Pyodide out, since `serve` runs CPython.
- `defaults.units` are the units of the model settings of a new model.
- The schema `app/src/vite/brand.schema.json` checks the file, and an invalid brand fails the build with a message that starts with *The brand of &lt;folder&gt;:*.
- The build copies the logo and the icons to `brand/`, writes `manifest.webmanifest` (the names, the icons, the colors of the app) and writes the brand into `index.html`: the title, the favicon, the links of the manifest and of the icon for the home screen, the theme color, the accent color and a JSON block (`<script type="application/json" id="brand">`), which the app reads (`app/src/brand.ts`). *Help ▸ About* of a brand says that it is based on FElupe Studio and its version, with the license of FElupe Studio and the source of the brand.

## Samples

The samples are a folder of samples, `app/samples` (#350). Every sample is a folder that describes itself, and the prefix of its name gives the order:

```
samples/
  01_two-materials/
    model.felupe.json
    sample.json         (optional)
    thumbnail.svg       (optional)
    bar.vtu
  02_material-test/
    ...
```

- **The id** of a sample is the name of its folder without the prefix of digits and `_`: `14_engine-mount` is the sample `engine-mount`. A new order changes the prefixes, not the ids, which the archives (`<id>.felupe.zip`), the MCP server and the tests use. Two folders with the same id are an error. Folders whose names start with `.` or `_` are left out.
- **`sample.json`** has the `title`, the `description` and the `topics` of the sample, each optional; without a title, the title comes from the id (`seal-ring` → *Seal ring*). Other keys are errors.
- **The files** of a sample are those of its project file (`mesh.import`, `mesh.script`), and they must be in its folder. A sample without `thumbnail.svg` shows a neutral placeholder.
- The upstream samples are made by `app/scripts/make_samples.py` (units: mm, N, MPa), also their `sample.json` and their pictures; run it from the repository root after a change and commit the files.

**Other samples in a build:** `SAMPLES_DIR` builds the app of the default brand with another folder of samples instead of `app/samples` (a brand gives its folder in its `brand.json`), e.g. with private ones, without changing the repository:

```bash
cd app && SAMPLES_DIR=~/my-samples npm run build   # or npm run dev
```

The folder has the layout above. To keep some of the upstream samples, copy their folders into it. The build copies the files of the samples to `samples/<folder>/` of `dist` and writes their list `samples/index.json`, which the app loads when it starts; the development server serves both. The wheel takes the samples of the build, so `felupe-studio serve` of it shows them too, with their list made from the folder. A folder that breaks the rules fails the build with a message that starts with *The samples of &lt;folder&gt;:*, e.g. *the sample 'seal-ring' has no file 'ring.vtu'.* A folder without samples gives an app without samples: the welcome panel has none and *File ▸ Samples…* is gone. The MCP server reads the same layout from `FELUPE_STUDIO_SAMPLES` (`docs/agents.md`); the rules are those of `felupe_studio.samples` and `app/src/vite/samples.ts`, tested with the shared cases `tests/data/sample_folder_cases.json`.

The samples are part of the build output: deploy a private build privately. The GitHub Pages of a private repository are public unless access control is used.

## License

By contributing, you agree that your contributions are licensed under GPL-3.0-or-later.
