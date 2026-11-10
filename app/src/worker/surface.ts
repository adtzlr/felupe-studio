// Conversion of the surface of `felupe_studio.scene.surface()` (bytes, converted to
// Uint8Array by Pyodide) into the typed arrays of the viewer.
import type { MeshSurface } from "./protocol";

/** The surface as returned by Python, after `toJs()`. */
export interface RawSurface {
  positions: Uint8Array;
  triangles: Uint8Array;
  faces?: Uint8Array | null;
  edges: Uint8Array;
  owners: Uint8Array;
  tags?: Record<string, Uint8Array>;
  nodes?: Uint8Array;
  cells: number;
}

type Typed =
  | typeof Float32Array
  | typeof Float64Array
  | typeof Uint32Array
  | typeof Int32Array;

function view<T extends Typed>(Type: T, bytes: Uint8Array): InstanceType<T> {
  const size = Type.BYTES_PER_ELEMENT;
  if (bytes.byteLength % size !== 0) {
    throw new Error(`Expected a multiple of ${size} bytes.`);
  }
  // a view without a copy, if the bytes are aligned
  const aligned = bytes.byteOffset % size === 0;
  const data = aligned ? bytes : bytes.slice();
  return new Type(
    data.buffer as ArrayBuffer,
    data.byteOffset,
    data.byteLength / size,
  ) as InstanceType<T>;
}

export function toSurface(raw: RawSurface): MeshSurface {
  const surface: MeshSurface = {
    positions: view(Float32Array, raw.positions),
    triangles: view(Uint32Array, raw.triangles),
    edges: view(Uint32Array, raw.edges),
    owners: view(Uint32Array, raw.owners),
    cells: raw.cells,
  };
  if (raw.faces) surface.faces = view(Uint32Array, raw.faces);
  if (raw.nodes) surface.nodes = view(Float64Array, raw.nodes);
  if (raw.tags) {
    surface.tags = Object.fromEntries(
      Object.entries(raw.tags).map(([name, b]) => [name, view(Int32Array, b)]),
    );
  }
  return surface;
}

/** The surfaces by cell type of `felupe_studio.meshes.load()`. */
export function toSurfaces(
  raw: Record<string, RawSurface> | undefined,
): Record<string, MeshSurface> {
  return Object.fromEntries(
    Object.entries(raw ?? {}).map(([type, s]) => [type, toSurface(s)]),
  );
}

/** The buffers of surfaces, to transfer them to another thread. */
export function transferables(
  ...surfaces: readonly MeshSurface[]
): ArrayBuffer[] {
  const buffers = new Set<ArrayBuffer>();
  for (const surface of surfaces) {
    for (const array of [
      surface.positions,
      surface.triangles,
      surface.faces,
      surface.edges,
      surface.owners,
      surface.nodes,
      ...Object.values(surface.tags ?? {}),
    ]) {
      if (array) buffers.add(array.buffer as ArrayBuffer);
    }
  }
  return [...buffers];
}
