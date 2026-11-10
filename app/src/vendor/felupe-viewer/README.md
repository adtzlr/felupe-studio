# FElupe WebGL viewer (vendored)

`viewer.js` is an unmodified copy of the WebGL2 viewer of the plotting backend `"webgl"` of FElupe ([ADR 0004](../../../../docs/adr/0004-viewer.md)).

| | |
| --- | --- |
| Source | `felupe/view/_backends/_webgl/viewer.js` |
| Version | FElupe 12.0.0 (wheel from PyPI) |
| SHA-256 | `ff8f42523a6d03fe7d3b97432027ae207bd5265c6f76624d5209ad52b6abc1b6` |
| License | GPL-3.0-or-later, like FElupe and FElupe Studio |

The app uses it only through `app/src/viewer/` (the adapter). To update it, replace the file with the one of a newer FElupe version, update this table and check the adapter; `viewer.d.ts` describes the parts of the API the app uses.
