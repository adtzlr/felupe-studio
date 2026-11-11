# 0007 Project archives

Status: Accepted

## Context

A project file (`*.felupe.json`) references its mesh files by name; their content lives next to it. To open a project on another computer, or from an e-mail, the project file and all of its mesh files have to be passed on and opened together every time. The samples solve this for themselves with a folder per sample; a user's project has nothing alike.

## Decision

A **project archive** is one file `<name>.felupe.zip`: a plain ZIP file that any tool can open.

- At its root are the project file `<name>.felupe.json` (unchanged, with its schema version as usual) and the mesh files under the names of their `mesh.import` (`file`).
- Optionally it holds the FElupe script `<name>.py`. The script reads the mesh files from the working directory, so the unpacked folder runs as is with `python <name>.py`.
- No results and no manifest: the project file is the manifest, and the results are solved again.
- The same project gives the same bytes: all entries have the time 1980-01-01 00:00 (the earliest of ZIP), the project file is followed by the script and the mesh files sorted by name, and every entry is compressed with deflate (level 6).
- Reading accepts what users zip themselves: one top-level folder of all entries is stripped, folders, hidden files (`.DS_Store`) and `__MACOSX/` are skipped. Absolute paths, `..` and more than one project file are errors. An archive without a project file gives its files as mesh files to import. Files that the project does not use are reported, not opened.

The module `app/src/core/archive.ts` (`writeArchive()`, `readArchive()`) is loaded on demand, like the project module. It uses [fflate](https://github.com/101arrowz/fflate) (MIT, no dependencies) for ZIP: zip and unzip with the module are 14 kB minified, 7 kB gzipped, in a chunk of their own. Archives of Info-ZIP (`zip -r`), of Python's `zipfile` (stored entries, data descriptors of streamed entries, ZIP64) and of the app read the same.

## Consequences

- A project can be passed on and opened in one step (#149), and saved as one (#150). The project file stays the format for version control: text that diffs well.
- The ZIP is built and read on the main thread (`zipSync`, `unzipSync`). For very large meshes (tens of MB) this blocks the page for a moment; fflate's asynchronous `zip`/`unzip` with workers can replace it without changing the format.
- Names of mesh files with characters outside of ASCII are stored in UTF-8 (with the flag of the ZIP format), which current tools read.

## Alternatives

- **An own ZIP container** with `CompressionStream("deflate-raw")`: about 200 lines plus CRC-32 without a dependency, but reading archives of other tools needs data descriptors, ZIP64 and stored entries, which fflate has tested.
- **A JSON file with the mesh files in base64:** one format less, but 33 % larger, not compressed and not opened by other tools; the unpacked project would not run with `python`.
- **A manifest** (e.g. `manifest.json` with versions and checksums): duplicates the project file, which already names its mesh files and has a schema version.
