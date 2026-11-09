# 0001 License

Status: Accepted

## Context

felupe-studio is a GUI for FElupe. FElupe is licensed under GPL-3.0-or-later and is loaded at runtime (Pyodide). The GUI reuses code from FElupe, e.g. the WebGL viewer (see [0004](0004-viewer.md)).

## Decision

felupe-studio is licensed under GPL-3.0-or-later, the same license as FElupe.

## Consequences

- Code can move freely between FElupe and felupe-studio (e.g. the viewer, plot helpers) without relicensing.
- A deployed build that bundles FElupe and felupe-studio is distributed under one license; the app links to its source code.
- Contributions are accepted under GPL-3.0-or-later.

## Alternatives

- MIT for the GUI: rejected, every file copied from FElupe would need an extra MIT grant by all of its authors, and the bundled app would still contain GPL code.
