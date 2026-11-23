# Benchmarks

Spike for [#9](https://github.com/adtzlr/felupe-studio/issues/9): how long does it take to load FElupe in the browser, and how large can a model be?

## Method

The page `spike.html` (deployed next to the app, `npm run dev` → `/spike.html` locally) starts a Web Worker that

1. loads Pyodide from the jsDelivr CDN,
2. loads NumPy, SciPy and micropip,
3. installs FElupe from PyPI with micropip (since #40: loads the FElupe wheel served by the app),

and then runs `felupe_studio.benchmark.benchmark(n)` for several mesh sizes: a uniaxial tension test (`fem.dof.uniaxial`, clamped) of a unit cube with `n` points per edge, `fem.NeoHookeCompressible(mu=1, lmbda=2)`, five increments up to a stretch of 2. The same Python module runs in CPython (`tests/test_benchmark.py`).

Use **Copy results as Markdown** on the page and paste the output below. Measure each device twice: the first run is the cold load (empty browser cache), the second the warm load.

## Native reference (CPython)

Container with 2 cores (x86_64), Python 3.13, FElupe 12.0.0, NumPy 2.5.3, SciPy 1.18.1. Best of two runs, times in seconds.

|   n |   DOF | Cells | Setup |  Solve |  Force |
| --: | ----: | ----: | ----: | -----: | -----: |
|   3 |    81 |     8 | 0.001 |  0.027 | 1.8216 |
|   5 |   375 |    64 | 0.001 |  0.067 | 1.8007 |
|   7 |  1029 |   216 | 0.001 |  0.187 | 1.7959 |
|   9 |  2187 |   512 | 0.003 |  0.712 | 1.7940 |
|  11 |  3993 |  1000 | 0.004 |  1.823 | 1.7930 |
|  13 |  6591 |  1728 | 0.007 |  6.029 | 1.7925 |
|  15 | 10125 |  2744 | 0.011 | 12.536 | 1.7922 |
|  17 | 14739 |  4096 | 0.016 | 28.776 | 1.7919 |

The browser results must reproduce the force column.

## Browser

### Desktop

Windows 10/11, Chrome 156, 16 cores, 32 GB. Times in seconds.

| Load step              |      Time |
| ---------------------- | --------: |
| Pyodide                |     2.821 |
| NumPy, SciPy, micropip |     1.952 |
| FElupe (micropip)      |     2.900 |
| **Total**              | **7.672** |

|   n |  DOF | Cells | Setup | Solve |  Force |
| --: | ---: | ----: | ----: | ----: | -----: |
|   3 |   81 |     8 | 0.004 | 0.071 | 1.8216 |
|   5 |  375 |    64 | 0.002 | 0.106 | 1.8007 |
|   7 | 1029 |   216 | 0.003 | 0.285 | 1.7959 |
|   9 | 2187 |   512 | 0.005 | 0.922 | 1.7940 |
|  11 | 3993 |  1000 | 0.007 | 2.583 | 1.7930 |

The forces agree with the native reference to all four decimals. Whether the load was cold or warm was not recorded.

### Phone

Android 10, Chrome 156 (mobile), 10 cores, 8 GB. Times in seconds.

| Load step              |      Time |
| ---------------------- | --------: |
| Pyodide                |     2.142 |
| NumPy, SciPy, micropip |     1.372 |
| FElupe (micropip)      |     4.100 |
| **Total**              | **7.614** |

|   n |  DOF | Cells | Setup | Solve |  Force |
| --: | ---: | ----: | ----: | ----: | -----: |
|   3 |   81 |     8 | 0.006 | 0.121 | 1.8216 |
|   5 |  375 |    64 | 0.003 | 0.140 | 1.8007 |
|   7 | 1029 |   216 | 0.004 | 0.378 | 1.7959 |
|   9 | 2187 |   512 | 0.007 | 1.226 | 1.7940 |
|  11 | 3993 |  1000 | 0.009 | 3.555 | 1.7930 |

Solves take about 1.3 to 1.4 times as long as on the desktop for 1,000 DOF and more. The forces agree with the native reference as well.

## After #40: bundled wheel and service worker cache

The FElupe wheel is now served by the app (`wheels/`, pinned with its SHA-256 in `app/package.json`) and loaded with `pyodide.loadPackage()`, without micropip. A service worker (`app/public/sw.js`) caches Pyodide, NumPy, SciPy and the wheel. The start page begins loading as soon as it opens.

Measure on each device

1. **cold:** clear the site data of the page (browser settings), open `spike.html`, copy the results,
2. **warm:** reload the page; the line _Service worker cache_ should say _active_, copy the results again.

### Phone

Android 10, Chrome 156 (mobile), 10 cores, 8 GB. Times in seconds.

| Load step    | Cold (no cache) | Warm (service worker) | Before #40 |
| ------------ | --------------: | --------------------: | ---------: |
| Pyodide      |           3.598 |                 1.796 |      2.142 |
| NumPy, SciPy |           2.550 |                 1.472 |      1.372 |
| FElupe       |           3.052 |                 2.520 |      4.100 |
| **Total**    |       **9.201** |             **5.789** |  **7.614** |

Solve times are unchanged (e.g. 2,187 DOF: 0.99 s cold, 1.03 s warm, 1.23 s before), the forces agree with the native reference.

- With the cache, the start takes 5.8 s instead of 7.6 s, and it runs in the background while the model is built.
- The cold load is slower than the measurement of #9. Whether that one was cold was not recorded; the browser's HTTP cache probably helped.
- The FElupe step still takes 2.5 s from the cache, so it is not the download but loading the wheel and `import felupe` (Python bytecode compilation, SciPy modules). A follow-up is to measure both parts and to ship a wheel with precompiled bytecode.

### Desktop

Not measured again; the phone is the limiting device.

## Recommendation

- **Model size:** on both devices a solve stays at about 1 s up to 2,000 DOF (desktop 0.92 s, phone 1.23 s) and takes 2.6 to 3.6 s at 4,000 DOF. v0.1 targets models up to about 4,000 DOF. A running job always shows its progress and can be cancelled (ADR 0005); the GUI warns above about 4,000 DOF instead of refusing.
- **Load time** (before #40, see above for the current state): about 7.6 s in total on both devices. Installing FElupe with micropip is the largest single step (2.9 s on the desktop, 4.1 s on the phone), because micropip resolves it on PyPI first. Before M2:
  - ship the FElupe wheel with the app and install it from the same origin,
  - start loading Pyodide in the background as soon as the app opens, while the user builds the model,
  - cache Pyodide, the packages and the wheel with a service worker.
- **Open:** whether these were cold or warm loads was not recorded; a second run per device shows how much the browser cache already helps.

## u-p-J of linear hexahedrons and quads (#226)

Since #226, the `u-p-J` sections of linear hexahedrons and quads use `fem.SolidBodyNearlyIncompressible` on the displacements only. It condenses the constant pressure and volume ratio of every cell (Q1/P0), instead of `fem.FieldsMixed` with these as unknowns of the global system. The discretization is the same: converged curves agree within 1e-9 for all golden cases and samples.

Container with 2 cores (x86_64), CPython 3.13, FElupe 12.0.0, SuperLU (the default solver). Best of two runs, times in seconds.

**A cube in uniaxial tension** (clamped, `fem.NeoHooke(mu=1)`, K = 5000, five increments to a stretch of 2):

| Tolerance |  n | Cells | DOF mixed | Mixed fields | Condensed | Speedup |
| --------: | -: | ----: | --------: | -----------: | --------: | ------: |
|      0.01 |  5 |    64 |       503 |        0.072 |     0.072 |    0.99 |
|      0.01 |  9 |   512 |      3211 |        0.561 |     0.566 |    0.99 |
|      0.01 | 13 |  1728 |     10047 |        3.689 |     5.066 |    0.73 |
|     1e-10 |  5 |    64 |       503 |        0.136 |     0.098 |    1.39 |
|     1e-10 |  9 |   512 |      3211 |        0.893 |     0.902 |    0.99 |
|     1e-10 | 13 |  1728 |     10047 |        6.775 |     7.304 |    0.93 |

Per Newton iteration, the assembly of the condensed system is about 20 % faster and has about 20 % fewer non-zeros. The solve takes about as long (n = 13: 0.25 s, 5603 vs. 9059 active DOF). At a tolerance of 0.01, the cube with n = 13 needs one more iteration per substep with the condensed solid body.

**The samples** (their own tolerance, mostly the default 0.01). The error is the largest deviation of the curve from the converged one (tolerance 1e-9), relative to its largest value:

| Sample                       | Cells | Mixed fields | Condensed | Speedup | Newton iterations (mixed / condensed) | Error (mixed / condensed) |
| ---------------------------- | ----: | -----------: | --------: | ------: | ------------------------------------: | ------------------------: |
| two-materials                |   192 |         0.33 |      0.36 |    0.90 |                               21 / 30 |         5.1e-05 / 2.4e-04 |
| shear-mount                  |   384 |         0.68 |      0.92 |    0.74 |                               19 / 26 |         1.7e-04 / 3.5e-07 |
| glued-plate                  |   256 |         0.42 |      0.52 |    0.81 |                               12 / 17 |         6.3e-02 / 4.0e-07 |
| sandwich-spring              |  1080 |         2.19 |      2.12 |    1.03 |                               17 / 17 |         2.3e-08 / 2.3e-08 |
| bushing                      |   990 |         3.19 |      1.99 |    1.60 |                               19 / 19 |         2.2e-05 / 2.2e-05 |
| sandwich-spring-axisymmetric |   160 |         0.16 |      0.18 |    0.90 |                               17 / 25 |         3.2e-05 / 1.5e-09 |
| plate-with-hole              |   128 |         0.11 |      0.08 |    1.38 |                               17 / 18 |         1.3e-06 / 1.3e-04 |
| material-test (tol 1e-6)     |    27 |         0.17 |      0.11 |    1.57 |                               31 / 32 |         1.5e-10 / 9.8e-08 |

**Conclusion:**
- In CPython the condensed solid body is not faster in general.
  - It is faster where it needs as many Newton iterations as the mixed fields (bushing 1.6×, plate with a hole 1.4×).
  - It is slower where it needs more (shear mount, glued plate).
- It stops later at the same tolerance, but then it is often closer to the converged curve. The glued plate at the default tolerance is the extreme case: its moment deviates by 6 % with the mixed fields and by 4e-7 condensed.
- The smaller system needs less memory, which matters in the browser. The times in Pyodide are still to be measured.

## The linear equation system in single precision (ADR 0016)

`solver.precision: "single"` of a job casts the matrix and the right-hand side to `float32`, factorizes them in `float32` and returns the increment in `float64`; the model, the residual forces and the convergence check stay in double precision. The page `spike.html` has *Precision: Double / Linear system in single (float32) / Model in single (float32)* (`precision` of the benchmark: `double`, `single`, `model`); runs of the precisions are listed one after another, with a column *Precision*.

Container with 2 cores (x86_64), CPython 3.13, FElupe 12.1.0, SuperLU. Peak memory of a process (the resident set; Python with FElupe takes 84 MB).

**The benchmark of the spike** (`felupe_studio.benchmark.benchmark(n, precision=...)`, best of two runs, times in seconds):

|   n |   DOF | Cells | Solve, double | Solve, single | Speedup | Peak memory, double / single |  Force |
| --: | ----: | ----: | ------------: | ------------: | ------: | ---------------------------: | -----: |
|   9 |  2187 |   512 |         0.665 |         0.568 |    1.17 |                              | 1.7940 |
|  13 |  6591 |  1728 |         6.063 |         4.027 |    1.51 |                              | 1.7925 |
|  17 | 14739 |  4096 |        27.974 |        17.028 |    1.64 |              401 MB / 341 MB | 1.7919 |

**A cube with u-p-J** (`fem.SolidBodyNearlyIncompressible`, `fem.NeoHooke(mu=1)`, K = 5000, n = 21: 27,783 DOF, uniaxial tension to a stretch of 1.2, tolerance 0.01), one run each:

| Precision                                         | Time in s | Peak memory |
| ------------------------------------------------- | --------: | ----------: |
| double                                            |        45 |     1083 MB |
| the linear equation system in `float32`           |        22 |      826 MB |
| the model in `float32` (regions, fields; FElupe 12.1.1, see below) |        17 |      575 MB |

**The samples and the golden cases** with the linear equation system in `float32` give the curves of double precision within 2e-5 of the largest force (the bar with cutbacks within 1.2e-4, at its tolerance of 0.01), with the same number of Newton iterations; at the tight tolerance 1.49e-8, the linear elastic and the plasticity cube take a few more. The samples are up to 1.4 times faster (the sandwich spring 2.0 s instead of 2.8 s). u-p-J fields of tetrahedrons (`fem.FieldsMixed`, an indefinite system) are slower: SuperLU of FElupe falls back to a factorization with pivoting in 11 of 16 solves (the hex-tet sample 2.3 s instead of 0.75 s).

The model in `float32` (`model.settings`, regions and fields in single precision) needs adtzlr/felupe#1293 and #1294 first (ADR 0016).

### Phone

Android 17, Firefox 160 (mobile), 8 cores, Pyodide 314.0.7, Python 3.14.2, FElupe 12.1.0, NumPy 2.4.6, SciPy 1.18.0, warm (service worker cache active). Times in seconds.

|   n |  DOF | Cells | Solve, double | Solve, single | Speedup |  Force |
| --: | ---: | ----: | ------------: | ------------: | ------: | -----: |
|   9 | 2187 |   512 |         0.967 |         0.883 |    1.10 | 1.7940 |
|  11 | 3993 |  1000 |         2.488 |         2.188 |    1.14 | 1.7930 |
|  13 | 6591 |  1728 |         8.661 |         5.919 |    1.46 | 1.7925 |

The forces agree with the native reference in both precisions. As in CPython, the speedup grows with the size of the model, where the factorization dominates: 1.46 at 6,591 DOF on the phone, 1.51 in CPython.

The load of the same run (warm): Pyodide 1.938 s, NumPy and SciPy 2.319 s, FElupe and meshio (the wheels of the app) 3.599 s, in total 7.856 s. The FElupe step is the measurement before #49 on this phone.

## The bytecode cache of Pyodide (#49, ADR 0017)

Neither the packages of Pyodide nor the wheels of PyPI have bytecode, and Pyodide does not write any: every start compiled the sources of about 740 modules. Since ADR 0017 the worker keeps the bytecode in IndexedDB. The first start of a version fills the cache, the next ones read it. `spike.html` lists the parts of the FElupe step and the state of the cache (*Bytecode cache: empty*, *hit* or *off*).

**Chromium (headless, desktop container with 2 cores), Pyodide 314.0.7 served locally, no service worker,** three loads of `spike.html` in the same browser, times in seconds:

| Part of the FElupe step       | First (cache empty) | Second (hit) | Third (hit) |
| ----------------------------- | ------------------: | -----------: | ----------: |
| wheels and sources            |               0.180 |        0.181 |       0.168 |
| import NumPy, SciPy           |               1.914 |        0.875 |       0.772 |
| import FElupe                 |               1.232 |        0.413 |       0.463 |
| import meshio                 |               0.583 |        0.349 |       0.242 |
| **FElupe, meshio (the step)** |           **3.909** |    **1.818** |   **1.645** |

The app in the same browser: the start of *Mount in shear* took 10.7 s with an empty cache and 7.8 s with a hit (the status bar), and its solve 2.30 s and 2.03 s (tensortrax is compiled at the first solve, and cached too). The forces are the same.

### Phone

Android 10, Chrome 157 (mobile), 10 cores, 8 GB (the phone of #40), Pyodide 314.0.7, FElupe 12.1.0, warm (service worker cache active), bytecode cache *hit*. Times in seconds.

| Load step                          | Time in s |
| ---------------------------------- | --------: |
| Pyodide                            |     1.315 |
| NumPy, SciPy                       |     1.480 |
| FElupe, meshio (wheels of the app) |     1.302 |
| · wheels and sources               |     0.118 |
| · import NumPy, SciPy              |     0.655 |
| · import FElupe                    |     0.302 |
| · import meshio                    |     0.227 |
| **Total**                          | **4.096** |

The FElupe step takes 1.30 s. The earlier warm measurements of this step on phones:
- 2.52 s on this phone (#40, FElupe 12.0, an older Pyodide);
- 3.60 s on the Firefox phone of #296 (Pyodide 314.0.7, without the bytecode cache).

They are not the same browser and versions, so they are not a strict before and after. The parts with the cache are in the proportions of Chromium on the desktop: NumPy and SciPy take half of the step, then FElupe, then meshio. The whole start takes 4.1 s instead of 5.8 s (#40).

**Before and after on the same phone:** Android 17, Firefox 160 (mobile), 8 cores, Pyodide 314.0.7, FElupe 12.1.0, warm (service worker cache active). Before is the measurement of #296, without the bytecode cache; after is with a hit. Times in seconds.

| Load step                          |    Before |     After |
| ---------------------------------- | --------: | --------: |
| Pyodide                            |     1.938 |     1.944 |
| NumPy, SciPy                       |     2.319 |     2.275 |
| FElupe, meshio (wheels of the app) |     3.599 |     1.620 |
| · wheels and sources               |           |     0.208 |
| · import NumPy, SciPy              |           |     0.802 |
| · import FElupe                    |           |     0.336 |
| · import meshio                    |           |     0.274 |
| **Total**                          | **7.856** | **5.839** |

The FElupe step takes 1.62 s instead of 3.60 s (55 % less), the whole start 5.8 s instead of 7.9 s. That matches Chromium on the desktop (3.9 s → 1.6–1.8 s). The other two steps are unchanged; they download and unpack Pyodide and its packages from the service worker cache.

The solve times of the same run (double precision, three runs of n = 9, 11, 13): 0.99 to 1.07 s, 2.92 to 3.18 s and 10.4 to 13.1 s. The forces are those of the native reference.

**FElupe 12.1.1** imports `scipy.interpolate` and `scipy.special` only when they are used (adtzlr/felupe#1297). Pyodide 314.0.7 in Node (container with 2 cores), three runs each, times in seconds:

| `import felupe`          | FElupe 12.1.0 | FElupe 12.1.1 |
| ------------------------ | ------------: | ------------: |
| without the bytecode     |    1.15–1.28 |    0.40–0.44 |
| with the bytecode cache  |    0.39–0.55 |    0.12–0.19 |

The FElupe step of the start without the cache takes 2.9–3.2 s instead of 3.7–3.9 s, and with the cache 1.2–1.4 s (imports) instead of 1.5–1.8 s.

## The model in single precision (#297)

`model.settings.precision: "single"` builds the regions and the fields in `float32` (ADR 0016), so the stresses, the tangents, the matrix and the factorization are in `float32` too. The benchmark of the spike runs it with `precision="model"` (*Model in single (float32)* on `spike.html`).

Container with 2 cores (x86_64), CPython 3.13, FElupe 12.1.1, SuperLU. Best of two runs, times in seconds; peak memory of a process (Python with FElupe takes 84 MB):

|   n |   DOF | Solve, double | Linear system in single | Model in single | Speedup of the model | Peak memory, double / linear system / model |  Force |
| --: | ----: | ------------: | ----------------------: | --------------: | -------------------: | ------------------------------------------: | -----: |
|   9 |  2187 |         0.665 |                   0.568 |           0.348 |                 1.91 |                                             | 1.7940 |
|  13 |  6591 |         6.063 |                   4.027 |           2.388 |                 2.54 |                                             | 1.7925 |
|  17 | 14739 |        27.974 |                  17.028 |           9.871 |                 2.83 |                     401 MB / 341 MB / 272 MB | 1.7919 |

The forces are those of double precision (four digits). Without Python and FElupe, the model in single precision takes 188 MB at n = 17 instead of 317 MB in double precision (and 257 MB with the linear system in single precision). The cube with u-p-J of the section above (n = 21, 27,783 DOF) takes 17 s and 575 MB with FElupe 12.1.1, instead of 45 s and 1083 MB.

### Phone

Android 17, Firefox 160 (mobile), 8 cores, Pyodide 314.0.7, FElupe 12.1.1, warm (service worker cache active, bytecode cache *hit*). Solve times in seconds:

|   n |  DOF | Double | Linear system in single | Model in single | Speedup, linear system / model |  Force |
| --: | ---: | -----: | ----------------------: | --------------: | -----------------------------: | -----: |
|   9 | 2187 |  0.877 |                   0.730 |           0.502 |                    1.20 / 1.75 | 1.7940 |
|  11 | 3993 |  2.457 |                   1.769 |           1.325 |                    1.39 / 1.85 | 1.7930 |
|  13 | 6591 |  8.718 |                   5.430 |           4.071 |                    1.61 / 2.14 | 1.7925 |

The forces are those of the native reference in all three precisions. As in CPython, the speedup grows with the size of the model.

The start of the same run with FElupe 12.1.1, which imports `scipy.interpolate` and `scipy.special` only when they are used:

| Load step                          | FElupe 12.1.0 (#296) | FElupe 12.1.1 |
| ---------------------------------- | -------------------: | ------------: |
| Pyodide                            |                1.944 |         1.907 |
| NumPy, SciPy                       |                2.275 |         2.213 |
| FElupe, meshio (wheels of the app) |                1.620 |         1.248 |
| · wheels and sources               |                0.208 |         0.148 |
| · import NumPy, SciPy              |                0.802 |         0.690 |
| · import FElupe                    |                0.336 |         0.137 |
| · import meshio                    |                0.274 |         0.273 |
| **Total**                          |            **5.839** |     **5.368** |

Both runs hit the bytecode cache. `import felupe` takes 0.14 s instead of 0.34 s; without the cache and with FElupe 12.1.0 (#296) the FElupe step took 3.60 s, now 1.25 s.

## PARDISO of Intel oneMKL (#308)

`solver.type: "pardiso"` of a job solves with `pypardiso.spsolve` in Python on the computer (`felupe-studio serve`); MKL has no build for WebAssembly, so not in the browser. The benchmark of the spike runs it with `solver="pardiso"` in CPython (`felupe_studio.benchmark.benchmark(n, precision=..., solver=...)`).

Container with 2 cores (x86_64), CPython 3.13, FElupe 12.1.1, NumPy 2.5.3, SciPy 1.18.1, MKL 2026.2.1; PyPardiso 0.4.7 in double precision, adtzlr/PyPardiso for single precision (PyPardiso 0.4 factorizes only in `float64`). Every configuration in a fresh process, best of two runs, times in seconds.

**The benchmark of the spike**, solve times:

|   n |   DOF | SuperLU, double | SuperLU, linear system in single | SuperLU, model in single | PARDISO, double | PARDISO, linear system in single | PARDISO, model in single | PARDISO / SuperLU, double |  Force |
| --: | ----: | --------------: | -------------------------------: | -----------------------: | --------------: | -------------------------------: | -----------------------: | ------------------------: | -----: |
|   9 |  2187 |           0.667 |                            0.539 |                    0.327 |           0.595 |                            0.521 |                    0.304 |                       1.1 | 1.7940 |
|  13 |  6591 |           5.402 |                            3.202 |                    1.996 |           1.586 |                            1.520 |                    0.991 |                       3.4 | 1.7925 |
|  17 | 14739 |          23.489 |                           14.098 |                    8.902 |           5.402 |                            4.468 |                    2.998 |                       4.3 | 1.7919 |
|  21 | 27783 |         104.782 |                           58.830 |                   36.548 |          14.811 |                           10.148 |                    7.333 |                       7.1 | 1.7916 |

Peak memory of a process (the resident set; Python with FElupe takes about 63 MB, MKL about 25 MB more):

|   n | SuperLU: double / linear system / model | PARDISO: double / linear system / model |
| --: | --------------------------------------: | --------------------------------------: |
|  17 |                  382 MB / 326 MB / 273 MB |                384 MB / 349 MB / 317 MB |
|  21 |                  824 MB / 656 MB / 520 MB |                701 MB / 617 MB / 544 MB |

**A cube with u-p-J** (`fem.SolidBodyNearlyIncompressible`, `fem.NeoHooke(mu=1)`, K = 5000, n = 21: 27,783 DOF, uniaxial tension to a stretch of 1.2 in five increments, tolerance 0.01), best of two runs:

| Precision                               | SuperLU | PARDISO | Peak memory, SuperLU / PARDISO |
| --------------------------------------- | ------: | ------: | -----------------------------: |
| double                                  |   109 s |    13 s |               1124 MB / 799 MB |
| the linear equation system in `float32` |    58 s |    10 s |                844 MB / 711 MB |
| the model in `float32`                  |    44 s |     9 s |                620 MB / 589 MB |

The forces of PARDISO are those of SuperLU in every precision (four digits; the golden case `bar_pardiso` agrees within 1e-10). PARDISO factorizes with less fill-in and on both cores: the larger the model, the larger its lead, 7 to 8 times at 27,783 DOF in double precision, with less memory than SuperLU. Single precision adds less with PARDISO than with SuperLU (1.5 times at n = 21 instead of 1.8 for the linear system, 2.0 instead of 2.9 for the model), as the factorization is no longer most of the time: the assembly and the material take the rest. PARDISO factorizes on all cores of the computer, SuperLU of SciPy on one.

## A cut through the model (#395)

`felupe_studio.cuts.cut()` (ADR 0022) of a cube, by a plane through points of the mesh (x = 0.5) and through its cells (z = 0.33). *Surface* is the outer surface of FElupe (`triangulate_surface`), which the cut clips; *Interpolation* is the displacement of all points of the cut of a substep, the only work for a new substep, a quantity or a scale while the cut is cached.

Container with 4 cores (x86_64), CPython 3.13.18, FElupe 12.1.1, NumPy 2.5.3, SciPy 1.18.1. Best of seven runs, times in milliseconds:

| Mesh                                           |  Cells | Surface | Cut x = 0.5 | Cut z = 0.33 | Interpolation | Triangles: surface / x = 0.5 / z = 0.33 |
| ---------------------------------------------- | -----: | ------: | ----------: | -----------: | ------------: | --------------------------------------: |
| hexahedrons, n = 21 (the largest benchmark)    |   8000 |     8.0 |        21.8 |         14.8 |          0.04 |                    4800 / 3200 / 10,240 |
| hexahedrons, n = 41                            | 64,000 |    43.0 |        69.4 |         61.9 |          0.20 |                19,200 / 12,800 / 40,640 |
| tetrahedrons, n = 21 (`triangulate()`)         | 48,000 |    17.0 |        26.9 |         26.9 |          0.04 |                    4800 / 3200 / 12,720 |
| quadratic hexahedrons (`hexahedron20`), n = 11 |   1000 |     3.1 |        15.5 |         16.8 |          0.06 |                      4800 / 3200 / 8480 |

A cut takes 1.5 to 5 times as long as the outer surface, once per cut: about 20 ms for the largest benchmark. The cut face of a plane through cells (z = 0.33) has about 18 triangles per hexahedron (the sections of its tetrahedrons), 4 per tetrahedron and 54 per quadratic hexahedron, which is subdivided like its outer surface; a plane through points of the mesh (x = 0.5) takes the faces of the cells as the cut face.

### Browser

The same in Pyodide 314.0.7 (Python 3.14.2, FElupe 12.1.1, NumPy 2.4.6) in Chromium 153 (headless) on the same container. Best of seven runs, times in milliseconds; the timer of the browser is coarse, the interpolation of a substep takes less than 0.5 ms:

| Mesh                                           |  Cells | Surface | Cut x = 0.5 | Cut z = 0.33 |
| ---------------------------------------------- | -----: | ------: | ----------: | -----------: |
| hexahedrons, n = 21 (the largest benchmark)    |   8000 |    12.7 |        33.1 |         33.3 |
| tetrahedrons, n = 21 (`triangulate()`)         | 48,000 |    31.9 |        52.3 |         50.7 |
| quadratic hexahedrons (`hexahedron20`), n = 11 |   1000 |     5.8 |        29.7 |         27.1 |

A cut takes about 1.5 to 2.5 times as long as in CPython: about 35 ms for the largest benchmark, once per cut and section. A new substep, quantity or scale of the same cut is the interpolation of the kept cut, as in CPython. The Results workspace asks for a cut when the slider stops (ADR 0022), so the cut follows the slider within a frame or two of these times plus the transfer of the scene.

## The results of a file (#414)

*Import results…* reads an XDMF file of the export (`felupe_studio.resultfile.load()`): meshio parses the XML of all substeps, and the file keeps the displacements and the data of every substep in memory. The largest benchmark, a cube of hexahedrons with n = 21 (8000 cells, 9261 points), `fem.NeoHookeCompressible`, 11 substeps; the file at the cells, or with the strains and the stresses at the points too (`mean`). *Peak* is the largest memory that Python allocates while it reads the file (`tracemalloc`), *Scene* the von Mises stress of a substep, the first one with the triangulation of the outer surface.

Container with 4 cores (x86_64), CPython 3.13.18, FElupe 12.1.1, NumPy 2.5.3, meshio 5.3.5. One run:

| Values at  |  File | Export | Import |   Peak | Scene: first / next |
| ---------- | ----: | -----: | -----: | -----: | ------------------: |
| the cells  | 23 MB |  2.3 s |  1.0 s |  83 MB |        13 ms / 4 ms |
| the points | 40 MB |  4.4 s |  1.7 s | 141 MB |        18 ms / 8 ms |

The file grows with the substeps, about 2 MB per substep at the cells and 3.6 MB with the points for this mesh, and reading it takes about 3.5 times its size in memory. A file of a large model with many substeps, e.g. 100 substeps of this mesh (about 230 MB), needs some 800 MB while it is read, which is much for Pyodide on a phone. Once read, a scene takes the time of the scene of a run. Not measured in the browser yet.
