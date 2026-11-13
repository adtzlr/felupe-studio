// Mesh files of the project, kept in the browser. A project file only references
// mesh files by name; their content is loaded here and written into the file system
// of the Python worker, which reads them with meshio (felupe_studio.meshes) and
// triangulates their outer surface for the viewer (felupe_studio.scene). Python
// scripts that make meshes (#182) are kept and written the same way; the meshes
// they make with the parameters of the model are kept by their file, item and
// parameter values.
import { analysisOf, CELLS_2D, is2d } from "./analysis";
import type { Command, MeshImport, MeshScript } from "./commands";
import { solidOf } from "./meshinfo";
import type { MeshInfo, MeshSurface } from "../worker/protocol";
import { safeName } from "../worker/files";

export type FileState =
  | { state: "reading" }
  /** A Python script that makes meshes (#182), written into the worker. */
  | { state: "script" }
  | {
      state: "ready";
      info: MeshInfo;
      /** Outer surfaces of the solid cells by cell type, for the viewer. */
      surfaces: Record<string, MeshSurface>;
    }
  | { state: "error"; message: string; traceback?: string };

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

/** Writes a file into the project directory of Python, e.g. a script. */
export type Writer = (name: string, data: Uint8Array) => Promise<void>;

/**
 * Runs a script of the project directory with parameters and inspects its mesh, or
 * the item of a dict of meshes (#182).
 */
export type Maker = (
  file: string,
  parameters: Record<string, number>,
  item?: string,
) => Promise<Inspection & { info: { traceback?: string } }>;

/** A mesh object of the model: imported from a file or made by a script. */
export type MeshCommand = MeshImport | MeshScript;

export const isMesh = (c: Command): c is MeshCommand =>
  c.command === "mesh.import" || c.command === "mesh.script";

/** A Python script of the project, by its name (#182). */
export const isScript = (name: string) => name.toLowerCase().endsWith(".py");

export class MeshFiles {
  private files = new Map<string, { data: Uint8Array; file: MeshFile }>();
  // the meshes made by scripts, by their key (scriptKey)
  private made = new Map<string, { file: string; status: FileState }>();
  private listeners = new Set<() => void>();
  private version = 0;

  constructor(
    private inspector?: Inspector,
    private scripts: { write?: Writer; make?: Maker } = {},
  ) {}

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
    if (!this.files.size && !this.made.size) return;
    this.files.clear();
    this.made.clear();
    this.notify();
  }

  /** The state of a mesh made by a script, by its key (`scriptKey`). */
  madeStatus(key: string): FileState | undefined {
    return this.made.get(key)?.status;
  }

  /**
   * Make the mesh of a script with parameters, once per key: resolves with its
   * final state; errors of the script (with their traceback) are part of it.
   */
  async make(
    key: string,
    file: string,
    parameters: Record<string, number>,
    item?: string,
  ): Promise<FileState> {
    const existing = this.made.get(key);
    if (existing) return existing.status;
    const entry = { file, status: { state: "reading" } as FileState };
    this.made.set(key, entry);
    this.notify();
    const set = (status: FileState) => {
      // replaced or forgotten meanwhile
      if (this.made.get(key) !== entry) return status;
      entry.status = status;
      this.notify();
      return status;
    };
    if (!this.scripts.make)
      return set({ state: "error", message: "Python is not available." });
    try {
      const { info, surfaces = {} } = await this.scripts.make(
        file,
        parameters,
        item,
      );
      return info.error
        ? set({
            state: "error",
            message: info.error,
            ...(info.traceback ? { traceback: info.traceback } : {}),
          })
        : set({ state: "ready", info, surfaces });
    } catch (error) {
      return set({ state: "error", message: (error as Error).message });
    }
  }

  /** Forget the made meshes of other keys, e.g. of old parameter values. */
  keepMade(keys: ReadonlySet<string>): void {
    let changed = false;
    for (const key of [...this.made.keys()]) {
      if (keys.has(key)) continue;
      // a mesh being made is kept until it is ready
      if (this.made.get(key)!.status.state === "reading") continue;
      this.made.delete(key);
      changed = true;
    }
    if (changed) this.notify();
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
    // the meshes of a replaced script are made again
    for (const [k, entry] of [...this.made]) {
      if (entry.file === key) this.made.delete(k);
    }
    if (isScript(key)) {
      if (!this.scripts.write)
        return set({ state: "error", message: "Python is not available." });
      try {
        await this.scripts.write(key, data);
        if (this.files.get(key)?.data !== data) return this.get(key)!;
        return set({ state: "script" });
      } catch (error) {
        return set({ state: "error", message: (error as Error).message });
      }
    }
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
    this.made.clear();
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
export const FACE_CELL_TYPES = [
  "hexahedron",
  "hexahedron20",
  "hexahedron27",
  // the edges of the quads of 2D models (#175)
  "quad",
  "quad8",
  "quad9",
];

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
  if (!mesh || !isMesh(mesh)) return undefined;
  const status = meshStatus(mesh, commands, files);
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
        type.startsWith("triangle")
          ? `The edges of ${type} cells of '${command.section}' have no boundary region in FElupe 12; a face set of a 2D model needs a section of quads.`
          : `The faces of ${type} cells of '${command.section}' have no boundary region in FElupe 12; a face set needs a section of hexahedrons.`,
      ]);
    }
  }
  return notes;
}

/**
 * The names of the files of the meshes of a model (`file` of `mesh.import` and of
 * `mesh.script`, #182), once each.
 */
export function meshFileNames(commands: readonly Command[]): string[] {
  return [...new Set(commands.filter(isMesh).map((c) => c.file))];
}

/** The values of the parameters of the model (#180), an int or a float each. */
export function parameterValues(
  commands: readonly Command[],
): Record<string, number> {
  return Object.fromEntries(
    commands.flatMap((c) =>
      c.command === "parameter.add"
        ? [[c.name, c.integer ? Math.trunc(c.value) : c.value]]
        : [],
    ),
  );
}

/**
 * The parameters of a mesh made by a script: the listed ones, or all parameters
 * of the model (#182).
 */
export function scriptParameters(
  mesh: MeshScript,
  commands: readonly Command[],
): Record<string, number> {
  const values = parameterValues(commands);
  const names = mesh.parameters ?? Object.keys(values);
  return Object.fromEntries(
    names.filter((n) => n in values).map((n) => [n, values[n]]),
  );
}

/** The key of the mesh of a script: its file, item and parameter values. */
export function scriptKey(
  mesh: MeshScript,
  commands: readonly Command[],
): string {
  return JSON.stringify([
    mesh.file,
    mesh.item ?? null,
    scriptParameters(mesh, commands),
  ]);
}

/**
 * The state of the mesh of a mesh object: the read file of an import, or the mesh
 * a script made with the parameters of the model (undefined if the file is not
 * loaded or the mesh is not asked for yet).
 */
export function meshStatus(
  mesh: MeshCommand,
  commands: readonly Command[],
  files: MeshFiles,
): FileState | undefined {
  const status = files.get(mesh.file)?.status;
  if (mesh.command === "mesh.import" || status?.state !== "script")
    return status;
  return files.madeStatus(scriptKey(mesh, commands));
}

/** Make the meshes of the scripts of a model that are not made yet (#182). */
export function makeMeshes(
  commands: readonly Command[],
  files: MeshFiles,
): void {
  const keys = new Set<string>();
  for (const mesh of commands) {
    if (mesh.command !== "mesh.script") continue;
    if (files.get(mesh.file)?.status.state !== "script") continue;
    const key = scriptKey(mesh, commands);
    keys.add(key);
    void files.make(
      key,
      mesh.file,
      scriptParameters(mesh, commands),
      mesh.item,
    );
  }
  files.keepMade(keys);
}

/** Messages for meshes of the model whose file is not loaded or not usable. */
export function fileNotes(
  commands: readonly Command[],
  files: MeshFiles,
): Map<string, string[]> {
  const notes = new Map<string, string[]>();
  for (const command of commands) {
    if (!isMesh(command)) continue;
    const file = files.get(command.file);
    const script = command.command === "mesh.script";
    if (!file) {
      notes.set(command.name, [
        `The ${script ? "script" : "file"} '${command.file}' is not loaded. Choose it in the properties.`,
      ]);
      continue;
    }
    if (script && file.status.state === "ready") {
      // a mesh file named like a script
      notes.set(command.name, [`'${command.file}' is not a Python script.`]);
      continue;
    }
    const status = meshStatus(command, commands, files);
    if (status?.state === "error") {
      notes.set(command.name, [`${command.file}: ${status.message}`]);
    } else if (status?.state === "ready") {
      const choice = solidOf(status.info, command.cell_type);
      const source = script
        ? `The mesh of '${command.file}'${command.item ? ` ['${command.item}']` : ""}`
        : `The file '${command.file}'`;
      // the cells of the type of the analysis (#175)
      const analysis = analysisOf(commands);
      const planar =
        !("problem" in choice) && CELLS_2D.includes(choice.solid.cell_type);
      if ("problem" in choice) {
        notes.set(command.name, [choice.problem]);
      } else if (planar !== is2d(analysis)) {
        notes.set(command.name, [
          planar
            ? `${source} has ${choice.solid.cell_type} cells, which are 2D cells: set the analysis of the settings to plane strain or axisymmetric.`
            : `${source} has ${choice.solid.cell_type} cells, but a 2D model has 2D cells (triangles or quads).`,
        ]);
      } else if (
        command.tag &&
        !choice.solid.tags.some((t) => t.name === command.tag)
      ) {
        const subject = command.cell_type
          ? `The ${command.cell_type} cells of ${source.replace("The ", "the ")} have`
          : `${source} has`;
        notes.set(command.name, [`${subject} no cell tag '${command.tag}'.`]);
      }
    }
  }
  return notes;
}
