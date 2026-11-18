# 0017 A bytecode cache of Pyodide

Status: Accepted

## Context

Even with the service worker cache (#40), the start of the app on a phone spends 3.6 s in the FElupe step, the largest of the three load steps (#49, `docs/benchmarks.md`). The step loads the wheels of the app and imports FElupe and meshio.

Measured with Pyodide 314.0.7 in Node (container with 2 cores; the same Pyodide, the numpy, scipy and rich packages of its release, and the wheels of the app). The values are medians of three runs, with bytecode of four runs, which read the bytecode of an earlier run from a folder (NODEFS, like the cache below):

| Part of the FElupe step | Time in s | With bytecode |
| --- | ---: | ---: |
| `loadPackage` of the wheels (FElupe, meshio) | 0.11 | 0.11 |
| `import numpy, scipy.sparse.linalg` (the first import of both) | 1.87 | 0.90 |
| `import felupe` | 1.18 | 0.43 |
| `import meshio` (with rich) | 0.66 | 0.33 |
| Fixed modification times of the sources (see below) | | 0.08 |
| **Total** | **3.86** | **1.85** |

Neither the packages of Pyodide nor the wheels of PyPI contain bytecode. Pyodide does not write it either (`sys.dont_write_bytecode`), so every start compiles the sources of about 740 modules again. With their bytecode, the imports take about 55 % less time. Compiling ahead of time with `compileall` costs 4.7 s, because it compiles every module of the packages, not only the imported ones.

Of the 0.43 s of `import felupe` with bytecode, 0.29 s are SciPy modules that FElupe imports at the top but rarely uses: `scipy.interpolate` (with `optimize`, `spatial`, `fft`) and `scipy.special`. Importing them lazily would be an upstream change in FElupe (adtzlr/felupe#1297).

## Decision

- **A persistent cache of the bytecode in the worker:**
  - Mount IDBFS of Emscripten (IndexedDB of the origin) at `/pycache`, with `sys.pycache_prefix = "/pycache/<key>"` and `sys.dont_write_bytecode = False`.
  - Python writes the bytecode of every module it compiles to the cache, and reads it on the next start.
  - This covers numpy, scipy, rich, FElupe, meshio, tensortrax, `felupe_studio` and the modules imported later, e.g. at the first solve.
- **Valid bytecode:** the sources of these packages and of `felupe_studio` get a fixed modification time after they are unpacked or written. The timestamp-based `.pyc` files (modification time and size of the source) are then valid on the next start too.
- **The key** is a hash of the Pyodide version, the URLs of the wheels (with their versions) and the sources of `felupe_studio`. A new version of the app or of a package starts a new cache, and the worker removes the others.
- **When:**
  - The cache is read from IndexedDB (`FS.syncfs(true)`) while NumPy and SciPy load.
  - It is written back (`FS.syncfs(false)`) in the background after *ready*, and after the first job (tensortrax, the SciPy modules of a solve).
  - It never delays the ready message.
- **Optional:** without IndexedDB (private windows, a full quota) or with any error of the cache, the worker starts as today, without a cache. The status bar is unchanged. The spike page lists the parts of the FElupe step (wheels, NumPy and SciPy, FElupe, meshio) and whether the cache was hit, empty or off.
- **Local runtime (ADR 0014):** no change, CPython writes its bytecode as usual.

## Consequences

- From the second start on, the FElupe step should take about half the time. On the phone that is an estimate of 3.6 s → 1.7 s, to be measured before and after with `spike.html` (warm, twice: the first start fills the cache).
- The first start of a version is not faster, and it writes about 15 MB to IndexedDB in the background (measured: 742 files, 15 MB for the imports of the start).
- *Clear site data* of the browser removes the cache with the other site data, as before.
- Tests: the key (versions, sources), the fixed modification times, the fallback without IndexedDB (Vitest with a fake FS); a Playwright check with a local Pyodide that the second load hits the cache.

## Alternatives

- **Wheels with bytecode, compiled at build time** (`pyodide py-compile` in #49, or `compileall` with the Pyodide of `node_modules`): they would help the first start too, but only FElupe, meshio and tensortrax (about 1.2 s). NumPy and SciPy come from the CDN without bytecode. This can be added later, on top of the cache.
- **Serving NumPy, SciPy and rich with bytecode from the app:** 17 MB more in the deployment, and a departure from the CDN of Pyodide (#40). No.
- **Hash-based `.pyc` files** (`compileall` with `UNCHECKED_HASH`): no fixed modification times, but every module would be compiled twice on the first start, and the imports write timestamp-based files anyway.
- **A memory snapshot of Pyodide** (`makeMemorySnapshot`): it would restore the whole heap after the imports. It is experimental in Pyodide, more than 100 MB, and tied to the exact build.
- **Lazy imports of SciPy in FElupe:** another 0.29 s in Node, upstream (adtzlr/felupe#1297), independent of this cache.
