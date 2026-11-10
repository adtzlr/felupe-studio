// What the viewport shows of the model: the imported meshes whose file is read,
// colored by mesh, cell set or section. Colors follow the position of an object in
// the model, so hiding an object keeps the colors of the others. Hiding a mesh, a
// cell set or a section hides its cells.
import type {
  CellSetFromFile,
  CellSetFromTag,
  Command,
  MeshImport,
  SectionAdd,
} from "../core/commands";
import type { MeshFiles } from "../core/meshfiles";
import { solidOf } from "../core/meshinfo";
import type { MeshSurface } from "../worker/protocol";
import { categorical, UNASSIGNED } from "./palette";
import type { CellGroup, LegendEntry, MeshLayer } from "./scene";

export type ColorBy = "mesh" | "cellset" | "section";

export const COLOR_BY: readonly { id: ColorBy; label: string }[] = [
  { id: "mesh", label: "Meshes" },
  { id: "cellset", label: "Cell sets" },
  { id: "section", label: "Sections" },
];

export interface ViewportContent {
  meshes: MeshLayer[];
  /** The legend; undefined for the names of the meshes (if more than one). */
  legend?: LegendEntry[];
  /** Files of meshes of the model that are being read. */
  reading: string[];
  /** Why nothing is shown, if no mesh is shown. */
  message?: string;
}

type CellSet = CellSetFromTag | CellSetFromFile;

const isCellSet = (c: Command): c is CellSet =>
  c.command === "cellset.from_tag" || c.command === "cellset.from_file";

/** Sections if the model has any, else cell sets if it has any, else meshes. */
export function defaultColorBy(commands: readonly Command[]): ColorBy {
  if (commands.some((c) => c.command === "section.add")) return "section";
  if (commands.some(isCellSet)) return "cellset";
  return "mesh";
}

/** The cells of a cell set (non-zero), or undefined if the tag is not available. */
export function cellMask(
  cellset: CellSet,
  mesh: MeshImport,
  surface: MeshSurface,
): Uint8Array | undefined {
  const mask = new Uint8Array(surface.cells);
  if (cellset.command === "cellset.from_file") return mask.fill(1);
  const values = mesh.tag ? surface.tags?.[mesh.tag] : undefined;
  if (!values) return undefined;
  for (let cell = 0; cell < mask.length; cell++) {
    mask[cell] = values[cell] === cellset.value ? 1 : 0;
  }
  return mask;
}

const indices = (mask: Uint8Array) => {
  const result: number[] = [];
  for (let cell = 0; cell < mask.length; cell++)
    if (mask[cell]) result.push(cell);
  return result;
};

/** The groups of cells of a mesh to color, and the label of the other cells. */
function groupsOf(
  mesh: MeshImport,
  masks: Map<string, Uint8Array>,
  commands: readonly Command[],
  colorBy: ColorBy,
): { name: string; color: string; mask: Uint8Array; order: number }[] {
  if (colorBy === "cellset") {
    return commands.filter(isCellSet).flatMap((c, index) => {
      const mask = c.mesh === mesh.name ? masks.get(c.name) : undefined;
      return mask
        ? [{ name: c.name, color: categorical(index), mask, order: index }]
        : [];
    });
  }
  if (colorBy === "section") {
    return commands
      .filter((c): c is SectionAdd => c.command === "section.add")
      .flatMap((c, index) => {
        const mask = masks.get(c.cellset);
        return mask
          ? [{ name: c.name, color: categorical(index), mask, order: index }]
          : [];
      });
  }
  return [];
}

export function viewportContent(
  commands: readonly Command[],
  files: MeshFiles,
  hidden: ReadonlySet<string>,
  colorBy: ColorBy = defaultColorBy(commands),
): ViewportContent {
  const imports = commands.filter(
    (c): c is MeshImport => c.command === "mesh.import",
  );
  const meshes: MeshLayer[] = [];
  const reading = new Set<string>();
  // legend entries with visible cells, by their position in the model
  const shown = new Map<string, LegendEntry & { order: number }>();
  const other = colorBy === "cellset" ? "No cell set" : "No section";

  imports.forEach((mesh, index) => {
    const status = files.get(mesh.file)?.status;
    if (status?.state === "reading") reading.add(mesh.file);
    if (hidden.has(mesh.name) || status?.state !== "ready") return;
    const choice = solidOf(status.info, mesh.cell_type);
    const surface =
      "solid" in choice ? status.surfaces[choice.solid.cell_type] : undefined;
    if (!surface) return;

    // the cells of the cell sets of this mesh
    const masks = new Map<string, Uint8Array>();
    for (const c of commands) {
      if (!isCellSet(c) || c.mesh !== mesh.name) continue;
      const mask = cellMask(c, mesh, surface);
      if (mask) masks.set(c.name, mask);
    }

    // hidden cell sets and sections hide their cells
    const hiddenCells = new Uint8Array(surface.cells);
    let anyHidden = false;
    for (const c of commands) {
      const set = isCellSet(c)
        ? c.name
        : c.command === "section.add"
          ? c.cellset
          : "";
      const mask = masks.get(set);
      if (!mask || !hidden.has(c.name)) continue;
      anyHidden = true;
      for (let cell = 0; cell < mask.length; cell++) {
        if (mask[cell]) hiddenCells[cell] = 1;
      }
    }

    const layer: MeshLayer = {
      name: mesh.name,
      surface,
      color: categorical(index),
    };
    if (anyHidden) layer.hidden = hiddenCells;
    if (colorBy !== "mesh") {
      const groups = groupsOf(mesh, masks, commands, colorBy);
      const grouped = new Uint8Array(surface.cells);
      groups.forEach((group) => {
        let visible = false;
        for (let cell = 0; cell < group.mask.length; cell++) {
          if (!group.mask[cell]) continue;
          grouped[cell] = 1;
          if (!hiddenCells[cell]) visible = true;
        }
        if (visible) {
          const { name, color, order } = group;
          shown.set(name, { label: name, color, order });
        }
      });
      if (grouped.some((g, cell) => !g && !hiddenCells[cell])) {
        shown.set(other, { label: other, color: UNASSIGNED, order: Infinity });
      }
      layer.color = UNASSIGNED;
      layer.groups = groups.map((g): CellGroup => ({
        color: g.color,
        cells: indices(g.mask),
      }));
    }
    meshes.push(layer);
  });

  const content: ViewportContent = { meshes, reading: [...reading] };
  if (colorBy !== "mesh") {
    content.legend = [...shown.values()]
      .sort((a, b) => a.order - b.order)
      .map(({ label, color }) => ({ label, color }));
  }
  if (meshes.length > 0) return content;
  if (imports.length === 0) {
    content.message = "Import a mesh to see it here.";
  } else if (reading.size > 0) {
    content.message = `Reading ${[...reading].join(", ")} …`;
  } else if (imports.every((c) => hidden.has(c.name))) {
    content.message = "All meshes are hidden.";
  } else {
    content.message =
      "The mesh files of the model are not loaded. Choose them in the properties of the meshes.";
  }
  return content;
}
