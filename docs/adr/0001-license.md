# 0001 License

Status: Accepted

## Context

felupe-studio is a GUI for FElupe. FElupe is licensed under GPL-3.0-or-later and is loaded at runtime (Pyodide). The GUI should be easy to reuse and embed.

## Decision

felupe-studio is licensed under the MIT license.

## Consequences

- The GUI does not copy FElupe's Python code; it generates scripts that import FElupe at runtime.
- Files copied from FElupe (see [0004](0004-viewer.md)) need an explicit MIT grant by their copyright holder before they are added, and must not contain contributions by others under GPL only.
- A deployed build that bundles the FElupe wheel distributes FElupe under its own license (GPL-3.0-or-later); its source and license are referenced in the app.

## Alternatives

- GPL-3.0-or-later, consistent with FElupe: rejected, the GUI should be usable in more contexts.
