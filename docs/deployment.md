# Your own deployment

FElupe Studio can run under your own name, e.g. at an institute or a company: with your logo and your links, with the samples of your group, on your own GitLab or GitHub Pages, and also on an intranet without internet access. This is a **brand** ([ADR 0020](adr/0020-brands.md)): a folder with a `brand.json`, which a release of felupe-studio is built with. The repository of a brand holds only this folder and a CI file. It is no fork, so it follows the releases of FElupe Studio with a change of one line.

| You want | Use |
| --- | --- |
| The app as it is | <https://adtzlr.github.io/felupe-studio/>, or `felupe-studio serve` with the Python of your computer ([user guide](guide.md#python-on-your-computer)) |
| FElupe Studio with other samples, e.g. private ones | a build with `SAMPLES_DIR` ([below](#other-samples-in-a-build-of-felupe-studio)) |
| The app under your name, with your samples, also without internet access | a [brand](#a-brand) |
| The app of your brand with the Python of the computers of your users | the [wheel of the brand](#the-wheel-of-a-brand) |

A brand changes the app, not the models: projects open in every brand and in FElupe Studio, and the generated scripts are those of FElupe.

## A folder of samples

The samples of a build are one folder. Every sample is a folder that describes itself, and the prefix of its name gives the order:

```text
samples/
├── 01_rubber-pad/
│   ├── model.felupe.json
│   ├── sample.json       (optional)
│   └── thumbnail.svg     (optional)
└── 02_bar/
    ├── model.felupe.json
    ├── sample.json
    └── bar.vtu
```

- **The id** of a sample is the name of its folder without the prefix of digits and `_`: `02_bar` is the sample `bar`. A new order changes the prefixes, not the ids, which the archives (`<id>.felupe.zip`) and the MCP server use. Two folders with the same id are an error. Folders whose names start with `.` or `_` are left out.
- **`model.felupe.json`** is the project of the sample. Make it in the app: build the model, save it with *File ▸ Save project as…* as a project archive (`.felupe.zip`, with its mesh files and scripts), unpack it into the folder of the sample and name the project file `model.felupe.json`.
- **`sample.json`** has the `title`, the `description` and the `topics` of the sample, each optional; without a title, the title comes from the id (`seal-ring` → *Seal ring*). Other keys are errors:

  ```json
  {
    "title": "Rubber pad in compression",
    "description": "A pad of 40 × 40 × 10 mm, pressed by 3 mm between its fixed base and its guided top.",
    "topics": ["mesh tools", "u-p-J", "force-displacement curve"]
  }
  ```

- **The files** of a sample are those of its project (`mesh.import`, `mesh.script`), and they must be in its folder. A mesh script of a sample runs when the sample opens, in Pyodide in the browser; with `felupe-studio serve`, the app shows the script first, since it runs with the rights of the user.
- **`thumbnail.svg`** is the picture of the sample, 160 × 100; without it, the sample shows a neutral placeholder. `python app/scripts/make_thumbnails.py <folder of samples>` in a clone of felupe-studio makes the pictures of all samples of a folder from their projects, like those of FElupe Studio.

The build copies the files of the samples to `samples/<folder>/` of the app and writes their list `samples/index.json`, which the app loads when it starts. A folder that breaks the rules fails the build with a message that starts with *The samples of &lt;folder&gt;:*, e.g. *the sample 'seal-ring' has no file 'ring.vtu'.* A folder without samples gives an app without samples: the welcome panel has none and *File ▸ Samples…* is gone.

The samples are a part of the deployed app: deploy private samples privately. The Pages of a private repository may be public; use the access control of your Pages.

### Other samples in a build of FElupe Studio

`SAMPLES_DIR` builds FElupe Studio itself with another folder of samples instead of its own, e.g. with private ones, without a brand and without a change of the repository. To keep some of the samples of FElupe Studio, copy their folders from `app/samples`.

```bash
cd app && npm ci && SAMPLES_DIR=~/my-samples npm run build   # or npm run dev
```

The MCP server reads the same layout from `FELUPE_STUDIO_SAMPLES` ([AI agents](agents.md)). A brand gives its folder in its `brand.json` instead; `SAMPLES_DIR` beside a brand is an error.

## A brand

### The repository of a brand

```text
my-brand/
├── .gitlab-ci.yml          a copy of brands/gitlab-ci.yml (or .github/workflows/brand.yml)
└── brand/
    ├── brand.json
    ├── logo.svg
    ├── icon-192.png
    ├── icon-512.png
    └── samples/
        ├── 01_<id>/
        └── 02_<id>/
```

The CI files take the brand folder `brand/`. If `brand.json` is in another folder, set `BRAND_FOLDER` in the CI file to that folder, relative to the root of the repository: e.g. `BRAND_FOLDER: my-brand` for `my-brand/brand.json`, or `BRAND_FOLDER: "."` if `brand.json` is at the root. A folder without `brand.json` fails the build with *failed to load config from vite.config.ts* and the message of the brand, which names the folder it searched: *The brand of /builds/…/brand: it has no brand.json.*

Start from a copy of the example brand [`brands/example`](../brands/example) of the release: it has a logo, icons, two samples of its own and a self-hosted Pyodide, and CI of FElupe Studio builds and checks it at every change.

1. Copy `brands/example` to `brand/` and change its `brand.json` (below).
2. Replace `logo.svg`, and make the icons from it in a clone of felupe-studio: `python app/scripts/make_icons.py <brand folder>` (with Playwright and Chromium; `CHROME` for another Chrome).
3. Replace the samples with yours ([a folder of samples](#a-folder-of-samples)), or remove `samples` from `brand.json` for an app without samples.
4. Copy the CI file ([below](#ci-gitlab-and-github)) and set the release of felupe-studio.

### brand.json

```json
{
  "brand_version": 1,
  "name": "Example Lab FEM",
  "short_name": "Example Lab",
  "logo": "logo.svg",
  "icons": { "192": "icon-192.png", "512": "icon-512.png" },
  "storage": "example-lab",
  "accent": "#f08c3a",
  "welcome": "Simulate the rubber parts of the lab.",
  "links": {
    "help": "https://fem.example.org/help",
    "issues": "mailto:fem@example.org",
    "source": "https://gitlab.example.org/fem/brand"
  },
  "samples": "samples",
  "pyodide": "self-hosted",
  "defaults": { "units": { "length": "mm", "force": "N" } }
}
```

| Field | | |
| --- | --- | --- |
| `brand_version` | required | `1`, the version of this format. A release that changes it in a way that is not additive raises it, and the build says what to change. |
| `name` | required | The name of the app: the title of the page, the header, the welcome panel, *Help ▸ About* and the texts of the app. |
| `short_name` | required | The name below the icon of an installed app. |
| `logo` | required | An SVG file of the brand folder: the header, the favicon and the manifest. |
| `icons` | | PNG files of 192 × 192 and 512 × 512 px for an installed app and the home screen of a phone; without them, the manifest has the logo only. |
| `storage` | required | The prefix of the browser storage of the app ([below](#the-storage-of-a-brand)): lowercase letters, digits, `.`, `_` and `-`. |
| `accent` | | The accent color, `#rrggbb`, e.g. of buttons and selections; without it, that of FElupe Studio. |
| `welcome` | | The text below the title of the welcome panel. |
| `links.help` | required | *Help ▸ User guide* and the welcome panel. |
| `links.documentation` | | *Help ▸ Command reference*; without it, no item. |
| `links.tutorial` | | The tutorial of the welcome panel; without it, no link. |
| `links.issues` | required | *Help ▸ Report an issue*, a web page or a `mailto:` address. |
| `links.source` | required | *Help ▸ About ▸ Source code*: the repository of the brand. The GPL asks for the source of the deployed version, which is the release of felupe-studio and the brand folder. |
| `samples` | | The folder of the samples, relative to the brand folder; without it, the brand has no samples. |
| `pyodide` | | `cdn` (the default) or `self-hosted` ([below](#pyodide-cdn-or-self-hosted)). |
| `defaults.units` | | The units of a new model (`mm` or `m`, `N` or `kN`). |

A brand inherits no identity of FElupe Studio: the name, the short name, the logo, the storage prefix and the links of help, issues and source have no defaults, so a missing link never sends the questions of your users to FElupe Studio. An invalid `brand.json` fails the build with a message that starts with *The brand of &lt;folder&gt;:*, e.g. *brand.json is invalid: /links: must have required property 'source'.*

The build checks `brand.json` with the schema of the release it builds, `app/src/vite/brand.schema.json`, also in `npm run dev`; the app and the build load no schema from elsewhere. For help in an editor while you write the file, `$schema` may point to that schema in your clone of felupe-studio at the release, e.g. `"$schema": "../../felupe-studio/app/src/vite/brand.schema.json"` when the clone is next to the repository of the brand. Only the editor reads it, it works without internet access, and it follows the release of the clone. A URL, e.g. of GitHub, is no good choice: an editor without internet access cannot load it, one with internet access asks a third-party host for the file, and the URL has to follow every new release.

### The storage of a brand

The app keeps its settings in the browser, the open model in IndexedDB, the compiled Python modules and, with its service worker, Pyodide and the wheels. All of these names start with `storage`: the keys `<storage>.<name>`, the session `<storage>`, the bytecode cache `/<storage>-pycache` and the cache `<storage>-runtime-v1`. So two brands on one origin keep their data apart, e.g. two folders of the Pages of one GitLab group, and none of them sees the models of FElupe Studio (`felupe-studio`).

Choose the prefix once: with another prefix, the users of the brand start again with the default settings and without their open model.

### Pyodide: CDN or self-hosted

The app runs Python in the browser with Pyodide, about 30 MB with NumPy and SciPy, which the browser keeps for the next visits.

- **`cdn`** (the default): Pyodide comes from `cdn.jsdelivr.net`, like for FElupe Studio. The deployment stays small. Keep it wherever the browsers of your users reach the CDN.
- **`self-hosted`**: the build copies Pyodide into `pyodide/v<version>/` of the app: the core of the npm package `pyodide`, which felupe-studio pins, and NumPy, SciPy and rich, downloaded from `cdn.jsdelivr.net` and checked against the SHA-256 of `pyodide-lock.json`. The app then loads nothing from another host, for an intranet without internet access or a policy against third-party hosts. Only the build needs internet access. Behind a proxy, Node needs `NODE_USE_ENV_PROXY=1` to use `HTTPS_PROXY`; the message of a failed download says so.

The files of FElupe, meshio and tensortrax are always served by the app itself. The users of either way download the same files once.

### Try a brand

In a clone of felupe-studio at the release of the brand:

```bash
cd app && npm ci && BRAND_DIR=~/my-brand/brand npm run dev   # or npm run build
```

`npm run dev` serves the app of the brand at <http://localhost:5173/>, with its samples and, if self-hosted, its Pyodide; `npm run build` writes it to `app/dist`.

### CI: GitLab and GitHub

The CI files of `brands/` build a release of felupe-studio with the brand folder `brand/` of the repository (or that of `BRAND_FOLDER`, see [the repository of a brand](#the-repository-of-a-brand)):

- **every pipeline** builds the app, so an invalid brand or sample fails there with the message of the build;
- **the default branch** deploys the app to the Pages of the repository. The app has a relative base, so it runs in any folder of a site;
- **a tag** also builds the [wheel of the brand](#the-wheel-of-a-brand), checks it in a fresh environment and keeps it as a file of the pipeline.

**GitLab:** copy [`brands/gitlab-ci.yml`](../brands/gitlab-ci.yml) to `.gitlab-ci.yml`. The jobs need `github.com` (the release of felupe-studio), the npm registry, PyPI (the wheel) and, for a self-hosted Pyodide, `cdn.jsdelivr.net`. On a GitLab without access to `github.com`, mirror the repository of felupe-studio and set `FELUPE_STUDIO` to the URL of the mirror; registries of npm and PyPI are set for the runner, e.g. with `NPM_CONFIG_REGISTRY` and `PIP_INDEX_URL`.

**GitHub:** copy [`brands/github-actions.yml`](../brands/github-actions.yml) to `.github/workflows/brand.yml`, and set *Settings ▸ Pages ▸ Source* to *GitHub Actions*.

Both files set the release in one line, `FELUPE_STUDIO_VERSION: "0.8.0"`. **A new release** of FElupe Studio is a change of this line: read its [changelog](../CHANGELOG.md) first, and try the brand with it. Projects saved with a newer release open in an older one only if they use nothing new; the older app then says that the project may be of a newer version.

### What stays FElupe Studio

These are the same in every brand, so that a model and a script can be traced to their origin:

- *Help ▸ About* says *Based on FElupe Studio &lt;version&gt;*, with the link to FElupe Studio and its license, GPL-3.0-or-later;
- the header of a generated script, *FElupe script generated by FElupe Studio &lt;version&gt;*;
- the Python package `felupe-studio`, its CLI and its MCP server, with their names and texts;
- the commands, the project files and the materials: a brand has no commands of its own.

## The wheel of a brand

The wheel of a brand is the Python package `felupe-studio` with the app and the samples of the brand, for `felupe-studio serve` on the computers of your users: the app of the brand with their Python instead of Pyodide, e.g. for large models and mesh scripts with their own packages ([user guide](guide.md#python-on-your-computer)). The CI files build it at a tag; it has no Pyodide, since `serve` runs CPython.

Give your users the file, e.g. as a download of the pipeline, and they install it with its extras:

```bash
pip install "felupe_studio-0.8.0-py3-none-any.whl[serve,mcp]"
felupe-studio serve
```

It keeps the version of the release of felupe-studio, and *Help ▸ About* names the brand. Its dependencies come from PyPI, or from the index that pip is set to. A package index of a brand is not planned: `pip install -U felupe-studio` replaces the wheel of the brand with the package of FElupe Studio from PyPI, so install a new wheel of the brand from its file.

## Agents and the MCP server

- **On the Pages of a brand,** the app has no agent bridge: an agent connects to `felupe-studio serve --agent` on the computer of the user, and a page on the web cannot reach it.
- **With the wheel of the brand,** `felupe-studio serve --agent` serves the app of the brand, and an agent works on the model that is open in it, like with FElupe Studio ([AI agents](agents.md#the-open-app-felupe-studio-serve---agent)).
- **The MCP server** `felupe-studio-mcp` of the wheel offers the samples of the brand, or those of a folder of `FELUPE_STUDIO_SAMPLES`. Its name, its tools and its texts stay those of FElupe Studio.
- There is no hosted MCP server for the users of a brand: it would run the mesh scripts of foreign projects with the rights of the server.

## Without internet access

| Part | Needs | Without internet access |
| --- | --- | --- |
| The deployed app | Pyodide | `"pyodide": "self-hosted"` |
| The build (CI) | the release of felupe-studio, npm, `cdn.jsdelivr.net` for a self-hosted Pyodide | a mirror of felupe-studio (`FELUPE_STUDIO`) and of npm; the packages of a self-hosted Pyodide still come from `cdn.jsdelivr.net` |
| The wheel | PyPI for its dependencies | an index that mirrors PyPI (`PIP_INDEX_URL`) |
| `felupe-studio serve` | nothing | runs on `127.0.0.1` |
