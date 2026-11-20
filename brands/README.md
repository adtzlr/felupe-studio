# Brands

A brand is a deployment of FElupe Studio under its own name, e.g. by an institute or a company on its own GitLab (#321, [ADR 0020](../docs/adr/0020-brands.md)). It is a folder with a `brand.json`, which a release of felupe-studio is built with; the repository of a brand holds only this folder and a CI file, no fork.

This folder has:

- [`example/`](example): the example brand, with a name, a logo, icons and two samples of its own, and Pyodide served with the app (`"pyodide": "self-hosted"`). CI builds it at every change and checks it in a browser without internet access (`tests/e2e/test_example_brand.py`), and its wheel (`tests/check_wheel.py brands/example`).
- [`gitlab-ci.yml`](gitlab-ci.yml): the CI file of a brand on GitLab, deployed to its Pages.
- [`github-actions.yml`](github-actions.yml): the workflow of a brand on GitHub, deployed to GitHub Pages.

## The repository of a brand

```text
my-brand/
├── .gitlab-ci.yml        # brands/gitlab-ci.yml (or .github/workflows/brand.yml)
└── brand/
    ├── brand.json
    ├── logo.svg
    ├── icon-192.png
    ├── icon-512.png
    └── samples/
        ├── 01_<id>/      # model.felupe.json, sample.json, thumbnail.svg, mesh files
        └── 02_<id>/
```

1. Copy `brands/example` of the release to `brand/` and change its `brand.json`: the name, the short name, the storage prefix and the links of help, issues and source are required, so a brand inherits no identity of FElupe Studio. Point `$schema` to the schema of the release, e.g. `https://raw.githubusercontent.com/adtzlr/felupe-studio/v0.8.0/app/src/vite/brand.schema.json`. The fields are described in [CONTRIBUTING.md](../CONTRIBUTING.md#brands).
2. Replace the logo, and make the icons from it in a clone of felupe-studio: `python app/scripts/make_icons.py <brand folder>`.
3. Put the samples of the brand into `brand/samples/`, one folder per sample (see [CONTRIBUTING.md](../CONTRIBUTING.md#samples)); without a `samples` in `brand.json`, the brand has none. To keep a sample of FElupe Studio, copy its folder from `app/samples`.
4. Copy the CI file and set `FELUPE_STUDIO_VERSION` to the release of felupe-studio. A new release is one change of this line.

To try a brand before it is pushed, build it in a clone of felupe-studio: `cd app && npm ci && BRAND_DIR=<brand folder> npm run dev` (or `npm run build`). An invalid brand fails with a message that starts with *The brand of &lt;folder&gt;:*.

## The wheel of a brand

The CI files build the wheel of the brand at a tag: the Python package `felupe-studio` with the app and the samples of the brand, for `felupe-studio serve` on the computer of a user, also with `--agent`. It is installed from its file, e.g. `pip install "felupe_studio-0.8.0-py3-none-any.whl[serve,mcp]"`; it keeps the version of the release of felupe-studio, and *Help ▸ About* names the brand. `pip install -U felupe-studio` replaces it with the package of FElupe Studio from PyPI.
