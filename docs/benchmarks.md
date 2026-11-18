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

`solver.precision: "single"` of a job casts the matrix and the right-hand side to `float32`, factorizes them in `float32` and returns the increment in `float64`; the model, the residual forces and the convergence check stay in double precision. The page `spike.html` has *Linear equation system: Double precision / Single precision (float32)*; runs of both are listed one after another, with a column *Precision*.

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
| the model in `float32` (regions, fields, prototype) |        13 |      595 MB |

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

The solve times of the same run (double precision, three runs of n = 9, 11, 13): 0.99 to 1.07 s, 2.92 to 3.18 s and 10.4 to 13.1 s. The forces are those of the native reference.
