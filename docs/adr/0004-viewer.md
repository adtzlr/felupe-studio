# 0004 Viewer source

Status: Accepted

## Context

FElupe ships a dependency-free WebGL2 viewer (`felupe/view/_backends/_webgl/viewer.js`, plot backend `"webgl"`). The GUI needs the same rendering in its viewport.

## Decision

- A pinned copy of `viewer.js` lives in `app/src/vendor/felupe-viewer/` with a README naming the FElupe version and commit it was taken from.
- The app uses it only through a small `Viewer` adapter (set mesh, cell colors, point markers, arrows, camera presets).

## Consequences

- The copy keeps FElupe's license header (GPL-3.0-or-later, same as felupe-studio, see [0001](0001-license.md)).
- Updating the viewer means replacing the copy and adjusting the adapter.
- Later, the viewer may move to an ES module in the FElupe repository; only the adapter changes then.

## Alternatives

- Loading the JS from the FElupe wheel in Pyodide's file system: the viewer would only be available after Pyodide has loaded.
- A shared ES module right away: needs a stable viewer API first.
