// Report of felupe_studio.checks.check(), computed in the worker with the mesh data.

export interface CheckReport {
  ok: boolean;
  messages: string[];
  cells: {
    total: number;
    unassigned: { mesh: string; cells: number }[];
    multiple: { mesh: string; cells: number; sections: string[] }[];
  };
  interfaces: { sections: [string, string]; shared: number; hanging: number }[];
  /** The sections of cells that their formulation does not take (#420). */
  formulations?: { section: string; formulation: string; cell_type: string }[];
}
