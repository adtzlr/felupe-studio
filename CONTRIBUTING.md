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

## License

By contributing, you agree that your contributions are licensed under GPL-3.0-or-later.
