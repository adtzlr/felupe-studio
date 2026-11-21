// The overlays of the objects in the viewport (#312): the faces of face sets and of
// picked surfaces, the markers of point sets, control points and picked points, the
// lines of boundaries, constraints, loads, pressures and rigid surfaces, and what
// the viewport warns about the selected object.
import { useMemo } from "preact/hooks";
import type {
  Command,
  ContactAdd,
  FaceSetAdd,
  MpcAdd,
  PointAdd,
  PointSetAdd,
  RigidAdd,
} from "../core/resolved";
import {
  boundaryLines,
  boundarySymbols,
  emptyPlanes,
  modelSize,
} from "../viewer/boundaries";
import {
  constraintLines,
  constraintShapes,
  overConstrained,
} from "../viewer/constraints";
import {
  type SectionFaces,
  faceTriangles,
  missingCenters,
  selectedFaces,
  sideRibbons,
} from "../viewer/facesets";
import type { viewportContent } from "../viewer/layers";
import { loadLines } from "../viewer/loads";
import {
  EXCLUDED_COLOR,
  FACE_COLOR,
  POINT_COLOR,
  type ViewColors,
} from "../viewer/palette";
import {
  missingPoints,
  outlined,
  selectedPoints,
  selectsNothing,
} from "../viewer/pointsets";
import { pressureLines } from "../viewer/pressures";
import { contactPoints, rigidShapes } from "../viewer/rigid";
import type { Highlight, Markers } from "../viewer/scene";
import type { Picking } from "./usePicking";

const isFaceSet = (c: Command): c is FaceSetAdd => c.command === "faceset.add";

const isPointSet = (c: Command): c is PointSetAdd =>
  c.command === "pointset.add";

// the control points and the reference points of the rigid surfaces (#219)
const isControl = (c: Command): c is PointAdd | RigidAdd =>
  c.command === "point.add" || c.command === "rigid.add";

type Content = ReturnType<typeof viewportContent>;

/** The drawn triangles of the faces of a section (not of hidden cells). */
function highlight(
  content: Content,
  of: SectionFaces,
  indices: readonly number[],
  color: string,
  opacity: number,
): Highlight[] {
  const layer = content.meshes.find((m) => m.name === of.mesh);
  if (!layer || !indices.length) return [];
  const shown = indices.filter((i) => {
    const face = of.faces[i];
    // a side of a 2D cell (#175) is shown with its cell
    if (face.owner !== undefined) return !layer.hidden?.[face.owner];
    return face.triangles.every((t) => !layer.hidden?.[of.surface.owners[t]]);
  });
  if (!shown.length) return [];
  // the sides of 2D cells as ribbons inside the cells
  if (of.planar) {
    return [{ ...sideRibbons(of, shown, 0.015 * of.size), color, opacity }];
  }
  return [
    {
      positions: of.surface.positions,
      triangles: faceTriangles(of, shown),
      color,
      opacity,
    },
  ];
}

interface Options {
  commands: readonly Command[];
  content: Content;
  sections: ReadonlyMap<string, SectionFaces>;
  hidden: ReadonlySet<string>;
  selected?: string;
  /** The nodes of the drawn meshes. */
  nodes: Float64Array[];
  /** The points on the outer surface of the drawn meshes (#222). */
  outer: Float64Array[];
  picking: Picking;
  /** The colors of the view in the theme of the app (#375). */
  colors: ViewColors;
}

export function useOverlays({
  commands,
  content,
  sections,
  hidden,
  selected,
  nodes,
  outer,
  picking,
  colors,
}: Options) {
  const { combined, preview, surfacePoints, pickedNodes } = picking;
  // the nodes of a section, for point sets of a section (#241)
  const ofSection = (name: string) => sections.get(name)?.nodes;
  const choice = commands.find((c) => c.name === selected);

  const faces = useMemo((): Highlight[] => {
    const sets = commands.filter(isFaceSet).filter((c) => !hidden.has(c.name));
    const picks = (
      map: Map<string, number[]>,
      color: string,
      opacity: number,
    ) =>
      [...map].flatMap(([section, indices]) => {
        const of = sections.get(section);
        return of ? highlight(content, of, indices, color, opacity) : [];
      });
    return [
      ...sets.flatMap((c) => {
        const of = sections.get(c.section);
        if (!of) return [];
        const chosen = c.name === selected;
        return highlight(
          content,
          of,
          selectedFaces(c.select, of),
          chosen ? colors.highlight : FACE_COLOR,
          chosen ? 0.6 : 0.35,
        );
      }),
      ...picks(combined.faces, colors.highlight, 0.6),
      ...picks(combined.excluded, EXCLUDED_COLOR, 0.75),
    ];
  }, [commands, hidden, selected, sections, content, combined, colors]);

  const controls = useMemo(
    () => commands.filter(isControl).filter((c) => !hidden.has(c.name)),
    [commands, hidden],
  );
  const markers = useMemo((): Markers[] => {
    const sets = commands.filter(isPointSet).filter((c) => !hidden.has(c.name));
    const others = sets.filter((c) => c.name !== selected);
    const chosen = sets.find((c) => c.name === selected);
    const points = (list: PointSetAdd[]) => {
      const all = list.map((c) =>
        selectedPoints(c.select, nodes, outer, ofSection),
      );
      return Float64Array.from(all.flatMap((p) => [...p]));
    };
    // the points of the selected contact (#220): of its point set or face set
    const contact = commands.find(
      (c): c is ContactAdd =>
        c.name === selected && c.command === "contact.add",
    );
    const touching = contact
      ? contactPoints(contact, commands, nodes, sections, outer)
      : [];
    const coordinates = (list: readonly (PointAdd | RigidAdd)[]) =>
      Float64Array.from(list.flatMap((c) => c.coordinates));
    return [
      ...outlined(points(others), POINT_COLOR),
      ...(chosen ? outlined(points([chosen]), colors.highlight, 9) : []),
      ...outlined(Float64Array.from(touching), colors.highlight, 9),
      ...(preview ? outlined(preview, colors.highlight, 9) : []),
      ...(surfacePoints ? outlined(surfacePoints, colors.highlight, 9) : []),
      ...outlined(Float64Array.from(pickedNodes.flat()), colors.highlight, 9),
      // the control points, always shown (#95)
      ...outlined(
        coordinates(controls.filter((c) => c.name !== selected)),
        colors.control,
        10,
      ),
      ...outlined(
        coordinates(controls.filter((c) => c.name === selected)),
        colors.highlight,
        11,
      ),
    ];
  }, [
    commands,
    hidden,
    selected,
    nodes,
    outer,
    preview,
    surfacePoints,
    pickedNodes,
    controls,
    sections,
    colors,
  ]);

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
  // the rigid surfaces: translucent planes and cylinders (#219); the surface of the
  // selected contact is highlighted (#220)
  const contactSurface =
    choice?.command === "contact.add" ? choice.surface : undefined;
  const rigid = useMemo(
    () =>
      rigidShapes(commands, nodes, {
        hidden,
        selected: contactSurface ?? selected,
        colors,
      }),
    [commands, nodes, hidden, selected, contactSurface, colors],
  );
  const lines = useMemo(() => {
    const options = { size, hidden, selected, colors };
    return [
      ...rigid.lines,
      ...boundaryLines(symbols, options),
      ...constraintLines(shapes, { hidden, selected, colors }),
      // the point loads: arrows in the direction of the force (#100)
      ...loadLines(commands, nodes, options),
      // the pressures: arrows normal to the faces of their face sets (#105)
      ...pressureLines(commands, sections, options),
    ];
  }, [
    symbols,
    size,
    hidden,
    selected,
    shapes,
    commands,
    nodes,
    sections,
    rigid,
    colors,
  ]);

  // the selected point set and its points, for a control point at its center (#96)
  const selectedSet = useMemo(() => {
    const set = commands.find((c) => c.name === selected);
    if (!set || !isPointSet(set) || hidden.has(set.name)) return undefined;
    const points = selectedPoints(set.select, nodes, outer, ofSection);
    return points.length ? { name: set.name, points } : undefined;
  }, [commands, selected, hidden, nodes, outer, sections]);

  const warnings = useWarnings({
    commands,
    selected,
    nodes,
    sections,
    controls,
    shapes,
    symbols,
  });

  return { faces, markers, lines, rigid, controls, selectedSet, warnings };
}

interface WarningOptions {
  commands: readonly Command[];
  selected?: string;
  nodes: Float64Array[];
  sections: ReadonlyMap<string, SectionFaces>;
  controls: readonly (PointAdd | RigidAdd)[];
  shapes: ReturnType<typeof constraintShapes>;
  symbols: ReturnType<typeof boundarySymbols>;
}

/** What the viewport warns about the selected object. */
function useWarnings({
  commands,
  selected,
  nodes,
  sections,
  controls,
  shapes,
  symbols,
}: WarningOptions) {
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
  // the centers of the selected face set without a face (the script raises an error)
  const missingFaces = useMemo(() => {
    const set = commands.find((c) => c.name === selected);
    if (set?.command !== "faceset.add") return [];
    const of = sections.get(set.section);
    return of ? missingCenters(set.select, of) : [];
  }, [commands, selected, sections]);
  // the points of the selected constraint that a boundary prescribes as well
  const overlaps = useMemo(() => {
    const constraint = commands.find(
      (c): c is MpcAdd => c.name === selected && c.command === "mpc.add",
    );
    if (!constraint) return [];
    const shape = shapes.find((s) => s.name === constraint.name);
    return overConstrained(constraint, shape, symbols);
  }, [commands, selected, shapes, symbols]);
  // a control point at a node of the meshes is merged with it (ADR 0006)
  const atNode = useMemo(() => {
    const point = controls.find((c) => c.name === selected);
    if (!point || !nodes.length) return false;
    return missingPoints({ points: [point.coordinates] }, nodes).length === 0;
  }, [controls, selected, nodes]);
  return {
    missing,
    selectsNone,
    emptySymmetry,
    missingFaces,
    overlaps,
    atNode,
  };
}

export type Warnings = ReturnType<typeof useWarnings>;
