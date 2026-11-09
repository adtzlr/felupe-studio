# 0003 Where commands are interpreted

Status: Accepted

## Context

Every GUI action is a command. The command list is saved as the project file and has to become a FElupe script that runs in the browser and can be exported.

## Decision

- The command schema is JSON Schema (`schema/`), the single source of truth. TypeScript types are generated from it.
- A small Python package `felupe_studio` (in this repository) turns a command list into a readable FElupe script: `felupe_studio.codegen(commands) -> str`.
- The same package runs in Pyodide (browser) and in CPython (tests, command line).

Data flow:

```
GUI action ──► command (JSON) ──► command list / project file
                                        │
                                        ▼
                     felupe_studio.codegen (Python, in Pyodide)
                                        │
                                        ▼
                         FElupe script ──► run in the worker
```

## Consequences

- Golden tests use plain pytest with the real FElupe: command list → script → run → compare with references.
- The exported Python script is exactly what runs in the browser.
- The TypeScript side validates and edits commands but never builds FElupe code itself.

## Alternatives

- Code generation in TypeScript: tests would need Node and Python, and two implementations of FElupe knowledge would drift apart.
