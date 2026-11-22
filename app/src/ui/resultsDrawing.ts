// The drawing of a scene of the results in the viewer (#312): the deformed
// surfaces with their contour, the control points (#95), the minimum and the
// maximum (#140), the constraints (#99) and the rigid surfaces (#219), displaced
// like the surfaces. A cut scene (#395) is drawn with what of them is in the
// visible half, clipped at the plane through the undeformed model.
import type { ContourLook } from "../core/contour";
import type { Command } from "../core/resolved";
import type { ResultView } from "../core/results";
import { type Units, unitOf, valueWithUnit } from "../core/units";
import {
  constraintLines,
  constraintShapes,
  resultPlacement,
} from "../viewer/constraints";
import {
  cutHighlights,
  cutLines,
  isVisible,
  type Plane,
  visiblePart,
} from "../viewer/cut";
import { type ExtremeShape, extremeShape } from "../viewer/extremes";
import type { ViewColors } from "../viewer/palette";
import { outlined } from "../viewer/pointsets";
import { rigidShapes } from "../viewer/rigid";
import { formatTick } from "../viewer/scalarbar";
import type { Highlight, Lines, Markers } from "../viewer/scene";
import type { Viewer } from "../viewer/viewer";
import type { ResultExtreme, ResultScene } from "../worker/protocol";
import { type Extreme, EXTREMES, extremeInfo, value } from "./ResultsCards";

/** The drawn shapes of the extremes, none of one in the hidden half of a cut. */
type Shapes = Partial<Record<Extreme, ExtremeShape>>;

export interface Drawing {
  scene?: ResultScene;
  view?: ResultView;
  /** The scene with the unit in its label (#132). */
  titled?: ResultScene;
  look?: ContourLook;
  edges: boolean;
  nodes: boolean;
  /** The lines of the constraints and the control points (#335). */
  constraints: boolean;
  extremesShown: boolean;
  /** The extreme whose label is expanded (#140). */
  pinned?: Extreme;
  onPin: (extreme: Extreme | undefined) => void;
  commands: readonly Command[];
  /** The colors of the view in the theme of the app (#375). */
  colors: ViewColors;
  units?: Units;
  /** The unit of the quantity of the contour. */
  unit?: string;
  /** The plane of the cut of the scene (#395). */
  plane?: Plane;
}

type ControlPoints = NonNullable<ResultScene["points"]>;

/** The positions of the control points, displaced like the surfaces (#95). */
const displacedPoints = (controls: ControlPoints, scale: number) =>
  controls.flatMap((p) =>
    p.position.map((x, k) => x + scale * p.displacement[k]),
  );

/** A dot at a node or a cell inside, the outlines of the outer faces of a cell. */
const shapesOf = (
  scene: ResultScene,
  extremes: Record<Extreme, ResultExtreme>,
  scale: number,
  plane?: Plane,
): Shapes =>
  Object.fromEntries(
    EXTREMES.flatMap((name) => {
      const shape = extremeShape(scene, extremes[name], scale, plane);
      return shape ? [[name, shape]] : [];
    }),
  ) as Shapes;

function markersOf(
  points: number[],
  colors: ViewColors,
  shapes?: Shapes,
): Markers[] {
  return [
    ...outlined(Float64Array.from(points), colors.control, 10),
    ...(shapes
      ? EXTREMES.flatMap((name) => {
          const dot = shapes[name]?.dot;
          return dot
            ? outlined(Float64Array.from(dot), colors.extremes[name], 11)
            : [];
        })
      : []),
  ];
}

function targetsOf(controls: ControlPoints, points: number[], shapes?: Shapes) {
  return [
    ...controls.map((p, i) => ({
      name: p.name,
      position: points.slice(3 * i, 3 * i + 3) as [number, number, number],
    })),
    ...(shapes
      ? EXTREMES.flatMap((name) =>
          (shapes[name]?.anchors ?? []).map((position) => ({
            name: `@${name}`,
            position,
          })),
        )
      : []),
  ];
}

/** The labels of the minimum and the maximum, one of them expanded (#140). */
function labelsOf(
  scene: ResultScene,
  extremes: Record<Extreme, ResultExtreme>,
  shapes: Shapes,
  { pinned, onPin, units, unit }: Drawing,
) {
  return EXTREMES.flatMap((name) => {
    const shape = shapes[name];
    if (!shape) return [];
    const extreme = extremes[name];
    const info = extremeInfo(scene, extreme);
    const displacement = info.displacement
      ? [
          `u = ${valueWithUnit(`(${info.displacement.map((c) => value(c)).join(", ")})`, unitOf("displacement", units))}`,
        ]
      : [];
    return {
      id: name,
      position: shape.anchors[0],
      anchors: shape.anchors,
      tone: name,
      text: `${name === "min" ? "Min." : "Max."} ${valueWithUnit(formatTick(extreme.value), unit)}`,
      detail: [
        `${info.where}${extreme.surface ? "" : " (inside)"}`,
        ...displacement,
      ],
      expanded: pinned === name,
      onClick: () => onPin(pinned === name ? undefined : name),
    };
  });
}

/** The outlines of the extremes at cells. */
const outlinesOf = (colors: ViewColors, shapes?: Shapes): Lines[] =>
  shapes
    ? EXTREMES.flatMap((name) => {
        const outline = shapes[name]?.outline;
        return outline
          ? [{ positions: outline, color: colors.extremes[name], width: 3 }]
          : [];
      })
    : [];

/**
 * The rigid surfaces, moved by the displacements of their reference points (#219),
 * each clipped where it is in the undeformed model: at the plane moved like it
 * (#395).
 */
function rigidOf(
  scene: ResultScene,
  commands: readonly Command[],
  scale: number,
  colors: ViewColors,
  plane?: Plane,
) {
  const rigids = commands.filter((c) => c.command === "rigid.add");
  if (!rigids.length) return { faces: [], lines: [] };
  const { nodes } = resultPlacement(scene, scale);
  const offsets = new Map(
    (scene.points ?? []).map((p) => [
      p.name,
      p.displacement.map((u) => scale * u),
    ]),
  );
  if (!plane) return rigidShapes(commands, nodes, { colors, offsets });
  const names = rigids.map((c) => c.name);
  const faces: Highlight[] = [];
  const lines: Lines[] = [];
  for (const name of names) {
    const hidden = new Set(names.filter((other) => other !== name));
    const shapes = rigidShapes(commands, nodes, { colors, offsets, hidden });
    const offset = offsets.get(name)?.[plane.axis] ?? 0;
    const moved = { ...plane, value: plane.value + offset };
    faces.push(...cutHighlights(moved, shapes.faces));
    lines.push(...cutLines(moved, shapes.lines));
  }
  return { faces, lines };
}

/** The constraints, displaced like the surfaces (#99), clipped at a plane (#395). */
function constraintsOf(
  scene: ResultScene,
  commands: readonly Command[],
  scale: number,
  colors: ViewColors,
  plane?: Plane,
): Lines[] {
  if (!commands.some((c) => c.command === "mpc.add")) return [];
  const { nodes, place } = resultPlacement(scene, scale);
  return constraintLines(constraintShapes(commands, nodes), {
    colors,
    place,
    ...(plane ? { clip: (a, b) => visiblePart(plane, a, b) } : {}),
  });
}

/** Draw a scene of the results (none without a scene or a view). */
export function drawResults(viewer: Viewer, drawing: Drawing) {
  const { scene, view, colors } = drawing;
  viewer.setColors(colors);
  if (!scene || !view) {
    viewer.setResult(undefined);
    viewer.setNodes(drawing.nodes);
    viewer.setMarkers([]);
    viewer.setTargets([]);
    viewer.setLabels([]);
    viewer.setFaces([]);
    viewer.setLines([]);
    return;
  }
  viewer.setResult({
    scene: drawing.titled || scene,
    scale: view.scale,
    undeformed: view.undeformed,
    edges: drawing.edges,
    look: drawing.look,
  });
  viewer.setNodes(drawing.nodes);
  const scale = view.scale;
  const { plane } = drawing;
  // the control points, also the center and rotation points of the constraints,
  // are hidden with the constraints (#335), and in the hidden half of a cut (#395)
  const controls = drawing.constraints
    ? (scene.points ?? []).filter((p) => !plane || isVisible(plane, p.position))
    : [];
  const points = displacedPoints(controls, scale);
  const extremes =
    scene.extremes && drawing.extremesShown ? scene.extremes : undefined;
  const shapes = extremes ? shapesOf(scene, extremes, scale, plane) : undefined;
  viewer.setMarkers(markersOf(points, colors, shapes));
  viewer.setTargets(targetsOf(controls, points, shapes));
  viewer.setLabels(
    extremes && shapes ? labelsOf(scene, extremes, shapes, drawing) : [],
  );
  const rigid = rigidOf(scene, drawing.commands, scale, colors, plane);
  viewer.setFaces(rigid.faces);
  viewer.setLines([
    ...(drawing.constraints
      ? constraintsOf(scene, drawing.commands, scale, colors, plane)
      : []),
    ...rigid.lines,
    ...outlinesOf(colors, shapes),
  ]);
}
