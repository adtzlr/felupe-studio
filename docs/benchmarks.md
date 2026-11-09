# Benchmarks

Spike for [#9](https://github.com/adtzlr/felupe-studio/issues/9): how long does it take to load FElupe in the browser, and how large can a model be?

## Method

The page `spike.html` (deployed next to the app, `npm run dev` → `/spike.html` locally) starts a Web Worker that

1. loads Pyodide from the jsDelivr CDN,
2. loads NumPy, SciPy and micropip,
3. installs FElupe from PyPI with micropip,

and then runs `felupe_studio.benchmark.benchmark(n)` for several mesh sizes: a uniaxial tension test (`fem.dof.uniaxial`, clamped) of a unit cube with `n` points per edge, `fem.NeoHookeCompressible(mu=1, lmbda=2)`, five increments up to a stretch of 2. The same Python module runs in CPython (`tests/test_benchmark.py`).

Use **Copy results as Markdown** on the page and paste the output below. Measure each device twice: the first run is the cold load (empty browser cache), the second the warm load.

## Native reference (CPython)

Container with 2 cores (x86_64), Python 3.13, FElupe 12.0.0, NumPy 2.5.3, SciPy 1.18.1. Best of two runs, times in seconds.

| n | DOF | Cells | Setup | Solve | Force |
| ---: | ---: | ---: | ---: | ---: | ---: |
| 3 | 81 | 8 | 0.001 | 0.027 | 1.8216 |
| 5 | 375 | 64 | 0.001 | 0.067 | 1.8007 |
| 7 | 1029 | 216 | 0.001 | 0.187 | 1.7959 |
| 9 | 2187 | 512 | 0.003 | 0.712 | 1.7940 |
| 11 | 3993 | 1000 | 0.004 | 1.823 | 1.7930 |
| 13 | 6591 | 1728 | 0.007 | 6.029 | 1.7925 |
| 15 | 10125 | 2744 | 0.011 | 12.536 | 1.7922 |
| 17 | 14739 | 4096 | 0.016 | 28.776 | 1.7919 |

The browser results must reproduce the force column.

## Browser

### Desktop

Windows 10/11, Chrome 156, 16 cores, 32 GB. Times in seconds.

| Load step | Time |
| --- | ---: |
| Pyodide | 2.821 |
| NumPy, SciPy, micropip | 1.952 |
| FElupe (micropip) | 2.900 |
| **Total** | **7.672** |

| n | DOF | Cells | Setup | Solve | Force |
| ---: | ---: | ---: | ---: | ---: | ---: |
| 3 | 81 | 8 | 0.004 | 0.071 | 1.8216 |
| 5 | 375 | 64 | 0.002 | 0.106 | 1.8007 |
| 7 | 1029 | 216 | 0.003 | 0.285 | 1.7959 |
| 9 | 2187 | 512 | 0.005 | 0.922 | 1.7940 |
| 11 | 3993 | 1000 | 0.007 | 2.583 | 1.7930 |

The forces agree with the native reference to all four decimals. Whether the load was cold or warm was not recorded.

### Phone

Android 10, Chrome 156 (mobile), 10 cores, 8 GB. Times in seconds.

| Load step | Time |
| --- | ---: |
| Pyodide | 2.142 |
| NumPy, SciPy, micropip | 1.372 |
| FElupe (micropip) | 4.100 |
| **Total** | **7.614** |

| n | DOF | Cells | Setup | Solve | Force |
| ---: | ---: | ---: | ---: | ---: | ---: |
| 3 | 81 | 8 | 0.006 | 0.121 | 1.8216 |
| 5 | 375 | 64 | 0.003 | 0.140 | 1.8007 |
| 7 | 1029 | 216 | 0.004 | 0.378 | 1.7959 |
| 9 | 2187 | 512 | 0.007 | 1.226 | 1.7940 |
| 11 | 3993 | 1000 | 0.009 | 3.555 | 1.7930 |

Solves take about 1.3 to 1.4 times as long as on the desktop for 1,000 DOF and more. The forces agree with the native reference as well.

## Recommendation

- **Model size:** on both devices a solve stays at about 1 s up to 2,000 DOF (desktop 0.92 s, phone 1.23 s) and takes 2.6 to 3.6 s at 4,000 DOF. v0.1 targets models up to about 4,000 DOF. A running job always shows its progress and can be cancelled (ADR 0005); the GUI warns above about 4,000 DOF instead of refusing.
- **Load time:** about 7.6 s in total on both devices. Installing FElupe with micropip is the largest single step (2.9 s on the desktop, 4.1 s on the phone), because micropip resolves it on PyPI first. Before M2:
  - ship the FElupe wheel with the app and install it from the same origin,
  - start loading Pyodide in the background as soon as the app opens, while the user builds the model,
  - cache Pyodide, the packages and the wheel with a service worker.
- **Open:** whether these were cold or warm loads was not recorded; a second run per device shows how much the browser cache already helps.
