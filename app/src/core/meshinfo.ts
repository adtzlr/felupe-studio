// The solid cells of a mesh file that a mesh of the model takes. Like the meshes of
// the MeshContainer of `fem.mesh.read()`, a mesh has one cell type: a file with more
// than one type of solid cells gives one mesh per cell type (`cell_type`).
import type { CellTag, MeshInfo, SolidInfo } from "../worker/protocol";

/** All types of solid cells of a file, also those without a region in FElupe. */
export function solidTypes(info: MeshInfo): string[] {
  return [
    ...(info.solids ?? []).map((s) => s.cell_type),
    ...(info.unsupported ?? []).map((u) => u.type),
  ];
}

export type SolidChoice = { solid: SolidInfo } | { problem: string };

/** The solid cells of the file that a mesh with the given cell type takes. */
export function solidOf(info: MeshInfo, cellType?: string): SolidChoice {
  if (cellType) {
    const solid = info.solids?.find((s) => s.cell_type === cellType);
    return solid
      ? { solid }
      : { problem: `The file '${info.file}' has no ${cellType} cells.` };
  }
  const types = solidTypes(info);
  if (types.length > 1) {
    return {
      problem:
        `The file '${info.file}' has more than one type of solid cells ` +
        `(${types.join(", ")}). Choose the cell type.`,
    };
  }
  const [solid] = info.solids ?? [];
  return solid
    ? { solid }
    : { problem: `The file '${info.file}' has no solid cells.` };
}

/** The cell tags of all solid cells of a file, with the cells of all types. */
export function fileTags(info: MeshInfo): CellTag[] {
  const tags = new Map<
    string,
    Map<number, { cells: number; label?: string }>
  >();
  for (const solid of info.solids ?? []) {
    for (const tag of solid.tags) {
      const values = tags.get(tag.name) ?? new Map();
      tags.set(tag.name, values);
      for (const v of tag.values) {
        const entry = values.get(v.value) ?? { cells: 0, label: v.label };
        entry.cells += v.cells;
        values.set(v.value, entry);
      }
    }
  }
  return [...tags].map(([name, values]) => ({
    name,
    values: [...values]
      .sort(([a], [b]) => a - b)
      .map(([value, { cells, label }]) => ({
        value,
        cells,
        ...(label === undefined ? {} : { label }),
      })),
  }));
}

/** The total number of solid cells of a file that FElupe supports. */
export function solidCells(info: MeshInfo): number {
  return (info.solids ?? []).reduce((sum, s) => sum + s.cells, 0);
}
