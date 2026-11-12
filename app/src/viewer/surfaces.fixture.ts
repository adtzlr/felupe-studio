// Faces of sections for the tests of picked surfaces (#189, #195): a box and a tube.
import type { Face, SectionFaces } from "./facesets";

type P = [number, number, number];

/** A quadrilateral face of four corners with an outward normal. */
export function quad(corners: P[], normal: P): Face {
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

export const section = (faces: Face[]) =>
  ({
    section: "body",
    mesh: "mesh",
    faces,
    ofTriangle: new Int32Array(),
    size: 1,
  }) as unknown as SectionFaces;

/** The faces of a box (0, 0, 0)–(2, 1, 1) with two cells along x. */
export function box(): SectionFaces {
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
export function tube(n: number): { of: SectionFaces; inner: number[] } {
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
