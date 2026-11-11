// The loaded result scenes of substeps (#141): kept so that going back and playing
// the substeps again shows them at once, and filled ahead while playing. The least
// recently used scenes are dropped above a budget of memory.
import type { ResultScene } from "../worker/protocol";

/** The memory of the arrays of a scene, in bytes. */
export function sceneBytes(scene: ResultScene): number {
  return scene.surfaces.reduce(
    (sum, surface) =>
      sum +
      Object.values(surface).reduce(
        (bytes: number, value) =>
          bytes + (ArrayBuffer.isView(value) ? value.byteLength : 0),
        0,
      ),
    0,
  );
}

/** The default budget of the cache: 128 MB. */
export const SCENE_BUDGET = 128 * 2 ** 20;

export class SceneCache {
  // in the order of their use, the least recently used first
  private scenes = new Map<string, { scene: ResultScene; bytes: number }>();
  private total = 0;

  constructor(private budget = SCENE_BUDGET) {}

  has(key: string): boolean {
    return this.scenes.has(key);
  }

  /** The scene of a key, now the most recently used one. */
  get(key: string): ResultScene | undefined {
    const entry = this.scenes.get(key);
    if (!entry) return undefined;
    this.scenes.delete(key);
    this.scenes.set(key, entry);
    return entry.scene;
  }

  /** Keep a scene; the newest one is kept even if it is larger than the budget. */
  set(key: string, scene: ResultScene): void {
    const old = this.scenes.get(key);
    if (old) {
      this.total -= old.bytes;
      this.scenes.delete(key);
    }
    const bytes = sceneBytes(scene);
    this.scenes.set(key, { scene, bytes });
    this.total += bytes;
    for (const [oldest, entry] of this.scenes) {
      if (this.total <= this.budget || oldest === key) break;
      this.scenes.delete(oldest);
      this.total -= entry.bytes;
    }
  }

  clear(): void {
    this.scenes.clear();
    this.total = 0;
  }

  get size(): number {
    return this.scenes.size;
  }

  /** The memory of the kept scenes, in bytes. */
  get bytes(): number {
    return this.total;
  }
}
