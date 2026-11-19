// The dialogs of the app (#312): which one is open, and the dialogs themselves.
import { useState } from "preact/hooks";
import { REGISTRY } from "../core/registry";
import type { RibbonItem } from "../core/ribbon";
import type { MeshFiles } from "../core/meshfiles";
import type { Sample } from "../core/samples";
import type { ModelStore } from "../core/store";
import type { RuntimeClient } from "../worker/client";
import type { CommandType } from "../core/validate";
import { AboutDialog } from "./AboutDialog";
import { CreateDialog } from "./CreateDialog";
import { ExportMeshDialog } from "./ExportMeshDialog";
import type { Runtime } from "./hooks";
import { ImportMeshDialog } from "./ImportMeshDialog";
import { NewProjectDialog } from "./NewProjectDialog";
import { ParametersDialog } from "./ParametersDialog";
import { SamplesDialog } from "./SamplesDialog";
import { SaveAsDialog } from "./SaveAsDialog";
import { ScriptConsent } from "./ScriptConsent";
import { ShortcutsDialog } from "./ShortcutsDialog";
import type { ScriptRequest } from "./useAgent";
import type { Exports } from "./useExports";
import type { Project } from "./useProject";

/** Which dialog of the app is open, and what it shows. */
export function useDialogs() {
  const [help, setHelp] = useState<"about" | "shortcuts">();
  const [samplesOpen, setSamplesOpen] = useState(false);
  const [savingAs, setSavingAs] = useState(false);
  // a mesh to export, from the context menu of the browser (#230)
  const [exportingMesh, setExportingMesh] = useState<string>();
  const [importing, setImporting] = useState<{ file?: File }>();
  const [creating, setCreating] = useState<RibbonItem | undefined>();
  // the parameters of a project, when it is opened and from the menu (#183)
  const [parameters, setParameters] = useState<{
    project: string;
    opening: boolean;
  }>();
  return {
    help,
    setHelp,
    samplesOpen,
    setSamplesOpen,
    savingAs,
    setSavingAs,
    exportingMesh,
    setExportingMesh,
    importing,
    /** Import a mesh file: the given one, or one to choose. */
    importMesh: (file?: File) => setImporting(file ? { file } : {}),
    closeImport: () => setImporting(undefined),
    creating,
    setCreating,
    /** Create a command of a type, with the values of a preset. */
    create: (type: CommandType, preset: Record<string, unknown> = {}) =>
      setCreating({ id: type, type, label: REGISTRY[type].label, preset }),
    parameters,
    setParameters,
  };
}

export type DialogState = ReturnType<typeof useDialogs>;

interface Props {
  dialogs: DialogState;
  store: ModelStore;
  files: MeshFiles;
  client?: RuntimeClient;
  runtime: Runtime;
  project: Project;
  exports: Exports;
  script?: ScriptRequest;
  /** The samples of the app (#350). */
  samples: readonly Sample[];
  onOpenSample: (sample: Sample) => Promise<void>;
  onSelect: (name: string) => void;
}

export function Dialogs({
  dialogs,
  store,
  files,
  client,
  runtime,
  project,
  exports,
  script,
  samples,
  onOpenSample,
  onSelect,
}: Props) {
  const { fileName, opening } = project;
  const { help, exportingMesh, importing, creating, parameters } = dialogs;
  const created = (name: string) => {
    dialogs.setCreating(undefined);
    onSelect(name);
  };
  return (
    <>
      {project.confirmNew && (
        <NewProjectDialog
          fileName={fileName}
          onConfirm={project.newProject}
          onClose={project.cancelNew}
        />
      )}
      {dialogs.savingAs && (
        <SaveAsDialog
          fileName={fileName}
          commands={store.commands}
          files={files}
          scriptAvailable={!!client && runtime.state === "ready"}
          onSave={({ name, script }) => {
            dialogs.setSavingAs(false);
            void project.saveProject(name, script);
          }}
          onClose={() => dialogs.setSavingAs(false)}
        />
      )}
      {exportingMesh && (
        <ExportMeshDialog
          mesh={exportingMesh}
          stem={exports.meshStem(exportingMesh)}
          format={exports.meshFormat}
          source={exports.meshSource(exportingMesh)}
          onExport={(choice) => {
            dialogs.setExportingMesh(undefined);
            exports.exportMesh(exportingMesh, choice);
          }}
          onClose={() => dialogs.setExportingMesh(undefined)}
        />
      )}
      {opening && (
        <NewProjectDialog
          fileName={fileName}
          opening={opening.name}
          onConfirm={project.confirmOpening}
          onClose={project.cancelOpening}
        />
      )}
      {help === "about" && (
        <AboutDialog
          runtime={runtime}
          onClose={() => dialogs.setHelp(undefined)}
        />
      )}
      {help === "shortcuts" && (
        <ShortcutsDialog onClose={() => dialogs.setHelp(undefined)} />
      )}
      {dialogs.samplesOpen && (
        <SamplesDialog
          modified={store.commands.length > 0 && project.modified}
          samples={samples}
          onOpen={onOpenSample}
          onClose={() => dialogs.setSamplesOpen(false)}
        />
      )}
      {importing && (
        <ImportMeshDialog
          store={store}
          files={files}
          initial={importing.file}
          onClose={dialogs.closeImport}
          onCreated={(name) => {
            dialogs.closeImport();
            onSelect(name);
          }}
        />
      )}
      {script && <ScriptConsent request={script} />}
      {parameters && (
        <ParametersDialog
          store={store}
          files={files}
          project={parameters.project}
          opening={parameters.opening}
          local={client?.local}
          onClose={() => dialogs.setParameters(undefined)}
        />
      )}
      {creating && (
        <CreateDialog
          item={creating}
          store={store}
          onClose={() => dialogs.setCreating(undefined)}
          onCreated={created}
        />
      )}
    </>
  );
}
