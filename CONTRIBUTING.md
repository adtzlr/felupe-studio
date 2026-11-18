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

## Golden tests

`tests/golden` holds complete cases: a command list, its mesh files, the expected generated script and the expected force-displacement curves. CI runs every case with FElupe and compares both. If a change of the generated script or of the results is intended, update the references and review the diff in the PR:

```bash
pytest tests/golden --update-golden
```

A new case is a new folder with a `commands.json` and its mesh files; run the command above once to create `script.py` and `results.json`. A case that is compared with a converged reference (an analytical solution or `fem.ViewMaterialIncompressible`) sets FElupe's tight tolerance `"tol": 1.49e-8` at its job; the others use the default of the app, 0.01.

## Extra samples in a build

A build can add samples from a folder outside the repository, e.g. private ones, without changing the repository (#255). One command, one folder:

```bash
cd app && EXTRA_SAMPLES_DIR=~/my-samples npm run build   # or npm run dev
```

The folder has the layout of `app/public/samples`: one folder per sample with its project file `model.felupe.json` and its mesh files or mesh scripts, optionally a picture `thumbnail.svg`. Adding a sample means copying its folder there.

```
my-samples/
  samples.json          (optional)
  engine-mount/
    model.felupe.json
    engine_mount.py
    thumbnail.svg       (optional)
  seal-ring/
    model.felupe.json
    ring.vtu
```

- The id of a sample is the name of its folder, its title comes from it (`engine-mount` → *Engine mount*), and its files are those of the project file (`mesh.import`, `mesh.script`).
- An optional `samples.json` has the format of `app/src/core/samples.json` (`id`, `title`, `description`, `topics`; `files` may be left out): better titles, descriptions, topics and the order. Folders without an entry follow the listed ones, sorted by name.
- A sample without `thumbnail.svg` gets a neutral placeholder. The build does not need Python; `thumbnail()` of `app/scripts/make_samples.py` still makes a picture.
- *File ▸ Samples…* and the welcome panel show the extra samples in their own section *More samples*, after the built-in ones. They open like the built-in samples. The build copies them to `samples/<id>/` of `dist`; the development server serves them.
- Errors fail the build with a message that starts with `EXTRA_SAMPLES_DIR:`: the folder does not exist, a sample has no `model.felupe.json` or an invalid one, a mesh file or script is missing, an entry of `samples.json` has no folder, or an id is taken by a built-in sample.
- Without `EXTRA_SAMPLES_DIR` the build is unchanged. The tests check the built-in samples only.
- **Without the built-in samples** (#279): `BUILT_IN_SAMPLES=false` (or `0`, `no`) leaves them out of the build, e.g. for a deployment with only its own samples:

  ```bash
  cd app && BUILT_IN_SAMPLES=false EXTRA_SAMPLES_DIR=~/my-samples npm run build
  ```

  The extra samples are then the samples: the welcome panel and *File ▸ Samples…* show them without the section *More samples*, and an extra sample may take the id of a built-in one. The build leaves out the folders of the built-in samples of `public/samples`, and the development server does not serve them. Without any samples, the welcome panel has no samples and *File ▸ Samples…* is gone. Another value of `BUILT_IN_SAMPLES` fails the build.

The extra samples are part of the build output: deploy a private build privately. The GitHub Pages of a private repository are public unless access control is used.

## License

By contributing, you agree that your contributions are licensed under GPL-3.0-or-later.
