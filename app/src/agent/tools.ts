// The tools of the agent bridge in the app (#258, ADR 0015): the answers of the open
// model to the tool calls of an agent, with the names and answers of the MCP server
// of project folders (`felupe_studio.mcp`). A change is an undo step of the open
// model and answers with the issues of the app; an error is an Error whose message
// the agent gets.
import type { Command } from "../core/commands";
import type { JobRun, JobRunner } from "../core/jobs";
import { isScript, type MeshFiles } from "../core/meshfiles";
import { parameterValues } from "../core/resolve";
import { type ResultView, substepsOf } from "../core/results";
import type { Sample } from "../core/samples";
import type { Edit, ModelStore } from "../core/store";
import { type Issue, nameProblem } from "../core/validate";
import type { RuntimeClient } from "../worker/client";
import { safeName } from "../worker/files";
import type { Quantity, ValuesMethod } from "../worker/protocol";
import type { Handler, Progress } from "./connection";

export type Workspace = "model" | "results";

/** What the tools need of the app. */
export interface AgentHost {
  store: ModelStore;
  files: MeshFiles;
  client?: RuntimeClient;
  jobs?: JobRunner;
  /** The notes of the app, e.g. of symmetry planes and mesh files. */
  notes(): readonly Pick<Issue, "name" | "message">[];
  /** The open model has changes that are not saved. */
  modified(): boolean;
  /** The samples of the app (#350), once they are loaded. */
  samples(): Promise<readonly Sample[]>;
  openSample(sample: Sample): Promise<void>;
  /** Why the model cannot be solved now, if it cannot. */
  solveBlocker(): string | undefined;
  /** Solve the model like the button Solve, with the live results of the app. */
  solve(): Promise<void>;
  selection(): { selected: string[]; workspace: Workspace; view?: ResultView };
  select(name: string | undefined): void;
  /** Show the model or the results of a job: what it shows, or why not. */
  show(
    workspace: Workspace,
    view?: Partial<Pick<ResultView, "job" | "substep" | "quantity">>,
  ): string | { workspace: Workspace; view?: ResultView };
  /** A picture of the view (PNG). */
  picture(): Promise<Blob | undefined>;
  /** Ask the user to run a mesh script of the agent (Show, Run, Reject). */
  trustScript(name: string, content: string): Promise<boolean>;
}

const QUANTITIES: readonly Quantity[] = [
  "displacement",
  "displacement_x",
  "displacement_y",
  "displacement_z",
  "strain_max",
  "strain_mid",
  "strain_min",
  "stress_max",
  "stress_mid",
  "stress_min",
  "stress_mises",
  "plastic_strain",
  "mullins_energy",
];
const METHODS: readonly ValuesMethod[] = [
  "cells",
  "mean",
  "project",
  "topoints",
];

const string = (args: Record<string, unknown>, key: string): string => {
  const value = args[key];
  if (typeof value !== "string" || !value)
    throw new Error(`'${key}' is a string.`);
  return value;
};

const optional = <T>(args: Record<string, unknown>, key: string) =>
  args[key] === undefined || args[key] === null ? undefined : (args[key] as T);

/** A blob as base64, e.g. a picture for the agent. */
async function base64(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let text = "";
  for (let i = 0; i < bytes.length; i += 0x8000)
    text += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(text);
}

/** The answers of the open model to the tools of an agent. */
// eslint-disable-next-line max-lines-per-function -- the tools are its nested handlers, each of them small (#313)
export function agentTools(host: AgentHost): Handler {
  const { store, files } = host;

  /** The errors and notes of the model, like `issues()` of the MCP server. */
  const issues = () => ({
    errors: store.issues.map((i) => i.message),
    notes: host.notes().map((i) => i.message),
  });

  const find = (name: string): Command => {
    const command = store.get(name);
    if (!command) throw new Error(`No command named '${name}'.`);
    return command;
  };

  /** The schema check of one command, like the command line and the MCP server. */
  const checked = async (command: unknown, verb: string): Promise<Command> => {
    if (
      !command ||
      typeof command !== "object" ||
      Array.isArray(command) ||
      !("command" in command) ||
      typeof (command as { name?: unknown }).name !== "string"
    )
      throw new Error("A command is an object with 'command' and 'name'.");
    const { commandErrors } = await import("../core/project");
    const errors = commandErrors(command as Command);
    if (errors.length) throw new Error(`Not ${verb}: ${errors.join(" ")}`);
    return command as Command;
  };

  const document = async () => {
    const { serialize } = await import("../core/project");
    return serialize(store.document);
  };

  const needClient = () => {
    if (!host.client) throw new Error("Python is not loaded.");
    return host.client;
  };

  /** The jobs of a finished run, up to and including a job. */
  const solved = (
    run: Extract<JobRun, { state: "finished" }>,
    job?: string,
  ) => {
    const jobs = run.progress.jobs.length
      ? run.progress.jobs
      : Object.keys(run.results);
    const last = job ? jobs.indexOf(job) : jobs.length - 1;
    return Object.fromEntries(
      jobs.slice(0, last + 1).map((name) => {
        const result = run.results[name];
        return [
          name,
          {
            substeps: result.substeps,
            time: result.time,
            ...(result.x ? { curve: { x: result.x, y: result.y } } : {}),
          },
        ];
      }),
    );
  };

  const tools: Record<
    string,
    (args: Record<string, unknown>, progress: Progress) => Promise<unknown>
  > = {
    samples: async () =>
      (await host.samples()).map(({ id, title, description, topics }) => ({
        id,
        title,
        description,
        topics,
      })),

    open_sample: async (args) => {
      const id = string(args, "sample");
      const samples = await host.samples();
      const sample = samples.find((s) => s.id === id);
      if (!sample)
        throw new Error(
          `Unknown sample '${id}': ${samples.map((s) => s.id).join(", ")}.`,
        );
      if (host.modified())
        throw new Error(
          "The open model has unsaved changes: ask the user to save or discard them first.",
        );
      await host.openSample(sample);
      return { opened: id, commands: store.commands.length, ...issues() };
    },

    list_commands: async () => ({ commands: store.commands, ...issues() }),

    add_command: async (args) => {
      const command = await checked(args.command, "added");
      const problem = nameProblem(command.name);
      if (problem) throw new Error(`Not added: ${problem}`);
      if (store.get(command.name))
        throw new Error(
          `Not added: there is already an object '${command.name}'.`,
        );
      const before = optional<string>(args, "before");
      const index = before
        ? store.commands.indexOf(find(before))
        : store.commands.length;
      store.apply({ type: "add", command, index });
      return {
        added: command.name,
        index: store.commands.findIndex((c) => c.name === command.name),
        ...issues(),
      };
    },

    update_command: async (args) => {
      const name = string(args, "name");
      const changes = args.changes;
      if (!changes || typeof changes !== "object" || Array.isArray(changes))
        throw new Error("'changes' is an object of properties.");
      const merged = Object.fromEntries(
        Object.entries({ ...find(name), ...changes }).filter(
          ([, value]) => value !== null,
        ),
      );
      const command = await checked(merged, "changed");
      if (command.name !== name) {
        const problem = nameProblem(command.name);
        if (problem) throw new Error(`Not changed: ${problem}`);
        if (store.get(command.name))
          throw new Error(
            `Not changed: there is already an object '${command.name}'.`,
          );
      }
      // a new name renames the references to it, like in the properties
      store.update(name, command);
      return {
        updated: command.name,
        index: store.commands.findIndex((c) => c.name === command.name),
        ...issues(),
      };
    },

    delete_command: async (args) => {
      const name = string(args, "name");
      find(name);
      const users = store.dependents(name);
      if (users.length)
        throw new Error(
          `'${name}' is used by ${users.join(", ")}: change or delete them first.`,
        );
      store.apply({ type: "remove", name });
      return { deleted: name, ...issues() };
    },

    parameters: async () => {
      // a derived parameter (ADR 0021): its expression and its computed value
      const values = parameterValues(store.commands);
      return {
        parameters: store.commands
          .filter((c) => c.command === "parameter.add")
          .map((c) => ({
            ...Object.fromEntries(
              Object.entries(c).filter(([key]) => key !== "command"),
            ),
            ...(typeof c.value === "string" && c.name in values
              ? { computed: values[c.name] }
              : {}),
          })),
      };
    },

    set_parameters: async (args) => {
      const values = args.values;
      if (!values || typeof values !== "object" || Array.isArray(values))
        throw new Error("'values' is an object of names and numbers.");
      const edits: Edit[] = Object.entries(values).map(([name, value]) => {
        const parameter = store.get(name);
        if (parameter?.command !== "parameter.add")
          throw new Error(`No parameter named '${name}'.`);
        // a derived parameter is computed from others (ADR 0021)
        if (typeof parameter.value === "string")
          throw new Error(
            `'${name}' is derived from other parameters: change them, or its expression.`,
          );
        if (typeof value !== "number" || !Number.isFinite(value))
          throw new Error(`The value of '${name}' is a number.`);
        return { type: "update", name, command: { ...parameter, value } };
      });
      // one undo step, like the dialog of the parameters
      if (edits.length) store.apply(edits);
      return { changed: Object.keys(values), ...issues() };
    },

    write_file: async (args) => {
      const name = safeName(string(args, "name"));
      const content = args.content;
      if (typeof content !== "string") throw new Error("'content' is text.");
      // a mesh script runs on this computer: after the user agrees
      if (isScript(name) && !(await host.trustScript(name, content)))
        throw new Error(
          `The user did not accept the mesh script '${name}'; it does not run.`,
        );
      const data = new TextEncoder().encode(content);
      await files.add(name, data);
      return { written: name, bytes: data.length };
    },

    check: async () => {
      const report = await needClient().check(await document());
      store.setReport(report);
      return report;
    },

    script: async () => needClient().script(await document()),

    solve: async (args, progress) => {
      const jobs = host.jobs;
      if (!jobs) throw new Error("Python is not loaded.");
      const blocker = host.solveBlocker();
      if (blocker) throw new Error(`Not solved: ${blocker}`);
      const job = optional<string>(args, "job");
      if (job && store.get(job)?.command !== "job.add")
        throw new Error(`No job named '${job}'.`);
      // the converged substeps of all jobs, as the progress of the call
      let reported = -1;
      const unsubscribe = jobs.subscribe(() => {
        const run = jobs.run;
        if (run.state !== "running") return;
        const { plan, jobs: names, job: current, done } = run.progress;
        if (!current || !done) return;
        const totals = names.map((n) =>
          (plan[n] ?? []).reduce((a, b) => a + b, 0),
        );
        const index = names.indexOf(current);
        const before = totals.slice(0, index).reduce((a, b) => a + b, 0);
        const total = totals.reduce((a, b) => a + b, 0);
        if (before + done !== reported && total) {
          reported = before + done;
          progress(
            reported,
            total,
            `${current}: ${done} of ${totals[index]} substeps`,
          );
        }
      });
      try {
        await host.solve();
      } finally {
        unsubscribe();
      }
      const run = jobs.run;
      if (run.state === "finished") return solved(run, job);
      if (run.state === "failed") throw new Error(run.message);
      if (run.state === "cancelled")
        throw new Error("The user cancelled the run.");
      throw new Error("The model was not solved.");
    },

    results: async (args) => {
      const job = string(args, "job");
      const finished = host.jobs?.results;
      if (!finished?.results[job])
        throw new Error(`No results of job '${job}': solve first.`);
      const quantity = (optional<string>(args, "quantity") ??
        "stress_mises") as Quantity;
      if (!QUANTITIES.includes(quantity))
        throw new Error(
          `Unknown quantity '${quantity}': ${QUANTITIES.join(", ")}.`,
        );
      const method = (optional<string>(args, "method") ??
        "cells") as ValuesMethod;
      if (!METHODS.includes(method))
        throw new Error(`Unknown method '${method}': ${METHODS.join(", ")}.`);
      const last = substepsOf(finished, job);
      const substep = optional<number>(args, "substep") ?? last;
      if (!Number.isInteger(substep) || substep < 1 || substep > last)
        throw new Error(`Job '${job}' has the substeps 1 to ${last}.`);
      const scene = await needClient().resultScene(
        job,
        substep,
        quantity,
        method,
      );
      // the range of all sections; that of chosen sections is the app's (#377)
      const meta = Object.fromEntries(
        Object.entries(scene).filter(
          ([key]) => key !== "surfaces" && key !== "sections",
        ),
      );
      return { job, substep, substeps: last, ...meta };
    },

    selection: async () => host.selection(),

    select: async (args) => {
      const names = args.names;
      if (!Array.isArray(names)) throw new Error("'names' is a list of names.");
      for (const name of names) find(String(name));
      host.select(names.length ? String(names[0]) : undefined);
      const note =
        names.length > 1
          ? { note: `The app selects one object at a time: ${names[0]}.` }
          : {};
      return { ...host.selection(), ...note };
    },

    show: async (args) => {
      const workspace = (optional<string>(args, "view") ??
        "model") as Workspace;
      if (workspace !== "model" && workspace !== "results")
        throw new Error("'view' is 'model' or 'results'.");
      const quantity = optional<Quantity>(args, "quantity");
      if (quantity && !QUANTITIES.includes(quantity))
        throw new Error(
          `Unknown quantity '${quantity}': ${QUANTITIES.join(", ")}.`,
        );
      const shown = host.show(workspace, {
        job: optional<string>(args, "job"),
        substep: optional<number>(args, "substep"),
        quantity,
      });
      if (typeof shown === "string") throw new Error(shown);
      return shown;
    },

    picture: async () => {
      const blob = await host.picture();
      if (!blob) throw new Error("The view shows nothing yet.");
      return { png: await base64(blob) };
    },
  };

  return async (tool, args, progress) => {
    const run = tools[tool];
    if (!run) throw new Error(`Unknown tool '${tool}'.`);
    return run(args, progress);
  };
}
