// The run of the jobs and their results (#312): the shown view of the results,
// the live results while the jobs run (#207), the player of the substeps (#141),
// the settings of the contour (#139) and solving the model.
import { useEffect, useRef, useState } from "preact/hooks";
import {
  type ContourSettings,
  loadContour,
  saveContour,
} from "../core/contour";
import { analysisOf, is2d } from "../core/analysis";
import type { JobRun, JobRunner } from "../core/jobs";
import { liveResults, loadLiveOn, saveLiveOn } from "../core/live";

type Finished = NonNullable<JobRunner["results"]>;
type Live = NonNullable<ReturnType<typeof liveResults>>;
import { type ResultView, substepsOf, viewOf } from "../core/results";
import type { ModelStore } from "../core/store";
import { useJobs } from "./hooks";
import type { Cut } from "../worker/protocol";
import { shownCut } from "./CutControls";
import type { Workspace } from "./Ribbon";
import { usePlayer } from "./usePlayer";

/** The results of the controls: of a finished run, or the live results. */
function controlledOf(
  finished: Finished | undefined,
  view: ResultView | undefined,
  live: Live | undefined,
  last: ResultView | undefined,
) {
  if (finished && view) return { run: finished, view };
  if (!live) return undefined;
  return {
    run: live.run,
    // the quantity of the next run, the scenes keep theirs
    view: { ...live.view, quantity: last?.quantity ?? live.view.quantity },
  };
}

/** Why the results cannot be exported now, if so. */
function blockerOf(
  run: JobRun,
  finished: Finished | undefined,
  view: ResultView | undefined,
) {
  if (run.state === "running") return "Wait until the jobs have run.";
  return !finished || !view ? "Solve the model first." : undefined;
}

interface Options {
  store: ModelStore;
  jobs?: JobRunner;
  workspace: Workspace;
  /** The compact layout of a phone (#378): the curve is off by default. */
  compact?: boolean;
  /** The cut of the view (#395), of the live scenes of a run. */
  cut?: Cut;
}

export function useResults({ store, jobs, workspace, compact, cut }: Options) {
  const run = useJobs(jobs);
  const finished = jobs?.results;
  const [view, setView] = useState<ResultView>();
  // the last view of the results, also of the live results (#207): its choices
  // (e.g. the quantity) are kept for the next run
  const lastView = useRef<ResultView | undefined>(undefined);
  if (view) lastView.current = view;
  // the choices of the first view: a phone shows the curve on request (#378), as
  // it would take much of the view
  const first = compact ? { curve: false } : undefined;
  // a finished run shows its last substep, with the choices of the previous view
  useEffect(
    () =>
      setView(
        (previous) =>
          finished && viewOf(finished, previous ?? lastView.current ?? first),
      ),
    [finished],
  );
  // the live results of a run (#207): scenes of a quantity while the jobs run, if
  // they are on, the curves always; the shown job and the choices of the view
  const [liveOn, setLiveOn] = useState(loadLiveOn);
  const [liveChoice, setLiveChoice] = useState<string>();
  const [, setLiveBase] = useState<ResultView>();
  const live = finished
    ? undefined
    : liveResults(run, liveChoice, lastView.current ?? first);
  const changeLive = (view: ResultView) => {
    setLiveChoice(view.job);
    lastView.current = view;
    setLiveBase(view);
  };
  // play the substeps (#141): the next one follows once the current one is shown
  const [shown, setShown] = useState<{ view: ResultView; ok: boolean }>();
  const substeps = finished && view ? substepsOf(finished, view.job) : 0;
  const player = usePlayer({
    enabled: workspace === "results" && run.state !== "running" && substeps > 1,
    substep: view?.substep ?? 0,
    total: substeps,
    shown: shown && shown.view === view ? shown.ok : undefined,
    onStep: (substep) => setView((view) => view && { ...view, substep }),
  });
  // the settings of the contour of the results, kept in the browser (#139)
  const [contour, setContour] = useState<ContourSettings>(loadContour);
  const [shownRange, setShownRange] = useState<readonly [number, number]>();
  // the values of the shown results can be shifted to the points (#231)
  const [shift, setShift] = useState<boolean>();

  /** The previous or next substep, or the first or last one (from 1). */
  const moveSubstep = (to: "previous" | "next" | "first" | "last") => {
    if (!finished || !view) return;
    const last = substepsOf(finished, view.job);
    const substep = {
      previous: Math.max(1, view.substep - 1),
      next: Math.min(last, view.substep + 1),
      first: 1,
      last,
    }[to];
    setView({ ...view, substep });
  };

  /** A job with results in the browser (#196): it shows its last substep. */
  const showJob = (job: string) => {
    if (!finished?.results[job] || !view) return false;
    setView({ ...view, job, substep: substepsOf(finished, job) });
    return true;
  };

  /**
   * Show the results of a job at a substep with a quantity, for the agent (#258):
   * the shown view, or why it cannot be shown.
   */
  const showView = (
    choice: Partial<Pick<ResultView, "job" | "substep" | "quantity">>,
  ): string | ResultView => {
    if (!finished) return "No results yet: solve first.";
    const job = choice.job ?? view?.job ?? Object.keys(finished.results)[0];
    if (!finished.results[job]) return `No results of job '${job}'.`;
    const last = substepsOf(finished, job);
    const substep = choice.substep ?? last;
    if (!Number.isInteger(substep) || substep < 1 || substep > last)
      return `Job '${job}' has the substeps 1 to ${last}.`;
    const shownView = {
      ...viewOf(finished, view),
      job,
      substep,
      ...(choice.quantity ? { quantity: choice.quantity } : {}),
    };
    setView(shownView);
    return shownView;
  };

  const solve = async () => {
    if (!jobs) return;
    const { serialize } = await import("../core/project");
    setLiveChoice(undefined);
    // the scenes of the running jobs show the quantity of the view (#207), cut
    // like the view (#395, not by z of a 2D model)
    // the commands with the values of their expressions (#242), the document as
    // written: the script shows the expressions
    const liveCut = shownCut(cut, is2d(analysisOf(store.resolved)));
    await jobs.solve(
      store.resolved,
      serialize(store.document),
      liveOn
        ? {
            quantity: (view ?? lastView.current)?.quantity ?? "displacement",
            method: contour.values,
            ...(liveCut ? { cut: liveCut } : {}),
          }
        : undefined,
    );
  };

  return {
    run,
    finished,
    view,
    setView,
    live,
    changeLive,
    liveOn,
    setLiveOn: (on: boolean) => {
      setLiveOn(on);
      saveLiveOn(on);
    },
    player,
    onShown: (view: ResultView, ok: boolean) => setShown({ view, ok }),
    contour,
    setContour: (settings: ContourSettings) => {
      setContour(settings);
      saveContour(settings);
    },
    shownRange,
    setShownRange,
    shift,
    setShift,
    moveSubstep,
    showJob,
    showView,
    solve,
    controlled: controlledOf(finished, view, live, lastView.current),
    /** Why the results cannot be exported now, if so. */
    blocker: blockerOf(run, finished, view),
  };
}

export type Results = ReturnType<typeof useResults>;
