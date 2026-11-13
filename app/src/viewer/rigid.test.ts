import { describe, expect, it } from "vitest";
import type { Command } from "../core/commands";
import { contactPoints, extent, RIGID_COLOR, rigidShapes } from "./rigid";

// the nodes of a unit cube
const cube = [
  Float64Array.from([0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0, 0, 0, 1, 1, 0, 1]),
  Float64Array.from([1, 1, 1, 0, 1, 1]),
];

const plate: Command = {
  command: "rigid.add",
  name: "plate",
  coordinates: [5, 5, 2],
  shape: { normal: [0, 0, -1] },
};
const roller: Command = {
  command: "rigid.add",
  name: "roller",
  coordinates: [0.5, 0.5, 3],
  shape: { radius: 2, axis: [1, 0, 0] },
};

/** The points of a flat array of positions. */
const points = (positions: Float32Array) =>
  Array.from({ length: positions.length / 3 }, (_, i) =>
    Array.from(positions.slice(3 * i, 3 * i + 3)),
  );

describe("rigid surfaces (#219)", () => {
  it("know the center and the size of the model", () => {
    const { center, size } = extent(cube);
    expect(center).toEqual([0.5, 0.5, 0.5]);
    expect(size).toBeCloseTo(Math.sqrt(3));
    expect(extent([])).toEqual({ size: 1 });
  });

  it("draw a plane around the model, with its normal", () => {
    const { faces, lines } = rigidShapes([plate], cube, { highlight: "#ff0" });
    expect(faces).toHaveLength(1);
    const corners = points(faces[0].positions);
    // a square in the plane z = 2, around the model (not the reference point)
    expect(corners.every((p) => p[2] === 2)).toBe(true);
    const half = 0.6 * Math.sqrt(3);
    const xs = corners.map((p) => p[0]);
    expect(Math.min(...xs)).toBeCloseTo(0.5 - half, 5);
    expect(Math.max(...xs)).toBeCloseTo(0.5 + half, 5);
    expect([...faces[0].triangles]).toEqual([0, 1, 2, 0, 2, 3]);
    expect(faces[0]).toMatchObject({ color: RIGID_COLOR, opacity: 0.22 });
    // the outline and the arrow of the normal at the reference point, downwards
    const [outline, arrow] = lines;
    expect(outline.positions).toHaveLength(4 * 6);
    expect(Array.from(arrow.positions.slice(0, 3))).toEqual([5, 5, 2]);
    expect(arrow.positions[5]).toBeLessThan(2);
  });

  it("draw a cylinder as a tube along the model", () => {
    const { faces, lines } = rigidShapes([roller], cube, {
      highlight: "#ff0",
      selected: "roller",
    });
    const ring = points(faces[0].positions);
    // two rings of 48 points at the radius 2 about the axis x through (·, 0.5, 3)
    expect(ring).toHaveLength(96);
    for (const p of ring)
      expect(Math.hypot(p[1] - 0.5, p[2] - 3)).toBeCloseTo(2, 5);
    const xs = ring.map((p) => p[0]);
    expect(Math.min(...xs) + Math.max(...xs)).toBeCloseTo(1, 5);
    // selected: highlighted, no arrow
    expect(faces[0]).toMatchObject({ color: "#ff0", opacity: 0.4 });
    expect(lines).toHaveLength(1);
  });

  it("are moved by offsets and hidden", () => {
    const moved = rigidShapes([plate], cube, {
      highlight: "#ff0",
      offsets: new Map([["plate", [0, 0, -0.5]]]),
    });
    expect(points(moved.faces[0].positions).every((p) => p[2] === 1.5)).toBe(
      true,
    );
    expect(
      rigidShapes([plate], cube, {
        highlight: "#ff0",
        hidden: new Set(["plate"]),
      }),
    ).toEqual({ faces: [], lines: [] });
  });

  it("are flat in the xy-plane of a 2D model (#175)", () => {
    const settings = {
      command: "model.settings",
      name: "settings",
      analysis: "plane-strain",
    } as Command;
    const flat = [Float64Array.from([0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0])];
    const wall: Command = {
      command: "rigid.add",
      name: "wall",
      coordinates: [1, 0, 0],
      shape: { normal: [-1, 0, 0] },
    };
    const wheel: Command = {
      command: "rigid.add",
      name: "wheel",
      coordinates: [0.5, 2, 0],
      shape: { radius: 0.5, axis: [0, 0, 1] },
    };
    const { faces } = rigidShapes([settings, wall, wheel], flat, {
      highlight: "#ff0",
    });
    const [strip, disc] = faces.map((f) => points(f.positions));
    expect([...strip, ...disc].every((p) => p[2] === 0)).toBe(true);
    // the strip along the line x = 1, on the rigid side (x > 1)
    expect(strip.every((p) => p[0] >= 1 - 1e-6)).toBe(true);
    expect(Math.max(...strip.map((p) => p[1]))).toBeGreaterThan(1);
    // the disc of the roller, within its radius
    expect(
      disc.every((p) => Math.hypot(p[0] - 0.5, p[1] - 2) <= 0.5 + 1e-6),
    ).toBe(true);
  });

  it("know the points of a contact (#220)", () => {
    const top = {
      command: "pointset.add",
      name: "top",
      select: { axis: "z", value: 1 },
    } as Command;
    const contact = {
      command: "contact.add",
      name: "touch",
      points: "top",
      surface: "plate",
    } as Command & { command: "contact.add" };
    expect(contactPoints(contact, [top], cube, new Map())).toEqual([
      0, 0, 1, 1, 0, 1, 1, 1, 1, 0, 1, 1,
    ]);
    expect(
      contactPoints({ ...contact, points: "none" }, [top], cube, new Map()),
    ).toEqual([]);
  });
});
