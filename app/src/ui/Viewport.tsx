import type { ComponentChildren } from "preact";
import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import type {
  Command,
  FaceSetAdd,
  MpcAdd,
  PointAdd,
  PointSetAdd,
} from "../core/commands";
import {
  constraintLines,
  constraintShapes,
  overConstrained,
} from "../viewer/constraints";
import { loadLines } from "../viewer/loads";
import { pressureLines } from "../viewer/pressures";
import type { MeshFiles } from "../core/meshfiles";
import type { ModelStore } from "../core/store";
import { useViewKeys } from "./hooks";
import { withHint } from "../core/shortcuts";
import { NodesButton, useShowNodes } from "./NodesButton";
import {
  COLOR_BY,
  type ColorBy,
  defaultColorBy,
  scaledSurface,
  viewportContent,
} from "../viewer/layers";
import {
  faceSetName,
  faceTriangles,
  missingCenters,
  type SectionFaces,
  sectionFaces,
  selectedFaces,
} from "../viewer/facesets";
import { axisOf, type Vec3 } from "../viewer/picking";
import {
  describeSurface,
  FEATURE_ANGLE,
  FEATURE_ANGLES,
  nodesSelect,
  type SectionPick,
  type Surface,
} from "../viewer/surfaces";
import { combine, type Patch, patchCounts, pickPatch } from "../viewer/patches";
import { toName } from "../core/importmesh";
import {
  type CoordinateSelect,
  centerOf,
  controlName,
  exactNode,
  boundOf,
  missingPoints,
  nodesName,
  outlined,
  planeName,
  planeSelect,
  selectedPoints,
  selectsNothing,
} from "../viewer/pointsets";
import {
  boundaryLines,
  boundarySymbols,
  emptyPlanes,
  modelSize,
} from "../viewer/boundaries";
import { CONTROL_COLOR, EXCLUDED_COLOR, FACE_COLOR } from "../viewer/palette";
import type { Highlight, Markers } from "../viewer/scene";
import {
  type CreateViewer,
  HIGHLIGHT,
  type Capture,
  type Pick,
  Viewer,
  VIEWS,
} from "../viewer/viewer";

interface Props {
  store: ModelStore;
  files: MeshFiles;
  /** Names of the objects hidden in the viewport. */
  hidden: ReadonlySet<string>;
  /** The selected object, e.g. a point set to highlight. */
  selected?: string;
  /** Create a point set, e.g. of a picked face or nodes (opens the dialog). */
  onCreatePointSet?: (preset: {
    name: string;
    select: PointSetAdd["select"];
  }) => void;
  /** Create a face set of a plane or of picked faces (opens the dialog, #142). */
  onCreateFaceSet?: (preset: {
    name: string;
    section: string;
    select: FaceSetAdd["select"];
  }) => void;
  /** Creates the viewer; the default is the vendored FElupe viewer. */
  createViewer?: CreateViewer;
  /** The viewport is shown (default); hidden in the Results workspace. */
  active?: boolean;
  /** Set to a function that returns a PNG of the view (none without a view). */
  capture?: Capture;
  /** Create a control point, e.g. at the center of a point set (opens the dialog). */
  onCreateControlPoint?: (preset: {
    name: string;
    coordinates: [number, number, number];
  }) => void;
  /** Select an object, e.g. a control point picked in the viewport (#95). */
  onSelect?: (name: string) => void;
  /** Show the nodes of the meshes (#91); without, the viewport keeps its own. */
  showNodes?: boolean;
  onShowNodes?: (show: boolean) => void;
  /** Shown instead of the message of an empty view, e.g. the welcome panel. */
  empty?: ComponentChildren;
}

/** A picked face: its plane, and the point set of the plane if it is normal to x, y or z. */
interface Picked {
  point: Vec3;
  normal: Vec3;
  select?: CoordinateSelect;
  /** The section of the picked face, if it is a face of its boundary (#142). */
  section?: string;
}

const isFaceSet = (c: Command): c is FaceSetAdd => c.command === "faceset.add";

/** The face of the boundary of a section at a picked triangle, if any. */
function faceAt(
  sections: ReadonlyMap<string, SectionFaces>,
  mesh: string,
  triangle: number,
): { section: string; face: number } | undefined {
  for (const of of sections.values()) {
    if (of.mesh !== mesh) continue;
    const face = of.ofTriangle[triangle] ?? -1;
    if (face >= 0) return { section: of.section, face };
  }
  return undefined;
}

/** Color of the markers of point sets, the selected one is highlighted. */
const POINTS = "#f2f4f8";

const isPointSet = (c: Command): c is PointSetAdd =>
  c.command === "pointset.add";

const isControl = (c: Command): c is PointAdd => c.command === "point.add";

const formatNumber = (value: number) => String(+value.toPrecision(6));

type Node3 = [number, number, number];

const sameNode = (a: readonly number[], b: readonly number[]) =>
  a[0] === b[0] && a[1] === b[1] && a[2] === b[2];

/** The feature angle of picked surfaces in degrees, kept in the browser (#189). */
const ANGLE = "felupe-studio.feature-angle";

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

/**
 * A short description of a picked surface, e.g. "Cylinder r = 25 about x", or of a
 * part of it if the shape selects more (then stored by its nodes and faces).
 */
function surfaceTitle(surface: Surface): string {
  const title = shapeTitle(surface);
  return surface.exactPoints ? title : `Part of the ${title.toLowerCase()}`;
}

function shapeTitle(surface: Surface): string {
  if (surface.kind === "plane") {
    return `Plane ${surface.plane.axis} = ${formatNumber(surface.plane.value)}`;
  }
  if (surface.kind === "cylinder") {
    const { radius, axis, center } = surface.cylinder;
    const through = center
      ? ` through (${center.map(formatNumber).join(", ")})`
      : "";
    return `Cylinder r = ${formatNumber(radius)} about ${axis}${through}`;
  }
  return "Surface";
}

/**
 * The counts of picked patches and faces (#195), e.g. "3 patches · 1 excluded · 54
 * faces of body"; the patches are counted if there are several or excluded ones.
 */
function pickedSummary(
  patches: readonly Patch[],
  faces: ReadonlyMap<string, readonly number[]>,
): string {
  const { selected, excluded } = patchCounts(patches);
  const parts: string[] = [];
  if (selected > 1 || excluded) {
    parts.push(`${selected} ${selected === 1 ? "patch" : "patches"}`);
  }
  if (excluded) parts.push(`${excluded} excluded`);
  const count = [...faces.values()].reduce((n, f) => n + f.length, 0);
  const of =
    faces.size === 1
      ? ` of ${[...faces.keys()][0]}`
      : faces.size > 1
        ? ` of ${faces.size} sections`
        : "";
  parts.push(`${count} ${count === 1 ? "face" : "faces"}${of}`);
  return parts.join(" · ");
}

/** The tip about picking is shown until the first pick or until it is dismissed. */
const TIP = "felupe-studio.tip.pick";

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

export function Viewport({
  store,
  files,
  hidden,
  selected,
  onCreatePointSet,
  onCreateFaceSet,
  createViewer,
  active = true,
  capture,
  showNodes,
  onShowNodes,
  onSelect,
  onCreateControlPoint,
  empty,
}: Props) {
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;
  const [nodesShown, toggleNodes] = useShowNodes(showNodes, onShowNodes);
  const host = useRef<HTMLDivElement>(null);
  const viewer = useRef<Viewer | null>(null);
  useViewKeys(active, viewer, toggleNodes);
  if (capture) {
    capture.current = async () => viewer.current?.snapshot();
  }
  const [available, setAvailable] = useState(true);
  const [picked, setPicked] = useState<Picked | undefined>();
  // the picked nodes, with their exact coordinates (#93)
  const [pickedNodes, setPickedNodes] = useState<Node3[]>([]);
  const pickedNodesRef = useRef(pickedNodes);
  pickedNodesRef.current = pickedNodes;
  // the picked surfaces: patches of connected faces, selected or excluded (#195)
  const [patches, setPatches] = useState<Patch[]>([]);
  const picking = patches.length > 0;
  // taps deselect and exclude like right clicks, for touch screens (#195)
  const [excluding, setExcluding] = useState(false);
  const excludingRef = useRef(excluding);
  excludingRef.current = excluding;
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
  // chosen by the user, else sections, cell sets or meshes, as the model has them
  const [chosen, setChosen] = useState<ColorBy | undefined>();
  const commands = store.commands;
  const colorBy = chosen ?? defaultColorBy(commands);
  const revision = files.revision;
  const content = useMemo(
    () => viewportContent(commands, files, hidden, colorBy),
    // the files change in place, their revision tells when
    [commands, files, revision, hidden, colorBy],
  );

  // the faces of the boundaries of the sections, for face sets (#142)
  const sections = useMemo(
    () => sectionFaces(commands, files, scaledSurface),
    [commands, files, revision],
  );
  const sectionsRef = useRef(sections);
  sectionsRef.current = sections;
  // the faces of the picked patches: selected, and excluded (#195)
  const combined = useMemo(
    () => combine(patches, sections, angle),
    [patches, sections, angle],
  );
  const faces = useMemo((): Highlight[] => {
    // the drawn triangles of faces (not of hidden cells)
    const highlight = (
      of: SectionFaces,
      indices: readonly number[],
      color: string,
      opacity: number,
    ): Highlight[] => {
      const layer = content.meshes.find((m) => m.name === of.mesh);
      if (!layer || !indices.length) return [];
      const shown = indices.filter((i) =>
        of.faces[i].triangles.every(
          (t) => !layer.hidden?.[of.surface.owners[t]],
        ),
      );
      return shown.length
        ? [
            {
              positions: of.surface.positions,
              triangles: faceTriangles(of, shown),
              color,
              opacity,
            },
          ]
        : [];
    };
    const sets = commands.filter(isFaceSet).filter((c) => !hidden.has(c.name));
    const picks = (
      map: Map<string, number[]>,
      color: string,
      opacity: number,
    ) =>
      [...map].flatMap(([section, indices]) => {
        const of = sections.get(section);
        return of ? highlight(of, indices, color, opacity) : [];
      });
    return [
      ...sets.flatMap((c) => {
        const of = sections.get(c.section);
        if (!of) return [];
        const chosen = c.name === selected;
        return highlight(
          of,
          selectedFaces(c.select, of),
          chosen ? HIGHLIGHT : FACE_COLOR,
          chosen ? 0.6 : 0.35,
        );
      }),
      ...picks(combined.faces, HIGHLIGHT, 0.6),
      ...picks(combined.excluded, EXCLUDED_COLOR, 0.75),
    ];
  }, [commands, hidden, selected, sections, content, combined]);
  // the centers of the selected face set without a face (the script raises an error)
  const missingFaces = useMemo(() => {
    const set = commands.find((c) => c.name === selected);
    if (!set || !isFaceSet(set)) return [];
    const of = sections.get(set.section);
    return of ? missingCenters(set.select, of) : [];
  }, [commands, selected, sections]);

  // the nodes of the drawn meshes, for previews of point sets
  const nodes = useMemo(
    () =>
      content.meshes.flatMap((m) => (m.surface.nodes ? [m.surface.nodes] : [])),
    [content],
  );
  const preview = useMemo(
    () => (picked?.select ? selectedPoints(picked.select, nodes) : undefined),
    [picked, nodes],
  );
  // the picked faces as a plane, a cylinder or a surface of nodes, and the points
  // of the point set it would create (#189), without the excluded points (#195)
  const surface = useMemo(() => {
    if (!picking && !excluding) return undefined;
    const of = (map: Map<string, number[]>): SectionPick[] =>
      [...map].flatMap(([section, faces]) => {
        const at = sections.get(section);
        return at ? [{ of: at, faces }] : [];
      });
    return describeSurface(of(combined.faces), nodes, of(combined.excluded));
  }, [picking, excluding, combined, sections, nodes]);
  const surfacePoints = useMemo(() => {
    if (!surface) return undefined;
    if (surface.kind === "plane" && surface.exactPoints)
      return selectedPoints(surface.plane, nodes);
    if (surface.kind === "cylinder" && surface.exactPoints)
      return selectedPoints(surface.cylinder, nodes);
    return surface.nodes;
  }, [surface, nodes]);
  const controls = useMemo(
    () => commands.filter(isControl).filter((c) => !hidden.has(c.name)),
    [commands, hidden],
  );
  const markers = useMemo((): Markers[] => {
    const sets = commands.filter(isPointSet).filter((c) => !hidden.has(c.name));
    const others = sets.filter((c) => c.name !== selected);
    const chosen = sets.find((c) => c.name === selected);
    const points = (list: PointSetAdd[]) => {
      const all = list.map((c) => selectedPoints(c.select, nodes));
      return Float64Array.from(all.flatMap((p) => [...p]));
    };
    return [
      ...outlined(points(others), POINTS),
      ...(chosen ? outlined(points([chosen]), HIGHLIGHT, 9) : []),
      ...(preview ? outlined(preview, HIGHLIGHT, 9) : []),
      ...(surfacePoints ? outlined(surfacePoints, HIGHLIGHT, 9) : []),
      ...outlined(Float64Array.from(pickedNodes.flat()), HIGHLIGHT, 9),
      // the control points, always shown (#95)
      ...outlined(
        Float64Array.from(
          controls
            .filter((c) => c.name !== selected)
            .flatMap((c) => c.coordinates),
        ),
        CONTROL_COLOR,
        10,
      ),
      ...outlined(
        Float64Array.from(
          controls
            .filter((c) => c.name === selected)
            .flatMap((c) => c.coordinates),
        ),
        HIGHLIGHT,
        11,
      ),
    ];
  }, [
    commands,
    hidden,
    selected,
    nodes,
    preview,
    surfacePoints,
    pickedNodes,
    controls,
  ]);

  // the nodes of the selected point set (by nodes) that the meshes do not have; the
  // script raises an error for them (#92)
  const missing = useMemo(() => {
    const set = commands.find((c) => c.name === selected);
    return set && isPointSet(set) ? missingPoints(set.select, nodes) : [];
  }, [commands, selected, nodes]);

  // the selected point set by a plane, at a bound or on a cylinder without points of
  // the drawn meshes, e.g. a wrong radius (#181)
  const selectsNone = useMemo(() => {
    const set = commands.find((c) => c.name === selected);
    return !!set && isPointSet(set) && selectsNothing(set.select, nodes);
  }, [commands, selected, nodes]);
  // the planes of the selected symmetry without nodes, e.g. a wrong coordinate (#186)
  const emptySymmetry = useMemo(() => {
    const symmetry = commands.find((c) => c.name === selected);
    return symmetry?.command === "symmetry.add"
      ? emptyPlanes(symmetry, nodes)
      : [];
  }, [commands, selected, nodes]);
  // the picked plane at a bound of the meshes, stored as the bound (#181)
  const pickedBound = useMemo(
    () => (picked?.select ? boundOf(picked.select, nodes) : undefined),
    [picked, nodes],
  );

  // the selected point set and its points, for a control point at its center (#96)
  const selectedSet = useMemo(() => {
    const set = commands.find((c) => c.name === selected);
    if (!set || !isPointSet(set) || hidden.has(set.name)) return undefined;
    const points = selectedPoints(set.select, nodes);
    return points.length ? { name: set.name, points } : undefined;
  }, [commands, selected, hidden, nodes]);
  const controlAt = (points: ArrayLike<number>, of?: string) =>
    onCreateControlPoint?.({
      name: controlName(of, commands),
      coordinates: centerOf(points),
    });

  // a control point at a node of the meshes is merged with it (ADR 0006)
  const atNode = useMemo(() => {
    const point = controls.find((c) => c.name === selected);
    if (!point || !nodes.length) return false;
    return missingPoints({ points: [point.coordinates] }, nodes).length === 0;
  }, [controls, selected, nodes]);

  // the boundaries and load cases: strokes of fixed components, arrows of moved
  // boundaries (#82)
  const symbols = useMemo(
    () => boundarySymbols(commands, nodes),
    [commands, nodes],
  );
  const size = useMemo(() => modelSize(nodes), [nodes]);
  // the multi-point constraints: lines from the center to the connected points (#99)
  const shapes = useMemo(
    () => constraintShapes(commands, nodes),
    [commands, nodes],
  );
  const lines = useMemo(
    () => [
      ...boundaryLines(symbols, {
        size,
        hidden,
        selected,
        highlight: HIGHLIGHT,
      }),
      ...constraintLines(shapes, { hidden, selected, highlight: HIGHLIGHT }),
      // the point loads: arrows in the direction of the force (#100)
      ...loadLines(commands, nodes, {
        size,
        hidden,
        selected,
        highlight: HIGHLIGHT,
      }),
      // the pressures: arrows normal to the faces of their face sets (#105)
      ...pressureLines(commands, sections, {
        size,
        hidden,
        selected,
        highlight: HIGHLIGHT,
      }),
    ],
    [symbols, size, hidden, selected, shapes, commands, nodes, sections],
  );
  // the points of the selected constraint that a boundary prescribes as well
  const overlaps = useMemo(() => {
    const constraint = commands.find(
      (c): c is MpcAdd => c.name === selected && c.command === "mpc.add",
    );
    if (!constraint) return [];
    const shape = shapes.find((s) => s.name === constraint.name);
    return overConstrained(constraint, shape, symbols);
  }, [commands, selected, shapes, symbols]);

  // the plane of a picked face, and its point set if it is normal to an axis (the
  // viewer calls it with the nodes of the latest render)
  const nodesRef = useRef(nodes);
  nodesRef.current = nodes;
  const planeOf = (pick: Pick): Picked => {
    const axis = axisOf(pick.normal);
    const face = faceAt(sectionsRef.current, pick.mesh, pick.triangle);
    return {
      point: pick.point,
      normal: pick.normal,
      ...(axis === undefined
        ? {}
        : { select: planeSelect(axis, pick.point, nodesRef.current) }),
      ...(face ? { section: face.section } : {}),
    };
  };

  // the viewer (and its WebGL context) is created when there is a mesh to show
  useEffect(() => {
    if (!viewer.current) {
      if (content.meshes.length === 0 || !host.current) return;
      viewer.current = new Viewer(host.current, createViewer);
      viewer.current.onPick((pick, click) => {
        setCopied(false);
        // a right click, or a tap with *Exclude* (#195)
        const right = !!click.right || excludingRef.current;
        if (click.target) {
          if (right) return;
          // a control point: select it (#95)
          setPicked(undefined);
          setPickedNodes([]);
          setPatches([]);
          onSelectRef.current?.(click.target);
          return;
        }
        if (click.node) {
          const node = exactNode(click.node, nodesRef.current);
          if (!right) {
            // a node: Shift adds or removes it, else it replaces the picked ones
            setPicked(undefined);
            setPatches([]);
            setPickedNodes((nodes) => {
              if (!click.shift) return [node];
              const others = nodes.filter((n) => !sameNode(n, node));
              return others.length < nodes.length ? others : [...nodes, node];
            });
            hideTip();
            return;
          }
          // a right click deselects a picked node, else it is one on the face
          if (pickedNodesRef.current.some((n) => sameNode(n, node))) {
            setPickedNodes((nodes) => nodes.filter((n) => !sameNode(n, node)));
            return;
          }
        }
        // a face of a section: a left click adds its connected surface up to the
        // feature angle (#189), a right click deselects or excludes it, Shift single
        // faces (#195)
        const at =
          pick && faceAt(sectionsRef.current, pick.mesh, pick.triangle);
        if (at) {
          setPicked(undefined);
          setPickedNodes([]);
          setPatches((current) =>
            pickPatch(
              current,
              at,
              { shift: click.shift, right },
              sectionsRef.current,
              angleRef.current,
            ),
          );
          hideTip();
          return;
        }
        if (right || click.shift) return;
        setPickedNodes([]);
        // the background keeps the picked surfaces (#195)
        if (pick) setPatches([]);
        setPicked(pick && planeOf(pick));
        if (pick) hideTip();
      });
      setAvailable(viewer.current.available);
    }
    viewer.current.setMeshes(content.meshes);
    viewer.current.setLegend(content.legend);
    viewer.current.setMarkers(markers);
    viewer.current.setLines(lines);
    viewer.current.setPlane(picked);
    viewer.current.setFaces(faces);
    viewer.current.setNodes(nodesShown);
    viewer.current.setTargets(
      controls.map((c) => ({ name: c.name, position: c.coordinates })),
    );
  }, [
    content,
    markers,
    lines,
    picked,
    faces,
    nodesShown,
    controls,
    createViewer,
  ]);

  // a changed feature angle follows the clicked faces of the patches, and is kept
  // (#189, #195)
  const chooseAngle = (value: number) => {
    setAngle(value);
    storeAngle(value);
  };
  const clearPatches = () => {
    setPatches([]);
    setExcluding(false);
  };

  // Escape clears a picked face or picked nodes, before the app clears the selection
  // (a listener of the capture phase)
  useEffect(() => {
    if (!picked && !pickedNodes.length && !picking && !excluding) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      event.preventDefault();
      setPicked(undefined);
      setPickedNodes([]);
      clearPatches();
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [picked, pickedNodes, picking, excluding]);

  // hidden nodes cannot stay picked
  useEffect(() => {
    if (!nodesShown) setPickedNodes([]);
  }, [nodesShown]);

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
      c.name === selected && isPointSet(c) && "points" in c.select,
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

  useEffect(
    () => () => {
      viewer.current?.dispose();
      viewer.current = null;
    },
    [],
  );

  const shown = content.meshes.length > 0;
  return (
    <main class="viewport" aria-label="Viewport" hidden={!active}>
      <div class="viewer" ref={host} />
      {shown && available && (
        <div class="view-toolbar" role="toolbar" aria-label="View">
          <button
            type="button"
            title={withHint("Fit the model into the view", "fit")}
            onClick={() => viewer.current?.fit()}
          >
            Fit
          </button>
          {VIEWS.map((view) => (
            <button
              key={view.id}
              type="button"
              title={withHint(view.title, view.shortcut)}
              aria-label={view.title}
              onClick={() => viewer.current?.setView(view.id)}
            >
              {view.label}
            </button>
          ))}
          <span class="toolbar-separator" aria-hidden="true" />
          <NodesButton pressed={nodesShown} onToggle={toggleNodes} />
          <span class="toolbar-separator" aria-hidden="true" />
          <select
            aria-label="Color by"
            title="Color the cells by mesh, cell set or section"
            value={colorBy}
            onChange={(event) =>
              setChosen(event.currentTarget.value as ColorBy)
            }
          >
            {COLOR_BY.map((option) => (
              <option key={option.id} value={option.id}>
                {option.label}
              </option>
            ))}
          </select>
        </div>
      )}
      {empty ??
        (content.message && (
          <p class="viewport-message muted">{content.message}</p>
        ))}
      {/* the panels and messages at the bottom, stacked between the axes and the
          job panel (#128) */}
      <div class="overlay-bottom">
        {shown &&
          selectedSet &&
          !picked &&
          !pickedNodes.length &&
          !picking &&
          !excluding &&
          onCreateControlPoint && (
            <div
              class="pick-panel"
              role="status"
              aria-label="Selected point set"
            >
              <span>
                <strong>{selectedSet.name}</strong>{" "}
                <span class="muted">
                  · {selectedSet.points.length / 3} points · center (
                  {centerOf(selectedSet.points).map(formatNumber).join(", ")})
                </span>
              </span>
              <button
                type="button"
                class="button"
                onClick={() => controlAt(selectedSet.points, selectedSet.name)}
              >
                Control point at center
              </button>
            </div>
          )}
        {shown &&
          available &&
          tip &&
          !picked &&
          !pickedNodes.length &&
          !picking &&
          !excluding &&
          !(selectedSet && onCreateControlPoint) && (
            <div class="pick-panel tip" role="note" aria-label="Tip">
              <span class="muted">
                {nodesShown
                  ? "Click a node to pick it, Shift+click for more."
                  : "Click faces to pick their surfaces for a point set or a face set, right-click to deselect, twice to exclude, Shift+click single faces."}
              </span>
              <button
                type="button"
                class="icon-button"
                aria-label="Dismiss the tip"
                onClick={hideTip}
              >
                ×
              </button>
            </div>
          )}
        {shown && picked && (
          <div class="pick-panel" role="status" aria-label="Picked face">
            {picked.select ? (
              <>
                <span>
                  Plane{" "}
                  <strong>
                    {picked.select.axis} = {formatNumber(picked.select.value)}
                  </strong>
                  {pickedBound && "bound" in pickedBound && (
                    <span class="muted"> ({pickedBound.bound})</span>
                  )}{" "}
                  <span class="muted">
                    · {(preview?.length ?? 0) / 3} points
                    {picked.select.atol !== undefined &&
                      ` · tolerance ${picked.select.atol}`}
                  </span>
                </span>
                {onCreatePointSet && (
                  <button
                    type="button"
                    class="button primary"
                    onClick={() => {
                      const select = picked.select!;
                      onCreatePointSet({
                        name: planeName(select, nodes, commands),
                        select: boundOf(select, nodes),
                      });
                      setPicked(undefined);
                    }}
                  >
                    Create point set
                  </button>
                )}
                {onCreateFaceSet && planeFaces && (
                  <button
                    type="button"
                    class="button"
                    title={`The ${planeFaces.count} faces of ${planeFaces.section} on the plane`}
                    onClick={() => {
                      const select = picked.select!;
                      onCreateFaceSet({
                        name: faceSetName(
                          select,
                          sections.get(planeFaces.section),
                          commands,
                        ),
                        section: planeFaces.section,
                        select,
                      });
                      setPicked(undefined);
                    }}
                  >
                    Create face set
                  </button>
                )}
                {onCreateControlPoint && preview && preview.length > 0 && (
                  <button
                    type="button"
                    class="button"
                    onClick={() => {
                      controlAt(
                        preview,
                        planeName(picked.select!, nodes, commands),
                      );
                      setPicked(undefined);
                    }}
                  >
                    Control point at center
                  </button>
                )}
              </>
            ) : (
              <span class="muted">
                This face is not normal to x, y or z. Point sets and face sets
                select planes normal to an axis; Shift+click picks faces.
              </span>
            )}
            <button
              type="button"
              class="icon-button"
              aria-label="Clear the picked face"
              onClick={() => setPicked(undefined)}
            >
              ×
            </button>
          </div>
        )}
        {/* the panel stays with *Exclude* pressed, for the next tap (#195) */}
        {shown && surface && (
          <div class="pick-panel" role="status" aria-label="Picked faces">
            <span>
              <strong>
                {picking ? surfaceTitle(surface) : "No faces picked"}
              </strong>
              {surface.kind === "plane" &&
                surface.exactPoints &&
                (() => {
                  const at = boundOf(surface.plane, nodes);
                  return "bound" in at ? (
                    <span class="muted"> ({at.bound})</span>
                  ) : null;
                })()}{" "}
              <span class="muted">
                · {pickedSummary(patches, combined.faces)} ·{" "}
                {(surfacePoints?.length ?? 0) / 3} points · right-click
                deselects, twice excludes
              </span>
            </span>
            <label
              class="pick-angle"
              title="The largest angle between the normals of neighbouring faces of a picked surface"
            >
              Angle{" "}
              <select
                aria-label="Feature angle"
                value={String(angle)}
                onChange={(event) =>
                  chooseAngle(Number(event.currentTarget.value))
                }
              >
                {FEATURE_ANGLES.map((a) => (
                  <option key={a} value={String(a)}>
                    {a}°
                  </option>
                ))}
              </select>
            </label>
            <button
              type="button"
              class="button"
              aria-pressed={excluding}
              title="Clicks deselect and exclude surfaces, like right clicks (for touch screens)"
              onClick={() => setExcluding((on) => !on)}
            >
              Exclude
            </button>
            {onCreatePointSet && (
              <button
                type="button"
                class="button primary"
                disabled={!surfacePoints?.length}
                title={
                  surfacePoints?.length
                    ? undefined
                    : "The picked faces have no points that are not excluded"
                }
                onClick={() => {
                  const taken = new Set(commands.map((c) => c.name));
                  onCreatePointSet(
                    surface.kind === "plane" && surface.exactPoints
                      ? {
                          name: planeName(surface.plane, nodes, commands),
                          select: boundOf(surface.plane, nodes),
                        }
                      : surface.kind === "cylinder" && surface.exactPoints
                        ? {
                            name: toName(
                              `r_${surface.cylinder.radius}`,
                              taken,
                              "points",
                            ),
                            select: surface.cylinder,
                          }
                        : {
                            name: toName("surface", taken, "points"),
                            select: nodesSelect(surface.nodes),
                          },
                  );
                  clearPatches();
                }}
              >
                Create point set
              </button>
            )}
            {onCreateFaceSet && (
              <button
                type="button"
                class="button"
                disabled={combined.faces.size !== 1}
                title={
                  combined.faces.size > 1
                    ? `A face set has faces of one section; the picked faces belong to ${combined.faces.size} sections`
                    : combined.faces.size === 0
                      ? "No faces are picked"
                      : undefined
                }
                onClick={() => {
                  const [entry] = combined.faces;
                  const of = entry && sections.get(entry[0]);
                  if (!entry || !of) return;
                  const [section, picks] = entry;
                  const taken = new Set(commands.map((c) => c.name));
                  const select =
                    surface.kind === "plane" && surface.exactFaces
                      ? surface.plane
                      : {
                          centers: picks.map((f) =>
                            of.faces[f].center.map((x) => +x.toPrecision(12)),
                          ) as [Node3, ...Node3[]],
                        };
                  onCreateFaceSet({
                    name:
                      surface.kind === "cylinder"
                        ? toName(
                            `faces_r_${surface.cylinder.radius}`,
                            taken,
                            "faces",
                          )
                        : faceSetName(select, of, commands),
                    section,
                    select,
                  });
                  clearPatches();
                }}
              >
                Create face set
              </button>
            )}
            {onCreateControlPoint &&
              surfacePoints &&
              surfacePoints.length > 0 && (
                <button
                  type="button"
                  class="button"
                  onClick={() => {
                    controlAt(
                      surfacePoints,
                      surface.kind === "plane" && surface.exactPoints
                        ? planeName(surface.plane, nodes, commands)
                        : undefined,
                    );
                    clearPatches();
                  }}
                >
                  Control point at center
                </button>
              )}
            <button
              type="button"
              class="icon-button"
              aria-label="Clear the picked faces"
              onClick={clearPatches}
            >
              ×
            </button>
          </div>
        )}
        {shown && pickedNodes.length > 0 && (
          <div class="pick-panel" role="status" aria-label="Picked nodes">
            <span>
              {pickedNodes.length === 1 ? (
                <>
                  Node{" "}
                  <strong>
                    ({pickedNodes[0].map(formatNumber).join(", ")})
                  </strong>
                </>
              ) : (
                <strong>{pickedNodes.length} nodes</strong>
              )}{" "}
              <span class="muted">· Shift+click for more</span>
            </span>
            <button type="button" class="button" onClick={copyNodes}>
              {copied ? "Copied" : "Copy"}
            </button>
            {target && (
              <button type="button" class="button" onClick={addToTarget}>
                Add to {target.name}
              </button>
            )}
            {onCreateControlPoint && (
              <button
                type="button"
                class="button"
                onClick={() => {
                  controlAt(pickedNodes.flat());
                  setPickedNodes([]);
                }}
              >
                Control point at center
              </button>
            )}
            {onCreatePointSet && (
              <button
                type="button"
                class="button primary"
                onClick={() => {
                  onCreatePointSet({
                    name: nodesName(pickedNodes.length, commands),
                    select: {
                      points: pickedNodes as [Node3, ...Node3[]],
                    },
                  });
                  setPickedNodes([]);
                }}
              >
                Create point set
              </button>
            )}
            <button
              type="button"
              class="icon-button"
              aria-label="Clear the picked nodes"
              onClick={() => setPickedNodes([])}
            >
              ×
            </button>
          </div>
        )}
        {shown && content.reading.length === 0 && missing.length > 0 && (
          <p class="viewport-status warning" role="status">
            {selected}: no node at{" "}
            {missing
              .slice(0, 3)
              .map((p) => `(${p.map(formatNumber).join(", ")})`)
              .join(", ")}
            {missing.length > 3 && ` and ${missing.length - 3} more`}
          </p>
        )}
        {shown && content.reading.length === 0 && selectsNone && (
          <p class="viewport-status warning" role="status">
            {selected}: no node of the meshes is selected
          </p>
        )}
        {shown && content.reading.length === 0 && emptySymmetry.length > 0 && (
          <p class="viewport-status warning" role="status">
            {`${selected}: no node of the meshes on the ${
              emptySymmetry.length > 1 ? "planes" : "plane"
            } ${emptySymmetry.join(", ")}`}
          </p>
        )}
        {shown && content.reading.length === 0 && missingFaces.length > 0 && (
          <p class="viewport-status warning" role="status">
            {selected}: no face with the center{" "}
            {missingFaces
              .slice(0, 3)
              .map((p) => `(${p.map(formatNumber).join(", ")})`)
              .join(", ")}
            {missingFaces.length > 3 && ` and ${missingFaces.length - 3} more`}
          </p>
        )}
        {shown && content.reading.length === 0 && overlaps.length > 0 && (
          <p class="viewport-status warning" role="status">
            {selected}:{" "}
            {overlaps
              .map(
                (o) =>
                  `${o.points} ${o.points === 1 ? "point is" : "points are"} also in ${o.boundary} (${o.components.join(", ")})`,
              )
              .join("; ")}
            : over-constrained.
          </p>
        )}
        {shown && content.reading.length === 0 && atNode && (
          <p class="viewport-status warning" role="status">
            {selected} is at a node of the meshes: the script merges it with the
            node.
          </p>
        )}
        {shown && content.reading.length > 0 && (
          <p class="viewport-status muted" role="status">
            Reading {content.reading.join(", ")} …
          </p>
        )}
      </div>
    </main>
  );
}
