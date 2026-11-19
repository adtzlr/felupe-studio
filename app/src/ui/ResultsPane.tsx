// The results of the app (#312): the controls of the Results ribbon, and the view
// of the results with the curve of the shown job, of a finished run or of the
// live results of a running one (#207).
import type { JobRunner } from "../core/jobs";
import type { ModelStore } from "../core/store";
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
}: {
  store: ModelStore;
  results: Results;
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
      player={results.player}
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
  download: (name: string, data: string | Blob) => void;
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
  download,
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
    >
      {finished && view?.curve && (
        <CurveCard
          run={finished}
          view={view}
          onChange={results.setView}
          download={download}
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
          download={download}
        />
      )}
    </ResultsView>
  );
}
