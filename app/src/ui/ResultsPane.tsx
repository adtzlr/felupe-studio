// The results of the app (#312): the controls of the Results ribbon, and the view
// of the results with the curve of the shown job, of a finished run or of the
// live results of a running one (#207).
import type { JobRunner } from "../core/jobs";
import type { ModelStore } from "../core/store";
import type { Theme } from "../core/theme";
import type { Capture } from "../viewer/viewer";
import type { RuntimeClient } from "../worker/client";
import { CurveCard } from "./CurveCard";
import { ResultsControls } from "./ResultsControls";
import { ResultsView } from "./ResultsView";
import type { Results } from "./useResults";

/** The controls of the Results ribbon: the quantity, the substep and the player. */
export function ResultsRibbon({
  store,
  results,
  theme,
  compact,
}: {
  store: ModelStore;
  results: Results;
  /** The theme of the app (#375), for the gray of the other sections (#396). */
  theme?: Theme;
  /** The compact layout of a phone (#378). */
  compact?: boolean;
}) {
  const { run, live } = results;
  return (
    <ResultsControls
      store={store}
      results={results.controlled}
      running={run.state === "running"}
      onChange={live ? results.changeLive : results.setView}
      live={live && { status: live.status, quantity: live.view.quantity }}
      liveOn={results.liveOn}
      onLiveOn={results.setLiveOn}
      contour={results.contour}
      onContour={results.setContour}
      currentRange={results.shownRange}
      shift={results.shift}
      theme={theme}
      player={results.player}
      compact={compact}
    />
  );
}

interface Props {
  client?: RuntimeClient;
  jobs?: JobRunner;
  results: Results;
  active: boolean;
  capture: Capture;
  showNodes: boolean;
  onShowNodes: (show: boolean) => void;
  /** Save a file, e.g. the CSV of a curve: with the save dialog where there is one (#400). */
  saveFile: (name: string, data: string) => void;
  /** The theme of the app (#375), for the colors of the view. */
  theme?: Theme;
  /** The compact layout of a phone (#378): the cards are off by default. */
  compact?: boolean;
}

/** The view of the results, with the curve of the shown job. */
export function ResultsPane({
  client,
  jobs,
  results,
  active,
  capture,
  showNodes,
  onShowNodes,
  saveFile,
  theme,
  compact,
}: Props) {
  const { run, finished, view, live } = results;
  return (
    <ResultsView
      source={client}
      view={finished && view}
      generation={jobs?.generation ?? 0}
      active={active}
      running={run.state === "running"}
      capture={capture}
      showNodes={showNodes}
      onShowNodes={onShowNodes}
      commands={finished?.commands ?? live?.run.commands}
      contour={results.contour}
      onRange={results.setShownRange}
      onShift={results.setShift}
      ahead={results.player.ahead}
      onShown={results.onShown}
      live={live}
      theme={theme}
      compact={compact}
    >
      {finished && view?.curve && (
        <CurveCard
          run={finished}
          view={view}
          onChange={results.setView}
          saveFile={saveFile}
        />
      )}
      {/* the curve grows with the converged substeps (#207) */}
      {live?.view.curve && (
        <CurveCard
          run={live.run}
          view={live.view}
          onChange={(changed) =>
            results.changeLive({ ...changed, substep: live.view.substep })
          }
          saveFile={saveFile}
        />
      )}
    </ResultsView>
  );
}
