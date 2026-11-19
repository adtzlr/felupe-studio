// The exports of the app (#312): the script, the results, the control points and a
// picture of the view (the menu File ▸ Export), and a mesh as a file of another
// format (#230).
import { useRef, useState } from "preact/hooks";
import { exportName, mediaType, stemOf } from "../core/files";
import {
  isMesh,
  type MeshFiles,
  meshStatus,
  scriptParameters,
} from "../core/meshfiles";
import type { ModelStore } from "../core/store";
import type { Capture } from "../viewer/viewer";
import type { RuntimeClient } from "../worker/client";
import type { MeshFormat } from "../worker/protocol";
import type { MeshExport } from "./ExportMeshDialog";
import type { ExportItem } from "./Header";
import type { Runtime } from "./hooks";
import type { Workspace } from "./Ribbon";
import type { Project } from "./useProject";
import type { Results } from "./useResults";

interface Options {
  store: ModelStore;
  files: MeshFiles;
  client?: RuntimeClient;
  runtime: Runtime;
  results: Results;
  project: Project;
  workspace: Workspace;
  download: (name: string, data: string | Blob) => void;
}

export function useExports({
  store,
  files,
  client,
  runtime,
  results,
  project,
  workspace,
  download,
}: Options) {
  const { fileName, failed } = project;
  const { run, finished, view } = results;
  // the last format of an exported mesh
  const [meshFormat, setMeshFormat] = useState<MeshFormat>("vtu");
  const captureModel = useRef<Capture>({}).current;
  const captureResults = useRef<Capture>({}).current;

  /** A picture of the shown view (PNG): of the results or of the model. */
  const picture = async () => {
    const shown = workspace === "results" && view;
    return (shown ? captureResults : captureModel).current?.();
  };

  /**
   * Export a mesh of the model as a file of another format (#230): the mesh file, or
   * the mesh of a script with the values of the parameters.
   */
  const exportMesh = async (
    name: string,
    { name: file, format }: MeshExport,
  ) => {
    // with the values of the expressions of its scale (#242)
    const mesh = store.getResolved(name);
    if (!client || !mesh || !isMesh(mesh)) return;
    setMeshFormat(format);
    const data = await client.exportMesh(mesh.file, format, {
      ...(mesh.command === "mesh.script"
        ? {
            parameters: scriptParameters(mesh, store.commands),
            ...(mesh.item ? { item: mesh.item } : {}),
          }
        : mesh.scale !== undefined && mesh.scale !== 1
          ? { scale: mesh.scale }
          : {}),
      ...(mesh.cell_type ? { cellType: mesh.cell_type } : {}),
    });
    download(file, new Blob([data as BlobPart], { type: mediaType(file) }));
  };

  /** Where the mesh to export comes from, for the export dialog (#230). */
  const meshSource = (name: string): string => {
    const mesh = store.get(name);
    if (!mesh || !isMesh(mesh)) return "";
    if (mesh.command === "mesh.import")
      return mesh.scale !== undefined && mesh.scale !== 1
        ? `From ${mesh.file}, scaled by ${mesh.scale}`
        : `From ${mesh.file}`;
    const count = Object.keys(scriptParameters(mesh, store.commands)).length;
    const item = mesh.item ? `, item ${mesh.item}` : "";
    return `Made by ${mesh.file} with ${count} parameter${count === 1 ? "" : "s"}${item}`;
  };

  /** Why a mesh cannot be exported, if so (#230). */
  const meshBlocker = (name: string): string | undefined => {
    const mesh = store.get(name);
    if (!mesh || !isMesh(mesh)) return "Not a mesh.";
    if (!client) return "Python is not available.";
    if (runtime.state === "loading") return "Python is still loading.";
    if (runtime.state === "error") return "Python could not be loaded.";
    const status = meshStatus(mesh, store.commands, files);
    if (status?.state === "reading") return "The mesh is still being read.";
    if (status?.state === "error")
      return `The mesh has an error: ${status.message}`;
    if (status?.state !== "ready")
      return mesh.command === "mesh.script"
        ? `Choose the script ${mesh.file} first.`
        : `Choose the mesh file ${mesh.file} first.`;
    return undefined;
  };

  const exportScript = async () => {
    if (!client) return;
    const { serialize } = await import("../core/project");
    const text = await client.script(serialize(store.document));
    download(exportName(fileName, ".py"), text);
  };
  const scriptExport = () =>
    void exportScript().catch(failed("The script could not be exported."));

  const exportPicture = async () => {
    const shown = workspace === "results" && view;
    const png = await picture();
    if (!png) throw new Error("The view shows nothing yet.");
    const suffix = shown ? `-${view.job}-${view.substep}.png` : ".png";
    download(exportName(fileName, suffix), png);
  };

  const exportResults = async (format: "vtu" | "xdmf" | "csv") => {
    if (!client || !finished || !view) return;
    const { job, substep } = view;
    // the strains and the stresses at the points too, as in the view (#231)
    const data = await client.exportResults(
      job,
      format,
      format === "vtu" ? substep : undefined,
      results.contour.values,
    );
    const suffix =
      format === "vtu"
        ? `-${job}-${substep}.vtu`
        : format === "csv"
          ? `-${job}-points.csv`
          : `-${job}.xdmf`;
    const name = exportName(fileName, suffix);
    download(name, new Blob([data as BlobPart], { type: mediaType(name) }));
  };

  const exports: ExportItem[] = [
    {
      id: "script",
      label: "Python script",
      hint: "The FElupe script of the model; it reads the mesh files from its folder.",
      blocker: !client
        ? "Python is not available."
        : store.issues.length
          ? "Fix the issues of the model first."
          : run.state === "running"
            ? "Wait until the jobs have run."
            : runtime.state === "loading"
              ? "Python is still loading."
              : runtime.state === "error"
                ? "Python could not be loaded."
                : undefined,
      onSelect: scriptExport,
    },
    {
      id: "xdmf",
      label: "Results of the job (XDMF)",
      hint: view
        ? `All substeps of ${view.job}: displacements, strains and stresses, for ParaView.`
        : "All substeps of the job, for ParaView.",
      blocker: results.blocker,
      onSelect: () =>
        void exportResults("xdmf").catch(
          failed("The results could not be exported."),
        ),
    },
    {
      id: "vtu",
      label: "Results of the substep (VTU)",
      hint: view
        ? `Substep ${view.substep} of ${view.job} (as shown in the Results workspace).`
        : "The substep shown in the Results workspace.",
      blocker: results.blocker,
      onSelect: () =>
        void exportResults("vtu").catch(
          failed("The results could not be exported."),
        ),
    },
    ...(store.commands.some(
      (c) => c.command === "point.add" || c.command === "rigid.add",
    )
      ? [
          {
            id: "points",
            label: "Control points (CSV)",
            hint: view
              ? `Displacements and forces of the control points of all substeps of ${view.job}.`
              : "Displacements and forces of the control points of all substeps.",
            blocker: results.blocker,
            onSelect: () =>
              void exportResults("csv").catch(
                failed("The control points could not be exported."),
              ),
          },
        ]
      : []),
    {
      id: "picture",
      label: "Picture of the view",
      hint: "A PNG of the 3D view with its scalar bar, legend and axes.",
      onSelect: () =>
        void exportPicture().catch(
          failed("The picture could not be exported."),
        ),
    },
  ];

  return {
    exports,
    scriptExport,
    picture,
    captureModel,
    captureResults,
    meshFormat,
    meshSource,
    meshBlocker,
    /** The stem of the file of an exported mesh. */
    meshStem: (mesh: string) => `${stemOf(fileName) || "untitled"}-${mesh}`,
    exportMesh: (name: string, choice: MeshExport) =>
      void exportMesh(name, choice).catch(
        failed("The mesh could not be exported."),
      ),
  };
}

export type Exports = ReturnType<typeof useExports>;
