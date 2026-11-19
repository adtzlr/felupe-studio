import { describe, expect, it } from "vitest";
import { encodeFrame, restore } from "./frames";
import { toWorkerMessage, transfers } from "./messages";

const bytes = (
  Type: typeof Float32Array | typeof Uint32Array,
  ...v: number[]
) => new Uint8Array(new Type(v).buffer);

const surface = () => ({
  positions: bytes(Float32Array, 0, 1, 2),
  triangles: bytes(Uint32Array, 0, 1, 2),
  edges: bytes(Uint32Array, 0, 1),
  owners: bytes(Uint32Array, 0),
  faces: null,
  cells: 1,
});

const resultSurface = () => ({
  name: "rubber",
  positions: bytes(Float32Array, 0, 1, 2),
  displacement: bytes(Float32Array, 0, 0, 0),
  triangles: bytes(Uint32Array, 0, 1, 2),
  edges: bytes(Uint32Array, 0, 1),
  values: bytes(Float32Array, 0.5),
  owners: bytes(Uint32Array, 0),
  nodes: bytes(Uint32Array, 0),
});

describe("the messages of Python (#311)", () => {
  it("restores the buffers of the parts of a frame, like a frame", () => {
    const message = { type: "bytes", id: 3, data: new Uint8Array([1, 2, 3]) };
    // the parts of felupe_studio.frames.split()
    const text = '{"type": "bytes", "id": 3, "data": {"$bytes": 0}}';
    const restored = restore(JSON.parse(text), [new Uint8Array([1, 2, 3])]);
    expect(restored).toEqual(message);
    expect(
      restore({ a: [{ $bytes: 1 }, null], b: 2 }, [
        new Uint8Array(0),
        new Uint8Array([7]),
      ]),
    ).toEqual({ a: [new Uint8Array([7]), null], b: 2 });
    expect(typeof encodeFrame({ type: "done", id: 1 })).toBe("string");
  });

  it("transfers the arrays of surfaces, scenes and files", () => {
    const info = toWorkerMessage({
      type: "mesh-info",
      id: 1,
      info: {},
      surfaces: { hexahedron: surface() },
    });
    expect(transfers(info).length).toBeGreaterThan(0);
    expect(transfers(info).every((b) => b instanceof ArrayBuffer)).toBe(true);

    const scene = { quantity: "displacement", surfaces: [resultSurface()] };
    const result = toWorkerMessage({ type: "result-scene", id: 2, scene });
    expect(transfers(result).length).toBeGreaterThan(0);

    const live = toWorkerMessage({
      type: "job-progress",
      id: 3,
      event: { event: "live", job: "job_1", substep: 1, scene },
    });
    expect(transfers(live).length).toBeGreaterThan(0);
    const start = toWorkerMessage({
      type: "job-progress",
      id: 3,
      event: { event: "finished", job: "job_1", time: 1 },
    });
    expect(transfers(start)).toEqual([]);

    const file = toWorkerMessage({
      type: "bytes",
      id: 4,
      data: new Uint8Array([1, 2]),
    });
    expect(transfers(file)).toEqual([(file as { data: ArrayBuffer }).data]);
    expect(
      transfers(toWorkerMessage({ type: "text", id: 5, text: "" })),
    ).toEqual([]);
  });
});
