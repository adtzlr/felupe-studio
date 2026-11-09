# 0002 Frontend stack

Status: Accepted

## Context

The app is a static site (GitHub Pages, no server). It should load fast, be typed, and be easy for contributors.

## Decision

- TypeScript and Vite
- Plain DOM, optionally Preact for the browser tree and panels; no larger framework
- Vitest for unit tests, ESLint and Prettier for linting and formatting

## Consequences

- One build tool, one test runner, small bundle.
- UI components are written by hand; the ribbon and property forms are generated from the command schema ([0003](0003-command-interpretation.md)).

## Alternatives

- React, Vue or Svelte: more ecosystem, more bundle and lock-in than needed.
- No build step: no typing, harder to test.
