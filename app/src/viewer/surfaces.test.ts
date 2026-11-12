import { describe, expect, it } from "vitest";
import type { Face, SectionFaces } from "./facesets";
import { selectedPoints } from "./pointsets";
import {
  connectedFaces,
  describeSurface,
  FEATURE_ANGLE,
  neighbours,
  nodesSelect,
} from "./surfaces";

type P = [number, number, number];

/** A quadrilateral face of four corners with an outward normal. */
function quad(corners: P[], normal: P): Face {
  const center = [0, 1, 2].map(
    (k) => corners.reduce((s, c) => s + c[k], 0) / 4,
  ) as P;
  const length = Math.hypot(...normal);
  return {
    triangles: [],
    nodes: Float64Array.from(corners.flat()),
    center,
    normal: normal.map((n) => n / length) as P,
  };
}

const section = (faces: Face[]) =>
  ({
    section: "body",
    mesh: "mesh",
    faces,
    ofTriangle: new Int32Array(),
    size: 1,
  }) as unknown as SectionFaces;

/** The faces of a box (0, 0, 0)–(2, 1, 1) with two cells along x. */
function box(): SectionFaces {
  const faces: Face[] = [];
  for (const [x0, x1] of [
    [0, 1],
    [1, 2],
  ]) {
    faces.push(
      quad(
        [
          [x0, 0, 0],
          [x1, 0, 0],
          [x1, 1, 0],
          [x0, 1, 0],
        ],
        [0, 0, -1],
      ),
      quad(
        [
          [x0, 0, 1],
          [x1, 0, 1],
          [x1, 1, 1],
          [x0, 1, 1],
        ],
        [0, 0, 1],
      ),
      quad(
        [
          [x0, 0, 0],
          [x1, 0, 0],
          [x1, 0, 1],
          [x0, 0, 1],
        ],
        [0, -1, 0],
      ),
      quad(
        [
          [x0, 1, 0],
          [x1, 1, 0],
          [x1, 1, 1],
          [x0, 1, 1],
        ],
        [0, 1, 0],
      ),
    );
  }
  for (const x of [0, 2]) {
    faces.push(
      quad(
        [
          [x, 0, 0],
          [x, 1, 0],
          [x, 1, 1],
          [x, 0, 1],
        ],
        [x === 0 ? -1 : 1, 0, 0],
      ),
    );
  }
  return section(faces);
}

/**
 * The faces of a tube along x (inner radius 25, outer radius 30, from x = -10 to
 * 10 in two cells) about the axis through (0, 5, -3), with `n` segments around.
 */
function tube(n: number): { of: SectionFaces; inner: number[] } {
  const faces: Face[] = [];
  const inner: number[] = [];
  const at = (x: number, r: number, i: number): P => {
    const phi = (2 * Math.PI * i) / n;
    return [x, 5 + r * Math.cos(phi), -3 + r * Math.sin(phi)];
  };
  const radial = (i: number): P => {
    const phi = (2 * Math.PI * (i + 0.5)) / n;
    return [0, Math.cos(phi), Math.sin(phi)];
  };
  for (let i = 0; i < n; i++) {
    for (const [x0, x1] of [
      [-10, 0],
      [0, 10],
    ]) {
      const out = radial(i);
      inner.push(faces.length);
      faces.push(
        quad(
          [at(x0, 25, i), at(x1, 25, i), at(x1, 25, i + 1), at(x0, 25, i + 1)],
          out.map((v) => -v) as P,
        ),
        quad(
          [at(x0, 30, i), at(x1, 30, i), at(x1, 30, i + 1), at(x0, 30, i + 1)],
          out,
        ),
      );
    }
    for (const x of [-10, 10]) {
      faces.push(
        quad(
          [at(x, 25, i), at(x, 30, i), at(x, 30, i + 1), at(x, 25, i + 1)],
          [Math.sign(x), 0, 0],
        ),
      );
    }
  }
  return { of: section(faces), inner };
}

describe("connected surfaces (#189)", () => {
  it("have neighbours that share an edge, not a corner", () => {
    const of = box();
    // the bottom face of the first cell: the other bottom face, the front and the
    // back face of its cell and the end face at x = 0
    expect(neighbours(of)[0].sort((a, b) => a - b)).toEqual([2, 3, 4, 8]);
  });

  it("follow the faces up to the feature angle", () => {
    const of = box();
    expect(connectedFaces(of, 0, FEATURE_ANGLE)).toEqual([0, 4]);
    expect(connectedFaces(of, 0, 0)).toEqual([0, 4]);
    expect(connectedFaces(of, 0, 90)).toHaveLength(10);
    expect(connectedFaces(of, 0, 180)).toHaveLength(10);
  });

  it("describe a plane normal to an axis", () => {
    const of = box();
    const nodes = [Float64Array.from(of.faces.flatMap((f) => [...f.nodes]))];
    const surface = describeSurface(of, [1, 5], nodes);
    expect(surface.kind).toBe("plane");
    if (surface.kind !== "plane") return;
    expect(surface.plane).toEqual({ axis: "z", value: 1 });
    expect(surface.nodes).toHaveLength(3 * 6);
    expect(surface).toMatchObject({ exactPoints: true, exactFaces: true });
    // a part of the plane: the plane would select more nodes and faces
    expect(describeSurface(of, [1], nodes)).toMatchObject({
      kind: "plane",
      exactPoints: false,
      exactFaces: false,
    });
  });

  it("describe a cylinder about an axis parallel to x, y or z", () => {
    const { of, inner } = tube(18);
    // 20° between the segments: one surface at 30°, a strip along x at 10°
    const faces = connectedFaces(of, inner[0], FEATURE_ANGLE);
    expect(faces).toEqual(inner);
    expect(connectedFaces(of, inner[0], 10)).toEqual(inner.slice(0, 2));
    const surface = describeSurface(of, faces, []);
    expect(surface).toMatchObject({
      kind: "cylinder",
      cylinder: { radius: 25, axis: "x", center: [0, 5, -3] },
    });
    if (surface.kind !== "cylinder") return;
    expect(surface.cylinder.atol).toBeUndefined();
    // the point set of the cylinder selects the nodes of the surface
    const points = selectedPoints(surface.cylinder, [surface.nodes]);
    expect(points).toHaveLength(surface.nodes.length);
    // a strip along x is still a part of a cylinder (curved, 20°)
    expect(describeSurface(of, inner.slice(0, 4), []).kind).toBe("cylinder");
  });

  it("need a larger angle for a coarse cylinder", () => {
    const { of, inner } = tube(6);
    expect(connectedFaces(of, inner[0], FEATURE_ANGLE)).toEqual(
      inner.slice(0, 2),
    );
    const faces = connectedFaces(of, inner[0], 60);
    expect(faces).toEqual(inner);
    expect(describeSurface(of, faces, [])).toMatchObject({
      kind: "cylinder",
      cylinder: { radius: 25, axis: "x" },
    });
  });

  it("describe other surfaces by their nodes", () => {
    const { of, inner } = tube(18);
    const all = connectedFaces(of, inner[0], 180);
    expect(all).toHaveLength(of.faces.length);
    const surface = describeSurface(of, all, []);
    expect(surface.kind).toBe("surface");
    // a flat strip of one segment is a plane, but not normal to an axis
    expect(describeSurface(of, inner.slice(0, 2), []).kind).toBe("surface");
    const select = nodesSelect(surface.nodes);
    expect("points" in select && select.points).toHaveLength(
      surface.nodes.length / 3,
    );
  });
});
