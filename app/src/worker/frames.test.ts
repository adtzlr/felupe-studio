import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { decodeFrame, encodeFrame } from "./frames";

// the frames of both sides (#240): made by Python (tests/test_serve.py) and by the
// app; each side decodes those of the other
const FRAMES = new URL("../../../tests/data/frames/", import.meta.url);

/** The message of the shared frames, its arrays as typed arrays of the app. */
const message = () => ({
  type: "mesh-info",
  id: 7,
  info: { file: "würfel.vtu", points: 8 },
  surfaces: {
    hexahedron: {
      positions: new Float32Array([0, 1, 2.5]),
      nodes: new Float64Array([1.5, -2]),
      tags: { part: new Int32Array([1, 2, 3]) },
      faces: null,
      cells: 1,
    },
  },
});

/** The decoded shared message with numbers instead of bytes. */
function numbers(decoded: unknown) {
  const m = decoded as ReturnType<typeof message> & {
    surfaces: { hexahedron: Record<string, unknown> };
  };
  const s = m.surfaces.hexahedron as unknown as {
    positions: Uint8Array;
    nodes: Uint8Array;
    tags: { part: Uint8Array };
  };
  const as = <T>(Type: new (b: ArrayBuffer) => T, bytes: Uint8Array) =>
    new Type(bytes.slice().buffer as ArrayBuffer);
  return {
    ...m,
    surfaces: {
      hexahedron: {
        ...m.surfaces.hexahedron,
        positions: [...as(Float32Array, s.positions)],
        nodes: [...as(Float64Array, s.nodes)],
        tags: { part: [...as(Int32Array, s.tags.part)] },
      },
    },
  };
}

const expected = {
  type: "mesh-info",
  id: 7,
  info: { file: "würfel.vtu", points: 8 },
  surfaces: {
    hexahedron: {
      positions: [0, 1, 2.5],
      nodes: [1.5, -2],
      tags: { part: [1, 2, 3] },
      faces: null,
      cells: 1,
    },
  },
};

describe("frames of the local runtime (#240)", () => {
  it("are text without bytes", () => {
    expect(encodeFrame({ type: "done", id: 1 })).toBe('{"type":"done","id":1}');
    expect(decodeFrame('{"type":"done","id":1}')).toEqual({
      type: "done",
      id: 1,
    });
  });

  it("are binary with bytes, aligned to 8 bytes", () => {
    const frame = encodeFrame(message()) as ArrayBuffer;
    const length = new DataView(frame).getUint32(0, true);
    expect((4 + length) % 8).toBe(0);
    const header = JSON.parse(
      new TextDecoder().decode(new Uint8Array(frame, 4, length)),
    ) as { buffers: [number, number][] };
    expect(header.buffers.map(([offset]) => offset % 8)).toEqual([0, 0, 0]);
    expect(numbers(decodeFrame(frame))).toEqual(expected);
    // the bytes are views of the frame, without a copy
    const decoded = decodeFrame(frame) as typeof expected;
    const nodes = decoded.surfaces.hexahedron.nodes as unknown as Uint8Array;
    expect(nodes.buffer).toBe(frame);
    // ArrayBuffers and lists
    const data = new Uint8Array([1, 2, 3]).buffer;
    const write = decodeFrame(
      encodeFrame({ type: "write-file", id: 2, name: "a", data, list: [data] }),
    ) as { data: Uint8Array; list: Uint8Array[] };
    expect([...write.data]).toEqual([1, 2, 3]);
    expect([...write.list[0]]).toEqual([1, 2, 3]);
  });

  it("of the app are those of the shared file", () => {
    const file = new URL("app.bin", FRAMES);
    const frame = new Uint8Array(encodeFrame(message()) as ArrayBuffer);
    if (process.env.UPDATE_FRAMES || !existsSync(file))
      writeFileSync(file, frame);
    expect(new Uint8Array(readFileSync(file))).toEqual(frame);
  });

  it("of Python are decoded", () => {
    const bytes = readFileSync(new URL("python.bin", FRAMES));
    const frame = bytes.buffer.slice(
      bytes.byteOffset,
      bytes.byteOffset + bytes.byteLength,
    ) as ArrayBuffer;
    expect(numbers(decodeFrame(frame))).toEqual(expected);
  });
});
