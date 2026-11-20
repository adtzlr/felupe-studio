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

A build of the app has a brand (ADR 0020): a folder with a `brand.json`, given with `BRAND_DIR`; without it, the build takes the default brand `app/brand/`, which is FElupe Studio itself. [Your own deployment](docs/deployment.md) describes the fields of `brand.json`, the samples, Pyodide, the CI files and the wheel of a brand for those who deploy one; this section is about the code.

```bash
cd app && BRAND_DIR=~/my-brand npm run build   # or npm run dev
```

- `app/src/vite/brand.ts` reads a brand, checks it with `app/src/vite/brand.schema.json` (an invalid brand fails the build with a message that starts with *The brand of &lt;folder&gt;:*) and writes it into the build: the logo and the icons to `brand/`, `manifest.webmanifest`, and in `index.html` the title, the favicon, the links of the manifest and of the icon for the home screen, the theme color, the accent color and the brand as a JSON block (`<script type="application/json" id="brand">`).
- `app/src/brand.ts` reads this block in the app. The name and the links (`app/src/app.ts`) come from it, and so do the names of the browser storage: new keys of `localStorage` or `sessionStorage` use `storageKey()`. The identity of FElupe Studio is no brand: the *based on* of *Help ▸ About*, the license, the header of the generated script and the Python package stay constants of the code.
- `app/src/pyodide.ts` gives the URL of Pyodide (the CDN or `pyodide/v<version>/` of the app), and `app/src/vite/pyodide.ts` copies a self-hosted Pyodide into the build; `public/sw.js` caches both.
- The default brand keeps the names of FElupe Studio before brands (`felupe-studio.*`, `/pycache`), which `app/src/storage.test.ts` checks; `app/src/ui/Brand.test.tsx` checks the app of another brand. `python app/scripts/make_icons.py <brand folder>` makes the icons of a brand from its logo.
- `brands/` has the example brand and the CI files of a brand ([brands/README.md](brands/README.md)). The job *Example brand* of CI builds `brands/example` like them, opens it in Chromium without internet access (`tests/e2e/test_example_brand.py`) and checks its wheel (`tests/check_wheel.py brands/example`). Locally: `cd app && BRAND_DIR=../brands/example npm run build -- --outDir dist-example`, then `BRAND_DIST=app/dist-example pytest -m e2e tests/e2e/test_example_brand.py`.

## Samples

The samples of FElupe Studio are the folder `app/samples` (#350): a folder per sample that describes itself, `NN_<id>/` with `model.felupe.json`, `sample.json`, `thumbnail.svg` and its mesh files. [A folder of samples](docs/deployment.md#a-folder-of-samples) describes the rules, and `SAMPLES_DIR` for a build with other samples.

- `app/scripts/make_samples.py` makes the samples of FElupe Studio (units: mm, N, MPa), also their `sample.json` and their pictures; run it from the repository root after a change and commit the files. `tests/test_samples.py` solves every sample and checks its picture. `app/scripts/make_thumbnails.py <folder of samples>` makes the pictures of another folder, e.g. of a brand.
- The rules of a folder are those of `felupe_studio.samples` (the MCP server, `felupe-studio serve`, the wheel) and of `app/src/vite/samples.ts` (the build), tested with the shared cases `tests/data/sample_folder_cases.json`.
- The build copies the files of the samples to `samples/<folder>/` of `dist` and writes their list `samples/index.json`, which the app loads when it starts; the development server serves both. The wheel takes the samples of the build (`hatch_build.py`), and `felupe-studio serve` makes their list from the folder.

## License

By contributing, you agree that your contributions are licensed under GPL-3.0-or-later.
