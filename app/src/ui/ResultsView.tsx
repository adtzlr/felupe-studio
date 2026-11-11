import type { ComponentChildren } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";
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
import { formatValue, type ResultView } from "../core/results";
import { type ProbeInfo, probeInfo } from "../viewer/probe";
import {
  type Capture,
  type CreateViewer,
  HIGHLIGHT,
  Viewer,
  VIEWS,
} from "../viewer/viewer";
import type { Quantity, ResultScene } from "../worker/protocol";

/** Loads the result scenes of substeps (the worker client). */
export interface ResultSource {
  resultScene(
    job: string,
    substep: number,
    quantity: Quantity,
  ): Promise<ResultScene>;
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
}

/** The value under the pointer, at a position of the view. */
interface Hover {
  x: number;
  y: number;
  /** The width of the view, to keep the tooltip inside. */
  width: number;
  info: ProbeInfo;
  /** The position of the point of a value at the points, in the view. */
  ring?: [number, number];
}

const value = (v: number | null) => (v === null ? "–" : formatValue(v));

/** The tooltip of the value under the pointer, and the ring of its point. */
function ProbeTooltip({ hover }: { hover: Hover }) {
  const { x, y, width, info, ring } = hover;
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
        <strong>
          {info.label} = {value(info.value)}
        </strong>
        {info.displacement && (
          <>
            <br />u = ({info.displacement.map((c) => value(c)).join(", ")})
          </>
        )}
        <br />
        <span class="muted">{info.where}</span>
      </div>
    </>
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
}: Props) {
  const [nodesShown, toggleNodes] = useShowNodes(showNodes, onShowNodes);
  const host = useRef<HTMLDivElement>(null);
  const viewer = useRef<Viewer | null>(null);
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

  // the viewer (and its WebGL context) is created when there is a scene to show
  useEffect(() => {
    if (!viewer.current) {
      if (!scene || !view || !host.current) return;
      viewer.current = new Viewer(host.current, createViewer);
      setAvailable(viewer.current.available);
    }
    viewer.current.setResult(
      scene && view
        ? { scene, scale: view.scale, undeformed: view.undeformed }
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
            title="Fit the model into the view"
            onClick={() => viewer.current?.fit()}
          >
            Fit
          </button>
          {VIEWS.map((v) => (
            <button
              key={v.id}
              type="button"
              title={v.title}
              aria-label={v.title}
              onClick={() => viewer.current?.setView(v.id)}
            >
              {v.label}
            </button>
          ))}
          <span class="toolbar-separator" aria-hidden="true" />
          <NodesButton pressed={nodesShown} onToggle={toggleNodes} />
        </div>
      )}
      {message && <p class="viewport-message muted">{message}</p>}
      {view && !running && children}
      {shown && hover && <ProbeTooltip hover={hover} />}
      {shown && loading && (
        <p class="viewport-status muted" role="status">
          Loading …
        </p>
      )}
    </main>
  );
}
