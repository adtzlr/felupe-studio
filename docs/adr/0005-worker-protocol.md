# 0005 Worker protocol

Status: Accepted

## Context

Pyodide and FElupe run in a Web Worker so that the UI stays responsive. The main thread and the worker exchange messages.

## Decision

Messages from the main thread to the worker:

| Type | Payload |
| --- | --- |
| `init` | packages and versions to load |
| `run` | `{ id, commands }` |

Messages from the worker to the main thread:

| Type | Payload |
| --- | --- |
| `ready` | versions of Pyodide, FElupe, NumPy, SciPy |
| `progress` | `{ id, step, substep, iteration, norm }` |
| `result` | `{ id, arrays }`, typed arrays as transferables (points, cells, point and cell data) |
| `error` | `{ id, message, traceback }` |

Cancelling a job terminates the worker and starts a new one (Pyodide cannot interrupt running Python code otherwise).

## Consequences

- Large arrays are transferred without copies.
- A cancelled job costs a new Pyodide start; the warm load time is measured in the spike (#9).

## Alternatives

- `SharedArrayBuffer` interrupts: need cross-origin isolation headers, which GitHub Pages does not set.
