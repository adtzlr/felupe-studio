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
