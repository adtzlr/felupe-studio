import { describe, expect, it } from "vitest";
import type { SectionFaces } from "./facesets";
import { selectedPoints } from "./pointsets";
import {
  connectedFaces,
  describeSurface,
  FEATURE_ANGLE,
  neighbours,
  nodesSelect,
  surfaceNodes,
} from "./surfaces";
import { box, tube } from "./surfaces.fixture";

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
    const surface = describeSurface([{ of, faces: [1, 5] }], nodes);
    expect(surface.kind).toBe("plane");
    if (surface.kind !== "plane") return;
    expect(surface.plane).toEqual({ axis: "z", value: 1 });
    expect(surface.nodes).toHaveLength(3 * 6);
    expect(surface).toMatchObject({ exactPoints: true, exactFaces: true });
    // a part of the plane: the plane would select more nodes and faces
    expect(describeSurface([{ of, faces: [1] }], nodes)).toMatchObject({
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
    const surface = describeSurface([{ of, faces: faces }], []);
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
    expect(describeSurface([{ of, faces: inner.slice(0, 4) }], []).kind).toBe(
      "cylinder",
    );
  });

  it("need a larger angle for a coarse cylinder", () => {
    const { of, inner } = tube(6);
    expect(connectedFaces(of, inner[0], FEATURE_ANGLE)).toEqual(
      inner.slice(0, 2),
    );
    const faces = connectedFaces(of, inner[0], 60);
    expect(faces).toEqual(inner);
    expect(describeSurface([{ of, faces: faces }], [])).toMatchObject({
      kind: "cylinder",
      cylinder: { radius: 25, axis: "x" },
    });
  });

  it("describe other surfaces by their nodes", () => {
    const { of, inner } = tube(18);
    const all = connectedFaces(of, inner[0], 180);
    expect(all).toHaveLength(of.faces.length);
    const surface = describeSurface([{ of, faces: all }], []);
    expect(surface.kind).toBe("surface");
    // a flat strip of one segment is a plane, but not normal to an axis
    expect(describeSurface([{ of, faces: inner.slice(0, 2) }], []).kind).toBe(
      "surface",
    );
    const select = nodesSelect(surface.nodes);
    expect("points" in select && select.points).toHaveLength(
      surface.nodes.length / 3,
    );
  });

  it("combine sections and remove the nodes of excluded faces (#195)", () => {
    const of = box();
    const nodes = [Float64Array.from(of.faces.flatMap((f) => [...f.nodes]))];
    const [top, front] = [
      [1, 5],
      [2, 6],
    ];
    // top and front: the nodes of the edge between them once
    expect(surfaceNodes([{ of, faces: [...top, ...front] }])).toHaveLength(
      3 * 9,
    );
    expect(
      describeSurface([{ of, faces: [...top, ...front] }], nodes),
    ).toMatchObject({ kind: "surface", exactPoints: true });
    // the front excluded: the top without the nodes of the edge, still its faces
    const surface = describeSurface([{ of, faces: top }], nodes, [
      { of, faces: front },
    ]);
    expect(surface).toMatchObject({
      kind: "plane",
      plane: { axis: "z", value: 1 },
      exactPoints: false,
      exactFaces: true,
    });
    expect([...surface.nodes]).toEqual([1, 1, 1, 0, 1, 1, 2, 1, 1]);
    // everything excluded: no nodes
    expect(
      describeSurface([{ of, faces: top }], nodes, [{ of, faces: top }]),
    ).toMatchObject({ kind: "surface", nodes: new Float64Array() });
    // faces of two sections are no plane of a face set
    const other = { ...of, section: "other" } as SectionFaces;
    expect(
      describeSurface(
        [
          { of, faces: [1] },
          { of: other, faces: [5] },
        ],
        nodes,
      ),
    ).toMatchObject({ kind: "plane", exactPoints: true, exactFaces: false });
  });
});
