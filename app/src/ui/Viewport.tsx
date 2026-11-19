import type { ComponentChildren } from "preact";
import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import { analysisOf, is2d } from "../core/analysis";
import type { MeshFiles } from "../core/meshfiles";
import type { FaceSetAdd, PointSetAdd } from "../core/resolved";
import type { ModelStore } from "../core/store";
import { sectionFaces } from "../viewer/facesets";
import {
  type ColorBy,
  defaultColorBy,
  scaledSurface,
  viewportContent,
} from "../viewer/layers";
import { centerOf, controlName, outerPoints } from "../viewer/pointsets";
import { type Capture, type CreateViewer, Viewer } from "../viewer/viewer";
import { useMedia, useViewKeys } from "./hooks";
import { useShowNodes } from "./NodesButton";
import { useOverlays } from "./useOverlays";
import { usePicking } from "./usePicking";
import {
  type Create,
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
}: Props) {
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
    () => viewportContent(commands, files, hidden, colorBy),
    // the files change in place, their revision tells when
    [commands, files, revision, hidden, colorBy],
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
  const { faces, markers, lines, rigid, controls, selectedSet, warnings } =
    useOverlays({
      commands,
      content,
      sections,
      hidden,
      selected,
      nodes,
      outer,
      picking,
    });

  // the viewer (and its WebGL context) is created when there is a mesh to show
  useEffect(() => {
    if (!viewer.current) {
      if (content.meshes.length === 0 || !host.current) return;
      viewer.current = new Viewer(host.current, createViewer);
      viewer.current.onPick(picking.onPick);
      setAvailable(viewer.current.available);
    }
    viewer.current.setMeshes(content.meshes);
    viewer.current.setLegend(content.legend);
    viewer.current.setMarkers(markers);
    viewer.current.setLines(lines);
    viewer.current.setPlane(picking.picked);
    viewer.current.setFaces([...rigid.faces, ...faces]);
    viewer.current.setNodes(nodesShown);
    viewer.current.setTargets(
      controls.map((c) => ({ name: c.name, position: c.coordinates })),
    );
  }, [
    content,
    markers,
    lines,
    picking.picked,
    faces,
    rigid,
    nodesShown,
    controls,
    createViewer,
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
  const shown = content.meshes.length > 0;
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
        {settled && <WarningsOf selected={selected} warnings={warnings} />}
        {shown && content.reading.length > 0 && (
          <p class="viewport-status muted" role="status">
            Reading {content.reading.join(", ")} …
          </p>
        )}
      </div>
    </main>
  );
}
