import { describe, expect, it } from "vitest";
import {
  resultTransferables,
  toResultScene,
  toSurface,
  toSurfaces,
  transferables,
} from "./surface";

const bytes = (array: Float32Array | Float64Array | Uint32Array | Int32Array) =>
  new Uint8Array(array.buffer.slice(0));

describe("surface of Python", () => {
  const raw = {
    positions: bytes(new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0])),
    triangles: bytes(new Uint32Array([0, 1, 2])),
    faces: bytes(new Uint32Array([0])),
    edges: bytes(new Uint32Array([0, 1, 1, 2, 2, 0])),
    owners: bytes(new Uint32Array([0])),
    tags: { material: bytes(new Int32Array([-3])) },
    nodes: bytes(new Float64Array([0.1, 0, 0])),
    cells: 1,
  };

  it("views the bytes as typed arrays without copies", () => {
    const surface = toSurface(raw);
    expect([...surface.positions]).toEqual([0, 0, 0, 1, 0, 0, 0, 1, 0]);
    expect([...surface.triangles]).toEqual([0, 1, 2]);
    expect([...surface.faces!]).toEqual([0]);
    expect([...surface.edges]).toEqual([0, 1, 1, 2, 2, 0]);
    expect(surface.positions.buffer).toBe(raw.positions.buffer);
    expect(surface.cells).toBe(1);
    expect([...surface.tags!.material]).toEqual([-3]);
    expect([...surface.nodes!]).toEqual([0.1, 0, 0]);
    expect(transferables(surface)).toHaveLength(7);
  });

  it("copies unaligned bytes and leaves out missing faces", () => {
    const shifted = new Uint8Array(13);
    shifted.set(bytes(new Uint32Array([0, 1, 2])), 1);
    const surface = toSurface({
      ...raw,
      triangles: shifted.subarray(1),
      faces: null,
    });
    expect([...surface.triangles]).toEqual([0, 1, 2]);
    expect(surface.faces).toBeUndefined();
    expect(transferables(surface)).toHaveLength(6);
  });

  it("converts the surfaces of all cell types", () => {
    const surfaces = toSurfaces({ hexahedron: raw, tetra: raw });
    expect(Object.keys(surfaces)).toEqual(["hexahedron", "tetra"]);
    expect(toSurfaces(undefined)).toEqual({});
    // shared buffers are transferred once
    expect(transferables(...Object.values(surfaces))).toHaveLength(7);
  });

  it("rejects truncated arrays", () => {
    expect(() => toSurface({ ...raw, positions: new Uint8Array(5) })).toThrow(
      "multiple of 4 bytes",
    );
  });
});

describe("result scene of Python", () => {
  it("views the bytes of every section as typed arrays", () => {
    const raw = {
      name: "body",
      positions: bytes(new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0])),
      displacement: bytes(new Float32Array([0, 0, 0, 0.5, 0, 0, 0, 0, 0])),
      triangles: bytes(new Uint32Array([0, 1, 2])),
      faces: null,
      edges: bytes(new Uint32Array([0, 1])),
      values: bytes(new Float32Array([0, 0.5, 0])),
    };
    const meta = {
      label: "Displacement",
      at: "point" as const,
      range: [0, 0.5] as [number, number],
    };
    const scene = toResultScene(meta, [raw]);
    expect(scene).toMatchObject(meta);
    const [surface] = scene.surfaces;
    expect(surface.name).toBe("body");
    expect([...surface.displacement]).toEqual([0, 0, 0, 0.5, 0, 0, 0, 0, 0]);
    expect([...surface.values]).toEqual([0, 0.5, 0]);
    expect(surface.faces).toBeUndefined();
    expect(surface.positions.buffer).toBe(raw.positions.buffer);
    expect(resultTransferables(scene)).toHaveLength(5);
  });
});
