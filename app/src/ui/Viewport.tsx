import type { ComponentChildren } from "preact";
import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import { analysisOf, is2d } from "../core/analysis";
import type { MeshFiles } from "../core/meshfiles";
import type { FaceSetAdd, PointSetAdd } from "../core/resolved";
import type { ModelStore } from "../core/store";
import type { Theme } from "../core/theme";
import {
  clipSurface,
  cutHighlights,
  cutLayers,
  cutLines,
  cutMarkers,
  meshCuts,
  planeOf,
  uncutPick,
  visiblePoints,
} from "../viewer/cut";
import { sectionFaces } from "../viewer/facesets";
import {
  type ColorBy,
  defaultColorBy,
  scaledSurface,
  viewportContent,
} from "../viewer/layers";
import { viewColors } from "../viewer/palette";
import { centerOf, controlName, outerPoints } from "../viewer/pointsets";
import { type Capture, type CreateViewer, Viewer } from "../viewer/viewer";
import type { Cut } from "../worker/protocol";
import { boundsOf, shownCut } from "./CutControls";
import { useMedia, useMeshFiles, useViewKeys } from "./hooks";
import { useShowNodes } from "./NodesButton";
import { useOverlays } from "./useOverlays";
import { usePicking } from "./usePicking";
import {
  type Create,
  OffInStep,
  PickedFacePanel,
  PickedFacesPanel,
  PickedNodesPanel,
  PickTip,
  SelectedSetPanel,
  ViewToolbar,
  WarningsOf,
} from "./ViewportPanels";

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
  /** Create a face set of a plane or of picked faces (opens the dialog, #142). */
  onCreateFaceSet?: (preset: {
    name: string;
    section: string;
    select: FaceSetAdd["select"];
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
  /** Shown instead of the message of an empty view, e.g. the welcome panel. */
  empty?: ComponentChildren;
  /** The theme of the app (#375), for the colors of the view; dark by default. */
  theme?: Theme;
  /** The cut of the view (#395), shared by the workspaces. */
  cut?: Cut;
  /** Set the cut of the view; without, the toolbar has no *Cut*. */
  onCut?: (cut: Cut | undefined) => void;
}

/**
 * The viewport of the model (#312): it draws the meshes with the overlays of the
 * objects (`useOverlays`), picks faces, surfaces and nodes (`usePicking`) and shows
 * the panels of the picks (`ViewportPanels`).
 */
export function Viewport({
  store,
  files,
  hidden,
  selected,
  onCreatePointSet,
  onCreateFaceSet,
  createViewer,
  active = true,
  capture,
  showNodes,
  onShowNodes,
  onSelect,
  onCreateControlPoint,
  empty,
  theme,
  cut: wanted,
  onCut,
}: Props) {
  const colors = viewColors(theme);
  const [nodesShown, toggleNodes] = useShowNodes(showNodes, onShowNodes);
  const host = useRef<HTMLDivElement>(null);
  const viewer = useRef<Viewer | null>(null);
  useViewKeys(active, viewer, toggleNodes);
  if (capture) {
    capture.current = async () => viewer.current?.snapshot();
  }
  const [available, setAvailable] = useState(true);
  // chosen by the user, else sections, cell sets or meshes, as the model has them
  const [chosen, setChosen] = useState<ColorBy | undefined>();
  // with the values of the expressions of the parameters (#242)
  const commands = store.resolved;
  const colorBy = chosen ?? defaultColorBy(commands);
  const revision = files.revision;
  const content = useMemo(
    () => viewportContent(commands, files, hidden, colorBy, colors),
    // the files change in place, their revision tells when
    [commands, files, revision, hidden, colorBy, colors],
  );
  // the faces of the boundaries of the sections, for face sets (#142)
  const sections = useMemo(
    () => sectionFaces(commands, files, scaledSurface),
    [commands, files, revision],
  );
  // the nodes of the drawn meshes, for previews of point sets
  const nodes = useMemo(
    () =>
      content.meshes.flatMap((m) => (m.surface.nodes ? [m.surface.nodes] : [])),
    [content],
  );
  // the points on the outer surface of the drawn meshes, of 2D models on the
  // outline, for point sets on the surface (#222)
  const planar = is2d(analysisOf(commands));
  const cutView = useCutView(content, files, nodes, {
    cut: wanted,
    onCut,
    planar,
  });
  const outer = useMemo(
    () =>
      outerPoints(
        content.meshes.map((m) => m.surface),
        planar,
      ),
    [content, planar],
  );
  // the words of the hints: taps and long presses on a touch screen, where a long
  // press picks like Shift+click (#273)
  const coarse = useMedia("(pointer: coarse)");
  const [tap, more] = coarse ? ["tap", "long-press"] : ["click", "Shift+click"];
  const picking = usePicking({
    store,
    commands,
    sections,
    nodes,
    planar,
    nodesShown,
    selected,
    tap,
    onSelect,
  });
  const { faces, markers, lines, rigid, controls, selectedSet, warnings, off } =
    useOverlays({
      commands,
      content,
      sections,
      hidden,
      selected,
      nodes,
      outer,
      picking,
      colors,
    });

  // a pick of a cut mesh is a pick of its outer surface (#395)
  const { meshes, construction, plane } = cutView;
  const latest = useRef({ onPick: picking.onPick, meshes });
  latest.current = { onPick: picking.onPick, meshes };

  // the viewer (and its WebGL context) is created when there is a mesh to show
  useEffect(() => {
    // the meshes of the model, and the construction meshes of tools (ADR 0019),
    // both cut by the cut of the view (#395) like everything else that is drawn
    const drawn = [...meshes, ...construction];
    if (!viewer.current) {
      if (drawn.length + content.vertices.length === 0 || !host.current) return;
      viewer.current = new Viewer(host.current, createViewer);
      viewer.current.onPick((pick, click) =>
        latest.current.onPick(uncutPick(pick, latest.current.meshes), click),
      );
      setAvailable(viewer.current.available);
    }
    const shownMarkers = [...content.vertices, ...markers];
    const shownFaces = [...rigid.faces, ...faces];
    const targets = controls.filter(
      (c) => !plane || visiblePoints(plane, c.coordinates).length,
    );
    viewer.current.setColors(colors);
    viewer.current.setMeshes(drawn);
    viewer.current.setLegend(content.legend);
    viewer.current.setMarkers(
      plane ? cutMarkers(plane, shownMarkers) : shownMarkers,
    );
    viewer.current.setLines(plane ? cutLines(plane, lines) : lines);
    viewer.current.setPlane(picking.picked);
    viewer.current.setFaces(
      plane ? cutHighlights(plane, shownFaces) : shownFaces,
    );
    viewer.current.setNodes(nodesShown);
    viewer.current.setTargets(
      targets.map((c) => ({ name: c.name, position: c.coordinates })),
    );
  }, [
    content,
    meshes,
    construction,
    plane,
    markers,
    lines,
    picking.picked,
    faces,
    rigid,
    nodesShown,
    controls,
    createViewer,
    colors,
  ]);

  useEffect(
    () => () => {
      viewer.current?.dispose();
      viewer.current = null;
    },
    [],
  );

  const create: Create = {
    pointSet: onCreatePointSet,
    faceSet: onCreateFaceSet,
    controlAt:
      onCreateControlPoint &&
      ((points, of) =>
        onCreateControlPoint({
          name: controlName(of, commands),
          coordinates: centerOf(points),
        })),
  };
  const model = { commands, nodes, sections };
  const shown =
    content.meshes.length +
      content.construction.length +
      content.vertices.length >
    0;
  const settled = shown && content.reading.length === 0;
  return (
    <main class="viewport" aria-label="Viewport" hidden={!active}>
      <div class="viewer" ref={host} />
      {shown && available && (
        <ViewToolbar
          viewer={viewer}
          nodesShown={nodesShown}
          onToggleNodes={toggleNodes}
          colorBy={colorBy}
          onColorBy={setChosen}
          cut={cutView.toolbar}
        />
      )}
      {empty ??
        (content.message && (
          <p class="viewport-message muted">{content.message}</p>
        ))}
      {/* the panels and messages at the bottom, stacked between the axes and the
          job panel (#128) */}
      <div class="overlay-bottom">
        {shown && selectedSet && picking.idle && create.controlAt && (
          <SelectedSetPanel set={selectedSet} onControlAt={create.controlAt} />
        )}
        {shown &&
          available &&
          picking.tip &&
          picking.idle &&
          !(selectedSet && onCreateControlPoint) && (
            <PickTip
              nodesShown={nodesShown}
              tap={tap}
              more={more}
              onDismiss={picking.hideTip}
            />
          )}
        {shown && picking.picked && (
          <PickedFacePanel
            picking={picking}
            model={model}
            create={create}
            more={more}
          />
        )}
        {shown && picking.surface && (
          <PickedFacesPanel
            picking={picking}
            model={model}
            create={create}
            surface={picking.surface}
          />
        )}
        {shown && picking.pickedNodes.length > 0 && (
          <PickedNodesPanel
            picking={picking}
            model={model}
            create={create}
            more={more}
          />
        )}
        {settled && (
          <>
            <WarningsOf selected={selected} warnings={warnings} />
            <OffInStep off={off} />
          </>
        )}
        {shown && content.reading.length > 0 && (
          <p class="viewport-status muted" role="status">
            Reading {content.reading.join(", ")} …
          </p>
        )}
      </div>
    </main>
  );
}

/**
 * The cut of the view (#395): the bounds of the drawn meshes for its slider, its
 * plane, and the meshes and the construction meshes to draw. The meshes are cut in
 * Python (`MeshFiles.cutMeshes`) and drawn whole until their first cut arrives; the
 * construction meshes are clipped here.
 */
function useCutView(
  content: ReturnType<typeof viewportContent>,
  files: MeshFiles,
  nodes: readonly Float64Array[],
  view: Pick<Props, "cut" | "onCut"> & { planar: boolean },
) {
  const cut = shownCut(view.cut, view.planar);
  const bounds = useMemo(() => boundsOf(nodes), [nodes]);
  const plane = useMemo(() => {
    if (!cut || !bounds) return undefined;
    const size = Math.hypot(...bounds.max.map((x, k) => x - bounds.min[k]));
    return planeOf(cut, size);
  }, [cut, bounds]);
  const cuts = useMemo(() => meshCuts(content, cut), [content, cut]);
  useEffect(() => files.cutMeshes(cuts), [files, cuts]);
  // drawn again when a cut arrives
  useMeshFiles(files);
  const revision = files.cutRevision;
  const meshes = useMemo(
    () => cutLayers(content, cuts, files),
    // the cut surfaces arrive in place, their revision tells when
    [content, cuts, files, revision],
  );
  const construction = useMemo(
    () =>
      plane
        ? content.construction.map((layer) => ({
            ...layer,
            surface: clipSurface(plane, layer.surface),
          }))
        : content.construction,
    [content, plane],
  );
  const { onCut, planar } = view;
  // *Cut* of the toolbar, if the app offers it
  const toolbar = onCut && { cut: view.cut, onCut, bounds, planar };
  return { plane, meshes, construction, toolbar };
}
