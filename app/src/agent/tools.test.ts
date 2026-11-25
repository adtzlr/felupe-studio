import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import fixture from "../../../tests/data/two_sections.json";
import type { Command, CommandList } from "../core/commands";
import { MeshFiles } from "../core/meshfiles";
import { ModelStore } from "../core/store";
import type { RuntimeClient } from "../worker/client";
import type { Progress } from "./connection";
import { readSamples } from "../vite/samples";
import { type AgentHost, agentTools } from "./tools";

const noProgress: Progress = () => {};

function setup(overrides: Partial<AgentHost> = {}) {
  const store = new ModelStore(structuredClone(fixture) as CommandList);
  const written: string[] = [];
  const files = new MeshFiles(
    async (name) => ({ info: { file: name, points: 8 }, surfaces: {} }),
    {
      write: async (name) => {
        written.push(name);
      },
    },
  );
  const host: AgentHost = {
    store,
    files,
    notes: () => [{ name: "right", message: "A note." }],
    modified: () => false,
    // the samples of app/samples (#350)
    samples: async () => readSamples(join(__dirname, "../../samples")),
    openSample: vi.fn(async () => {}),
    solveBlocker: () => undefined,
    solve: async () => {},
    selection: () => ({ selected: [], workspace: "model" }),
    select: vi.fn(),
    show: () => ({ workspace: "model" }),
    picture: async () => new Blob([new Uint8Array([137, 80, 78, 71])]),
    trustScript: async () => true,
    ...overrides,
  };
  const call = (tool: string, args: Record<string, unknown> = {}) =>
    agentTools(host)(tool, args, noProgress);
  return { store, files, written, host, call };
}

describe("the tools of the agent bridge in the app (#258)", () => {
  it("list, add, change and delete commands as undo steps", async () => {
    const { store, call } = setup();
    const listed = (await call("list_commands")) as {
      commands: Command[];
      errors: string[];
      notes: string[];
    };
    expect(listed.commands).toBe(store.commands);
    expect(listed.errors).toEqual([]);
    expect(listed.notes).toEqual(["A note."]);

    const added = (await call("add_command", {
      command: { command: "parameter.add", name: "h", value: 2 },
      before: "right",
    })) as { added: string; index: number; errors: string[] };
    expect(added.added).toBe("h");
    expect(store.commands[added.index].name).toBe("h");
    expect(store.commands.findIndex((c) => c.name === "right")).toBeGreaterThan(
      added.index,
    );

    // an expression of the new parameter, and a rename that it follows
    await call("update_command", {
      name: "right",
      changes: { select: { axis: "x", value: "h + 1" } },
    });
    await call("update_command", { name: "h", changes: { name: "height" } });
    expect(store.get("right")).toMatchObject({
      select: { value: "height + 1" },
    });
    expect(store.issues).toEqual([]);
    // one undo step each
    store.undo();
    expect(store.get("h")).toBeDefined();

    await expect(
      call("add_command", {
        command: { command: "parameter.add", name: "1x" },
      }),
    ).rejects.toThrow(/^Not added: /);
    await expect(
      call("add_command", {
        command: { command: "parameter.add", name: "right", value: 1 },
      }),
    ).rejects.toThrow("there is already an object 'right'");
    await expect(call("add_command", { command: 3 })).rejects.toThrow(
      "A command is an object with 'command' and 'name'.",
    );
    await expect(
      call("update_command", { name: "nothing", changes: {} }),
    ).rejects.toThrow("No command named 'nothing'.");
    await expect(call("delete_command", { name: "right" })).rejects.toThrow(
      "'right' is used by",
    );
    const deleted = (await call("delete_command", { name: "job_1" })) as {
      deleted: string;
    };
    expect(deleted.deleted).toBe("job_1");
    expect(store.get("job_1")).toBeUndefined();
  });

  it("set parameters as one undo step", async () => {
    const { store, call } = setup();
    await call("add_command", {
      command: { command: "parameter.add", name: "a", value: 1 },
    });
    await call("add_command", {
      command: { command: "parameter.add", name: "b", value: 2 },
    });
    const { parameters } = (await call("parameters")) as {
      parameters: { name: string; value: number }[];
    };
    expect(parameters).toEqual([
      { name: "a", value: 1 },
      { name: "b", value: 2 },
    ]);
    await call("set_parameters", { values: { a: 3, b: 4 } });
    expect(store.get("a")).toMatchObject({ value: 3 });
    store.undo();
    expect(store.get("a")).toMatchObject({ value: 1 });
    expect(store.get("b")).toMatchObject({ value: 2 });
    await expect(
      call("set_parameters", { values: { right: 1 } }),
    ).rejects.toThrow("No parameter named 'right'.");
  });

  it("give a derived parameter with its value, and do not set it (ADR 0021)", async () => {
    const { call } = setup();
    for (const [name, value] of [
      ["a", 1],
      ["b", 2],
      ["c", "a + 2 * b"],
    ] as const)
      await call("add_command", {
        command: { command: "parameter.add", name, value },
      });
    const { parameters } = (await call("parameters")) as {
      parameters: { name: string }[];
    };
    expect(parameters.at(-1)).toEqual({
      name: "c",
      value: "a + 2 * b",
      computed: 5,
    });
    await expect(call("set_parameters", { values: { c: 7 } })).rejects.toThrow(
      "'c' is derived from other parameters: change them, or its expression.",
    );
  });

  it("write mesh scripts only if the user agrees", async () => {
    const trust = vi.fn(async () => false);
    const { files, written, call } = setup({ trustScript: trust });
    const script = "import felupe as fem\nmesh = fem.Cube(n=n)\n";
    await expect(
      call("write_file", { name: "cube.py", content: script }),
    ).rejects.toThrow("The user did not accept the Python script 'cube.py'");
    expect(trust).toHaveBeenCalledWith("cube.py", script);
    expect(files.has("cube.py")).toBe(false);
    trust.mockResolvedValue(true);
    expect(
      await call("write_file", { name: "../cube.py", content: script }),
    ).toEqual({
      written: "cube.py",
      bytes: script.length,
    });
    expect(written).toEqual(["cube.py"]);
    // a mesh file is no script
    await call("write_file", { name: "cube.vtk", content: "# vtk" });
    expect(trust).toHaveBeenCalledTimes(2);
    expect(files.get("cube.vtk")?.status.state).toBe("ready");
  });

  it("run the script of a material once, like the MCP server (#423)", async () => {
    const runs: Record<string, number>[] = [];
    const files = new MeshFiles(undefined, {
      write: async () => {},
      inspect: async (file, parameters) => {
        runs.push(parameters);
        return parameters.bulk
          ? { file, type: "NeoHooke", statevars: 0 }
          : {
              file,
              error: "NameError: name 'bulk' is not defined",
              traceback: "…",
            };
      },
    });
    const { call } = setup({ files });
    await expect(call("inspect_material", { file: "soft.py" })).rejects.toThrow(
      "No file 'soft.py' in the files of the model.",
    );
    await expect(
      call("inspect_material", { file: "cube.vtk" }),
    ).rejects.toThrow("'cube.vtk' is not a Python script.");
    await call("write_file", { name: "soft.py", content: "umat = …" });
    // the parameters of the model, changed by the call
    expect(
      await call("inspect_material", {
        file: "soft.py",
        parameters: { bulk: 5 },
      }),
    ).toEqual({ file: "soft.py", type: "NeoHooke", statevars: 0 });
    expect(await call("inspect_material", { file: "soft.py" })).toEqual({
      file: "soft.py",
      error: "NameError: name 'bulk' is not defined",
      traceback: "…",
    });
    expect(runs).toEqual([{ bulk: 5 }, {}]);
  });

  it("open samples of an unchanged model", async () => {
    const opened = setup();
    const samples = (await opened.call("samples")) as { id: string }[];
    expect(samples.map((s) => s.id)).toContain("plate-with-hole");
    await opened.call("open_sample", { sample: "plate-with-hole" });
    expect(opened.host.openSample).toHaveBeenCalledWith(
      expect.objectContaining({ id: "plate-with-hole" }),
    );
    await expect(
      opened.call("open_sample", { sample: "nope" }),
    ).rejects.toThrow("Unknown sample 'nope'");
    const changed = setup({ modified: () => true });
    await expect(
      changed.call("open_sample", { sample: "plate-with-hole" }),
    ).rejects.toThrow("unsaved changes");
  });

  it("check, script and results with the runtime", async () => {
    const report = { ok: true, messages: [] };
    const scene = {
      label: "Displacement",
      at: "point",
      range: [0, 1],
      // the range of every section is the app's (#377), not the agent's
      sections: { body: { range: [0, 1], extremes: null } },
      surfaces: [{}],
    };
    const client = {
      check: vi.fn(async () => report),
      script: vi.fn(async () => "import felupe as fem\n"),
      resultScene: vi.fn(async () => scene),
    } as unknown as RuntimeClient;
    const jobs = {
      results: {
        state: "finished",
        results: { job_1: { substeps: 6, time: 1 } },
      },
    } as unknown as AgentHost["jobs"];
    const { store, call } = setup({ client, jobs });
    expect(await call("check")).toBe(report);
    expect(store.report).toBe(report);
    expect(await call("script")).toBe("import felupe as fem\n");
    expect(await call("results", { job: "job_1", substep: 3 })).toEqual({
      job: "job_1",
      substep: 3,
      substeps: 6,
      label: "Displacement",
      at: "point",
      range: [0, 1],
    });
    expect(client.resultScene).toHaveBeenCalledWith(
      "job_1",
      3,
      "stress_mises",
      "cells",
    );
    await expect(call("results", { job: "job_1", substep: 7 })).rejects.toThrow(
      "Job 'job_1' has the substeps 1 to 6.",
    );
    await expect(call("results", { job: "other" })).rejects.toThrow(
      "No results of job 'other': solve first.",
    );
    await expect(
      call("results", { job: "job_1", quantity: "pressure" }),
    ).rejects.toThrow("Unknown quantity 'pressure'");
  });

  it("solve with progress, or say why not", async () => {
    const listeners = new Set<() => void>();
    let run: Record<string, unknown> = { state: "idle" };
    const jobs = {
      get run() {
        return run;
      },
      subscribe: (listener: () => void) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
    } as unknown as AgentHost["jobs"];
    const progress = { jobs: ["job_1"], plan: { job_1: [2] }, job: "job_1" };
    const solve = async () => {
      for (const done of [0, 1, 2]) {
        run = { state: "running", progress: { ...progress, done } };
        for (const listener of listeners) listener();
      }
      run = {
        state: "finished",
        progress: { ...progress, done: 2 },
        results: {
          job_1: { substeps: 2, time: 0.5, x: [[0], [1]], y: [[0], [2]] },
        },
      };
    };
    const { host } = setup({ jobs, solve });
    const reported: unknown[] = [];
    const result = await agentTools(host)("solve", {}, (...args) =>
      reported.push(args),
    );
    expect(result).toEqual({
      job_1: {
        substeps: 2,
        time: 0.5,
        curve: { x: [[0], [1]], y: [[0], [2]] },
      },
    });
    expect(reported).toEqual([
      [1, 2, "job_1: 1 of 2 substeps"],
      [2, 2, "job_1: 2 of 2 substeps"],
    ]);
    const blocked = setup({ jobs, solveBlocker: () => "Add a job first." });
    await expect(blocked.call("solve")).rejects.toThrow(
      "Not solved: Add a job first.",
    );
    const failed = setup({
      jobs,
      solve: async () => {
        run = { state: "failed", message: "NewtonConvergenceError" };
      },
    });
    await expect(failed.call("solve")).rejects.toThrow(
      "NewtonConvergenceError",
    );
  });

  it("select, show and take a picture of the view", async () => {
    const { host, call } = setup({
      show: (workspace) =>
        workspace === "results"
          ? "No results yet: solve first."
          : { workspace: "model" },
    });
    const selected = (await call("select", { names: ["right", "left"] })) as {
      note: string;
    };
    expect(host.select).toHaveBeenCalledWith("right");
    expect(selected.note).toBe("The app selects one object at a time: right.");
    await expect(call("select", { names: ["nothing"] })).rejects.toThrow(
      "No command named 'nothing'.",
    );
    expect(await call("show", { view: "model" })).toEqual({
      workspace: "model",
    });
    await expect(call("show", { view: "results" })).rejects.toThrow(
      "No results yet",
    );
    expect(await call("picture")).toEqual({ png: "iVBORw==" });
    await expect(call("export")).rejects.toThrow("Unknown tool 'export'.");
  });
});
