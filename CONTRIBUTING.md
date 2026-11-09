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

## License

By contributing, you agree that your contributions are licensed under GPL-3.0-or-later.
