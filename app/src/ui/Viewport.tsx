import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import type { Command, PointAdd, PointSetAdd } from "../core/commands";
import type { MeshFiles } from "../core/meshfiles";
import type { ModelStore } from "../core/store";
import { NodesButton, useShowNodes } from "./NodesButton";
import {
  COLOR_BY,
  type ColorBy,
  defaultColorBy,
  viewportContent,
} from "../viewer/layers";
import { axisOf, type Vec3 } from "../viewer/picking";
import {
  type CoordinateSelect,
  centerOf,
  controlName,
  exactNode,
  missingPoints,
  nodesName,
  outlined,
  planeName,
  planeSelect,
  selectedPoints,
} from "../viewer/pointsets";
import {
  boundaryLines,
  boundarySymbols,
  modelSize,
} from "../viewer/boundaries";
import { CONTROL_COLOR } from "../viewer/palette";
import type { Markers } from "../viewer/scene";
import {
  type CreateViewer,
  HIGHLIGHT,
  type Capture,
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
  /** Create a point set, e.g. of a picked face or nodes (opens the dialog). */
  onCreatePointSet?: (preset: {
    name: string;
    select: PointSetAdd["select"];
  }) => void;
  /** Creates the viewer; the default is the vendored FElupe viewer. */
  createViewer?: CreateViewer;
  /** The viewport is shown (default); hidden in the Results workspace. */
  active?: boolean;
  /** Set to a function that returns a PNG of the view (none without a view). */
  capture?: Capture;
  /** Create a control point, e.g. at the center of a point set (opens the dialog). */
  onCreateControlPoint?: (preset: {
    name: string;
    coordinates: [number, number, number];
  }) => void;
  /** Select an object, e.g. a control point picked in the viewport (#95). */
  onSelect?: (name: string) => void;
  /** Show the nodes of the meshes (#91); without, the viewport keeps its own. */
  showNodes?: boolean;
  onShowNodes?: (show: boolean) => void;
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

const isControl = (c: Command): c is PointAdd => c.command === "point.add";

const formatNumber = (value: number) => String(+value.toPrecision(6));

type Node3 = [number, number, number];

const sameNode = (a: readonly number[], b: readonly number[]) =>
  a[0] === b[0] && a[1] === b[1] && a[2] === b[2];

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
  capture,
  showNodes,
  onShowNodes,
  onSelect,
  onCreateControlPoint,
}: Props) {
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;
  const [nodesShown, toggleNodes] = useShowNodes(showNodes, onShowNodes);
  const host = useRef<HTMLDivElement>(null);
  const viewer = useRef<Viewer | null>(null);
  if (capture) {
    capture.current = async () => viewer.current?.snapshot();
  }
  const [available, setAvailable] = useState(true);
  const [picked, setPicked] = useState<Picked | undefined>();
  // the picked nodes, with their exact coordinates (#93)
  const [pickedNodes, setPickedNodes] = useState<Node3[]>([]);
  const [copied, setCopied] = useState(false);
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
  const controls = useMemo(
    () => commands.filter(isControl).filter((c) => !hidden.has(c.name)),
    [commands, hidden],
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
      ...outlined(Float64Array.from(pickedNodes.flat()), HIGHLIGHT, 9),
      // the control points, always shown (#95)
      ...outlined(
        Float64Array.from(
          controls
            .filter((c) => c.name !== selected)
            .flatMap((c) => c.coordinates),
        ),
        CONTROL_COLOR,
        10,
      ),
      ...outlined(
        Float64Array.from(
          controls
            .filter((c) => c.name === selected)
            .flatMap((c) => c.coordinates),
        ),
        HIGHLIGHT,
        11,
      ),
    ];
  }, [commands, hidden, selected, nodes, preview, pickedNodes, controls]);

  // the nodes of the selected point set (by nodes) that the meshes do not have; the
  // script raises an error for them (#92)
  const missing = useMemo(() => {
    const set = commands.find((c) => c.name === selected);
    return set && isPointSet(set) ? missingPoints(set.select, nodes) : [];
  }, [commands, selected, nodes]);

  // the selected point set and its points, for a control point at its center (#96)
  const selectedSet = useMemo(() => {
    const set = commands.find((c) => c.name === selected);
    if (!set || !isPointSet(set) || hidden.has(set.name)) return undefined;
    const points = selectedPoints(set.select, nodes);
    return points.length ? { name: set.name, points } : undefined;
  }, [commands, selected, hidden, nodes]);
  const controlAt = (points: ArrayLike<number>, of?: string) =>
    onCreateControlPoint?.({
      name: controlName(of, commands),
      coordinates: centerOf(points),
    });

  // a control point at a node of the meshes is merged with it (ADR 0006)
  const atNode = useMemo(() => {
    const point = controls.find((c) => c.name === selected);
    if (!point || !nodes.length) return false;
    return missingPoints({ points: [point.coordinates] }, nodes).length === 0;
  }, [controls, selected, nodes]);

  // the boundaries and load cases: strokes of fixed components, arrows of moved
  // boundaries (#82)
  const symbols = useMemo(
    () => boundarySymbols(commands, nodes),
    [commands, nodes],
  );
  const size = useMemo(() => modelSize(nodes), [nodes]);
  const lines = useMemo(
    () =>
      boundaryLines(symbols, { size, hidden, selected, highlight: HIGHLIGHT }),
    [symbols, size, hidden, selected],
  );

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
      viewer.current.onPick((pick, click) => {
        setCopied(false);
        if (click.target) {
          // a control point: select it (#95)
          setPicked(undefined);
          setPickedNodes([]);
          onSelectRef.current?.(click.target);
          return;
        }
        if (click.node) {
          // a node: Shift adds or removes it, else it replaces the picked ones
          const node = exactNode(click.node, nodesRef.current);
          setPicked(undefined);
          setPickedNodes((nodes) => {
            if (!click.shift) return [node];
            const others = nodes.filter((n) => !sameNode(n, node));
            return others.length < nodes.length ? others : [...nodes, node];
          });
          hideTip();
          return;
        }
        if (click.shift) return;
        setPickedNodes([]);
        setPicked(pick && planeOf(pick));
        if (pick) hideTip();
      });
      setAvailable(viewer.current.available);
    }
    viewer.current.setMeshes(content.meshes);
    viewer.current.setLegend(content.legend);
    viewer.current.setMarkers(markers);
    viewer.current.setLines(lines);
    viewer.current.setPlane(picked);
    viewer.current.setNodes(nodesShown);
    viewer.current.setTargets(
      controls.map((c) => ({ name: c.name, position: c.coordinates })),
    );
  }, [content, markers, lines, picked, nodesShown, controls, createViewer]);

  // Escape clears a picked face or picked nodes
  useEffect(() => {
    if (!picked && !pickedNodes.length) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setPicked(undefined);
      setPickedNodes([]);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [picked, pickedNodes]);

  // hidden nodes cannot stay picked
  useEffect(() => {
    if (!nodesShown) setPickedNodes([]);
  }, [nodesShown]);

  // the selected point set by nodes can take the picked nodes
  const target = commands.find(
    (c): c is PointSetAdd =>
      c.name === selected && isPointSet(c) && "points" in c.select,
  );
  const addToTarget = () => {
    if (!target || !("points" in target.select)) return;
    const points = [...target.select.points];
    for (const node of pickedNodes)
      if (!points.some((p) => sameNode(p, node))) points.push(node);
    store.update(target.name, {
      ...target,
      select: {
        ...target.select,
        points: points as typeof target.select.points,
      },
    });
    setPickedNodes([]);
  };
  const copyNodes = async () => {
    const text = pickedNodes.map((n) => n.join(", ")).join("\n");
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
    } catch {
      // the clipboard may be unavailable, e.g. without a secure context
    }
  };

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
          <NodesButton pressed={nodesShown} onToggle={toggleNodes} />
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
      {shown &&
        selectedSet &&
        !picked &&
        !pickedNodes.length &&
        onCreateControlPoint && (
          <div class="pick-panel" role="status" aria-label="Selected point set">
            <span>
              <strong>{selectedSet.name}</strong>{" "}
              <span class="muted">
                · {selectedSet.points.length / 3} points · center (
                {centerOf(selectedSet.points).map(formatNumber).join(", ")})
              </span>
            </span>
            <button
              type="button"
              class="button"
              onClick={() => controlAt(selectedSet.points, selectedSet.name)}
            >
              Control point at center
            </button>
          </div>
        )}
      {shown &&
        available &&
        tip &&
        !picked &&
        !pickedNodes.length &&
        !(selectedSet && onCreateControlPoint) && (
          <div class="pick-panel tip" role="note" aria-label="Tip">
            <span class="muted">
              {nodesShown
                ? "Tip: click a node to pick it, Shift+click for more nodes. Drag to rotate."
                : "Tip: click a face to create a point set of its plane. Drag to rotate."}
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
              {onCreateControlPoint && preview && preview.length > 0 && (
                <button
                  type="button"
                  class="button"
                  onClick={() => {
                    controlAt(
                      preview,
                      planeName(picked.select!, nodes, commands),
                    );
                    setPicked(undefined);
                  }}
                >
                  Control point at center
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
      {shown && pickedNodes.length > 0 && (
        <div class="pick-panel" role="status" aria-label="Picked nodes">
          <span>
            {pickedNodes.length === 1 ? (
              <>
                Node{" "}
                <strong>({pickedNodes[0].map(formatNumber).join(", ")})</strong>
              </>
            ) : (
              <strong>{pickedNodes.length} nodes</strong>
            )}{" "}
            <span class="muted">· Shift+click for more</span>
          </span>
          <button type="button" class="button" onClick={copyNodes}>
            {copied ? "Copied" : "Copy"}
          </button>
          {target && (
            <button type="button" class="button" onClick={addToTarget}>
              Add to {target.name}
            </button>
          )}
          {onCreateControlPoint && (
            <button
              type="button"
              class="button"
              onClick={() => {
                controlAt(pickedNodes.flat());
                setPickedNodes([]);
              }}
            >
              Control point at center
            </button>
          )}
          {onCreatePointSet && (
            <button
              type="button"
              class="button primary"
              onClick={() => {
                onCreatePointSet({
                  name: nodesName(pickedNodes.length, commands),
                  select: {
                    points: pickedNodes as [Node3, ...Node3[]],
                  },
                });
                setPickedNodes([]);
              }}
            >
              Create point set
            </button>
          )}
          <button
            type="button"
            class="icon-button"
            aria-label="Clear the picked nodes"
            onClick={() => setPickedNodes([])}
          >
            ×
          </button>
        </div>
      )}
      {content.message && (
        <p class="viewport-message muted">{content.message}</p>
      )}
      {shown && content.reading.length === 0 && missing.length > 0 && (
        <p class="viewport-status warning" role="status">
          {selected}: no node at{" "}
          {missing
            .slice(0, 3)
            .map((p) => `(${p.map(formatNumber).join(", ")})`)
            .join(", ")}
          {missing.length > 3 && ` and ${missing.length - 3} more`}
        </p>
      )}
      {shown && content.reading.length === 0 && atNode && (
        <p class="viewport-status warning" role="status">
          {selected} is at a node of the meshes: the script merges it with the
          node.
        </p>
      )}
      {shown && content.reading.length > 0 && (
        <p class="viewport-status muted" role="status">
          Reading {content.reading.join(", ")} …
        </p>
      )}
    </main>
  );
}
