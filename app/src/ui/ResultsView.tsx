import type { ComponentChildren } from "preact";
import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import {
  type ContourSettings,
  DEFAULT_CONTOUR,
  methodOf,
} from "../core/contour";
import type { Command } from "../core/resolved";
import type { ResultView } from "../core/results";
import { resultUnit, unitsOf, withUnit } from "../core/units";
import { withHint } from "../core/shortcuts";
import type { Theme } from "../core/theme";
import { viewColors } from "../viewer/palette";
import {
  type Capture,
  type CreateViewer,
  Viewer,
  VIEWS,
} from "../viewer/viewer";
import type { ResultScene } from "../worker/protocol";
import { useViewKeys } from "./hooks";
import { NodesButton, useShowNodes } from "./NodesButton";
import { type Extreme, PointsCard, ProbeTooltip } from "./ResultsCards";
import { drawResults } from "./resultsDrawing";
import {
  type Loaded,
  type ResultSource,
  useResultScene,
  type Wanted,
} from "./useResultScene";
import { useContourLook } from "./useContourLook";
import { useHover, usePinnedPick } from "./useResultsPointer";

export type { ResultSource } from "./useResultScene";

const NO_COMMANDS: readonly Command[] = [];
const NO_SUBSTEPS: readonly number[] = [];

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
  /** The values of the shown scene can be shifted to the points (#231). */
  onShift?: (shift: boolean | undefined) => void;
  /** Substeps of the job to load ahead, e.g. while playing (#141). */
  ahead?: readonly number[];
  /** The scene of the view is shown, or it failed (e.g. to play on, #141). */
  onShown?: (view: ResultView, ok: boolean) => void;
  /**
   * The live results of a run (#207): the last scene of a job (none yet, or without
   * live scenes), its view and its status. They replace the loaded scenes.
   */
  live?: { scene?: ResultScene; view: ResultView; status: string };
  /** The theme of the app (#375), for the colors of the view; dark by default. */
  theme?: Theme;
}

/** The wanted scene of a substep of the view; none while it is not shown. */
function wantedOf(
  view: ResultView | undefined,
  substep: number,
  {
    shown,
    generation,
    method,
  }: { shown: boolean; generation: number; method: Wanted["method"] },
): Wanted {
  if (!view || !shown)
    return {
      key: "",
      job: "",
      substep: 0,
      quantity: "displacement",
      method: "cells",
    };
  return {
    // (the quantity last, for its unit)
    key: `${generation}/${view.job}/${substep}/${method}/${view.quantity}`,
    job: view.job,
    substep,
    quantity: view.quantity,
    method,
  };
}

/** The shown scene: the live one, or a loaded one of the run (not of an older run). */
function sceneOf(
  live: Props["live"],
  view: ResultView | undefined,
  loaded: Loaded,
  generation: number,
): ResultScene | undefined {
  if (live) return live.scene;
  if (!view || !loaded || !("scene" in loaded)) return undefined;
  return loaded.key.startsWith(`${generation}/`) ? loaded.scene : undefined;
}

/** The error of the wanted scene, if it failed. */
function errorOf(
  view: ResultView | undefined,
  loaded: Loaded,
  wanted: Wanted,
): string | undefined {
  if (!view || !loaded || !("error" in loaded)) return undefined;
  return loaded.key === wanted.key ? loaded.error : undefined;
}

/** The unit of the quantity of the shown scene (the key of a scene ends with it). */
function unitOf(
  live: Props["live"],
  scene: ResultScene | undefined,
  loaded: Loaded,
  units: ReturnType<typeof unitsOf>,
): string | undefined {
  if (live?.scene) return resultUnit(live.view.quantity, units);
  if (!scene || !loaded) return undefined;
  return resultUnit(loaded.key.slice(loaded.key.lastIndexOf("/") + 1), units);
}

/** A toggle of the toolbar: whether it is on, and its switch. */
type Toggle = readonly [boolean, () => void];

/** Fit, the standard views, and the toggles of the parts of the results. */
function ResultsToolbar({
  viewer,
  nodes,
  edges,
  constraints,
  extremes,
  points,
}: {
  viewer: { current: Viewer | null };
  nodes: Toggle;
  edges: Toggle;
  /** The constraints and the control points, if the model has them (#335). */
  constraints?: Toggle;
  /** The minimum and the maximum, if the scene has them (#140). */
  extremes?: Toggle;
  /** The card of the control points, if the scene has them (#101). */
  points?: Toggle;
}) {
  return (
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
      <NodesButton pressed={nodes[0]} onToggle={nodes[1]} />
      <button
        type="button"
        aria-pressed={edges[0]}
        title="Show the edges of the cells on the deformed shape"
        onClick={edges[1]}
      >
        Edges
      </button>
      {constraints && (
        <button
          type="button"
          aria-pressed={constraints[0]}
          title={withHint(
            "Show the multi-point constraints and the control points",
            "constraints",
          )}
          onClick={constraints[1]}
        >
          Constraints
        </button>
      )}
      {extremes && (
        <button
          type="button"
          aria-pressed={extremes[0]}
          title="Show the minimum and the maximum of the contour"
          onClick={extremes[1]}
        >
          Min/Max
        </button>
      )}
      {points && (
        <button
          type="button"
          aria-pressed={points[0]}
          title="Show the displacements and forces of the control points"
          onClick={points[1]}
        >
          Points
        </button>
      )}
    </div>
  );
}

/**
 * The lines of the constraints and the control points (#335): shown by default, and
 * a toggle only in a model with constraints or control points.
 */
function useConstraints(commands: readonly Command[]) {
  const [shown, setShown] = useState(true);
  const offered = commands.some(
    (c) => c.command === "mpc.add" || c.command === "point.add",
  );
  const toggle: Toggle = [shown, () => setShown((value) => !value)];
  return { shown, toggle: offered ? toggle : undefined };
}

/** The message of the view instead of a scene, if any. */
function messageOf({
  live,
  running,
  view,
  error,
  loading,
  scene,
}: {
  live: Props["live"];
  running: boolean;
  view?: ResultView;
  error?: string;
  loading: boolean;
  scene?: ResultScene;
}): string | undefined {
  if (live)
    return live.scene
      ? undefined
      : "Solving … the view follows the converged substeps.";
  if (running) return "Solving …";
  if (!view) return "Solve the model to see its results.";
  if (error) return `The results could not be shown: ${error}`;
  return !scene && loading ? "Loading the results …" : undefined;
}

/**
 * The view of the results (#312): the scene of the shown substep, loaded with
 * `useResultScene`, drawn by `drawResults`, with the value under the pointer and
 * the cards of `ResultsCards`.
 */
export function ResultsView({
  source,
  view: loadedView,
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
  onShift,
  ahead = NO_SUBSTEPS,
  onShown,
  live,
  theme,
}: Props) {
  // the live results replace the view of the loaded results (#207)
  const view = live ? live.view : loadedView;
  const [nodesShown, toggleNodes] = useShowNodes(showNodes, onShowNodes);
  // the table of the control points of the substep (#101)
  const [pointsShown, setPointsShown] = useState(true);
  // the edges of the cells on the deformed shape (#233), kept for the next run
  const [edgesShown, setEdgesShown] = useState(true);
  // the minimum and the maximum of the contour, one of them selected (#140)
  const [extremesShown, setExtremesShown] = useState(false);
  const constraints = useConstraints(commands);
  const host = useRef<HTMLDivElement>(null);
  const viewer = useRef<Viewer | null>(null);
  useViewKeys(active, viewer, toggleNodes, constraints.toggle?.[1]);
  if (capture) {
    capture.current = async () => viewer.current?.snapshot();
  }
  const [available, setAvailable] = useState(true);
  // the values of the strains and the stresses at the cells or the points (#231)
  const method = view ? methodOf(view.quantity, contour) : "cells";
  // scenes are loaded only while the view is shown, not during a run
  const loads = { shown: active && !running && !live, generation, method };
  const wanted = wantedOf(view, view?.substep ?? 0, loads);
  const { loaded, loading } = useResultScene(
    source,
    wanted,
    wanted.key ? ahead.map((substep) => wantedOf(view, substep, loads)) : [],
  );
  // the contour (#139), with the range of chosen sections (#377)
  const { scene, look, range } = useContourLook({
    source,
    scene: sceneOf(live, view, loaded, generation),
    view,
    contour,
    method,
    shown: loads.shown,
    generation,
  });
  const error = live ? undefined : errorOf(view, loaded, wanted);
  // the units of the model (#132): the title of the scalar bar and the tooltips
  const units = unitsOf(commands);
  const unit = unitOf(live, scene, loaded, units);
  const titled = useMemo(
    () => scene && unit && { ...scene, label: withUnit(scene.label, unit) },
    [scene, unit],
  );

  // the start of a manual range: the range of the substep, of the chosen sections
  useEffect(() => onRange?.(range ?? undefined), [range?.[0], range?.[1]]);
  useEffect(() => onShift?.(scene?.shift), [scene?.shift]);
  const pin = useState<Extreme>();
  const [pinned, setPinned] = pin;

  // the viewer (and its WebGL context) is created when there is a scene to show
  useEffect(() => {
    if (!viewer.current) {
      if (!scene || !view || !host.current) return;
      viewer.current = new Viewer(host.current, createViewer);
      setAvailable(viewer.current.available);
    }
    drawResults(viewer.current, {
      scene,
      view,
      titled: titled || undefined,
      look,
      edges: edgesShown,
      nodes: nodesShown,
      constraints: constraints.shown,
      extremesShown,
      pinned,
      onPin: setPinned,
      commands,
      units,
      unit,
      colors: viewColors(theme),
    });
  }, [
    scene,
    titled,
    look,
    extremesShown,
    pinned,
    view?.scale,
    view?.undeformed,
    edgesShown,
    nodesShown,
    constraints.shown,
    commands,
    createViewer,
    theme,
  ]);

  usePinnedPick(viewer, extremesShown, scene, pin);

  // the scene of the view is shown (or failed), e.g. to play on (#141)
  useEffect(() => {
    if (!view || !loaded || loaded.key !== wanted.key) return;
    onShown?.(view, "scene" in loaded);
  }, [loaded, view]);

  useEffect(
    () => () => {
      viewer.current?.dispose();
      viewer.current = null;
    },
    [],
  );

  const hover = useHover(host, viewer, scene, view?.scale);
  const message = messageOf({ live, running, view, error, loading, scene });
  const shown = !!scene && !message;
  const points = shown && scene.points?.length ? scene.points : undefined;
  return (
    <main class="viewport" aria-label="Results" hidden={!active}>
      <div class="viewer" ref={host} hidden={!shown} />
      {shown && available && (
        <ResultsToolbar
          viewer={viewer}
          nodes={[nodesShown, toggleNodes]}
          edges={[edgesShown, () => setEdgesShown(!edgesShown)]}
          constraints={constraints.toggle}
          extremes={
            scene.extremes
              ? [
                  extremesShown,
                  () => {
                    setExtremesShown(!extremesShown);
                    setPinned(undefined);
                  },
                ]
              : undefined
          }
          points={points && [pointsShown, () => setPointsShown(!pointsShown)]}
        />
      )}
      {message && <p class="viewport-message muted">{message}</p>}
      {/* the cards of the results in one column on the right (#128) */}
      <div class="overlay-side">
        {view && (!running || live) && children}
        {pointsShown && points && (
          <PointsCard
            points={points}
            units={units}
            onClose={() => setPointsShown(false)}
          />
        )}
      </div>
      {shown && hover && (
        <ProbeTooltip hover={hover} units={units} unit={unit} />
      )}
      <div class="overlay-bottom above-bars">
        {live && (
          <p class="viewport-status live-status" role="status">
            {live.status}
          </p>
        )}
        {!live && shown && loading && (
          <p class="viewport-status muted" role="status">
            Loading …
          </p>
        )}
      </div>
    </main>
  );
}
