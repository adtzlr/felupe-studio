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

_to be measured_

### Phone

_to be measured_

## Recommendation

_After the measurements: maximum model size (DOF) for an interactive response, and whether the load time needs caching (service worker) before M2._
