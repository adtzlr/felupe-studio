// The drawing of a scene of the results in the viewer (#312): the deformed
// surfaces with their contour, the control points (#95), the minimum and the
// maximum (#140), the constraints (#99) and the rigid surfaces (#219), displaced
// like the surfaces.
import type { ContourLook } from "../core/contour";
import type { Command } from "../core/resolved";
import type { ResultView } from "../core/results";
import { type Units, unitOf, valueWithUnit } from "../core/units";
import {
  constraintLines,
  constraintShapes,
  resultPlacement,
} from "../viewer/constraints";
import { extremeShape } from "../viewer/extremes";
import { CONTROL_COLOR, EXTREME_COLORS } from "../viewer/palette";
import { outlined } from "../viewer/pointsets";
import { rigidShapes } from "../viewer/rigid";
import { formatTick } from "../viewer/scalarbar";
import type { Lines, Markers } from "../viewer/scene";
import { HIGHLIGHT, type Viewer } from "../viewer/viewer";
import type { ResultExtreme, ResultScene } from "../worker/protocol";
import { type Extreme, EXTREMES, extremeInfo, value } from "./ResultsCards";

type Shapes = Record<Extreme, ReturnType<typeof extremeShape>>;

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
  units?: Units;
  /** The unit of the quantity of the contour. */
  unit?: string;
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
): Shapes =>
  Object.fromEntries(
    EXTREMES.map((name) => [name, extremeShape(scene, extremes[name], scale)]),
  ) as Shapes;

function markersOf(points: number[], shapes?: Shapes): Markers[] {
  return [
    ...outlined(Float64Array.from(points), CONTROL_COLOR, 10),
    ...(shapes
      ? EXTREMES.flatMap((name) => {
          const dot = shapes[name].dot;
          return dot
            ? outlined(Float64Array.from(dot), EXTREME_COLORS[name], 11)
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
          shapes[name].anchors.map((position) => ({
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
  return EXTREMES.map((name) => {
    const extreme = extremes[name];
    const info = extremeInfo(scene, extreme);
    const displacement = info.displacement
      ? [
          `u = ${valueWithUnit(`(${info.displacement.map((c) => value(c)).join(", ")})`, unitOf("displacement", units))}`,
        ]
      : [];
    return {
      id: name,
      position: shapes[name].anchors[0],
      anchors: shapes[name].anchors,
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
const outlinesOf = (shapes?: Shapes): Lines[] =>
  shapes
    ? EXTREMES.flatMap((name) => {
        const outline = shapes[name].outline;
        return outline
          ? [{ positions: outline, color: EXTREME_COLORS[name], width: 3 }]
          : [];
      })
    : [];

/** The rigid surfaces, moved by the displacements of their reference points (#219). */
function rigidOf(
  scene: ResultScene,
  commands: readonly Command[],
  scale: number,
) {
  if (!commands.some((c) => c.command === "rigid.add"))
    return { faces: [], lines: [] };
  return rigidShapes(commands, resultPlacement(scene, scale).nodes, {
    highlight: HIGHLIGHT,
    offsets: new Map(
      (scene.points ?? []).map((p) => [
        p.name,
        p.displacement.map((u) => scale * u),
      ]),
    ),
  });
}

/** The constraints, displaced like the surfaces (#99). */
function constraintsOf(
  scene: ResultScene,
  commands: readonly Command[],
  scale: number,
): Lines[] {
  if (!commands.some((c) => c.command === "mpc.add")) return [];
  const { nodes, place } = resultPlacement(scene, scale);
  return constraintLines(constraintShapes(commands, nodes), {
    highlight: HIGHLIGHT,
    place,
  });
}

/** Draw a scene of the results (none without a scene or a view). */
export function drawResults(viewer: Viewer, drawing: Drawing) {
  const { scene, view } = drawing;
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
  // the control points, also the center and rotation points of the constraints,
  // are hidden with the constraints (#335)
  const controls = drawing.constraints ? (scene.points ?? []) : [];
  const points = displacedPoints(controls, scale);
  const extremes =
    scene.extremes && drawing.extremesShown ? scene.extremes : undefined;
  const shapes = extremes ? shapesOf(scene, extremes, scale) : undefined;
  viewer.setMarkers(markersOf(points, shapes));
  viewer.setTargets(targetsOf(controls, points, shapes));
  viewer.setLabels(
    extremes && shapes ? labelsOf(scene, extremes, shapes, drawing) : [],
  );
  const rigid = rigidOf(scene, drawing.commands, scale);
  viewer.setFaces(rigid.faces);
  viewer.setLines([
    ...(drawing.constraints
      ? constraintsOf(scene, drawing.commands, scale)
      : []),
    ...rigid.lines,
    ...outlinesOf(shapes),
  ]);
}
