import { describe, expect, it } from "vitest";
import { SceneCache, sceneBytes } from "./scenecache";
import type { ResultScene } from "../worker/protocol";

/** A scene with a surface of the given number of values (4 bytes each). */
const scene = (values: number): ResultScene => ({
  label: "Displacement",
  at: "point",
  range: [0, 1],
  surfaces: [
    {
      name: "body",
      positions: new Float32Array(values),
      displacement: new Float32Array(0),
      triangles: new Uint32Array(0),
      edges: new Uint32Array(0),
      values: new Float32Array(0),
      owners: new Uint32Array(0),
      nodes: new Int32Array(0),
    },
  ],
});

describe("the cache of the result scenes (#141)", () => {
  it("counts the bytes of the arrays of a scene", () => {
    expect(sceneBytes(scene(10))).toBe(40);
  });

  it("drops the least recently used scenes above its budget", () => {
    const cache = new SceneCache(100);
    const a = scene(10);
    cache.set("a", a);
    cache.set("b", scene(10));
    expect(cache.bytes).toBe(80);
    // a is used again: b is dropped first
    expect(cache.get("a")).toBe(a);
    cache.set("c", scene(10));
    expect([cache.has("a"), cache.has("b"), cache.has("c")]).toEqual([
      true,
      false,
      true,
    ]);
    expect(cache.bytes).toBe(80);
    // a scene again replaces the old one
    cache.set("c", scene(5));
    expect(cache.bytes).toBe(60);
    // the newest scene is kept even if it is larger than the budget
    cache.set("d", scene(50));
    expect(cache.size).toBe(1);
    expect(cache.has("d")).toBe(true);
    cache.clear();
    expect([cache.size, cache.bytes]).toEqual([0, 0]);
  });
});
