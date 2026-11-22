// The toolbar and the panels of the viewport (#312): the selected point set, the
// tip about picking, a picked face, picked surfaces and picked nodes, the warnings
// about the selected object and what is off in the selected step (#393), stacked
// between the axes and the job panel (#128).
import { toName } from "../core/importmesh";
import type { Command, FaceSetAdd, PointSetAdd } from "../core/resolved";
import { withHint } from "../core/shortcuts";
import { faceSetName, type SectionFaces } from "../viewer/facesets";
import { COLOR_BY, type ColorBy } from "../viewer/layers";
import { type Patch, patchCounts } from "../viewer/patches";
import { boundOf, centerOf, nodesName, planeName } from "../viewer/pointsets";
import { FEATURE_ANGLES, nodesSelect, type Surface } from "../viewer/surfaces";
import { VIEWS, type Viewer } from "../viewer/viewer";
import { NodesButton } from "./NodesButton";
import type { Node3, Picking } from "./usePicking";
import type { Warnings } from "./useOverlays";

export const formatNumber = (value: number) => String(+value.toPrecision(6));

/** The presets of the commands that the panels create (they open the dialogs). */
export interface Create {
  /** A point set, e.g. of a picked face or nodes. */
  pointSet?: (preset: { name: string; select: PointSetAdd["select"] }) => void;
  /** A face set of a plane or of picked faces (#142). */
  faceSet?: (preset: {
    name: string;
    section: string;
    select: FaceSetAdd["select"];
  }) => void;
  /** A control point at the center of points, named after their set. */
  controlAt?: (points: ArrayLike<number>, of?: string) => void;
}

/** What the panels name and create things with. */
interface Model {
  commands: readonly Command[];
  nodes: Float64Array[];
  sections: ReadonlyMap<string, SectionFaces>;
}

const close = (label: string, onClick: () => void) => (
  <button
    type="button"
    class="icon-button"
    aria-label={label}
    onClick={onClick}
  >
    ×
  </button>
);

interface ToolbarProps {
  viewer: { current: Viewer | null };
  nodesShown: boolean;
  onToggleNodes: () => void;
  colorBy: ColorBy;
  onColorBy: (colorBy: ColorBy) => void;
}

/** Fit, the standard views, the nodes and the colors of the cells. */
export function ViewToolbar({
  viewer,
  nodesShown,
  onToggleNodes,
  colorBy,
  onColorBy,
}: ToolbarProps) {
  return (
    <div class="view-toolbar" role="toolbar" aria-label="View">
      <button
        type="button"
        title={withHint("Fit the model into the view", "fit")}
        onClick={() => viewer.current?.fit()}
      >
        Fit
      </button>
      {VIEWS.map((view) => (
        <button
          key={view.id}
          type="button"
          title={withHint(view.title, view.shortcut)}
          aria-label={view.title}
          onClick={() => viewer.current?.setView(view.id)}
        >
          {view.label}
        </button>
      ))}
      <span class="toolbar-separator" aria-hidden="true" />
      <NodesButton pressed={nodesShown} onToggle={onToggleNodes} />
      <span class="toolbar-separator" aria-hidden="true" />
      <select
        aria-label="Color by"
        title="Color the cells by mesh, cell set or section"
        value={colorBy}
        onChange={(event) => onColorBy(event.currentTarget.value as ColorBy)}
      >
        {COLOR_BY.map((option) => (
          <option key={option.id} value={option.id}>
            {option.label}
          </option>
        ))}
      </select>
    </div>
  );
}

/** The selected point set, with a control point at its center (#96). */
export function SelectedSetPanel({
  set,
  onControlAt,
}: {
  set: { name: string; points: Float64Array };
  onControlAt: (points: ArrayLike<number>, of?: string) => void;
}) {
  return (
    <div class="pick-panel" role="status" aria-label="Selected point set">
      <span>
        <strong>{set.name}</strong>{" "}
        <span class="muted">
          · {set.points.length / 3} points · center (
          {centerOf(set.points).map(formatNumber).join(", ")})
        </span>
      </span>
      <button
        type="button"
        class="button"
        onClick={() => onControlAt(set.points, set.name)}
      >
        Control point at center
      </button>
    </div>
  );
}

/** The tip about picking, until the first pick or until it is dismissed. */
export function PickTip({
  nodesShown,
  tap,
  more,
  onDismiss,
}: {
  nodesShown: boolean;
  tap: string;
  more: string;
  onDismiss: () => void;
}) {
  const capital = (text: string) => text[0].toUpperCase() + text.slice(1);
  return (
    <div class="pick-panel tip" role="note" aria-label="Tip">
      <span class="muted">
        {nodesShown
          ? `${capital(tap)} a node to pick it, ${more} for more.`
          : `${capital(tap)} faces to pick their surfaces for a point set or a face set, again to exclude them and a third time to deselect them. ${capital(more)} single faces.`}
      </span>
      {close("Dismiss the tip", onDismiss)}
    </div>
  );
}

interface PickedProps {
  picking: Picking;
  model: Model;
  create: Create;
  /** The word of more picks, Shift+click or long-press (#273). */
  more: string;
}

/** A picked face: its plane, normal to x, y or z, and what it creates. */
export function PickedFacePanel({ picking, model, create, more }: PickedProps) {
  const { picked, pickedBound, preview, planeFaces } = picking;
  const { commands, nodes, sections } = model;
  const select = picked?.select;
  const created = (make: () => void) => () => {
    make();
    picking.clearPicked();
  };
  return (
    <div class="pick-panel" role="status" aria-label="Picked face">
      {select ? (
        <>
          <span>
            Plane{" "}
            <strong>
              {select.axis} = {formatNumber(select.value)}
            </strong>
            {pickedBound && "bound" in pickedBound && (
              <span class="muted"> ({pickedBound.bound})</span>
            )}{" "}
            <span class="muted">
              · {(preview?.length ?? 0) / 3} points
              {select.atol !== undefined && ` · tolerance ${select.atol}`}
            </span>
          </span>
          {create.pointSet && (
            <button
              type="button"
              class="button primary"
              onClick={created(() =>
                create.pointSet!({
                  name: planeName(select, nodes, commands),
                  select: boundOf(select, nodes),
                }),
              )}
            >
              Create point set
            </button>
          )}
          {create.faceSet && planeFaces && (
            <button
              type="button"
              class="button"
              title={`The ${planeFaces.count} faces of ${planeFaces.section} on the plane`}
              onClick={created(() =>
                create.faceSet!({
                  name: faceSetName(
                    select,
                    sections.get(planeFaces.section),
                    commands,
                  ),
                  section: planeFaces.section,
                  select,
                }),
              )}
            >
              Create face set
            </button>
          )}
          {create.controlAt && preview && preview.length > 0 && (
            <button
              type="button"
              class="button"
              onClick={created(() =>
                create.controlAt!(preview, planeName(select, nodes, commands)),
              )}
            >
              Control point at center
            </button>
          )}
        </>
      ) : (
        <span class="muted">
          This face is not normal to x, y or z. Point sets and face sets select
          planes normal to an axis; {more} picks faces.
        </span>
      )}
      {close("Clear the picked face", picking.clearPicked)}
    </div>
  );
}

/**
 * A short description of a picked surface, e.g. "Cylinder r = 25 about x", or of a
 * part of it if the shape selects more (then stored by its nodes and faces).
 */
function surfaceTitle(surface: Surface): string {
  const title = shapeTitle(surface);
  return surface.exactPoints ? title : `Part of the ${title.toLowerCase()}`;
}

function shapeTitle(surface: Surface): string {
  if (surface.kind === "plane") {
    return `Plane ${surface.plane.axis} = ${formatNumber(surface.plane.value)}`;
  }
  if (surface.kind === "cylinder") {
    const { radius, axis, center } = surface.cylinder;
    const through = center
      ? ` through (${center.map(formatNumber).join(", ")})`
      : "";
    return `Cylinder r = ${formatNumber(radius)} about ${axis}${through}`;
  }
  return "Surface";
}

/**
 * The counts of picked patches and faces (#195), e.g. "3 patches · 1 excluded · 54
 * faces of body"; the patches are counted if there are several or excluded ones.
 */
function pickedSummary(
  patches: readonly Patch[],
  faces: ReadonlyMap<string, readonly number[]>,
): string {
  const { selected, excluded } = patchCounts(patches);
  const parts: string[] = [];
  if (selected > 1 || excluded) {
    parts.push(`${selected} ${selected === 1 ? "patch" : "patches"}`);
  }
  if (excluded) parts.push(`${excluded} excluded`);
  const count = [...faces.values()].reduce((n, f) => n + f.length, 0);
  const of =
    faces.size === 1
      ? ` of ${[...faces.keys()][0]}`
      : faces.size > 1
        ? ` of ${faces.size} sections`
        : "";
  parts.push(`${count} ${count === 1 ? "face" : "faces"}${of}`);
  return parts.join(" · ");
}

/** The point set of a picked surface: a plane, a cylinder or its nodes (#189). */
function surfacePointSet(
  surface: Surface,
  { commands, nodes }: Model,
): { name: string; select: PointSetAdd["select"] } {
  const taken = new Set(commands.map((c) => c.name));
  if (surface.kind === "plane" && surface.exactPoints)
    return {
      name: planeName(surface.plane, nodes, commands),
      select: boundOf(surface.plane, nodes),
    };
  if (surface.kind === "cylinder" && surface.exactPoints)
    return {
      name: toName(`r_${surface.cylinder.radius}`, taken, "points"),
      select: surface.cylinder,
    };
  return {
    name: toName("surface", taken, "points"),
    select: nodesSelect(surface.nodes),
  };
}

/** The face set of the picked faces of one section: a plane or their centers. */
function surfaceFaceSet(
  surface: Surface,
  faces: ReadonlyMap<string, readonly number[]>,
  { commands, sections }: Model,
) {
  const [entry] = faces;
  const of = entry && sections.get(entry[0]);
  if (!entry || !of) return undefined;
  const [section, picks] = entry;
  const taken = new Set(commands.map((c) => c.name));
  const select =
    surface.kind === "plane" && surface.exactFaces
      ? surface.plane
      : {
          centers: picks.map((f) =>
            of.faces[f].center.map((x) => +x.toPrecision(12)),
          ) as [Node3, ...Node3[]],
        };
  const name =
    surface.kind === "cylinder"
      ? toName(`faces_r_${surface.cylinder.radius}`, taken, "faces")
      : faceSetName(select, of, commands);
  return { name, section, select };
}

/** Why a face set cannot be made of the picked faces, if so. */
function faceSetBlocker(sections: number): string | undefined {
  if (sections > 1)
    return `A face set has faces of one section; the picked faces belong to ${sections} sections`;
  return sections === 0 ? "No faces are picked" : undefined;
}

/** The picked surfaces (#189, #195), their feature angle and what they create. */
export function PickedFacesPanel({
  picking,
  model,
  create,
  surface,
}: Omit<PickedProps, "more"> & { surface: Surface }) {
  const { combined, surfacePoints, patches, nextClick } = picking;
  const points = surfacePoints?.length ?? 0;
  const created = (make: () => void) => () => {
    make();
    picking.clearPatches();
  };
  const exactPlane = surface.kind === "plane" && surface.exactPoints;
  return (
    <div class="pick-panel" role="status" aria-label="Picked faces">
      <span>
        <strong>
          {combined.faces.size ? surfaceTitle(surface) : "No faces picked"}
        </strong>
        {exactPlane && <Bound plane={surface.plane} nodes={model.nodes} />}{" "}
        <span class="muted">
          · {pickedSummary(patches, combined.faces)} · {points / 3} points
          {nextClick && ` · ${nextClick}`}
        </span>
      </span>
      <label
        class="pick-angle"
        title="The largest angle between the normals of neighbouring faces of a picked surface"
      >
        Angle{" "}
        <select
          aria-label="Feature angle"
          value={String(picking.angle)}
          onChange={(event) =>
            picking.chooseAngle(Number(event.currentTarget.value))
          }
        >
          {FEATURE_ANGLES.map((a) => (
            <option key={a} value={String(a)}>
              {a}°
            </option>
          ))}
        </select>
      </label>
      {create.pointSet && (
        <button
          type="button"
          class="button primary"
          disabled={!points}
          title={
            points
              ? undefined
              : "The picked faces have no points that are not excluded"
          }
          onClick={created(() =>
            create.pointSet!(surfacePointSet(surface, model)),
          )}
        >
          Create point set
        </button>
      )}
      {create.faceSet && (
        <button
          type="button"
          class="button"
          disabled={combined.faces.size !== 1}
          title={faceSetBlocker(combined.faces.size)}
          onClick={() => {
            const preset = surfaceFaceSet(surface, combined.faces, model);
            if (!preset) return;
            create.faceSet!(preset);
            picking.clearPatches();
          }}
        >
          Create face set
        </button>
      )}
      {create.controlAt && surfacePoints && points > 0 && (
        <button
          type="button"
          class="button"
          onClick={created(() =>
            create.controlAt!(
              surfacePoints,
              exactPlane
                ? planeName(surface.plane, model.nodes, model.commands)
                : undefined,
            ),
          )}
        >
          Control point at center
        </button>
      )}
      {close("Clear the picked faces", picking.clearPatches)}
    </div>
  );
}

/** The bound of a picked plane, if it is at a bound of the meshes (#181). */
function Bound({
  plane,
  nodes,
}: {
  plane: Parameters<typeof boundOf>[0];
  nodes: Float64Array[];
}) {
  const at = boundOf(plane, nodes);
  return "bound" in at ? <span class="muted"> ({at.bound})</span> : null;
}

/** The picked nodes (#93): copied, added to a point set or a new one. */
export function PickedNodesPanel({
  picking,
  model,
  create,
  more,
}: PickedProps) {
  const { pickedNodes, target } = picking;
  const created = (make: () => void) => () => {
    make();
    picking.clearNodes();
  };
  return (
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
        <span class="muted">· {more} for more</span>
      </span>
      <button type="button" class="button" onClick={picking.copyNodes}>
        {picking.copied ? "Copied" : "Copy"}
      </button>
      {target && (
        <button type="button" class="button" onClick={picking.addToTarget}>
          Add to {target.name}
        </button>
      )}
      {create.controlAt && (
        <button
          type="button"
          class="button"
          onClick={created(() => create.controlAt!(pickedNodes.flat()))}
        >
          Control point at center
        </button>
      )}
      {create.pointSet && (
        <button
          type="button"
          class="button primary"
          onClick={created(() =>
            create.pointSet!({
              name: nodesName(pickedNodes.length, model.commands),
              select: { points: pickedNodes as [Node3, ...Node3[]] },
            }),
          )}
        >
          Create point set
        </button>
      )}
      {close("Clear the picked nodes", picking.clearNodes)}
    </div>
  );
}

/** Up to three points, and how many more. */
const listed = (points: readonly (readonly number[])[]) =>
  points
    .slice(0, 3)
    .map((p) => `(${p.map(formatNumber).join(", ")})`)
    .join(", ") + (points.length > 3 ? ` and ${points.length - 3} more` : "");

/** What is off in the selected step, and faded in the viewport (#393). */
export function OffInStep({
  off,
}: {
  off?: { step: string; names: readonly string[] };
}) {
  if (!off) return null;
  return (
    <p class="viewport-status muted" role="status">
      Off in {off.step} (faded): {off.names.join(", ")}
    </p>
  );
}

/** What the viewport warns about the selected object. */
export function WarningsOf({
  selected,
  warnings,
}: {
  selected?: string;
  warnings: Warnings;
}) {
  const {
    missing,
    selectsNone,
    emptySymmetry,
    missingFaces,
    overlaps,
    atNode,
  } = warnings;
  const warn = (text: string) => (
    <p class="viewport-status warning" role="status">
      {text}
    </p>
  );
  return (
    <>
      {missing.length > 0 && warn(`${selected}: no node at ${listed(missing)}`)}
      {selectsNone && warn(`${selected}: no node of the meshes is selected`)}
      {emptySymmetry.length > 0 &&
        warn(
          `${selected}: no node of the meshes on the ${
            emptySymmetry.length > 1 ? "planes" : "plane"
          } ${emptySymmetry.join(", ")}`,
        )}
      {missingFaces.length > 0 &&
        warn(`${selected}: no face with the center ${listed(missingFaces)}`)}
      {overlaps.length > 0 &&
        warn(
          `${selected}: ${overlaps
            .map(
              (o) =>
                `${o.points} ${o.points === 1 ? "point is" : "points are"} also in ${o.boundary} (${o.components.join(", ")})`,
            )
            .join("; ")}: over-constrained.`,
        )}
      {atNode &&
        warn(
          `${selected} is at a node of the meshes: the script merges it with the node.`,
        )}
    </>
  );
}
