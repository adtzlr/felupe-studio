import { describe, expect, it } from "vitest";
import type { Command } from "../core/resolved";
import { loadLines } from "./loads";
import { VIEW_COLORS } from "./palette";

const nodes = [Float64Array.from([0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0])];

const commands = [
  { command: "pointset.add", name: "right", select: { axis: "x", value: 1 } },
  { command: "point.add", name: "plate", coordinates: [2, 0.5, 0] },
  { command: "load.add", name: "pull", points: "right", force: [3, 0, 0] },
  { command: "load.add", name: "push", points: "plate", force: [0, 0, -1] },
  { command: "load.add", name: "none", points: "plate", force: [0, 0, 0] },
] as Command[];

describe("point loads in the viewport (#100)", () => {
  it("are arrows at their points in the direction of the force", () => {
    const [pull, push] = loadLines(commands, nodes, {
      size: 10,
      colors: VIEW_COLORS.dark,
    });
    expect(pull.color).toBe(VIEW_COLORS.dark.force);
    // the first segment of an arrow: from the point along the force, 0.12 * size
    expect([...pull.positions.slice(0, 6)].map((x) => +x.toFixed(6))).toEqual([
      1, 0, 0, 2.2, 0, 0,
    ]);
    expect([...push.positions.slice(0, 6)].map((x) => +x.toFixed(6))).toEqual([
      2, 0.5, 0, 2, 0.5, -1.2,
    ]);
  });

  it("are highlighted, hidden, and without a force not drawn", () => {
    const lines = loadLines(commands, nodes, {
      size: 10,
      colors: VIEW_COLORS.dark,
      selected: "push",
      hidden: new Set(["pull"]),
    });
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({
      color: VIEW_COLORS.dark.highlight,
      width: 3,
    });
    // in the colors of the light theme (#375)
    const light = loadLines(commands, nodes, {
      size: 10,
      colors: VIEW_COLORS.light,
    });
    expect(light.map((l) => l.color)).toEqual([
      VIEW_COLORS.light.force,
      VIEW_COLORS.light.force,
    ]);
  });
});
