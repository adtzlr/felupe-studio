import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import type { Command, PointSetAdd } from "../core/commands";
import type { MeshFiles } from "../core/meshfiles";
import type { ModelStore } from "../core/store";
import {
  COLOR_BY,
  type ColorBy,
  defaultColorBy,
  viewportContent,
} from "../viewer/layers";
import { axisOf, type Vec3 } from "../viewer/picking";
import {
  type CoordinateSelect,
  outlined,
  planeName,
  planeSelect,
  selectedPoints,
} from "../viewer/pointsets";
import type { Markers } from "../viewer/scene";
import {
  type CreateViewer,
  HIGHLIGHT,
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
  /** Create a point set, e.g. of a picked face (opens the dialog). */
  onCreatePointSet?: (preset: {
    name: string;
    select: CoordinateSelect;
  }) => void;
  /** Creates the viewer; the default is the vendored FElupe viewer. */
  createViewer?: CreateViewer;
  /** The viewport is shown (default); hidden in the Results workspace. */
  active?: boolean;
}

/** A picked face: its plane, and the point set of the plane if it is normal to x, y or z. */
interface Picked {
  point: Vec3;
  normal: Vec3;
  select?: CoordinateSelect;
}

/** Color of the markers of point sets, the selected one is highlighted. */
const POINTS = "#f2f4f8";

const isPointSet = (c: Command): c is PointSetAdd =>
  c.command === "pointset.add";

const formatNumber = (value: number) => String(+value.toPrecision(6));

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
  createViewer,
  active = true,
}: Props) {
  const host = useRef<HTMLDivElement>(null);
  const viewer = useRef<Viewer | null>(null);
  const [available, setAvailable] = useState(true);
  const [picked, setPicked] = useState<Picked | undefined>();
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
    ];
  }, [commands, hidden, selected, nodes, preview]);

  // the plane of a picked face, and its point set if it is normal to an axis (the
  // viewer calls it with the nodes of the latest render)
  const nodesRef = useRef(nodes);
  nodesRef.current = nodes;
  const planeOf = (pick: Pick): Picked => {
    const axis = axisOf(pick.normal);
    return {
      point: pick.point,
      normal: pick.normal,
      ...(axis === undefined
        ? {}
        : { select: planeSelect(axis, pick.point, nodesRef.current) }),
    };
  };

  // the viewer (and its WebGL context) is created when there is a mesh to show
  useEffect(() => {
    if (!viewer.current) {
      if (content.meshes.length === 0 || !host.current) return;
      viewer.current = new Viewer(host.current, createViewer);
      viewer.current.onPick((pick) => {
        setPicked(pick && planeOf(pick));
        if (pick) hideTip();
      });
      setAvailable(viewer.current.available);
    }
    viewer.current.setMeshes(content.meshes);
    viewer.current.setLegend(content.legend);
    viewer.current.setMarkers(markers);
    viewer.current.setPlane(picked);
  }, [content, markers, picked, createViewer]);

  // Escape clears a picked face
  useEffect(() => {
    if (!picked) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setPicked(undefined);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [picked]);

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
            title="Fit the model into the view"
            onClick={() => viewer.current?.fit()}
          >
            Fit
          </button>
          {VIEWS.map((view) => (
            <button
              key={view.id}
              type="button"
              title={view.title}
              aria-label={view.title}
              onClick={() => viewer.current?.setView(view.id)}
            >
              {view.label}
            </button>
          ))}
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
      {shown && available && tip && !picked && (
        <div class="pick-panel tip" role="note" aria-label="Tip">
          <span class="muted">
            Tip: click a face to create a point set of its plane. Drag to
            rotate.
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
                </strong>{" "}
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
                      select,
                    });
                    setPicked(undefined);
                  }}
                >
                  Create point set
                </button>
              )}
            </>
          ) : (
            <span class="muted">
              This face is not normal to x, y or z. Point sets select planes
              normal to an axis.
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
      {content.message && (
        <p class="viewport-message muted">{content.message}</p>
      )}
      {shown && content.reading.length > 0 && (
        <p class="viewport-status muted" role="status">
          Reading {content.reading.join(", ")} …
        </p>
      )}
    </main>
  );
}
