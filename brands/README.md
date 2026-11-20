# Brands

A brand is a deployment of FElupe Studio under its own name, e.g. by an institute or a company on its own GitLab ([ADR 0020](../docs/adr/0020-brands.md)). [Your own deployment](../docs/deployment.md) describes how to make one: the repository of a brand, its `brand.json`, its samples, Pyodide, the CI files and the wheel of a brand.

This folder has:

- [`example/`](example): the example brand to start from, with a name, a logo, icons and two samples of its own, and Pyodide served with the app (`"pyodide": "self-hosted"`). CI builds it at every change and checks it in a browser without internet access and its wheel.
- [`gitlab-ci.yml`](gitlab-ci.yml): the CI file of a brand on GitLab, deployed to its Pages. Copy it to `.gitlab-ci.yml` of the repository of the brand.
- [`github-actions.yml`](github-actions.yml): the workflow of a brand on GitHub, deployed to GitHub Pages. Copy it to `.github/workflows/brand.yml`.

Both CI files build the release `FELUPE_STUDIO_VERSION` of felupe-studio with the brand folder `brand/` of the repository.
