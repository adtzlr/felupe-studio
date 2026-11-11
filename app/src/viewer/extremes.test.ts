import { describe, expect, it } from "vitest";
import { extremeShape } from "./extremes";
import type { ResultExtreme, ResultScene } from "../worker/protocol";

// a unit cube cell 0 with its top face (z = 1) at the surface, two triangles, and
// the bottom face of the cell 1 below it
const surface = {
  name: "body",
  positions: Float32Array.from([
    0, 0, 1, 1, 0, 1, 1, 1, 1, 0, 1, 1, 0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0,
  ]),
  displacement: Float32Array.from([
    0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
  ]),
  triangles: Uint32Array.from([0, 1, 2, 0, 2, 3, 4, 6, 5, 4, 7, 6]),
  faces: Uint32Array.from([0, 0, 1, 1]),
  edges: new Uint32Array(),
  values: new Float32Array(4),
  owners: Uint32Array.from([0, 0, 1, 1]),
  nodes: Int32Array.from([0, 1, 2, 3, 4, 5, 6, 7]),
};
const scene: ResultScene = {
  label: "Stress",
  at: "cell",
  range: [0, 1],
  surfaces: [surface],
};
const extreme = (e: Partial<ResultExtreme>): ResultExtreme => ({
  value: 1,
  section: "body",
  at: "cell",
  index: 0,
  surface: true,
  position: [0.5, 0.5, 0.5],
  displacement: [0, 0, 0.5],
  ...e,
});

describe("the shape of an extreme (#140)", () => {
  it("outlines the outer faces of a cell, with the label at their centers", () => {
    const shape = extremeShape(scene, extreme({}), 2);
    expect(shape.dot).toBeUndefined();
    // the top face moved up by 2 × 1: its four edges, not the diagonal
    expect(shape.anchors).toEqual([[0.5, 0.5, 3]]);
    const segments = Array.from(shape.outline!);
    expect(segments).toHaveLength(4 * 6);
    expect(segments.filter((_, i) => i % 3 === 2).every((z) => z === 3)).toBe(
      true,
    );
    const diagonal = [0, 0, 3, 1, 1, 3];
    for (let s = 0; s < 4; s++) {
      const segment = segments.slice(6 * s, 6 * s + 6);
      expect(segment).not.toEqual(diagonal);
      expect(segment).not.toEqual([1, 1, 3, 0, 0, 3]);
    }
  });

  it("takes every triangle of curved faces, and a dot elsewhere", () => {
    const curved = { ...scene, surfaces: [{ ...surface, faces: undefined }] };
    expect(extremeShape(curved, extreme({}), 1).anchors).toHaveLength(2);
    // a node, a cell inside and a cell not drawn get a dot at the point
    for (const e of [
      extreme({ at: "point", index: 2 }),
      extreme({ surface: false }),
      extreme({ index: 9 }),
      extreme({ section: "other" }),
    ]) {
      const shape = extremeShape(scene, e, 2);
      expect(shape.dot).toEqual([0.5, 0.5, 1.5]);
      expect(shape.anchors).toEqual([[0.5, 0.5, 1.5]]);
      expect(shape.outline).toBeUndefined();
    }
  });
});
