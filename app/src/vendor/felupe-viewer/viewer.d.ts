// Types of the parts of the vendored FElupe viewer that the app uses.

/** A flat little-endian array of the scene. */
export interface SceneArray {
  dtype: "f4" | "u4" | "u1";
  size: number;
  data: ArrayBuffer | ArrayBufferView | string;
}

export interface SurfaceObject {
  type: "surface";
  positions: SceneArray;
  triangles?: SceneArray;
  faceIds?: SceneArray;
  edges?: SceneArray;
  color?: string;
  edgeColor?: string;
  lineWidth?: number;
  opacity?: number;
  faces?: boolean;
  smooth?: boolean;
  sharp?: boolean;
  values?: SceneArray;
  valuesAt?: "point" | "cell";
  range?: [number, number];
  label?: string;
  /** Show a scalar bar of the values (default is true), one per label. */
  scalarBar?: boolean;
  /** Displacements of the points, drawn scaled by `factor` (default is 1). */
  displacement?: SceneArray;
  factor?: number;
}

export interface PointsObject {
  type: "points";
  positions: SceneArray;
  color?: string;
  size?: number;
  opacity?: number;
}

export interface LinesObject {
  type: "lines";
  positions: SceneArray;
  color?: string;
  width?: number;
  opacity?: number;
}

export type SceneObject = SurfaceObject | PointsObject | LinesObject;

export interface Scene {
  objects: SceneObject[];
  legend?: { label: string; color: string }[] | null;
  view?: string;
  axes?: boolean;
}

/** Without WebGL2, the viewer shows a message and has no camera. */
export interface ViewerHandle {
  root: HTMLElement;
  /** The camera (rotation, target, size, zoom), changed in place by the viewer. */
  camera?: {
    basis: number[][];
    target: number[];
    radius: number;
    zoom: number;
    parallel: boolean;
  };
  update(scene: Scene, options?: { keepView?: boolean }): void;
  /** Set a view of the camera (or keep the rotation if null) and fit the scene. */
  setView?(view: string | null): void;
  redraw?(): void;
  dispose(): void;
}

export function createViewer(
  element: HTMLElement,
  scene: Scene,
  options?: { wheelOnFocus?: boolean },
): ViewerHandle;
