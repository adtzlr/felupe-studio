import { describe, expect, it } from "vitest";
import type { Command } from "../core/commands";
import type { Loadcase } from "../core/loadcases";
import type { Symmetry } from "../core/symmetry";
import {
  AXIS_COLORS,
  boundaryLines,
  boundarySymbols,
  direction,
  emptyPlanes,
  loadcaseParts,
  modelSize,
  strokes,
  thinned,
} from "./boundaries";
import fixture from "./boundaries.fixture.json";

type Case = {
  loadcase: Record<string, unknown>;
  boundaries: Record<
    string,
    { points: number[]; components: number[]; value: number }
  >;
};

describe("boundaries of load cases like fem.dof", () => {
  for (const [mesh, data] of Object.entries(fixture) as unknown as [
    string,
    { points: number[]; cases: Case[] },
  ][]) {
    const nodes = [Float64Array.from(data.points)];
    const index = new Map<string, number>();
    for (let p = 0; p < data.points.length; p += 3) {
      index.set(data.points.slice(p, p + 3).join(" "), p / 3);
    }
    for (const { loadcase, boundaries } of data.cases) {
      it(`${mesh}: ${JSON.stringify(loadcase)}`, () => {
        const command = {
          command: "loadcase.add",
          name: "lc",
          ...loadcase,
        } as unknown as Loadcase;
        const symbols = boundarySymbols([command], nodes);
        const byName = new Map(symbols.map((s) => [s.name, s]));
        for (const [key, expected] of Object.entries(boundaries)) {
          const symbol = byName.get(`lc/${key}`);
          if (expected.points.length === 0) {
            expect(symbol).toBeUndefined();
            continue;
          }
          expect(symbol, key).toBeDefined();
          const points: number[] = [];
          for (let p = 0; p < symbol!.points.length; p += 3) {
            points.push(
              index.get([...symbol!.points.subarray(p, p + 3)].join(" "))!,
            );
          }
          expect(
            points.sort((a, b) => a - b),
            key,
          ).toEqual(expected.points);
          expect(symbol!.components, key).toEqual(expected.components);
          // -0 of a move of 0 backwards is 0
          expect(symbol!.value + 0, key).toBe(expected.value + 0);
        }
        // no other boundaries
        expect(
          loadcaseParts(command, nodes)
            .map((p) => p.key)
            .sort(),
        ).toEqual(Object.keys(boundaries).sort());
      });
    }
  }
});

describe("symmetry planes like fem.dof.symmetry (#186)", () => {
  for (const [mesh, data] of Object.entries(fixture) as unknown as [
    string,
    {
      points: number[];
      symmetries: {
        symmetry: Record<string, unknown>;
        boundaries: Case["boundaries"];
      }[];
    },
  ][]) {
    const nodes = [Float64Array.from(data.points)];
    const index = new Map<string, number>();
    for (let p = 0; p < data.points.length; p += 3) {
      index.set(data.points.slice(p, p + 3).join(" "), p / 3);
    }
    for (const { symmetry, boundaries } of data.symmetries) {
      it(`${mesh}: ${JSON.stringify(symmetry)}`, () => {
        const command = {
          command: "symmetry.add",
          name: "sym",
          ...symmetry,
        } as unknown as Command;
        const symbols = boundarySymbols([command], nodes);
        const empty = Object.entries(boundaries)
          .filter(([, b]) => b.points.length === 0)
          .map(
            ([key]) =>
              `${key.slice(3)} = ${(symmetry[key.slice(3)] as number) ?? 0}`,
          );
        expect(emptyPlanes(command as Symmetry, nodes)).toEqual(empty);
        expect(symbols.map((s) => s.name).sort()).toEqual(
          Object.entries(boundaries)
            .filter(([, b]) => b.points.length > 0)
            .map(([key]) => `sym/${key}`)
            .sort(),
        );
        for (const symbol of symbols) {
          const expected = boundaries[symbol.name.slice(4)];
          const points: number[] = [];
          for (let p = 0; p < symbol.points.length; p += 3) {
            points.push(
              index.get([...symbol.points.subarray(p, p + 3)].join(" "))!,
            );
          }
          expect(points.sort((a, b) => a - b)).toEqual(expected.points);
          expect(symbol.components).toEqual(expected.components);
          expect(symbol.value).toBe(0);
        }
      });
    }
  }
});

describe("boundary symbols", () => {
  const nodes = [Float64Array.from(fixture.corner.points)];
  const commands = [
    { command: "pointset.add", name: "left", select: { axis: "x", value: 0 } },
    { command: "pointset.add", name: "right", select: { axis: "x", value: 2 } },
    { command: "pointset.add", name: "ids", select: { ids: [0, 1] } },
    {
      command: "boundary.add",
      name: "fixed",
      pointset: "left",
      constrained: ["x", "y", "z"],
    },
    {
      command: "boundary.add",
      name: "move",
      pointset: "right",
      constrained: ["x"],
    },
    {
      command: "boundary.add",
      name: "pulled",
      pointset: "right",
      constrained: ["y", "z"],
      value: 0.1,
    },
    {
      command: "boundary.add",
      name: "by_ids",
      pointset: "ids",
      constrained: ["x"],
    },
    {
      command: "loadcase.add",
      name: "tension",
      type: "uniaxial",
      symmetry: false,
    },
    {
      command: "step.add",
      name: "load",
      ramp: {
        num: 2,
        items: [
          { target: "move", end: 0.5 },
          { target: "tension", end: 0.5 },
        ],
      },
    },
    {
      command: "step.add",
      name: "unload",
      ramp: { num: 2, items: [{ target: "move", end: -0.25 }] },
    },
  ] as unknown as Command[];

  it("has the points, components and final values of the boundaries", () => {
    const symbols = boundarySymbols(commands, nodes);
    const get = (name: string) => symbols.find((s) => s.name === name)!;
    expect(get("fixed")).toMatchObject({
      owner: "fixed",
      components: [0, 1, 2],
      value: 0,
    });
    expect(get("fixed").points.length / 3).toBe(6);
    // the last step that ramps a boundary gives its value
    expect(get("move").value).toBe(-0.25);
    expect(get("pulled").value).toBe(0.1);
    expect(get("tension/move")).toMatchObject({ owner: "tension", value: 0.5 });
    // point sets of point ids are not drawn
    expect(symbols.find((s) => s.name === "by_ids")).toBeUndefined();
    expect(boundarySymbols(commands, [])).toEqual([]);
    // a boundary of a control point is drawn at the control point (#95)
    const control = boundarySymbols(
      [
        ...commands,
        { command: "point.add", name: "c", coordinates: [5, 0.5, 0.5] },
        {
          command: "boundary.add",
          name: "pin",
          pointset: "c",
          constrained: ["x"],
        },
      ] as Command[],
      nodes,
    ).find((s) => s.name === "pin")!;
    expect([...control.points]).toEqual([5, 0.5, 0.5]);
  });

  it("draws strokes and directions", () => {
    const symbols = boundarySymbols(commands, nodes);
    const fixed = symbols.find((s) => s.name === "fixed")!;
    const segments = strokes(fixed, 1, 0.2);
    expect(segments.length).toBe(2 * fixed.points.length);
    expect(
      [...segments.subarray(0, 6)].map((v) => Number(v.toFixed(6))),
    ).toEqual([
      fixed.points[0],
      fixed.points[1] - 0.1,
      fixed.points[2],
      fixed.points[0],
      fixed.points[1] + 0.1,
      fixed.points[2],
    ]);
    const pulled = symbols.find((s) => s.name === "pulled")!;
    const d = direction(pulled);
    expect(d[0]).toBe(0);
    expect(d[1]).toBeCloseTo(Math.SQRT1_2);
    expect(direction({ ...pulled, components: [0], value: -1 })).toEqual([
      -1, 0, 0,
    ]);
    expect(modelSize(nodes)).toBeCloseTo(Math.sqrt(6));
    const many = new Float64Array(3 * 1000).map((_, i) => i);
    expect(thinned(many).length).toBe(900);
    expect(thinned(many, 2000)).toBe(many);
  });

  it("groups the lines by color, hides owners and highlights the selected", () => {
    const symbols = boundarySymbols(commands, nodes);
    const lines = boundaryLines(symbols, { size: 10, highlight: "#ffd23f" });
    const colors = lines.map((l) => l.color);
    // strokes of fixed components in the colors of the axes, arrows in orange
    expect(colors).toEqual(expect.arrayContaining([...AXIS_COLORS, "#f5a524"]));
    expect(new Set(colors).size).toBe(colors.length);
    const hidden = boundaryLines(symbols, {
      size: 10,
      hidden: new Set(["fixed", "move", "pulled", "tension"]),
      highlight: "#ffd23f",
    });
    expect(hidden).toEqual([]);
    const chosen = boundaryLines(symbols, {
      size: 10,
      hidden: new Set(["move", "pulled", "tension"]),
      selected: "fixed",
      highlight: "#ffd23f",
    });
    expect(chosen).toHaveLength(1);
    expect(chosen[0]).toMatchObject({ color: "#ffd23f", width: 3 });
    // three components at six points, a stroke of two points each
    expect(chosen[0].positions.length).toBe(3 * 6 * 6);
  });
});
