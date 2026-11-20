// Picking in the viewport (#312): a picked face and its plane (#93), picked nodes,
// picked surfaces of connected faces with their feature angle (#189, #195), the
// tip about picking, and the click of the viewer that picks them (#260).
import { storageKey } from "../brand";
import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import type { Command, PointSetAdd } from "../core/resolved";
import type { ModelStore } from "../core/store";
import { type SectionFaces, selectedFaces, sideAt } from "../viewer/facesets";
import {
  combine,
  type FaceAt,
  faceState,
  type Patch,
  pickPatch,
} from "../viewer/patches";
import { axisOf, type Vec3 } from "../viewer/picking";
import {
  boundOf,
  type CoordinateSelect,
  exactNode,
  planeSelect,
  selectedPoints,
} from "../viewer/pointsets";
import {
  describeSurface,
  FEATURE_ANGLE,
  FEATURE_ANGLES,
  type SectionPick,
} from "../viewer/surfaces";
import type { Click, Pick } from "../viewer/viewer";

/** A picked face: its plane, and the point set of the plane if it is normal to x, y or z. */
export interface Picked {
  point: Vec3;
  normal: Vec3;
  select?: CoordinateSelect;
  /** The section of the picked face, if it is a face of its boundary (#142). */
  section?: string;
}

export type Node3 = [number, number, number];

export const sameNode = (a: readonly number[], b: readonly number[]) =>
  a[0] === b[0] && a[1] === b[1] && a[2] === b[2];

/**
 * The face of the boundary of a section at a picked triangle, if any: of a 2D model
 * (#175), the nearest side of the picked cell on the boundary of its section.
 */
function faceAt(
  sections: ReadonlyMap<string, SectionFaces>,
  { mesh, triangle, point }: Pick,
): { section: string; face: number } | undefined {
  for (const of of sections.values()) {
    if (of.mesh !== mesh) continue;
    const face = of.planar
      ? sideAt(of, triangle, point)
      : (of.ofTriangle[triangle] ?? -1);
    if (face >= 0) return { section: of.section, face };
  }
  return undefined;
}

/** The feature angle of picked surfaces in degrees, kept in the browser (#189). */
const ANGLE = storageKey("feature-angle");

function storedAngle(): number {
  try {
    const value = Number(localStorage.getItem(ANGLE));
    return (FEATURE_ANGLES as readonly number[]).includes(value)
      ? value
      : FEATURE_ANGLE;
  } catch {
    return FEATURE_ANGLE;
  }
}

function storeAngle(angle: number): void {
  try {
    localStorage.setItem(ANGLE, String(angle));
  } catch {
    // storage may be unavailable, e.g. in a private window
  }
}

/** The tip about picking is shown until the first pick or until it is dismissed. */
const TIP = storageKey("tip.pick");

function tipSeen(): boolean {
  try {
    return localStorage.getItem(TIP) === "seen";
  } catch {
    return false;
  }
}

function rememberTip(): void {
  try {
    localStorage.setItem(TIP, "seen");
  } catch {
    // storage may be unavailable, e.g. in a private window
  }
}

interface Options {
  store: ModelStore;
  commands: readonly Command[];
  /** The faces of the boundaries of the sections, for face sets (#142). */
  sections: ReadonlyMap<string, SectionFaces>;
  /** The nodes of the drawn meshes. */
  nodes: Float64Array[];
  /** A 2D model (#175): its plane is no plane of its point sets. */
  planar: boolean;
  nodesShown: boolean;
  selected?: string;
  /** The word of a click, `tap` on a touch screen (#273). */
  tap: string;
  onSelect?: (name: string) => void;
}

export function usePicking({
  store,
  commands,
  sections,
  nodes,
  planar,
  nodesShown,
  selected,
  tap,
  onSelect,
}: Options) {
  // the viewer calls back with the values of the latest render
  const latest = useRef({ sections, nodes, planar, onSelect });
  latest.current = { sections, nodes, planar, onSelect };
  const [picked, setPicked] = useState<Picked | undefined>();
  // the picked nodes, with their exact coordinates (#93)
  const [pickedNodes, setPickedNodes] = useState<Node3[]>([]);
  const pickedNodesRef = useRef(pickedNodes);
  pickedNodesRef.current = pickedNodes;
  // the picked surfaces: patches of connected faces, selected or excluded (#195)
  const [patches, setPatches] = useState<Patch[]>([]);
  const picking = patches.length > 0;
  // the face of the last click on a surface: the panel names what the next click
  // does (#260)
  const [lastFace, setLastFace] = useState<FaceAt | undefined>();
  // the feature angle of a clicked surface (#189)
  const [angle, setAngle] = useState(storedAngle);
  const angleRef = useRef(angle);
  angleRef.current = angle;
  const [copied, setCopied] = useState(false);
  const [tip, setTip] = useState(() => !tipSeen());
  const hideTip = () => {
    setTip(false);
    rememberTip();
  };

  /** The plane of a picked face, and its point set if it is normal to an axis. */
  const planeOf = (pick: Pick): Picked => {
    const { sections, nodes, planar } = latest.current;
    // the plane of a 2D model is no plane of its point sets (#175)
    const normal = axisOf(pick.normal);
    const axis = normal === 2 && planar ? undefined : normal;
    const face = faceAt(sections, pick);
    return {
      point: pick.point,
      normal: pick.normal,
      ...(axis === undefined
        ? {}
        : { select: planeSelect(axis, pick.point, nodes) }),
      ...(face ? { section: face.section } : {}),
    };
  };

  /** A control point: select it (#95). */
  const pickTarget = (target: string) => {
    setPicked(undefined);
    setPickedNodes([]);
    setPatches([]);
    latest.current.onSelect?.(target);
  };

  /**
   * A node: a click on a picked node deselects it (#260), Shift adds or removes it,
   * else it replaces the picked ones; a right click deselects a picked node. Whether
   * the click was taken (a right click on a node that is not picked is one on the
   * face).
   */
  const pickNode = (node: Node3, click: Click) => {
    if (!click.right) {
      setPicked(undefined);
      setPatches([]);
      setPickedNodes((nodes) => {
        const others = nodes.filter((n) => !sameNode(n, node));
        if (others.length < nodes.length) return others;
        return click.shift ? [...nodes, node] : [node];
      });
      hideTip();
      return true;
    }
    if (!pickedNodesRef.current.some((n) => sameNode(n, node))) return false;
    setPickedNodes((nodes) => nodes.filter((n) => !sameNode(n, node)));
    return true;
  };

  /**
   * A face of a section: a click cycles its connected surface up to the feature
   * angle (#189) through picked, excluded and not picked (#260), a right click
   * deselects it at once, Shift single faces (#195).
   */
  const pickFace = (at: FaceAt, click: Click) => {
    setPicked(undefined);
    setPickedNodes([]);
    setLastFace(at);
    setPatches((current) =>
      pickPatch(
        current,
        at,
        { shift: click.shift, right: !!click.right },
        latest.current.sections,
        angleRef.current,
      ),
    );
    hideTip();
  };

  /** A pick of the viewer: of a control point, a node, a face or the background. */
  const onPick = (pick: Pick | undefined, click: Click) => {
    setCopied(false);
    // a right click deselects at once (#195), a click cycles (#260)
    const right = !!click.right;
    if (click.target) {
      if (!right) pickTarget(click.target);
      return;
    }
    if (click.node) {
      const node = exactNode(click.node, latest.current.nodes);
      if (pickNode(node, click)) return;
    }
    const at = pick && faceAt(latest.current.sections, pick);
    if (at) return pickFace(at, click);
    if (right || click.shift) return;
    setPickedNodes([]);
    // the background keeps the picked surfaces (#195)
    if (pick) setPatches([]);
    setPicked(pick && planeOf(pick));
    if (pick) hideTip();
  };

  const clearPatches = () => {
    setPatches([]);
    setLastFace(undefined);
  };

  // Escape clears a picked face or picked nodes, before the app clears the selection
  // (a listener of the capture phase)
  useEffect(() => {
    if (!picked && !pickedNodes.length && !picking) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      event.preventDefault();
      setPicked(undefined);
      setPickedNodes([]);
      clearPatches();
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [picked, pickedNodes, picking]);

  // hidden nodes cannot stay picked
  useEffect(() => {
    if (!nodesShown) setPickedNodes([]);
  }, [nodesShown]);

  // the faces of the picked patches: selected, and excluded (#195)
  const combined = useMemo(
    () => combine(patches, sections, angle),
    [patches, sections, angle],
  );
  // what the next click on the last clicked surface does (#260)
  const nextClick = useMemo(() => {
    if (!lastFace) return undefined;
    const state = faceState(combined, lastFace);
    if (state === "selected") return `${tap} again to exclude`;
    if (state === "excluded") return `${tap} again to deselect`;
    return `${tap} again to pick`;
  }, [combined, lastFace, tap]);
  // the points of the plane of a picked face
  const preview = useMemo(
    () => (picked?.select ? selectedPoints(picked.select, nodes) : undefined),
    [picked, nodes],
  );
  // the picked faces as a plane, a cylinder or a surface of nodes, and the points
  // of the point set it would create (#189), without the excluded points (#195)
  const surface = useMemo(() => {
    if (!picking) return undefined;
    const of = (map: Map<string, number[]>): SectionPick[] =>
      [...map].flatMap(([section, faces]) => {
        const at = sections.get(section);
        return at ? [{ of: at, faces }] : [];
      });
    return describeSurface(of(combined.faces), nodes, of(combined.excluded));
  }, [picking, combined, sections, nodes]);
  const surfacePoints = useMemo(() => {
    if (!surface) return undefined;
    if (surface.kind === "plane" && surface.exactPoints)
      return selectedPoints(surface.plane, nodes);
    if (surface.kind === "cylinder" && surface.exactPoints)
      return selectedPoints(surface.cylinder, nodes);
    return surface.nodes;
  }, [surface, nodes]);
  // the picked plane at a bound of the meshes, stored as the bound (#181)
  const pickedBound = useMemo(
    () => (picked?.select ? boundOf(picked.select, nodes) : undefined),
    [picked, nodes],
  );
  // the faces of the section of a picked face on its plane, for a face set (#142)
  const planeFaces = useMemo(() => {
    if (!picked?.select || !picked.section) return undefined;
    const of = sections.get(picked.section);
    const count = of ? selectedFaces(picked.select, of).length : 0;
    return count ? { section: picked.section, count } : undefined;
  }, [picked, sections]);

  // the selected point set by nodes can take the picked nodes
  const target = commands.find(
    (c): c is PointSetAdd =>
      c.name === selected &&
      c.command === "pointset.add" &&
      "points" in c.select,
  );
  const addToTarget = () => {
    if (!target || !("points" in target.select)) return;
    const points = [...target.select.points];
    for (const node of pickedNodes)
      if (!points.some((p) => sameNode(p, node))) points.push(node);
    store.update(target.name, {
      ...target,
      select: {
        ...target.select,
        points: points as typeof target.select.points,
      },
    });
    setPickedNodes([]);
  };
  const copyNodes = async () => {
    const text = pickedNodes.map((n) => n.join(", ")).join("\n");
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
    } catch {
      // the clipboard may be unavailable, e.g. without a secure context
    }
  };

  return {
    onPick,
    picked,
    clearPicked: () => setPicked(undefined),
    pickedNodes,
    clearNodes: () => setPickedNodes([]),
    patches,
    picking,
    combined,
    clearPatches,
    nextClick,
    preview,
    surface,
    surfacePoints,
    pickedBound,
    planeFaces,
    /** A changed feature angle follows the clicked faces, and is kept (#189, #195). */
    angle,
    chooseAngle: (value: number) => {
      setAngle(value);
      storeAngle(value);
    },
    tip,
    hideTip,
    copied,
    copyNodes,
    target,
    addToTarget,
    /** Nothing is picked: no face, no nodes and no surface. */
    idle: !picked && !pickedNodes.length && !picking,
  };
}

export type Picking = ReturnType<typeof usePicking>;
