import type { ComponentChildren } from "preact";
import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import { useViewKeys } from "./hooks";
import { withHint } from "../core/shortcuts";
import { NodesButton, useShowNodes } from "./NodesButton";
import { CONTROL_COLOR } from "../viewer/palette";
import { outlined } from "../viewer/pointsets";
import {
  constraintLines,
  constraintShapes,
  resultPlacement,
} from "../viewer/constraints";
import type { Command } from "../core/commands";

const NO_COMMANDS: readonly Command[] = [];
import {
  type ContourSettings,
  contourLook,
  contourRange,
  DEFAULT_CONTOUR,
} from "../core/contour";
import { formatValue, type ResultView } from "../core/results";
import {
  resultUnit,
  type Units,
  unitOf,
  unitsOf,
  valueWithUnit,
  withUnit,
} from "../core/units";
import { type ProbeInfo, probeInfo } from "../viewer/probe";
import {
  type Capture,
  type CreateViewer,
  HIGHLIGHT,
  Viewer,
  VIEWS,
} from "../viewer/viewer";
import type { Quantity, ResultPoint, ResultScene } from "../worker/protocol";

/** Loads the result scenes of substeps (the worker client). */
export interface ResultSource {
  resultScene(
    job: string,
    substep: number,
    quantity: Quantity,
  ): Promise<ResultScene>;
  /** The ranges of a quantity of every substep of a job (#139). */
  resultRanges?(
    job: string,
    quantity: Quantity,
  ): Promise<([number, number] | null)[]>;
}

interface Props {
  source?: ResultSource;
  /** The view of the results of the last finished run (none without results). */
  view?: ResultView;
  /** The results of a run: a new run invalidates the loaded scenes. */
  generation: number;
  /** The view is shown; scenes are loaded only then. */
  active: boolean;
  /** A run is going on. */
  running: boolean;
  createViewer?: CreateViewer;
  /** Panels over the results, e.g. the force-displacement curve. */
  children?: ComponentChildren;
  /** Set to a function that returns a PNG of the view (none without a view). */
  capture?: Capture;
  /** The command list of the results, for the constraints (#99). */
  commands?: readonly Command[];
  /** Show the nodes of the result (#91); without, the view keeps its own. */
  showNodes?: boolean;
  onShowNodes?: (show: boolean) => void;
  /** The settings of the contour (#139). */
  contour?: ContourSettings;
  /** The range of the values of the shown substep, e.g. for a manual range. */
  onRange?: (range: readonly [number, number] | undefined) => void;
}

/** The range over all substeps of a job (#139), from the ranges of its substeps. */
function useJobRange(
  source: ResultSource | undefined,
  key: string | undefined,
  job: string,
  quantity: Quantity,
): readonly [number, number] | undefined {
  const [ranges, setRanges] = useState<{
    key: string;
    range?: [number, number];
  }>();
  useEffect(() => {
    if (!key || !source?.resultRanges || ranges?.key === key) return;
    let alive = true;
    source.resultRanges(job, quantity).then(
      (list) => {
        const finite = list.filter((r): r is [number, number] => r !== null);
        const range: [number, number] | undefined = finite.length
          ? [
              Math.min(...finite.map((r) => r[0])),
              Math.max(...finite.map((r) => r[1])),
            ]
          : undefined;
        if (alive) setRanges({ key, range });
      },
      () => alive && setRanges({ key }),
    );
    return () => {
      alive = false;
    };
  }, [source, key]);
  return key && ranges?.key === key ? ranges.range : undefined;
}

/** The value under the pointer, at a position of the view. */
interface Hover {
  x: number;
  y: number;
  /** The width of the view, to keep the tooltip inside. */
  width: number;
  /** The value of a surface, or a control point (#101). */
  info?: ProbeInfo;
  point?: ResultPoint;
  /** The position of the point of a value at the points, in the view. */
  ring?: [number, number];
}

const value = (v: number | null) => (v === null ? "–" : formatValue(v));

/** The symbols of the values of a control point: of a rotation point φ and M. */
const symbols = (point: ResultPoint) =>
  point.rotation ? (["φ", "M"] as const) : (["u", "F"] as const);

/** The units of the values of a control point (#132); rotations are in rad. */
const pointUnits = (point: ResultPoint, units: Units | undefined) =>
  point.rotation
    ? [unitOf("rotation", units), unitOf("moment", units)]
    : [unitOf("displacement", units), unitOf("force", units)];

/** A vector, without the round-off noise of components near zero. */
const vector = (v: readonly number[] | undefined) => {
  if (!v) return "–";
  const max = Math.max(...v.map(Math.abs));
  const clean = v.map((c) => (Math.abs(c) <= 1e-9 * max ? 0 : c));
  return `(${clean.map((c) => value(c)).join(", ")})`;
};

/**
 * The tooltip of the value under the pointer, and the ring of its point, with the
 * units of the model (#132).
 */
function ProbeTooltip({
  hover,
  units,
  unit,
}: {
  hover: Hover;
  units?: Units;
  /** The unit of the quantity of the contour. */
  unit?: string;
}) {
  const { x, y, width, info, point, ring } = hover;
  const left = x + 14 + 240 > width ? Math.max(x - 254, 0) : x + 14;
  return (
    <>
      {ring && (
        <div
          class="probe-ring"
          style={{ left: `${ring[0]}px`, top: `${ring[1]}px` }}
        />
      )}
      <div
        class="probe-tooltip"
        role="tooltip"
        style={{ left: `${left}px`, top: `${y + 14}px` }}
      >
        {point ? (
          <>
            <strong>{point.name}</strong>
            <br />
            {symbols(point)[0]} ={" "}
            {valueWithUnit(
              vector(point.displacement),
              pointUnits(point, units)[0],
            )}
            <br />
            {symbols(point)[1]} ={" "}
            {valueWithUnit(vector(point.force), pointUnits(point, units)[1])}
            <br />
            <span class="muted">
              {point.rotation ? "Rotation point" : "Control point"}
            </span>
          </>
        ) : (
          info && (
            <>
              <strong>
                {info.label} ={" "}
                {valueWithUnit(
                  value(info.value),
                  info.value === null ? undefined : unit,
                )}
              </strong>
              {info.displacement && (
                <>
                  <br />u ={" "}
                  {valueWithUnit(
                    `(${info.displacement.map((c) => value(c)).join(", ")})`,
                    unitOf("displacement", units),
                  )}
                </>
              )}
              <br />
              <span class="muted">{info.where}</span>
            </>
          )
        )}
      </div>
    </>
  );
}

/** The displacements and forces of the control points of the substep (#101). */
function PointsCard({
  points,
  units,
  onClose,
}: {
  points: readonly ResultPoint[];
  units?: Units;
  onClose: () => void;
}) {
  return (
    <section class="points-card" aria-label="Control points">
      <div class="curve-head">
        <h2>Control points</h2>
        <button
          type="button"
          class="icon-button"
          aria-label="Close the control points"
          onClick={onClose}
        >
          ×
        </button>
      </div>
      <table>
        <thead>
          <tr>
            <th scope="col">Point</th>
            <th scope="col">Displacement</th>
            <th scope="col">Force</th>
          </tr>
        </thead>
        <tbody>
          {points.map((p) => (
            <tr key={p.name}>
              <th scope="row">{p.name}</th>
              <td>
                {symbols(p)[0]} ={" "}
                {valueWithUnit(vector(p.displacement), pointUnits(p, units)[0])}
              </td>
              <td>
                {symbols(p)[1]} ={" "}
                {valueWithUnit(vector(p.force), pointUnits(p, units)[1])}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p class="muted">
        Of a rotation point: the rotation φ in rad and the moment M. All
        substeps: Export ▸ Control points (CSV).
      </p>
    </section>
  );
}

type Loaded =
  | { key: string; scene: ResultScene }
  | { key: string; error: string }
  | undefined;

/**
 * The scene of a substep, loaded from the worker: one request at a time, and the
 * latest wanted scene wins (e.g. while dragging the slider of the substeps).
 */
function useResultScene(
  source: ResultSource | undefined,
  wanted: { key: string; job: string; substep: number; quantity: Quantity },
): { loaded: Loaded; loading: boolean } {
  const [loaded, setLoaded] = useState<Loaded>();
  const latest = useRef(wanted);
  latest.current = wanted;
  const busy = useRef(false);
  const alive = useRef(true);
  useEffect(
    () => () => {
      alive.current = false;
    },
    [],
  );

  useEffect(() => {
    if (!source || !wanted.key || busy.current) return;
    const load = async () => {
      busy.current = true;
      const { key, job, substep, quantity } = latest.current;
      try {
        const scene = await source.resultScene(job, substep, quantity);
        if (alive.current) setLoaded({ key, scene });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (alive.current) setLoaded({ key, error: message });
      } finally {
        busy.current = false;
      }
      // a newer scene was wanted while this one was loading
      if (alive.current && latest.current.key && latest.current.key !== key) {
        void load();
      }
    };
    void load();
  }, [source, wanted.key]);

  return {
    loaded,
    loading: !!wanted.key && loaded?.key !== wanted.key,
  };
}

export function ResultsView({
  source,
  view,
  generation,
  active,
  running,
  createViewer,
  children,
  capture,
  showNodes,
  onShowNodes,
  commands = NO_COMMANDS,
  contour = DEFAULT_CONTOUR,
  onRange,
}: Props) {
  const [nodesShown, toggleNodes] = useShowNodes(showNodes, onShowNodes);
  // the table of the control points of the substep (#101)
  const [pointsShown, setPointsShown] = useState(true);
  const host = useRef<HTMLDivElement>(null);
  const viewer = useRef<Viewer | null>(null);
  useViewKeys(active, viewer, toggleNodes);
  if (capture) {
    capture.current = async () => viewer.current?.snapshot();
  }
  const [available, setAvailable] = useState(true);
  const wanted =
    view && active && !running
      ? {
          key: `${generation}/${view.job}/${view.substep}/${view.quantity}`,
          job: view.job,
          substep: view.substep,
          quantity: view.quantity,
        }
      : { key: "", job: "", substep: 0, quantity: "displacement" as const };
  const { loaded, loading } = useResultScene(source, wanted);
  // a scene of an older run is not shown
  const scene =
    view &&
    loaded &&
    "scene" in loaded &&
    loaded.key.startsWith(`${generation}/`)
      ? loaded.scene
      : undefined;
  const error =
    view && loaded && "error" in loaded && loaded.key === wanted.key
      ? loaded.error
      : undefined;
  // the units of the model (#132): the title of the scalar bar and the tooltips
  const units = unitsOf(commands);
  // of the quantity of the shown scene (the key ends with it)
  const unit =
    scene && loaded
      ? resultUnit(loaded.key.slice(loaded.key.lastIndexOf("/") + 1), units)
      : undefined;
  const titled = useMemo(
    () => scene && unit && { ...scene, label: withUnit(scene.label, unit) },
    [scene, unit],
  );

  // the look of the contour (#139): the map, the bands and the range, of the
  // substep, of all substeps of the job or manual
  const jobRange = useJobRange(
    source,
    view && active && !running && contour.range === "job"
      ? `${generation}/${view.job}/${view.quantity}`
      : undefined,
    view?.job ?? "",
    view?.quantity ?? "displacement",
  );
  const values = scene?.range ?? undefined;
  const look = useMemo(() => {
    if (!scene) return undefined;
    const substep: [number, number] = values ?? [0, 0];
    return contourLook(
      contour,
      contourRange(contour, substep, jobRange),
      substep,
    );
  }, [scene, contour, jobRange?.[0], jobRange?.[1]]);
  useEffect(() => onRange?.(values ?? undefined), [values?.[0], values?.[1]]);

  // the viewer (and its WebGL context) is created when there is a scene to show
  useEffect(() => {
    if (!viewer.current) {
      if (!scene || !view || !host.current) return;
      viewer.current = new Viewer(host.current, createViewer);
      setAvailable(viewer.current.available);
    }
    viewer.current.setResult(
      scene && view
        ? {
            scene: titled || scene,
            scale: view.scale,
            undeformed: view.undeformed,
            look,
          }
        : undefined,
    );
    viewer.current.setNodes(nodesShown);
    // the control points, displaced like the surfaces (#95)
    const scale = view?.scale ?? 1;
    const points = (scene?.points ?? []).flatMap((p) =>
      p.position.map((x, k) => x + scale * p.displacement[k]),
    );
    viewer.current.setMarkers(
      scene && view
        ? outlined(Float64Array.from(points), CONTROL_COLOR, 10)
        : [],
    );
    viewer.current.setTargets(
      (scene && view ? (scene.points ?? []) : []).map((p, i) => ({
        name: p.name,
        position: points.slice(3 * i, 3 * i + 3) as [number, number, number],
      })),
    );
    // the constraints, displaced like the surfaces (#99)
    if (scene && view && commands.some((c) => c.command === "mpc.add")) {
      const { nodes, place } = resultPlacement(scene, scale);
      viewer.current.setLines(
        constraintLines(constraintShapes(commands, nodes), {
          highlight: HIGHLIGHT,
          place,
        }),
      );
    } else viewer.current.setLines([]);
  }, [
    scene,
    titled,
    look,
    view?.scale,
    view?.undeformed,
    nodesShown,
    commands,
    createViewer,
  ]);

  useEffect(
    () => () => {
      viewer.current?.dispose();
      viewer.current = null;
    },
    [],
  );

  // the value under the pointer, once per frame; none while the view is moved
  const [hover, setHover] = useState<Hover>();
  useEffect(() => {
    setHover(undefined);
    const element = host.current;
    if (!element || !scene) return;
    let frame = 0;
    let last: { x: number; y: number } | undefined;
    const update = () => {
      frame = 0;
      const canvas = element.querySelector("canvas");
      if (!last || !canvas || !viewer.current) return;
      const { width, height } = canvas.getBoundingClientRect();
      // a control point under the pointer (#101)
      const target = viewer.current.targetAt(last.x, last.y, width, height);
      const point = scene.points?.find((p) => p.name === target);
      if (point) {
        const scale = view?.scale ?? 1;
        const at = point.position.map(
          (x, k) => x + scale * point.displacement[k],
        ) as [number, number, number];
        const ring = viewer.current.project(at, width, height);
        return setHover({ ...last, width, point, ring });
      }
      const probe = viewer.current.probeAt(last.x, last.y, width, height);
      if (!probe) return setHover(undefined);
      const info = probeInfo(scene, probe);
      const ring = info.atPoint
        ? viewer.current.project(probe.position, width, height)
        : undefined;
      setHover({ ...last, width, info, ring });
    };
    const clear = () => {
      last = undefined;
      setHover(undefined);
    };
    const move = (event: PointerEvent) => {
      if (event.buttons) return clear();
      const rect = element.getBoundingClientRect();
      last = { x: event.clientX - rect.left, y: event.clientY - rect.top };
      frame ||= requestAnimationFrame(update);
    };
    element.addEventListener("pointermove", move);
    element.addEventListener("pointerleave", clear);
    element.addEventListener("pointerdown", clear);
    element.addEventListener("wheel", clear, { passive: true });
    return () => {
      cancelAnimationFrame(frame);
      element.removeEventListener("pointermove", move);
      element.removeEventListener("pointerleave", clear);
      element.removeEventListener("pointerdown", clear);
      element.removeEventListener("wheel", clear);
    };
  }, [scene, view?.scale]);

  const message = running
    ? "Solving …"
    : !view
      ? "Solve the model to see its results."
      : error
        ? `The results could not be shown: ${error}`
        : !scene && loading
          ? "Loading the results …"
          : undefined;
  const shown = !!scene && !message;
  return (
    <main class="viewport" aria-label="Results" hidden={!active}>
      <div class="viewer" ref={host} hidden={!shown} />
      {shown && available && (
        <div class="view-toolbar" role="toolbar" aria-label="View">
          <button
            type="button"
            title={withHint("Fit the model into the view", "fit")}
            onClick={() => viewer.current?.fit()}
          >
            Fit
          </button>
          {VIEWS.map((v) => (
            <button
              key={v.id}
              type="button"
              title={withHint(v.title, v.shortcut)}
              aria-label={v.title}
              onClick={() => viewer.current?.setView(v.id)}
            >
              {v.label}
            </button>
          ))}
          <span class="toolbar-separator" aria-hidden="true" />
          <NodesButton pressed={nodesShown} onToggle={toggleNodes} />
          {scene?.points && scene.points.length > 0 && (
            <button
              type="button"
              aria-pressed={pointsShown}
              title="Show the displacements and forces of the control points"
              onClick={() => setPointsShown(!pointsShown)}
            >
              Points
            </button>
          )}
        </div>
      )}
      {message && <p class="viewport-message muted">{message}</p>}
      {/* the cards of the results in one column on the right (#128) */}
      <div class="overlay-side">
        {view && !running && children}
        {shown && pointsShown && scene.points && scene.points.length > 0 && (
          <PointsCard
            points={scene.points}
            units={units}
            onClose={() => setPointsShown(false)}
          />
        )}
      </div>
      {shown && hover && (
        <ProbeTooltip hover={hover} units={units} unit={unit} />
      )}
      <div class="overlay-bottom above-bars">
        {shown && loading && (
          <p class="viewport-status muted" role="status">
            Loading …
          </p>
        )}
      </div>
    </main>
  );
}
