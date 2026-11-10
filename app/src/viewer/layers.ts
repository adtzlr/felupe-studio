// What the viewport shows of the model: the imported meshes whose file is read,
// colored by their position in the model (hiding a mesh keeps the other colors).
import type { Command } from "../core/commands";
import type { MeshFiles } from "../core/meshfiles";
import { solidOf } from "../core/meshinfo";
import { categorical } from "./palette";
import type { MeshLayer } from "./scene";

export interface ViewportContent {
  meshes: MeshLayer[];
  /** Files of meshes of the model that are being read. */
  reading: string[];
  /** Why nothing is shown, if no mesh is shown. */
  message?: string;
}

export function viewportContent(
  commands: readonly Command[],
  files: MeshFiles,
  hidden: ReadonlySet<string>,
): ViewportContent {
  const imports = commands.filter(
    (c): c is Extract<Command, { command: "mesh.import" }> =>
      c.command === "mesh.import",
  );
  const meshes: MeshLayer[] = [];
  const reading = new Set<string>();
  imports.forEach((command, index) => {
    const status = files.get(command.file)?.status;
    if (status?.state === "reading") reading.add(command.file);
    if (hidden.has(command.name) || status?.state !== "ready") return;
    const choice = solidOf(status.info, command.cell_type);
    const surface =
      "solid" in choice ? status.surfaces[choice.solid.cell_type] : undefined;
    if (!surface) return;
    meshes.push({ name: command.name, surface, color: categorical(index) });
  });

  const content: ViewportContent = { meshes, reading: [...reading] };
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
