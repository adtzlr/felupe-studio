// Mesh files of the project, kept in the browser. A project file only references
// mesh files by name; their content is loaded here and written into the file system
// of the Python worker, which reads them with meshio (felupe_studio.meshes) and
// triangulates their outer surface for the viewer (felupe_studio.scene).
import type { Command } from "./commands";
import { solidOf } from "./meshinfo";
import type { MeshInfo, MeshSurface } from "../worker/protocol";
import { safeName } from "../worker/files";

export type FileState =
  | { state: "reading" }
  | {
      state: "ready";
      info: MeshInfo;
      /** Outer surfaces of the solid cells by cell type, for the viewer. */
      surfaces: Record<string, MeshSurface>;
    }
  | { state: "error"; message: string };

export interface MeshFile {
  name: string;
  size: number;
  status: FileState;
}

/** The summary of a mesh file and the outer surfaces of its solid cells. */
export interface Inspection {
  info: MeshInfo;
  surfaces?: Record<string, MeshSurface>;
}

/** Writes a file into the project directory of Python and inspects it. */
export type Inspector = (name: string, data: Uint8Array) => Promise<Inspection>;

export class MeshFiles {
  private files = new Map<string, { data: Uint8Array; file: MeshFile }>();
  private listeners = new Set<() => void>();
  private version = 0;

  constructor(private inspector?: Inspector) {}

  /** Changes with every change of the files, for re-rendering. */
  get revision(): number {
    return this.version;
  }

  get(name: string): MeshFile | undefined {
    return this.files.get(name)?.file;
  }

  has(name: string): boolean {
    return this.files.has(name);
  }

  /** The content of a file. */
  dataOf(name: string): Uint8Array | undefined {
    return this.files.get(name)?.data;
  }

  /** Forget all files, e.g. for a new project. */
  clear(): void {
    if (!this.files.size) return;
    this.files.clear();
    this.notify();
  }

  get names(): string[] {
    return [...this.files.keys()];
  }

  /**
   * Add (or replace) a file and inspect it. Resolves with the final state of the
   * file; errors are part of the state, not thrown.
   */
  async add(name: string, data: Uint8Array): Promise<MeshFile> {
    const key = safeName(name);
    const set = (status: FileState) => {
      const file = { name: key, size: data.byteLength, status };
      this.files.set(key, { data, file });
      this.notify();
      return file;
    };
    set({ state: "reading" });
    if (!this.inspector)
      return set({ state: "error", message: "Python is not available." });
    try {
      const { info, surfaces = {} } = await this.inspector(key, data);
      // a newer version of the file may have arrived meanwhile
      if (this.files.get(key)?.data !== data) return this.get(key)!;
      return info.error
        ? set({ state: "error", message: info.error })
        : set({ state: "ready", info, surfaces });
    } catch (error) {
      return set({ state: "error", message: (error as Error).message });
    }
  }

  /** Add the files of a browser file input or a drop. */
  async addFiles(files: Iterable<File>): Promise<MeshFile[]> {
    const added: Promise<MeshFile>[] = [];
    for (const file of files) {
      added.push(
        file
          .arrayBuffer()
          .then((buffer) => this.add(file.name, new Uint8Array(buffer))),
      );
    }
    return Promise.all(added);
  }

  /** Write all files into the worker again, e.g. after it was restarted. */
  async resend(): Promise<void> {
    await Promise.all(
      [...this.files.entries()].map(([name, { data }]) => this.add(name, data)),
    );
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notify() {
    this.version++;
    for (const listener of this.listeners) listener();
  }
}

/** The cell types whose faces have a boundary region in FElupe 12 (#142). */
export const FACE_CELL_TYPES = ["hexahedron", "hexahedron20", "hexahedron27"];

/** The type of the solid cells of a section, if its mesh file is read. */
export function sectionCellType(
  commands: readonly Command[],
  section: string,
  files: MeshFiles,
): string | undefined {
  const sec = commands.find((c) => c.name === section);
  if (sec?.command !== "section.add") return undefined;
  const set = commands.find((c) => c.name === sec.cellset);
  if (
    set?.command !== "cellset.from_tag" &&
    set?.command !== "cellset.from_file"
  )
    return undefined;
  const mesh = commands.find((c) => c.name === set.mesh);
  if (mesh?.command !== "mesh.import") return undefined;
  const status = files.get(mesh.file)?.status;
  if (status?.state !== "ready") return undefined;
  const choice = solidOf(status.info, mesh.cell_type);
  return "solid" in choice ? choice.solid.cell_type : undefined;
}

/**
 * Problems of face sets that need the mesh files (#142): faces of tetrahedrons have
 * no boundary region in FElupe 12.
 */
export function faceSetNotes(
  commands: readonly Command[],
  files: MeshFiles,
): Map<string, string[]> {
  const notes = new Map<string, string[]>();
  for (const command of commands) {
    if (command.command !== "faceset.add") continue;
    const type = sectionCellType(commands, command.section, files);
    if (type && !FACE_CELL_TYPES.includes(type)) {
      notes.set(command.name, [
        `The faces of ${type} cells of '${command.section}' have no boundary region in FElupe 12; a face set needs a section of hexahedrons.`,
      ]);
    }
  }
  return notes;
}

/** The names of the mesh files of a model (`file` of `mesh.import`), once each. */
export function meshFileNames(commands: readonly Command[]): string[] {
  return [
    ...new Set(
      commands.flatMap((c) => (c.command === "mesh.import" ? [c.file] : [])),
    ),
  ];
}

/** Messages for meshes of the model whose file is not loaded or not usable. */
export function fileNotes(
  commands: readonly Command[],
  files: MeshFiles,
): Map<string, string[]> {
  const notes = new Map<string, string[]>();
  for (const command of commands) {
    if (command.command !== "mesh.import") continue;
    const file = files.get(command.file);
    if (!file) {
      notes.set(command.name, [
        `The file '${command.file}' is not loaded. Choose it in the properties.`,
      ]);
    } else if (file.status.state === "error") {
      notes.set(command.name, [`${command.file}: ${file.status.message}`]);
    } else if (file.status.state === "ready") {
      const choice = solidOf(file.status.info, command.cell_type);
      if ("problem" in choice) {
        notes.set(command.name, [choice.problem]);
      } else if (
        command.tag &&
        !choice.solid.tags.some((t) => t.name === command.tag)
      ) {
        const subject = command.cell_type
          ? `The ${command.cell_type} cells of the file '${command.file}' have`
          : `The file '${command.file}' has`;
        notes.set(command.name, [`${subject} no cell tag '${command.tag}'.`]);
      }
    }
  }
  return notes;
}
