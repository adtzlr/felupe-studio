import { describe, expect, it } from "vitest";
import { toSurface, transferables } from "./surface";

const bytes = (array: Float32Array | Uint32Array) =>
  new Uint8Array(array.buffer.slice(0));

describe("surface of Python", () => {
  const raw = {
    positions: bytes(new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0])),
    triangles: bytes(new Uint32Array([0, 1, 2])),
    faces: bytes(new Uint32Array([0])),
    edges: bytes(new Uint32Array([0, 1, 1, 2, 2, 0])),
    owners: bytes(new Uint32Array([0])),
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
    expect(transferables(surface)).toHaveLength(5);
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
    expect(transferables(surface)).toHaveLength(4);
  });

  it("rejects truncated arrays", () => {
    expect(() => toSurface({ ...raw, positions: new Uint8Array(5) })).toThrow(
      "multiple of 4 bytes",
    );
  });
});
