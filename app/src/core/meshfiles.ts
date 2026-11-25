// Mesh files of the project, kept in the browser. A project file only references
// mesh files by name; their content is loaded here and written into the file system
// of the Python worker, which reads them with meshio (felupe_studio.meshes) and
// triangulates their outer surface for the viewer (felupe_studio.scene). Python
// scripts that make meshes (#182) are kept and written the same way; the meshes
// they make with the parameters of the model are kept by their file, item and
// parameter values. The meshes of the tools (ADR 0019) are kept by their chain and
// the meshes of files and scripts that they take (#438).
import { analysisOf, CELLS_2D, is2d } from "./analysis";
import { cellProblem, formulationOf } from "./formulations";
import type { Command, MeshGenerate, MeshImport, MeshScript } from "./commands";
import { parameterValues, resolveCommands } from "./resolve";
import { solidOf } from "./meshinfo";
import { dimensions, inputProblems, type MeshDimension } from "./meshtools";
import type {
  Cut,
  MeshInfo,
  MeshSource,
  MeshSurface,
  SourceMesh,
} from "../worker/protocol";
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

/**
 * Makes a mesh with the tools of FElupe (ADR 0019): the commands of the tools that
 * make it, with the values of their expressions, its name and the meshes of files
 * and scripts that they take (#438).
 */
export type Generator = (
  commands: readonly unknown[],
  name: string,
  sources: readonly SourceMesh[],
) => Promise<Inspection>;

/**
 * Cuts a mesh (#395): the outer surfaces of the kept cells of the mesh of a request,
 * cut by the plane of a cut of the view.
 */
export type Cutter = (
  source: MeshSource,
  cut: Cut,
) => Promise<Record<string, MeshSurface>>;

/**
 * The cut of a drawn mesh (#395): the name of the mesh object, the request that
 * made its mesh and the cut in the coordinates of its file.
 */
export interface MeshCut {
  name: string;
  source: MeshSource;
  cut: Cut;
}

/** The cut surfaces of a mesh (#395): the wanted cut, the one asked for, the latest. */
interface CutEntry {
  wanted: { key: string } & MeshCut;
  /** The key of the cut that is being made. */
  pending?: string;
  /** The latest cut that arrived, or its error. */
  done?: {
    key: string;
    surfaces?: Record<string, MeshSurface>;
    error?: string;
  };
}

/** A mesh object of a file: imported from a file or made by a script. */
export type MeshCommand = MeshImport | MeshScript;

/** A mesh object of the model: of a file, or made by a tool (ADR 0019). */
export type MeshObject = MeshCommand | MeshGenerate;

/** Whether a command is a mesh object of a file, also with the values of expressions. */
export const isMesh = <C extends Command>(c: C): c is Extract<C, MeshCommand> =>
  c.command === "mesh.import" || c.command === "mesh.script";

/** Whether a command is a mesh object: of a file, or made by a tool (ADR 0019). */
export const isMeshObject = <C extends Command>(
  c: C,
): c is Extract<C, MeshObject> => isMesh(c) || c.command === "mesh.generate";

/** A Python script of the project, by its name (#182). */
export const isScript = (name: string) => name.toLowerCase().endsWith(".py");

export class MeshFiles {
  private files = new Map<string, { data: Uint8Array; file: MeshFile }>();
  // the meshes made by scripts (scriptKey) and by tools (generateKey), by their key,
  // with the files that they read
  private made = new Map<
    string,
    { files: readonly string[]; status: FileState }
  >();
  // the cut surfaces of the drawn meshes (#395), by their mesh (meshCutKey)
  private cuts = new Map<string, CutEntry>();
  private listeners = new Set<() => void>();
  private version = 0;
  private cutVersion = 0;

  constructor(
    private inspector?: Inspector,
    private scripts: {
      write?: Writer;
      make?: Maker;
      generate?: Generator;
      /** Cuts the kept cells of a mesh (#395). */
      cut?: Cutter;
    } = {},
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
    this.cuts.clear();
    if (!this.files.size && !this.made.size) return;
    this.files.clear();
    this.made.clear();
    this.notify();
  }

  /** Changes with every cut surface that arrives (#395), for re-rendering. */
  get cutRevision(): number {
    return this.cutVersion;
  }

  /**
   * Cut the drawn meshes (#395), each with its cut (in the coordinates of its file):
   * the latest cut of a mesh is asked for once the one being made has arrived, and
   * the cuts of other meshes are forgotten (all of them without one). Two meshes of
   * one file are cut each, also with different scales of their imports (#442).
   */
  cutMeshes(wanted: readonly MeshCut[]): void {
    const keys = new Set(wanted.map(meshCutKey));
    for (const key of [...this.cuts.keys()]) {
      if (!keys.has(key)) this.cuts.delete(key);
    }
    for (const mesh of wanted) {
      const key = meshCutKey(mesh);
      const entry = this.cuts.get(key);
      const next = { ...mesh, key: cutKey(mesh.cut) };
      if (entry?.wanted.key === next.key) continue;
      if (entry) entry.wanted = next;
      else this.cuts.set(key, { wanted: next });
      this.sendCut(key);
    }
  }

  /**
   * The latest cut surfaces of a drawn mesh by cell type (#395), also of an older
   * cut while the wanted one is being made, or after an error; undefined before the
   * first.
   */
  cutSurfaces(
    mesh: Omit<MeshCut, "cut">,
  ): Record<string, MeshSurface> | undefined {
    return this.cuts.get(meshCutKey(mesh))?.done?.surfaces;
  }

  /**
   * The error of the latest cut of a drawn mesh (#442), with the traceback of
   * Python; undefined once a cut of it arrives.
   */
  cutError(mesh: Omit<MeshCut, "cut">): string | undefined {
    return this.cuts.get(meshCutKey(mesh))?.done?.error;
  }

  /** Ask for the wanted cut of a mesh, unless a cut of it is being made. */
  private sendCut(key: string): void {
    const entry = this.cuts.get(key);
    if (!entry || entry.pending || entry.done?.key === entry.wanted.key) return;
    const { key: asked, source, cut } = entry.wanted;
    const cutter = this.scripts.cut;
    if (!cutter) {
      entry.done = { key: asked, error: "Python is not available." };
      return;
    }
    entry.pending = asked;
    const settle = (done: NonNullable<CutEntry["done"]>) => {
      // forgotten meanwhile, e.g. without a cut or for a new project
      if (this.cuts.get(key) !== entry) return;
      entry.pending = undefined;
      // an error keeps the latest surfaces
      entry.done = done.error ? { ...entry.done, ...done } : done;
      this.cutVersion++;
      this.notify(false);
      this.sendCut(key);
    };
    cutter(source, cut).then(
      (surfaces) => settle({ key: asked, surfaces }),
      (error) => settle({ key: asked, error: (error as Error).message }),
    );
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
    const { make } = this.scripts;
    return this.produce(
      key,
      [file],
      make && (() => make(file, parameters, item)),
    );
  }

  /**
   * Make the mesh of tools (ADR 0019), once per key (`generateKey`), of the meshes
   * of files and scripts that they take (#438): resolves with its final state; an
   * error of FElupe is part of it. A new version of one of their files makes it
   * again.
   */
  async generate(
    key: string,
    commands: readonly unknown[],
    name: string,
    sources: readonly SourceMesh[] = [],
  ): Promise<FileState> {
    const { generate } = this.scripts;
    return this.produce(
      key,
      sources.map((s) => s.file),
      generate && (() => generate(commands, name, sources)),
    );
  }

  /** Make a mesh once per key with a maker of Python, and keep its state. */
  private async produce(
    key: string,
    files: readonly string[],
    maker: (() => Promise<Inspection>) | undefined,
  ): Promise<FileState> {
    const existing = this.made.get(key);
    if (existing) return existing.status;
    const entry = { files, status: { state: "reading" } as FileState };
    this.made.set(key, entry);
    this.notify();
    const set = (status: FileState) => {
      // replaced or forgotten meanwhile
      if (this.made.get(key) !== entry) return status;
      entry.status = status;
      this.notify();
      return status;
    };
    if (!maker)
      return set({ state: "error", message: "Python is not available." });
    try {
      const { info, surfaces = {} } = await maker();
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
    // the kept cells of Python are forgotten, and with them the cuts (#395)
    this.cuts.clear();
    // the meshes of a replaced script are made again, and the meshes of tools that
    // take a mesh of the file (#438)
    for (const [k, entry] of [...this.made]) {
      if (entry.files.includes(key)) this.made.delete(k);
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

  /** Tell the listeners, of a change of the files unless only a cut arrived. */
  private notify(files = true) {
    if (files) this.version++;
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

/**
 * The solid cells of the mesh of a section, with its cell set and its mesh object,
 * if its mesh file is read or its mesh is made.
 */
function sectionSolid(
  commands: readonly Command[],
  section: string,
  files: MeshFiles,
) {
  const sec = commands.find((c) => c.name === section);
  if (sec?.command !== "section.add") return undefined;
  const set = commands.find((c) => c.name === sec.cellset);
  if (
    set?.command !== "cellset.from_tag" &&
    set?.command !== "cellset.from_file"
  )
    return undefined;
  const mesh = commands.find((c) => c.name === set.mesh);
  if (!mesh || !isMeshObject(mesh)) return undefined;
  const status = meshStatus(mesh, commands, files);
  if (status?.state !== "ready") return undefined;
  const choice = solidOf(status.info, cellTypeOf(mesh));
  return "solid" in choice ? { solid: choice.solid, set, mesh } : undefined;
}

/** The type of the solid cells of a section, if its mesh file is read. */
export function sectionCellType(
  commands: readonly Command[],
  section: string,
  files: MeshFiles,
): string | undefined {
  return sectionSolid(commands, section, files)?.solid.cell_type;
}

/**
 * The volume of the cells of a section (#429), the area of 2D cells, if its mesh is
 * read or made: of all solid cells of its mesh, or of those of its tag value, with
 * the scale of an imported mesh. A section of one degenerate cell, e.g. an empty
 * part of a mesh script (#418), has the volume 0.
 */
export function sectionVolume(
  commands: readonly Command[],
  section: string,
  files: MeshFiles,
): number | undefined {
  const found = sectionSolid(commands, section, files);
  if (!found) return undefined;
  const { solid, set, mesh } = found;
  const tag = mesh.command === "mesh.generate" ? undefined : mesh.tag;
  const volume =
    set.command === "cellset.from_file"
      ? solid.volume
      : solid.tags
          .find((t) => t.name === tag)
          ?.values.find((v) => v.value === set.value)?.volume;
  if (volume === undefined) return undefined;
  // the value of the scale, also of an expression (#242)
  const resolved = resolvedOf(commands).find((c) => c.name === mesh.name);
  const scale =
    resolved?.command === "mesh.import" && typeof resolved.scale === "number"
      ? resolved.scale
      : 1;
  return volume * scale ** (CELLS_2D.includes(solid.cell_type) ? 2 : 3);
}

/**
 * The sections without volume that are off in every step (#429): of a model with
 * meshes of scripts, whose script leaves out their solid bodies when it runs. The
 * steps keep them as they are.
 */
export function sectionsWithoutVolume(
  commands: readonly Command[],
  files: MeshFiles,
): Set<string> {
  if (!commands.some((c) => c.command === "mesh.script")) return new Set();
  return new Set(
    commands
      .filter((c) => c.command === "section.add")
      .map((c) => c.name)
      .filter((name) => sectionVolume(commands, name, files) === 0),
  );
}

/** The cell type that a mesh object takes, if it names one (not of a tool). */
export const cellTypeOf = (mesh: MeshObject): string | undefined =>
  mesh.command === "mesh.generate" ? undefined : mesh.cell_type;

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
 * Problems of the formulations of sections that need the mesh data (#420): a
 * formulation that takes some cell types only, e.g. condensed per cell of
 * hexahedrons and quads, and a section of other cells. Like `faceSetNotes()`, an
 * issue of the model that blocks Solve.
 */
export function formulationNotes(
  commands: readonly Command[],
  files: MeshFiles,
): Map<string, string[]> {
  const notes = new Map<string, string[]>();
  for (const command of commands) {
    if (command.command !== "section.add") continue;
    const formulation = formulationOf(command.formulation);
    const type = sectionCellType(commands, command.name, files);
    const problem =
      formulation && type && cellProblem(command.name, formulation, type);
    if (problem) notes.set(command.name, [problem]);
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

/**
 * The values of the parameters of the model (#180), an int or a float each, also of
 * the derived parameters (ADR 0021).
 */
export { parameterValues };

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

// the commands with the values of their expressions, once per command list
const RESOLVED = new WeakMap<readonly Command[], readonly Command[]>();

/** The commands with the values of their expressions (#242), by the schema. */
function resolvedOf(commands: readonly Command[]): readonly Command[] {
  let resolved = RESOLVED.get(commands);
  if (!resolved) {
    resolved = resolveCommands(commands).commands as unknown as Command[];
    RESOLVED.set(commands, resolved);
  }
  return resolved;
}

/**
 * The mesh objects that make a mesh of tools (ADR 0019), with the values of their
 * expressions: the mesh and the meshes that it takes, recursively, in the order of
 * the model, up to the meshes of files and scripts (#438).
 */
function chainOf(mesh: MeshGenerate, commands: readonly Command[]) {
  const resolved = resolvedOf(commands);
  const meshes = new Map(
    resolved.flatMap((c) => (isMeshObject(c) ? [[c.name, c] as const] : [])),
  );
  const needed = new Set<string>();
  const visit = (name: string) => {
    const command = meshes.get(name);
    if (!command || needed.has(name)) return;
    needed.add(name);
    if (command.command === "mesh.generate")
      for (const input of inputsOf(command)) visit(input);
  };
  visit(mesh.name);
  const chain = resolved.filter(
    (c): c is Extract<Command, MeshObject> =>
      isMeshObject(c) && needed.has(c.name),
  );
  return {
    tools: chain.filter(
      (c): c is MeshGenerate => c.command === "mesh.generate",
    ),
    sources: chain.filter((c): c is MeshCommand => isMesh(c)),
  };
}

/**
 * The commands of the tools that make a mesh (ADR 0019), with the values of their
 * expressions: the mesh and the meshes made by tools that it takes, recursively, in
 * the order of the model; none if an expression of them has a problem.
 */
export function generateChain(
  mesh: MeshGenerate,
  commands: readonly Command[],
): MeshGenerate[] {
  const { tools } = chainOf(mesh, commands);
  return tools.some((c) => c.name === mesh.name) ? tools : [];
}

/**
 * A mesh of a file or of a script as the tools take it (#438), like the script: the
 * arguments of `volume_cells()` or `run_mesh_script()`, with the values of their
 * expressions.
 */
function sourceMesh(
  mesh: MeshCommand,
  commands: readonly Command[],
): SourceMesh {
  const dim = is2d(analysisOf(commands)) ? 2 : 3;
  const own =
    mesh.command === "mesh.script"
      ? {
          parameters: scriptParameters(mesh, commands),
          ...(mesh.item ? { item: mesh.item } : {}),
        }
      : typeof mesh.scale === "number" && mesh.scale !== 1
        ? { scale: mesh.scale }
        : {};
  return {
    name: mesh.name,
    file: mesh.file,
    ...own,
    ...(mesh.tag ? { tag: mesh.tag } : {}),
    ...(mesh.cell_type ? { cell_type: mesh.cell_type } : {}),
    dim,
  };
}

/**
 * The meshes of files and scripts that the tools of a mesh take (#438), which the
 * worker takes as the script does; undefined until each of them is read or made and
 * fits the model (no file note), and their cells fit the tools (`readProblems()`).
 */
export function generateSources(
  mesh: MeshGenerate,
  commands: readonly Command[],
  files: MeshFiles,
): SourceMesh[] | undefined {
  const { tools, sources } = chainOf(mesh, commands);
  const ready = sources.every(
    (source) =>
      meshStatus(source, commands, files)?.state === "ready" &&
      !fileNote(source, commands, files),
  );
  if (!ready || tools.some((t) => readProblems(t, commands, files).length))
    return undefined;
  return sources.map((source) => sourceMesh(source, commands));
}

/**
 * The dimensions of the meshes of files and scripts of the model that are read
 * (#438): of the type of their solid cells.
 */
function readDimensions(
  commands: readonly Command[],
  files: MeshFiles,
): Map<string, MeshDimension> {
  const known = new Map<string, MeshDimension>();
  for (const mesh of commands) {
    if (!isMesh(mesh)) continue;
    const status = meshStatus(mesh, commands, files);
    if (status?.state !== "ready") continue;
    const choice = solidOf(status.info, mesh.cell_type);
    if (!("solid" in choice)) continue;
    const type = choice.solid.cell_type;
    const dim = CELLS_2D.includes(type) ? 2 : 3;
    known.set(mesh.name, { points: dim, cells: dim, cell_type: type });
  }
  return known;
}

/**
 * Why the inputs of a tool do not fit it by the cell types of the read meshes of
 * files and scripts (#438), e.g. a stack of an imported mesh of tetrahedrons and a
 * cube: the rules of the commands do not know them (`inputProblems()` without the
 * problems of the commands alone).
 */
export function readProblems(
  mesh: MeshGenerate,
  commands: readonly Command[],
  files: MeshFiles,
): string[] {
  const read = readDimensions(commands, files);
  if (!read.size) return [];
  const before = new Set(inputProblems(mesh, dimensions(commands)));
  return inputProblems(mesh, dimensions(commands, read)).filter(
    (problem) => !before.has(problem),
  );
}

/** The meshes that a tool takes (ADR 0019), none of a primitive. */
export const inputsOf = (mesh: MeshGenerate): readonly string[] =>
  "inputs" in mesh ? mesh.inputs : [];

/**
 * The key of the mesh of tools: its name, its chain with values and the meshes of
 * files and scripts that it takes (#438).
 */
export function generateKey(
  mesh: MeshGenerate,
  commands: readonly Command[],
): string {
  const { sources } = chainOf(mesh, commands);
  return JSON.stringify([
    mesh.name,
    generateChain(mesh, commands),
    ...(sources.length
      ? [sources.map((source) => sourceMesh(source, commands))]
      : []),
  ]);
}

/**
 * The state of the mesh of a mesh object: the read file of an import, the mesh a
 * script made with the parameters of the model, or the mesh of tools (undefined if
 * the file is not loaded or the mesh is not asked for yet).
 */
export function meshStatus(
  mesh: MeshObject,
  commands: readonly Command[],
  files: MeshFiles,
): FileState | undefined {
  if (mesh.command === "mesh.generate")
    return files.madeStatus(generateKey(mesh, commands));
  const status = files.get(mesh.file)?.status;
  if (mesh.command === "mesh.import" || status?.state !== "script")
    return status;
  return files.madeStatus(scriptKey(mesh, commands));
}

/** The key of a cut (#395). */
export const cutKey = (cut: Cut) =>
  JSON.stringify([cut.axis, cut.value, cut.half]);

/**
 * The key of the cut of a drawn mesh (#395): its name and the request that made its
 * mesh. So a mesh made anew is drawn whole until its first cut arrives, and two
 * meshes of one source get a cut each, e.g. imports of a file with different scales
 * (#442).
 */
const meshCutKey = ({ name, source }: Omit<MeshCut, "cut">) =>
  JSON.stringify([name, source]);

/**
 * The request that made the mesh of a mesh object (#395): the read of its file, the
 * run of its script with the parameters of the model, or its tools; undefined if
 * its file is not loaded.
 */
export function meshSource(
  mesh: MeshObject,
  commands: readonly Command[],
  files: MeshFiles,
): MeshSource | undefined {
  if (mesh.command === "mesh.generate") {
    const chain = generateChain(mesh, commands);
    const sources = generateSources(mesh, commands, files);
    if (!chain.length || !sources) return undefined;
    return {
      type: "generate-mesh",
      commands: chain,
      name: mesh.name,
      ...(sources.length ? { sources } : {}),
    };
  }
  const state = files.get(mesh.file)?.status.state;
  if (mesh.command === "mesh.import" || state !== "script")
    return state ? { type: "inspect-mesh", name: mesh.file } : undefined;
  return {
    type: "make-mesh",
    file: mesh.file,
    parameters: scriptParameters(mesh, commands),
    ...(mesh.item ? { item: mesh.item } : {}),
  };
}

/**
 * Make the meshes of the scripts (#182) and of the tools (ADR 0019) of a model that
 * are not made yet.
 */
export function makeMeshes(
  commands: readonly Command[],
  files: MeshFiles,
): void {
  const keys = new Set<string>();
  for (const mesh of commands) {
    if (mesh.command === "mesh.generate") {
      const chain = generateChain(mesh, commands);
      // once the meshes of files and scripts that it takes are read (#438)
      const sources = generateSources(mesh, commands, files);
      if (!chain.length || !sources) continue;
      const key = generateKey(mesh, commands);
      keys.add(key);
      void files.generate(key, chain, mesh.name, sources);
      continue;
    }
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
    const note =
      command.command === "mesh.generate"
        ? toolNote(command, commands, files)
        : isMesh(command)
          ? fileNote(command, commands, files)
          : undefined;
    if (note) notes.set(command.name, [note]);
  }
  return notes;
}

/**
 * An error of FElupe in the tool of a made mesh (ADR 0019), or an input that does
 * not fit it by the cell type of its read file or script (#438).
 */
function toolNote(
  command: MeshGenerate,
  commands: readonly Command[],
  files: MeshFiles,
): string | undefined {
  const [problem] = readProblems(command, commands, files);
  if (problem) return problem;
  const status = meshStatus(command, commands, files);
  return status?.state === "error"
    ? `${command.tool}: ${status.message}`
    : undefined;
}

/** Why the file of a mesh is not loaded or not usable. */
function fileNote(
  command: MeshCommand,
  commands: readonly Command[],
  files: MeshFiles,
): string | undefined {
  const file = files.get(command.file);
  const script = command.command === "mesh.script";
  if (!file)
    return `The ${script ? "script" : "file"} '${command.file}' is not loaded. Choose it in the properties.`;
  // a mesh file named like a script
  if (script && file.status.state === "ready")
    return `'${command.file}' is not a Python script.`;
  const status = meshStatus(command, commands, files);
  if (status?.state === "error") return `${command.file}: ${status.message}`;
  if (status?.state !== "ready") return undefined;
  return cellsNote(command, commands, status.info);
}

/** Why the cells of a read mesh do not fit the model. */
function cellsNote(
  command: MeshCommand,
  commands: readonly Command[],
  info: MeshInfo,
): string | undefined {
  const choice = solidOf(info, command.cell_type);
  if ("problem" in choice) return choice.problem;
  const source =
    command.command === "mesh.script"
      ? `The mesh of '${command.file}'${command.item ? ` ['${command.item}']` : ""}`
      : `The file '${command.file}'`;
  // the cells of the type of the analysis (#175); the 2D cells of a 3D model, given
  // by their cell type, are a construction mesh (#438)
  const cellType = choice.solid.cell_type;
  const planar = CELLS_2D.includes(cellType);
  if (planar !== is2d(analysisOf(commands)) && !(planar && command.cell_type))
    return planar
      ? `${source} has ${cellType} cells, which are 2D cells: set the analysis of the settings to plane strain or axisymmetric, or take them as a construction mesh with the cell type ${cellType}, e.g. a profile to revolve.`
      : `${source} has ${cellType} cells, but a 2D model has 2D cells (triangles or quads).`;
  if (!command.tag || choice.solid.tags.some((t) => t.name === command.tag))
    return undefined;
  const subject = command.cell_type
    ? `The ${command.cell_type} cells of ${source.replace("The ", "the ")} have`
    : `${source} has`;
  return `${subject} no cell tag '${command.tag}'.`;
}
