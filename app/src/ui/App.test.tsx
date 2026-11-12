// @vitest-environment happy-dom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/preact";
import { IDBFactory } from "fake-indexeddb";
import { afterEach, describe, expect, it, vi } from "vitest";
import projectText from "../../../tests/data/two_sections.felupe.json?raw";
import fixture from "../../../tests/data/two_sections.json";
import type { Command, CommandList } from "../core/commands";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { MeshFiles } from "../core/meshfiles";
import { SAMPLES } from "../core/samples";
import { IndexedDBSession, type SessionStorage } from "../core/session";
import { ModelStore } from "../core/store";
import type {
  PyodideClient,
  Ready,
  ScriptView as ScriptViewData,
} from "../worker/client";
import type { JobEvent, JobResult, ResultScene } from "../worker/protocol";
import { App, NARROW } from "./App";

afterEach(cleanup);

const material = {
  command: "material.add",
  name: "rubber",
  model: "NeoHookeCompressible",
  parameters: { mu: 1, lmbda: 2 },
} as const;

function client(ready: Promise<Ready>, extra: Partial<PyodideClient> = {}) {
  return { ready, onRestart: () => () => {}, ...extra } as PyodideClient;
}

const readyValue: Ready = {
  versions: {
    python: "3.14.2",
    pyodide: "314.0.7",
    felupe: "12.0.0",
    numpy: "2",
    scipy: "1",
  },
  timings: { pyodide: 1, packages: 1, felupe: 1, total: 3 },
};

/** Choose an item of the File menu of the header. */
const fileMenu = (name: string | RegExp) => {
  fireEvent.click(screen.getByRole("button", { name: "File" }));
  fireEvent.click(
    within(screen.getByRole("menu", { name: "File" })).getByRole("menuitem", {
      name,
    }),
  );
};

describe("App shell", () => {
  it("has the regions of the layout", () => {
    render(<App store={new ModelStore()} />);
    expect(screen.getByRole("banner")).toBeTruthy();
    expect(screen.getByRole("group", { name: "Workspace" })).toBeTruthy();
    expect(screen.getByRole("tablist", { name: "Ribbon" })).toBeTruthy();
    expect(
      screen.getByRole("navigation", { name: "Model browser" }),
    ).toBeTruthy();
    // the properties panel opens with a selection
    expect(screen.queryByRole("region", { name: "Properties" })).toBeNull();
    expect(screen.getByRole("main", { name: "Viewport" })).toBeTruthy();
    expect(screen.getByRole("contentinfo")).toBeTruthy();
    expect(screen.getByText(/^No model yet\./)).toBeTruthy();
    // an empty model welcomes with the first steps and the samples (#127)
    const welcome = screen.getByRole("region", {
      name: "Welcome to FElupe Studio",
    });
    expect(
      within(welcome)
        .getAllByRole("button")
        .map((b) => b.textContent),
    ).toEqual(["Import mesh", "Open project", ...SAMPLES.map(() => "Open")]);
    expect(screen.getByText("untitled.felupe.json")).toBeTruthy();
  });

  it("undoes and redoes with the buttons and the keyboard", async () => {
    const store = new ModelStore();
    render(<App store={store} />);
    const undo = screen.getByRole("button", {
      name: "Undo",
    }) as HTMLButtonElement;
    const redo = screen.getByRole("button", {
      name: "Redo",
    }) as HTMLButtonElement;
    expect(undo.disabled && redo.disabled).toBe(true);

    act(() => store.apply({ type: "add", command: material }));
    expect(undo.disabled).toBe(false);
    expect(screen.getByLabelText("modified")).toBeTruthy();

    fireEvent.click(undo);
    expect(store.commands).toHaveLength(0);
    expect(redo.disabled).toBe(false);

    fireEvent.keyDown(window, { key: "z", ctrlKey: true, shiftKey: true });
    expect(store.commands).toHaveLength(1);
    fireEvent.keyDown(window, { key: "z", ctrlKey: true });
    expect(store.commands).toHaveLength(0);
    fireEvent.keyDown(window, { key: "y", ctrlKey: true });
    expect(store.commands).toHaveLength(1);
  });

  it("switches workspaces and ribbon tabs", () => {
    render(<App store={new ModelStore()} />);
    const tab = (name: string) => screen.getByRole("tab", { name });
    expect(tab("Mesh").getAttribute("aria-selected")).toBe("true");

    fireEvent.click(tab("Sections"));
    expect(tab("Sections").getAttribute("aria-selected")).toBe("true");
    fireEvent.keyDown(tab("Sections"), { key: "ArrowRight" });
    expect(tab("Loads & BCs").getAttribute("aria-selected")).toBe("true");
    fireEvent.keyDown(tab("Loads & BCs"), { key: "ArrowLeft" });
    expect(tab("Sections").getAttribute("aria-selected")).toBe("true");

    fireEvent.click(screen.getByRole("button", { name: "Results" }));
    expect(screen.getAllByRole("tab").map((t) => t.textContent)).toEqual([
      "Results",
    ]);
    expect(tab("Results").getAttribute("aria-selected")).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: "Model" }));
    expect(tab("Mesh").getAttribute("aria-selected")).toBe("true");
  });

  it("opens a project file and shows the groups of the browser", async () => {
    const store = new ModelStore();
    render(<App store={store} />);
    const file = new File([projectText], "bar.felupe.json", {
      type: "application/json",
    });
    fireEvent.change(screen.getByTestId("open-file"), {
      target: { files: [file] },
    });

    await waitFor(() => expect(store.commands).toHaveLength(13));
    expect(screen.getByText("bar.felupe.json")).toBeTruthy();
    expect(screen.queryByLabelText("modified")).toBeNull();
    const browser = screen.getByRole("navigation", { name: "Model browser" });
    expect(browser.textContent).toContain("Sections2");
    expect(screen.getByRole("status").textContent).toContain("13 commands");
  });

  it("asks for the parameters of an opened project before its meshes (#183)", async () => {
    const store = new ModelStore();
    const make = vi.fn(async (file: string) => ({
      info: { file, error: "no mesh in the test" },
    }));
    const files = new MeshFiles(undefined, { write: async () => {}, make });
    render(<App store={store} files={files} />);
    const project = JSON.stringify({
      schema_version: 3,
      commands: [
        {
          command: "parameter.add",
          name: "radius",
          value: 50,
          min: 10,
          max: 100,
        },
        { command: "mesh.script", name: "disc", file: "disc.py" },
      ],
    });
    fireEvent.change(screen.getByTestId("open-file"), {
      target: {
        files: [
          new File([project], "disc.felupe.json"),
          new File(["mesh = None\n"], "disc.py"),
        ],
      },
    });
    const dialog = await screen.findByRole("dialog", {
      name: "Parameters of disc.felupe.json",
    });
    // the meshes wait for the values
    await act(async () => {});
    expect(make).not.toHaveBeenCalled();
    fireEvent.input(within(dialog).getByRole("spinbutton"), {
      target: { value: "60" },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "Open" }));
    await waitFor(() =>
      expect(make).toHaveBeenCalledWith("disc.py", { radius: 60 }, undefined),
    );
    expect(make).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("dialog")).toBeNull();

    // later from the menu of a parameter
    const tree = screen.getByRole("tree", { name: "Model" });
    fireEvent.click(
      within(tree).getByRole("button", { name: "Actions of radius" }),
    );
    fireEvent.click(screen.getByRole("menuitem", { name: "All parameters…" }));
    expect(
      screen.getByRole("dialog", { name: "Parameters" }).textContent,
    ).toContain("10 to 100");
  });

  it("shows why a project file could not be opened", async () => {
    render(<App store={new ModelStore()} />);
    const file = new File(['{"schema_version": 7}'], "new.felupe.json");
    fireEvent.change(screen.getByTestId("open-file"), {
      target: { files: [file] },
    });
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("Please update FElupe Studio");
    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("saves the project file", async () => {
    const store = new ModelStore(fixture as CommandList);
    const download = vi.fn();
    render(<App store={store} download={download} />);
    act(() => store.apply({ type: "remove", name: "job_1" }));
    fireEvent.click(screen.getByRole("button", { name: "Save project" }));
    await waitFor(() => expect(download).toHaveBeenCalledTimes(1));
    const [name, text] = download.mock.calls[0];
    expect(name).toBe("untitled.felupe.json");
    expect(text).not.toContain("job_1");
    expect(screen.queryByLabelText("modified")).toBeNull();
  });

  it("shows the state of the Python runtime", async () => {
    let resolve!: (ready: Ready) => void;
    render(
      <App
        store={new ModelStore()}
        client={client(new Promise((r) => (resolve = r)))}
      />,
    );
    const status = screen.getByRole("status");
    expect(status.textContent).toContain("Loading Python and FElupe");
    expect(
      screen
        .getByRole("button", { name: /Solve/ })
        .getAttribute("aria-disabled"),
    ).toBe("true");
    await act(async () => resolve(readyValue));
    expect(status.textContent).toContain("FElupe 12.0.0 ready");

    cleanup();
    render(
      <App
        store={new ModelStore()}
        client={client(Promise.reject(new Error("offline")))}
      />,
    );
    await waitFor(() =>
      expect(screen.getByRole("status").textContent).toContain(
        "Python could not be loaded: offline",
      ),
    );
  });

  it("counts validation issues", () => {
    const store = new ModelStore(fixture as CommandList);
    render(<App store={store} />);
    expect(screen.getByRole("status").textContent).toContain("0 issues");
    act(() => store.apply({ type: "remove", name: "umat_hard" }));
    expect(screen.getByRole("status").textContent).toContain("1 issue");
  });
});

describe("narrow windows (#131)", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("show the browser as a drawer, which closes after a selection", () => {
    // a window that matches the media query of the drawers
    vi.stubGlobal("matchMedia", (query: string) => ({
      matches: query === NARROW,
      addEventListener() {},
      removeEventListener() {},
    }));
    render(<App store={new ModelStore(fixture as CommandList)} />);
    const toggle = screen.getByRole("button", { name: "Browser" });
    const body = document.querySelector(".body")!;
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(body.classList.contains("browser-open")).toBe(false);

    fireEvent.click(toggle);
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(body.classList.contains("browser-open")).toBe(true);
    // Esc closes the drawer before it clears a selection
    fireEvent.keyDown(document.body, { key: "Escape" });
    expect(body.classList.contains("browser-open")).toBe(false);

    fireEvent.click(toggle);
    fireEvent.click(screen.getByRole("treeitem", { name: "umat_soft" }));
    expect(body.classList.contains("browser-open")).toBe(false);
    expect(screen.getByRole("region", { name: "Properties" })).toBeTruthy();

    fireEvent.click(toggle);
    fireEvent.click(screen.getByRole("button", { name: "Close the browser" }));
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
  });

  it("keep the browser in wide windows", () => {
    render(<App store={new ModelStore(fixture as CommandList)} />);
    expect(
      screen.queryByRole("button", { name: "Close the browser" }),
    ).toBeNull();
    fireEvent.click(screen.getByRole("treeitem", { name: "umat_soft" }));
    expect(
      document.querySelector(".body")!.classList.contains("browser-open"),
    ).toBe(false);
  });
});

describe("script view (#130)", () => {
  it("shows the script with the lines of the selected object", async () => {
    const scriptView = vi.fn<(document: string) => Promise<ScriptViewData>>(
      async () => ({
        script: "import felupe as fem\n\numat_soft = fem.NeoHooke(mu=1)\n",
        lines: { umat_soft: [[3, 3]] as [number, number][] },
      }),
    );
    const download = vi.fn();
    const store = new ModelStore(fixture as CommandList);
    render(
      <App
        store={store}
        client={client(Promise.resolve(readyValue), {
          scriptView,
          script: async () => "import felupe as fem\n",
        })}
        download={download}
      />,
    );
    await waitFor(() =>
      expect(screen.getByText(/FElupe 12.0.0 ready/)).toBeTruthy(),
    );
    fireEvent.click(screen.getByRole("tab", { name: "Script" }));
    const view = screen.getByRole("main", { name: "Script" });
    // the script replaces the viewport
    expect(
      document.querySelector<HTMLElement>('main[aria-label="Viewport"]')!
        .hidden,
    ).toBe(true);
    const code = await within(view).findByRole("region", {
      name: "FElupe script",
    });
    const lines = code.querySelectorAll(".script-line");
    expect([...lines].map((l) => l.textContent)).toEqual([
      "1import felupe as fem",
      "2",
      "3umat_soft = fem.NeoHooke(mu=1)",
    ]);
    expect(lines[0].querySelector(".py-keyword")?.textContent).toBe("import");
    expect(JSON.parse(scriptView.mock.lastCall![0]).commands).toEqual(
      store.commands,
    );

    // a click on a line selects its object, which is highlighted
    fireEvent.click(lines[2]);
    expect(screen.getByRole("region", { name: "Properties" })).toBeTruthy();
    expect(lines[2].classList.contains("selected")).toBe(true);
    expect(lines[0].classList.contains("selected")).toBe(false);

    fireEvent.click(within(view).getByRole("button", { name: "Download" }));
    await waitFor(() =>
      expect(download).toHaveBeenCalledWith(
        "untitled.py",
        "import felupe as fem\n",
      ),
    );

    // a model with issues shows the issues instead of the script
    act(() => store.apply({ type: "remove", name: "umat_soft" }));
    expect(
      within(view).getByText("Fix the issues of the model first:"),
    ).toBeTruthy();
    expect(
      within(view).queryByRole("region", { name: "FElupe script" }),
    ).toBeNull();
  });
});

describe("keyboard shortcuts (#129)", () => {
  const key = (init: KeyboardEventInit, target: Element = document.body) =>
    fireEvent.keyDown(target, init);

  it("saves, opens the overview and works on the selected object", async () => {
    const download = vi.fn();
    const store = new ModelStore(fixture as CommandList);
    render(<App store={store} download={download} />);
    key({ key: "s", ctrlKey: true });
    await waitFor(() =>
      expect(download).toHaveBeenCalledWith(
        "untitled.felupe.json",
        expect.any(String),
      ),
    );
    key({ key: "?", shiftKey: true });
    expect(
      screen.getByRole("dialog", { name: "Keyboard shortcuts" }).textContent,
    ).toContain("Ctrl+SSave the project");
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });

    // a used object is not deleted; the reason is shown
    const tree = screen.getByRole("tree");
    fireEvent.click(within(tree).getByRole("treeitem", { name: "umat_soft" }));
    expect(screen.getByRole("region", { name: "Properties" })).toBeTruthy();
    key(
      { key: "Delete" },
      within(tree).getByRole("treeitem", { name: "umat_soft" }),
    );
    expect(store.commands.some((c) => c.name === "umat_soft")).toBe(true);
    expect(screen.getByRole("alert").textContent).toContain(
      "umat_soft cannot be deleted.",
    );

    // F2 focuses the name in the properties, Esc clears the selection
    key({ key: "F2" });
    await waitFor(() => expect(document.activeElement?.id).toBe("field-name"));
    // while typing, letters and Delete are typed, but Ctrl+S saves
    key({ key: "Delete" }, document.activeElement!);
    expect(store.commands.some((c) => c.name === "umat_soft")).toBe(true);
    key({ key: "s", ctrlKey: true }, document.activeElement!);
    await waitFor(() => expect(download).toHaveBeenCalledTimes(2));
    (document.activeElement as HTMLElement).blur();
    key({ key: "Escape" });
    expect(screen.queryByRole("region", { name: "Properties" })).toBeNull();

    // an object that nothing uses is deleted, with undo
    const job = store.commands.find((c) => c.command === "job.add")!.name;
    fireEvent.click(within(tree).getByRole("treeitem", { name: job }));
    key({ key: "Delete" });
    expect(store.commands.some((c) => c.name === job)).toBe(false);
    key({ key: "z", ctrlKey: true });
    expect(store.commands.some((c) => c.name === job)).toBe(true);
  });
});

describe("menus of the header", () => {
  it("has File and Help menus, operated with the keyboard", () => {
    render(<App store={new ModelStore()} />);
    const file = screen.getByRole("button", { name: "File" });
    expect(file.getAttribute("aria-haspopup")).toBe("menu");
    fireEvent.keyDown(file, { key: "ArrowDown" });
    const menu = screen.getByRole("menu", { name: "File" });
    const items = within(menu).getAllByRole("menuitem");
    const label = (item: HTMLElement) =>
      item.querySelector(".menu-label")?.textContent;
    expect(items.map(label)).toEqual([
      "New project",
      "Open project…",
      "Samples…",
      "Save project",
      "Save project as…",
      "Python script",
      "Results of the job (XDMF)",
      "Results of the substep (VTU)",
      "Picture of the view",
    ]);
    expect(within(menu).getByRole("group", { name: "Export" })).toBeTruthy();
    // the shortcuts of the items (#129)
    expect(items[3].textContent).toBe("Save projectCtrl+S");
    expect(items[3].getAttribute("aria-keyshortcuts")).toBe("Control+S Meta+S");
    expect(items[4].textContent).toBe("Save project as…Ctrl+Shift+S");
    expect(document.activeElement).toBe(items[0]);
    fireEvent.keyDown(items[0], { key: "ArrowUp" });
    expect(document.activeElement).toBe(items.at(-1));
    fireEvent.keyDown(items.at(-1)!, { key: "Home" });
    fireEvent.keyDown(items[0], { key: "ArrowDown" });
    expect(document.activeElement).toBe(items[1]);
    // a blocked item says why in its tooltip
    expect(items[5].getAttribute("aria-disabled")).toBe("true");
    expect(items[5].title).toBeTruthy();
    fireEvent.keyDown(items[1], { key: "Escape" });
    expect(screen.queryByRole("menu")).toBeNull();
    expect(document.activeElement).toBe(file);

    fireEvent.keyDown(screen.getByRole("button", { name: "Help" }), {
      key: "ArrowUp",
    });
    const help = screen.getByRole("menu", { name: "Help" });
    const links = within(help).getAllByRole("menuitem");
    expect(document.activeElement).toBe(links.at(-1));
    expect(links.map(label)).toEqual([
      "User guide",
      "Command reference",
      "Keyboard shortcuts",
      "Report an issue",
      "About FElupe Studio",
    ]);
    expect((links[0] as HTMLAnchorElement).href).toMatch(/docs\/guide\.md$/);
    expect((links[1] as HTMLAnchorElement).href).toMatch(
      /docs\/reference\.md$/,
    );
    expect((links[3] as HTMLAnchorElement).target).toBe("_blank");
  });

  it("shows the versions and the keyboard shortcuts", async () => {
    render(
      <App
        store={new ModelStore()}
        client={client(Promise.resolve(readyValue))}
      />,
    );
    await waitFor(() =>
      expect(screen.getByText(/FElupe 12.0.0 ready/)).toBeTruthy(),
    );
    const help = (name: string) => {
      fireEvent.click(screen.getByRole("button", { name: "Help" }));
      fireEvent.click(screen.getByRole("menuitem", { name }));
    };
    help("About FElupe Studio");
    const about = screen.getByRole("dialog", { name: "FElupe Studio" });
    const versions = within(about).getByLabelText("Versions").textContent;
    expect(versions).toContain("FElupe12.0.0");
    expect(versions).toContain("Python3.14.2");
    expect(versions).toContain("Pyodide314.0.7");
    expect(versions).toMatch(/meshio\d/);
    expect(
      within(about).getByRole("link", { name: "Pyodide benchmark" }),
    ).toBeTruthy();
    expect(
      within(about).getByRole("link", { name: "GPL-3.0-or-later" }),
    ).toBeTruthy();
    fireEvent.keyDown(about, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();

    help("Keyboard shortcuts");
    const shortcuts = screen.getByRole("dialog", {
      name: "Keyboard shortcuts",
    });
    const general = within(shortcuts).getByRole("region", { name: "General" });
    expect(general.textContent).toContain("Ctrl+ZUndo");
    expect(general.textContent).toContain("Ctrl+Shift+Z or Ctrl+YRedo");
  });

  it("has no Tools tab: the benchmark is in Help ▸ About", () => {
    render(<App store={new ModelStore()} />);
    expect(screen.queryByRole("tab", { name: "Tools" })).toBeNull();
  });
});

describe("updates", () => {
  it("offers to reload when a newer version is deployed", () => {
    let report: (build: string) => void = () => {};
    const stop = vi.fn();
    const updates = vi.fn((onUpdate: (build: string) => void) => {
      report = onUpdate;
      return stop;
    });
    const reload = vi.fn();
    render(<App store={new ModelStore()} updates={updates} reload={reload} />);
    expect(screen.queryByRole("status", { name: "Update" })).toBeNull();
    act(() => report("new"));
    const banner = screen.getByRole("status", { name: "Update" });
    expect(banner.textContent).toContain("A new version of FElupe Studio");
    expect(banner.textContent).toContain("Reload the page to use it.");
    fireEvent.click(screen.getByRole("button", { name: "Reload" }));
    expect(reload).toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Dismiss the update" }));
    expect(screen.queryByRole("status", { name: "Update" })).toBeNull();
  });

  it("asks to save a project first", () => {
    let report: (build: string) => void = () => {};
    render(
      <App
        store={new ModelStore(fixture as CommandList)}
        updates={(onUpdate) => {
          report = onUpdate;
          return () => {};
        }}
      />,
    );
    act(() => report("new"));
    expect(
      screen.getByRole("status", { name: "Update" }).textContent,
    ).toContain("Save your project first");
  });
});

describe("solve", () => {
  const files = async () => {
    const files = new MeshFiles(async (name) => ({
      info: {
        file: name,
        points: 8,
        solids: [
          {
            cell_type: "hexahedron",
            cells: 1,
            bounds: [
              [0, 0, 0],
              [1, 1, 1],
            ] as [number[], number[]],
            tags: [
              {
                name: "material",
                values: [
                  { value: 1, cells: 1 },
                  { value: 2, cells: 1 },
                ],
              },
            ],
          },
        ],
      },
    }));
    await files.add("specimen.vtu", new Uint8Array([1]));
    return files;
  };

  function runner() {
    let emit: (event: JobEvent) => void = () => {};
    let settle!: {
      resolve: (results: Record<string, JobResult>) => void;
      reject: (error: Error) => void;
    };
    const run = vi.fn(
      (_document: string, onEvent: (event: JobEvent) => void) => {
        emit = onEvent;
        return new Promise<Record<string, JobResult>>((resolve, reject) => {
          settle = { resolve, reject };
        });
      },
    );
    const restart = vi.fn(() => {
      const error = new Error("Cancelled.");
      error.name = "CancelledError";
      settle.reject(error);
    });
    return {
      run,
      restart,
      emit: (event: JobEvent) => act(() => emit(event)),
      settle: () => settle,
    };
  }

  const solveButton = () => screen.getByRole("button", { name: /Solve/ });

  it("runs the jobs with progress and shows the outcome", async () => {
    const store = new ModelStore(fixture as CommandList);
    const jobs = runner();
    render(
      <App
        store={store}
        files={await files()}
        client={client(Promise.resolve(readyValue), jobs)}
      />,
    );
    await waitFor(() =>
      expect(solveButton().getAttribute("aria-disabled")).toBeNull(),
    );
    fireEvent.click(solveButton());
    await waitFor(() => expect(jobs.run).toHaveBeenCalledTimes(1));
    expect(JSON.parse(jobs.run.mock.calls[0][0]).commands).toEqual(
      store.commands,
    );

    const panel = screen.getByRole("region", { name: "Job" });
    expect(panel.textContent).toContain("Preparing the model");
    jobs.emit({ event: "start", jobs: ["job_1"], substeps: { job_1: [4] } });
    jobs.emit({
      event: "substep",
      job: "job_1",
      step: 0,
      steps: 1,
      substep: 2,
      substeps: 4,
    });
    jobs.emit({ event: "iteration", iteration: 3, fnorm: 1.5e-7, xnorm: 1 });
    expect(panel.textContent).toContain("Solving job_1");
    expect(panel.textContent).toContain("Step 1 of 1 · substep 3 of 4");
    expect(panel.textContent).toContain(
      "Newton iteration 3 of 16 · residuals 1.50e-7",
    );
    expect(screen.getByRole("progressbar").getAttribute("aria-valuenow")).toBe(
      "50",
    );
    // the next substep keeps the line of the Newton iteration (#108)
    const height = panel.querySelectorAll(".job-line").length;
    jobs.emit({
      event: "substep",
      job: "job_1",
      step: 0,
      steps: 1,
      substep: 3,
      substeps: 4,
    });
    expect(panel.querySelectorAll(".job-line").length).toBe(height);
    expect(screen.getByRole("button", { name: "Cancel" })).toBeTruthy();

    await act(async () =>
      jobs.settle().resolve({
        job_1: {
          substeps: 4,
          time: 0.25,
          x: [
            [0, 0, 0],
            [0.5, 0, 0],
          ],
          y: [
            [0, 0, 0],
            [12.5, 0.1, 0],
          ],
        },
      }),
    );
    expect(panel.textContent).toContain("Solved");
    expect(panel.textContent).toContain("job_1: 4 substeps in 0.25 s");
    expect(panel.textContent).toContain("Last substep: ux = 0.5, Fx = 12.5");
    act(() => store.apply({ type: "remove", name: "job_1" }));
    expect(panel.textContent).toContain("The model was changed after solving.");
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("region", { name: "Job" })).toBeNull();
    expect(solveButton().getAttribute("aria-disabled")).toBe("true");
  });

  it("shows a failed run with the traceback and cancels a run", async () => {
    const jobs = runner();
    render(
      <App
        store={new ModelStore(fixture as CommandList)}
        files={await files()}
        client={client(Promise.resolve(readyValue), jobs)}
      />,
    );
    await waitFor(() =>
      expect(solveButton().getAttribute("aria-disabled")).toBeNull(),
    );
    fireEvent.click(solveButton());
    await waitFor(() => expect(jobs.run).toHaveBeenCalledTimes(1));
    const traceback =
      'Traceback (most recent call last):\n  File "model.py", line 40\nfelupe.NewtonConvergenceError: The solution did not converge.';
    await act(async () => jobs.settle().reject(new Error(traceback)));
    const panel = screen.getByRole("region", { name: "Job" });
    expect(panel.textContent).toContain("Solving failed");
    expect(panel.querySelector(".error")?.textContent).toBe(
      "NewtonConvergenceError: The solution did not converge.",
    );
    expect(panel.textContent).toContain("enable the cutback");
    expect(panel.querySelector("pre")?.textContent).toBe(traceback);

    fireEvent.click(solveButton());
    await waitFor(() => expect(jobs.run).toHaveBeenCalledTimes(2));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    });
    expect(jobs.restart).toHaveBeenCalledTimes(1);
    expect(panel.textContent).toContain("Cancelled");
  });

  it("shows the results of the substeps", async () => {
    const jobs = runner();
    const scenes: [string, number, string][] = [];
    let resolveScene: (scene: ResultScene) => void = () => {};
    const resultScene = vi.fn(
      (job: string, substep: number, quantity: string) => {
        scenes.push([job, substep, quantity]);
        return new Promise<ResultScene>((r) => (resolveScene = r));
      },
    );
    const download = vi.fn();
    const exportResults = vi.fn(async () => new Uint8Array([1]));
    const scene = (label: string): ResultScene => ({
      label,
      at: "point",
      range: [0, 1],
      // a control point with the force of a constraint and a rotation point (#101)
      points: [
        {
          name: "plate",
          position: [3.5, 0.5, 0.5],
          displacement: [0.5, 0, 0],
          force: [5, 1e-18, 0],
        },
        {
          name: "turn",
          position: [4, 0.5, 0.5],
          displacement: [0.1, 0, 0],
          force: [2, 0, 0],
          rotation: true,
        },
      ],
      surfaces: [],
    });
    render(
      <App
        store={new ModelStore(fixture as CommandList)}
        files={await files()}
        client={client(Promise.resolve(readyValue), {
          ...jobs,
          resultScene,
          exportResults,
        })}
        download={download}
      />,
    );
    const workspace = (name: string) =>
      fireEvent.click(screen.getByRole("button", { name }));
    workspace("Results");
    const results = screen.getByRole("main", { name: "Results" });
    expect(results.textContent).toContain("Solve the model to see its results");
    expect(screen.getByRole("tabpanel").textContent).toContain(
      "Results will appear here",
    );

    workspace("Model");
    await waitFor(() =>
      expect(solveButton().getAttribute("aria-disabled")).toBeNull(),
    );
    fireEvent.click(solveButton());
    await waitFor(() => expect(jobs.run).toHaveBeenCalledTimes(1));
    jobs.emit({ event: "start", jobs: ["job_1"], substeps: { job_1: [6] } });
    await act(async () =>
      jobs.settle().resolve({
        job_1: {
          substeps: 6,
          time: 0.1,
          x: [0, 0.1, 0.2, 0.3, 0.4, 0.5].map((u) => [u, 0, 0]),
          y: [0, 1, 2, 3, 4, 5].map((f) => [f, 0, 0]),
        },
      }),
    );
    // no scene is loaded while the results are not shown
    expect(resultScene).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Show results" }));
    expect(screen.queryByRole("region", { name: "Job" })).toBeNull();
    expect(
      document.querySelector<HTMLElement>('main[aria-label="Viewport"]')!
        .hidden,
    ).toBe(true);
    await waitFor(() => expect(scenes).toEqual([["job_1", 6, "displacement"]]));
    expect(results.textContent).toContain("Loading the results");

    const panel = screen.getByRole("tabpanel");
    expect(panel.textContent).toContain("Substep 6 of 6");
    expect(panel.textContent).toContain("step_1: 6 of 6");
    expect(panel.textContent).toContain("ux = 0.5, Fx = 5");

    // the latest substep wins while a scene is loading
    const slider = within(panel).getByRole("slider") as HTMLInputElement;
    fireEvent.input(slider, { target: { value: "2" } });
    fireEvent.input(slider, { target: { value: "3" } });
    expect(panel.textContent).toContain("ux = 0.2, Fx = 2");
    await act(async () => resolveScene(scene("Displacement")));
    await waitFor(() => expect(scenes).toHaveLength(2));
    expect(scenes[1]).toEqual(["job_1", 3, "displacement"]);
    await act(async () => resolveScene(scene("Displacement")));

    fireEvent.change(within(panel).getByLabelText("Contour"), {
      target: { value: "stress_mises" },
    });
    await waitFor(() =>
      expect(scenes.at(-1)).toEqual(["job_1", 3, "stress_mises"]),
    );
    await act(async () => resolveScene(scene("Von Mises")));
    expect(scenes).toHaveLength(3);
    // the control points of the substep, without round-off noise (#101)
    const points = screen.getByRole("region", { name: "Control points" });
    const cells = within(points)
      .getAllByRole("row")
      .slice(1)
      .map((row) => row.textContent);
    expect(cells).toEqual([
      "plateu = (0.5, 0, 0)F = (5, 0, 0)",
      "turnφ = (0.1, 0, 0) radM = (2, 0, 0)",
    ]);
    fireEvent.click(
      within(points).getByRole("button", { name: "Close the control points" }),
    );
    expect(screen.queryByRole("region", { name: "Control points" })).toBeNull();
    // the scale and the undeformed shape need no new scene
    fireEvent.change(within(panel).getByLabelText("Scale"), {
      target: { value: "10" },
    });
    fireEvent.click(within(panel).getByLabelText("Undeformed"));
    expect(scenes).toHaveLength(3);

    // the force-displacement curve of the job, with the current substep
    const card = screen.getByRole("region", {
      name: "Force-displacement curve",
    });
    expect(card.textContent).toContain("Force–displacement · move");
    expect(within(card).getByRole("img").getAttribute("aria-label")).toBe(
      "Force Fx over the displacement ux, 6 substeps",
    );
    expect(card.querySelector(".current-point")).not.toBeNull();
    fireEvent.click(within(card).getByRole("button", { name: "Table" }));
    const rows = within(card).getAllByRole("row");
    expect(rows).toHaveLength(7);
    expect(rows[3].getAttribute("aria-current")).toBe("true");
    expect(rows[3].textContent).toBe("30.22");
    fireEvent.click(rows[5]);
    expect(panel.textContent).toContain("Substep 5 of 6");
    expect(panel.textContent).toContain("ux = 0.4, Fx = 4");
    await act(async () => resolveScene(scene("Von Mises")));

    fireEvent.click(within(card).getByRole("button", { name: "CSV" }));
    expect(download).toHaveBeenCalledWith(
      "job_1.csv",
      expect.stringContaining(
        "substep,step,u_x,u_y,u_z,F_x,F_y,F_z\n1,step_1,0,0,0,0,0,0\n",
      ),
    );
    fireEvent.change(within(card).getByLabelText("Component"), {
      target: { value: "1" },
    });
    expect(panel.textContent).toContain("uy = 0, Fy = 0");

    fireEvent.click(
      within(card).getByRole("button", { name: "Close the curve" }),
    );
    expect(
      screen.queryByRole("region", { name: "Force-displacement curve" }),
    ).toBeNull();
    const toggle = within(panel).getByLabelText("Curve") as HTMLInputElement;
    expect(toggle.checked).toBe(false);
    fireEvent.click(toggle);
    expect(
      screen.getByRole("region", { name: "Force-displacement curve" }),
    ).toBeTruthy();

    // the results of the job and of the shown substep as files
    const exportItem = (name: RegExp) => {
      fireEvent.click(screen.getByRole("button", { name: "Export" }));
      return within(screen.getByRole("menu", { name: "Export" })).getByRole(
        "menuitem",
        { name },
      );
    };
    expect(exportItem(/Results of the substep/).textContent).toContain(
      "Substep 5 of job_1",
    );
    fireEvent.keyDown(document, { key: "Escape" });
    fireEvent.click(exportItem(/Results of the substep/));
    await waitFor(() =>
      expect(download).toHaveBeenCalledWith(
        "untitled-job_1-5.vtu",
        expect.any(Blob),
      ),
    );
    fireEvent.click(exportItem(/Results of the job/));
    await waitFor(() =>
      expect(download).toHaveBeenCalledWith(
        "untitled-job_1.xdmf",
        expect.any(Blob),
      ),
    );
    expect(exportResults.mock.calls).toEqual([
      ["job_1", "vtu", 5],
      ["job_1", "xdmf", undefined],
    ]);

    // the substeps with the keyboard (#129), not while the focus is in the tree
    const key = (k: string) => fireEvent.keyDown(document.body, { key: k });
    key("ArrowRight");
    expect(panel.textContent).toContain("Substep 6 of 6");
    key("ArrowRight");
    expect(panel.textContent).toContain("Substep 6 of 6");
    key("Home");
    expect(panel.textContent).toContain("Substep 1 of 6");
    key("ArrowLeft");
    expect(panel.textContent).toContain("Substep 1 of 6");
    key("End");
    expect(panel.textContent).toContain("Substep 6 of 6");
    key("ArrowLeft");
    expect(panel.textContent).toContain("Substep 5 of 6");
  });

  it("shows the results with the units of the model (#132)", async () => {
    const jobs = runner();
    let resolveScene: (scene: ResultScene) => void = () => {};
    const resultScene = vi.fn(
      () => new Promise<ResultScene>((r) => (resolveScene = r)),
    );
    const list = fixture as CommandList;
    const settings = {
      command: "model.settings",
      name: "settings",
      units: { length: "mm", force: "N" },
    } as Command;
    render(
      <App
        store={
          new ModelStore({ ...list, commands: [settings, ...list.commands] })
        }
        files={await files()}
        client={client(Promise.resolve(readyValue), { ...jobs, resultScene })}
      />,
    );
    await waitFor(() =>
      expect(solveButton().getAttribute("aria-disabled")).toBeNull(),
    );
    fireEvent.click(solveButton());
    await waitFor(() => expect(jobs.run).toHaveBeenCalledTimes(1));
    await act(async () =>
      jobs.settle().resolve({
        job_1: { substeps: 1, time: 0.1, x: [[0.5, 0, 0]], y: [[5, 0, 0]] },
      }),
    );
    const job = screen.getByRole("region", { name: "Job" });
    expect(job.textContent).toContain("Last substep: ux = 0.5 mm, Fx = 5 N");
    fireEvent.click(screen.getByRole("button", { name: "Show results" }));
    expect(screen.getByRole("tabpanel").textContent).toContain(
      "ux = 0.5 mm, Fx = 5 N",
    );
    await waitFor(() => expect(resultScene).toHaveBeenCalled());
    await act(async () =>
      resolveScene({
        label: "Displacement",
        at: "point",
        range: [0, 1],
        points: [
          {
            name: "plate",
            position: [3.5, 0.5, 0.5],
            displacement: [0.5, 0, 0],
            force: [5, 0, 0],
          },
        ],
        surfaces: [],
      }),
    );
    const points = screen.getByRole("region", { name: "Control points" });
    expect(within(points).getAllByRole("row")[1].textContent).toBe(
      "plateu = (0.5, 0, 0) mmF = (5, 0, 0) N",
    );
    const card = screen.getByRole("region", {
      name: "Force-displacement curve",
    });
    const labels = [...card.querySelectorAll(".axis-label")].map(
      (l) => l.textContent,
    );
    expect(labels).toEqual(["Displacement ux [mm]", "Force Fx [N]"]);
    // the scalar bar of the app (#139), with the unit
    expect(
      document.querySelector(".app-scalar-bar .fv-bar-title")!.textContent,
    ).toBe("Displacement [mm]");
  });

  it("changes the color map, the bands and the range of the contour (#139)", async () => {
    localStorage.clear();
    const jobs = runner();
    const resultScene = vi.fn(async (): Promise<ResultScene> => ({
      label: "Displacement",
      at: "point",
      range: [0, 1],
      points: [],
      surfaces: [],
    }));
    let resolveRanges: (ranges: ([number, number] | null)[]) => void = () => {};
    const resultRanges = vi.fn(
      () =>
        new Promise<([number, number] | null)[]>((r) => (resolveRanges = r)),
    );
    render(
      <App
        store={new ModelStore(fixture as CommandList)}
        files={await files()}
        client={client(Promise.resolve(readyValue), {
          ...jobs,
          resultScene,
          resultRanges,
        })}
      />,
    );
    await waitFor(() =>
      expect(solveButton().getAttribute("aria-disabled")).toBeNull(),
    );
    fireEvent.click(solveButton());
    await waitFor(() => expect(jobs.run).toHaveBeenCalledTimes(1));
    await act(async () =>
      jobs.settle().resolve({
        job_1: {
          substeps: 2,
          time: 0.1,
          x: [
            [0.5, 0, 0],
            [1, 0, 0],
          ],
          y: [
            [5, 0, 0],
            [9, 0, 0],
          ],
        },
      }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Show results" }));
    await waitFor(() =>
      expect(document.querySelector(".app-scalar-bar")).toBeTruthy(),
    );
    const ticks = () =>
      [...document.querySelectorAll(".app-scalar-bar .fv-ticks span")].map(
        (t) => t.textContent,
      );
    expect(ticks()).toEqual(["0", "0.25", "0.5", "0.75", "1"]);

    fireEvent.click(screen.getByRole("button", { name: "Contour settings" }));
    const popover = screen.getByRole("dialog", { name: "Contour settings" });
    fireEvent.change(within(popover).getByLabelText("Color map"), {
      target: { value: "viridis" },
    });
    fireEvent.change(within(popover).getByLabelText("Bands"), {
      target: { value: "8" },
    });
    fireEvent.click(within(popover).getByLabelText("All substeps"));
    await waitFor(() =>
      expect(resultRanges).toHaveBeenCalledWith("job_1", "displacement"),
    );
    await act(async () => resolveRanges([[0, 1], null, [0, 3]]));
    // the viewer draws in a microtask
    await waitFor(() =>
      expect(ticks()).toEqual(["0", "0.75", "1.5", "2.25", "3"]),
    );
    // kept in the browser
    expect(JSON.parse(localStorage.getItem("felupe-studio.contour")!)).toEqual({
      map: "viridis",
      bands: 8,
      range: "job",
    });

    // a manual range starts at the range of the substep; values above it get
    // the extra color
    fireEvent.click(within(popover).getByLabelText("Manual"));
    const max = within(popover).getByLabelText("Max") as HTMLInputElement;
    expect(max.value).toBe("1");
    fireEvent.input(max, { target: { value: "0.5" } });
    await waitFor(() => expect(ticks().at(-1)).toBe("0.5"));
    expect(document.querySelector(".app-scalar-bar canvas.above")).toBeTruthy();
    fireEvent.input(max, { target: { value: "-1" } });
    expect(popover.textContent).toContain(
      "The minimum must be less than the maximum.",
    );
    fireEvent.click(within(popover).getByRole("button", { name: "Defaults" }));
    fireEvent.keyDown(document, { key: "Escape" });
    expect(
      screen.queryByRole("dialog", { name: "Contour settings" }),
    ).toBeNull();
    await waitFor(() =>
      expect(ticks()).toEqual(["0", "0.25", "0.5", "0.75", "1"]),
    );
    localStorage.clear();
  });

  it("shows the minimum and the maximum of the contour (#140)", async () => {
    const jobs = runner();
    const extreme = (value: number, index: number, surface = true) => ({
      value,
      section: "section_hard",
      at: "cell" as const,
      index,
      surface,
      position: [1, 0.5, 0.5] as [number, number, number],
      displacement: [0.1, 0, 0] as [number, number, number],
    });
    const resultScene = vi.fn(async (): Promise<ResultScene> => ({
      label: "Max. principal Cauchy stress",
      at: "cell",
      range: [0.5, 2],
      extremes: { min: extreme(0.5, 3), max: extreme(2, 7, false) },
      points: [],
      surfaces: [],
    }));
    render(
      <App
        store={new ModelStore(fixture as CommandList)}
        files={await files()}
        client={client(Promise.resolve(readyValue), { ...jobs, resultScene })}
      />,
    );
    await waitFor(() =>
      expect(solveButton().getAttribute("aria-disabled")).toBeNull(),
    );
    fireEvent.click(solveButton());
    await waitFor(() => expect(jobs.run).toHaveBeenCalledTimes(1));
    await act(async () =>
      jobs.settle().resolve({
        job_1: { substeps: 1, time: 0.1, x: [[0.5, 0, 0]], y: [[5, 0, 0]] },
      }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Show results" }));
    const toggle = await screen.findByRole("button", { name: "Min/Max" });
    expect(toggle.getAttribute("aria-pressed")).toBe("false");
    expect(document.querySelector(".fv-label")).toBeNull();

    // (the toolbar goes away without WebGL2 once the viewer exists)
    fireEvent.click(toggle);
    const labels = () =>
      [...document.querySelectorAll<HTMLButtonElement>(".fv-label")].map(
        (l) => l.textContent,
      );
    expect(labels()).toEqual(["Min. 0.5", "Max. 2"]);
    // a click selects the maximum: where it is
    fireEvent.click(
      document.querySelectorAll<HTMLButtonElement>(".fv-label")[1],
    );
    expect(labels()).toEqual([
      "Min. 0.5",
      "Max. 2Cell 7 of section_hard (inside)",
    ]);
    // Esc unselects it, but keeps the results
    fireEvent.keyDown(window, { key: "Escape" });
    expect(labels()).toEqual(["Min. 0.5", "Max. 2"]);
  });

  it("plays the substeps, loads them ahead and keeps them (#141)", async () => {
    const jobs = runner();
    const calls: [number, string][] = [];
    const resultScene = vi.fn(
      async (_: string, substep: number, quantity: string) => {
        calls.push([substep, quantity]);
        if (substep === 2 && quantity === "stress_mises") {
          throw new Error("No scene");
        }
        return {
          label: "Displacement",
          at: "point",
          range: [0, substep],
          points: [],
          surfaces: [],
        } as ResultScene;
      },
    );
    render(
      <App
        store={new ModelStore(fixture as CommandList)}
        files={await files()}
        client={client(Promise.resolve(readyValue), { ...jobs, resultScene })}
      />,
    );
    await waitFor(() =>
      expect(solveButton().getAttribute("aria-disabled")).toBeNull(),
    );
    fireEvent.click(solveButton());
    await waitFor(() => expect(jobs.run).toHaveBeenCalledTimes(1));
    await act(async () =>
      jobs.settle().resolve({
        job_1: {
          substeps: 6,
          time: 0.1,
          x: [0, 0.1, 0.2, 0.3, 0.4, 0.5].map((u) => [u, 0, 0]),
          y: [0, 1, 2, 3, 4, 5].map((f) => [f, 0, 0]),
        },
      }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Show results" }));
    const panel = screen.getByRole("tabpanel");
    await waitFor(() => expect(calls).toEqual([[6, "displacement"]]));
    // nothing is loaded ahead while not playing
    await act(async () => {});
    expect(calls).toHaveLength(1);

    // the fastest speed; after the last substep the first one follows, and the
    // scenes ahead are loaded
    fireEvent.change(within(panel).getByLabelText("Speed"), {
      target: { value: "20" },
    });
    fireEvent.click(within(panel).getByRole("button", { name: "Play" }));
    await waitFor(() => expect(panel.textContent).toContain("Substep 3 of 6"));
    expect(calls.slice(0, 5).map(([s]) => s)).toEqual([6, 1, 2, 3, 4]);
    // the curve follows the substep
    fireEvent.click(within(panel).getByRole("button", { name: "Pause" }));
    const substep = Number(/Substep (\d)/.exec(panel.textContent!)![1]);
    await new Promise((r) => setTimeout(r, 150));
    expect(panel.textContent).toContain(`Substep ${substep} of 6`);
    expect(panel.textContent).toContain(
      `ux = ${[0, 0.1, 0.2, 0.3, 0.4, 0.5][substep - 1]}`,
    );

    // kept scenes are not loaded again
    const loaded = calls.length;
    const key = (k: string) => fireEvent.keyDown(document.body, { key: k });
    key("Home");
    key("End");
    await act(async () => {});
    expect(calls).toHaveLength(loaded);

    // Space plays and pauses; a scene that fails stops playing
    key("Home");
    fireEvent.change(within(panel).getByLabelText("Contour"), {
      target: { value: "stress_mises" },
    });
    await waitFor(() => expect(calls.at(-1)).toEqual([1, "stress_mises"]));
    key(" ");
    await waitFor(() =>
      expect(
        within(panel).queryByRole("button", { name: "Play" }),
      ).not.toBeNull(),
    );
    expect(panel.textContent).toContain("Substep 2 of 6");
    expect(screen.getByRole("main", { name: "Results" }).textContent).toContain(
      "No scene",
    );
    // playing again goes on with the next substep
    key(" ");
    await waitFor(() => expect(panel.textContent).toContain("Substep 3 of 6"));
    expect(within(panel).getByRole("button", { name: "Pause" })).toBeTruthy();
    key(" ");
    expect(within(panel).getByRole("button", { name: "Play" })).toBeTruthy();

    // playing stops in the model workspace
    key(" ");
    fireEvent.click(screen.getByRole("button", { name: "Model" }));
    fireEvent.click(screen.getByRole("button", { name: "Results" }));
    expect(
      within(screen.getByRole("tabpanel")).getByRole("button", {
        name: "Play",
      }),
    ).toBeTruthy();
  });

  it("exports the script and a picture of the view", async () => {
    const download = vi.fn();
    const script = vi.fn<(document: string) => Promise<string>>(
      async () => "import felupe as fem\n",
    );
    const store = new ModelStore(fixture as CommandList);
    render(
      <App
        store={store}
        client={client(Promise.resolve(readyValue), { script })}
        download={download}
      />,
    );
    const open = () =>
      fireEvent.click(screen.getByRole("button", { name: "Export" }));
    const item = (name: RegExp) =>
      within(screen.getByRole("menu", { name: "Export" })).getByRole(
        "menuitem",
        { name },
      );
    open();
    await waitFor(() =>
      expect(item(/Python script/).getAttribute("aria-disabled")).toBeNull(),
    );
    expect(item(/Python script/).textContent).toContain(
      "reads the mesh files from its folder",
    );
    fireEvent.click(item(/Python script/));
    expect(screen.queryByRole("menu", { name: "Export" })).toBeNull();
    await waitFor(() =>
      expect(download).toHaveBeenCalledWith(
        "untitled.py",
        "import felupe as fem\n",
      ),
    );
    expect(JSON.parse(script.mock.calls[0][0]).commands).toEqual(
      store.commands,
    );

    open();
    expect(item(/Results of the job/).textContent).toContain(
      "Solve the model first.",
    );
    fireEvent.keyDown(document, { key: "Escape" });

    // without a view, the picture is not exported
    open();
    fireEvent.click(item(/Picture of the view/));
    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toContain(
        "The picture could not be exported.The view shows nothing yet.",
      ),
    );

    // a model with an issue has no script; Escape closes the list
    act(() => store.apply({ type: "remove", name: "umat_soft" }));
    open();
    expect(item(/Python script/).getAttribute("aria-disabled")).toBe("true");
    expect(item(/Python script/).textContent).toContain(
      "Fix the issues of the model first.",
    );
    fireEvent.click(item(/Python script/));
    expect(script).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("menu", { name: "Export" })).toBeNull();
    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: "Export" }),
    );
  });

  it("explains why the jobs cannot be run", () => {
    render(<App store={new ModelStore(fixture as CommandList)} />);
    expect(solveButton().getAttribute("aria-disabled")).toBe("true");
    expect(solveButton().title).toBe("Load the mesh files of the model first.");
  });
});

describe("samples", () => {
  const serve = (async (url: string | URL | Request) => {
    // the files of public/ (the working directory of the tests is app/)
    const path = new URL(String(url)).pathname.replace(/^\//, "");
    const file = resolve("public", path);
    return existsSync(file)
      ? new Response(readFileSync(file))
      : new Response("", { status: 404 });
  }) as typeof fetch;

  it("opens a sample like a project with its mesh files", async () => {
    const store = new ModelStore();
    render(<App store={store} fetchSample={serve} />);
    fileMenu("Samples…");
    const dialog = screen.getByRole("dialog", { name: "Samples" });
    expect(within(dialog).queryByRole("note")).toBeNull();
    const samples = within(dialog)
      .getAllByRole("listitem")
      .filter((item) => item.querySelector("h3"));
    expect(
      samples.map((item) => item.querySelector("h3")?.textContent),
    ).toEqual(SAMPLES.map((sample) => sample.title));
    const mount = samples.find((item) =>
      item.textContent?.includes("Rubber mount in shear"),
    )!;
    expect(mount.textContent).toContain("Mooney-Rivlin");
    fireEvent.click(within(mount).getByRole("button", { name: /Open/ }));
    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: "Samples" })).toBeNull(),
    );
    const text = readFileSync(
      resolve("public/samples/rubber-mount/model.felupe.json"),
      "utf8",
    );
    expect(store.commands).toEqual(JSON.parse(text).commands);
    // a sample is an archive (#150)
    expect(screen.getByRole("banner").textContent).toContain(
      "rubber-mount.felupe.zip",
    );
  });

  it("saves a sample as an archive, with the script and as a project file (#150)", async () => {
    const store = new ModelStore();
    const files = new MeshFiles(async (name) => ({
      info: { file: name, points: 8, solids: [] },
    }));
    const download = vi.fn();
    const script = vi.fn(async () => "import felupe as fem\n");
    render(
      <App
        store={store}
        files={files}
        fetchSample={serve}
        download={download}
        client={client(Promise.resolve(readyValue), { script })}
      />,
    );
    const sample = SAMPLES.find((s) => s.id === "rubber-mount")!;
    fileMenu("Samples…");
    const dialog = screen.getByRole("dialog", { name: "Samples" });
    const card = within(dialog)
      .getAllByRole("listitem")
      .find((item) => item.textContent?.includes(sample.title))!;
    fireEvent.click(within(card).getByRole("button", { name: /Open/ }));
    await waitFor(() => expect(store.commands.length).toBeGreaterThan(0));
    await waitFor(() => expect(files.names).toEqual(sample.files));
    const { readArchive } = await import("../core/archive");
    const saved = async (call: number) => {
      const [name, blob] = download.mock.calls[call] as [string, Blob];
      return {
        name,
        archive: readArchive(new Uint8Array(await blob.arrayBuffer())),
      };
    };

    // Save: an archive that opens again to the same commands and mesh files
    fireEvent.keyDown(window, { key: "s", ctrlKey: true });
    await waitFor(() => expect(download).toHaveBeenCalledTimes(1));
    const first = await saved(0);
    expect(first.name).toBe("rubber-mount.felupe.zip");
    expect(JSON.parse(await first.archive.project!.text()).commands).toEqual(
      store.commands,
    );
    expect(first.archive.files.map((f) => f.name)).toEqual(sample.files);
    for (const file of first.archive.files) {
      expect(new Uint8Array(await file.arrayBuffer())).toEqual(
        files.dataOf(file.name),
      );
    }
    expect(first.archive.script).toBeUndefined();

    // Save as: another name, with the script
    fireEvent.keyDown(window, { key: "S", ctrlKey: true, shiftKey: true });
    let saveAs = screen.getByRole("dialog", { name: "Save project as" });
    const name = within(saveAs).getByLabelText("Name") as HTMLInputElement;
    expect(name.value).toBe("rubber-mount");
    expect(
      (within(saveAs).getByLabelText(/Project archive/) as HTMLInputElement)
        .checked,
    ).toBe(true);
    const meshes = within(saveAs).getByLabelText("Mesh files");
    expect(meshes.textContent).toContain(sample.files[0]);
    expect(meshes.textContent).toMatch(/\d+(\.\d)? kB/);
    fireEvent.input(name, { target: { value: "a/b" } });
    expect(saveAs.textContent).toContain("A name has none of the characters");
    expect(
      (
        within(saveAs).getByRole("button", {
          name: "Save",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
    fireEvent.input(name, { target: { value: "mount" } });
    fireEvent.click(within(saveAs).getByLabelText(/Include the Python script/));
    fireEvent.click(within(saveAs).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(download).toHaveBeenCalledTimes(2));
    const second = await saved(1);
    expect(second.name).toBe("mount.felupe.zip");
    expect(await second.archive.script?.text()).toBe("import felupe as fem\n");
    expect(script).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("banner").textContent).toContain(
      "mount.felupe.zip",
    );

    // Save as a project file, and Save keeps that format
    fileMenu(/Save project as/);
    saveAs = screen.getByRole("dialog", { name: "Save project as" });
    fireEvent.click(within(saveAs).getByLabelText(/Project file/));
    expect(within(saveAs).queryByLabelText("Mesh files")).toBeNull();
    fireEvent.click(within(saveAs).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(download).toHaveBeenCalledTimes(3));
    const [jsonName, text] = download.mock.calls[2] as [string, string];
    expect(jsonName).toBe("mount.felupe.json");
    expect(JSON.parse(text).commands).toEqual(store.commands);
    expect(screen.getByRole("banner").textContent).toContain(
      "mount.felupe.json",
    );
    fireEvent.click(screen.getByRole("button", { name: "Save project" }));
    await waitFor(() => expect(download).toHaveBeenCalledTimes(4));
    expect(download.mock.calls[3][0]).toBe("mount.felupe.json");
    expect(typeof download.mock.calls[3][1]).toBe("string");
  });

  it("are offered with their pictures by the welcome panel", async () => {
    const store = new ModelStore();
    render(<App store={store} fetchSample={serve} />);
    const welcome = screen.getByRole("region", {
      name: "Welcome to FElupe Studio",
    });
    const cards = within(welcome).getAllByRole("listitem");
    expect(cards.map((card) => card.querySelector("h3")?.textContent)).toEqual(
      SAMPLES.map((sample) => sample.title),
    );
    for (const [i, card] of cards.entries()) {
      const src = card.querySelector("img")?.getAttribute("src") ?? "";
      expect(src).toMatch(
        new RegExp(`samples/${SAMPLES[i].id}/thumbnail.svg$`),
      );
      expect(
        existsSync(resolve("public", new URL(src).pathname.slice(1))),
      ).toBe(true);
    }
    const plate = cards.find((card) =>
      card.textContent?.includes("Rubber block with a rigid plate"),
    )!;
    fireEvent.click(within(plate).getByRole("button", { name: "Open" }));
    await waitFor(() => expect(store.commands.length).toBeGreaterThan(0));
    expect(
      screen.queryByRole("region", { name: "Welcome to FElupe Studio" }),
    ).toBeNull();
    expect(screen.getByRole("banner").textContent).toContain(
      "glued-plate.felupe.zip",
    );
  });

  it("warns before replacing changes and reports a missing file", async () => {
    const store = new ModelStore(fixture as CommandList);
    const missing = (async () =>
      new Response("", { status: 404 })) as typeof fetch;
    render(<App store={store} fetchSample={missing} />);
    act(() => store.apply({ type: "remove", name: "job_1" }));
    fileMenu("Samples…");
    const dialog = screen.getByRole("dialog", { name: "Samples" });
    expect(within(dialog).getByRole("note").textContent).toContain(
      "unsaved changes",
    );
    fireEvent.click(within(dialog).getAllByRole("button", { name: "Open" })[0]);
    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toContain(
        "The sample could not be opened.",
      ),
    );
    expect(store.commands).not.toContain(undefined);
    expect(screen.queryByRole("dialog", { name: "Samples" })).toBeNull();
  });
});

describe("project archives (#149, #150)", () => {
  // a mesh file with the tag of the sections of the fixture
  const meshFiles = () =>
    new MeshFiles(async (name) => ({
      info: {
        file: name,
        points: 8,
        solids: [
          {
            cell_type: "hexahedron",
            cells: 2,
            bounds: [
              [0, 0, 0],
              [1, 1, 1],
            ] as [number[], number[]],
            tags: [
              {
                name: "material",
                values: [
                  { value: 1, cells: 1 },
                  { value: 2, cells: 1 },
                ],
              },
            ],
          },
        ],
      },
    }));
  const vtu = new Uint8Array([1, 2, 3]);
  const archive = async (
    entries: { name: string; data: Uint8Array }[],
    project?: string,
  ) => {
    const { writeArchive } = await import("../core/archive");
    const { zipSync } = await import("fflate");
    return project === undefined
      ? zipSync(Object.fromEntries(entries.map((e) => [e.name, e.data])))
      : writeArchive({ name: "bar", project, files: entries });
  };
  const open = (...list: File[]) =>
    fireEvent.change(screen.getByTestId("open-file"), {
      target: { files: list },
    });
  const solve = () => screen.getByRole("button", { name: /Solve/ });

  it("opens an archive with its mesh files and saves it again", async () => {
    const store = new ModelStore();
    const files = meshFiles();
    await files.add("old.vtu", new Uint8Array([9]));
    const download = vi.fn();
    render(
      <App
        store={store}
        files={files}
        download={download}
        client={client(Promise.resolve(readyValue))}
      />,
    );
    const zip = await archive(
      [
        { name: "specimen.vtu", data: vtu },
        { name: "notes.txt", data: new Uint8Array([1]) },
      ],
      projectText,
    );
    // a .zip is recognized by its content
    open(new File([zip], "bar (1).zip"));
    await waitFor(() => expect(store.commands).toEqual(fixture.commands));
    expect(screen.getByRole("banner").textContent).toContain(
      "bar (1).felupe.zip",
    );
    expect(screen.queryByLabelText("modified")).toBeNull();
    // the mesh files of the archive replace the ones of the previous project
    await waitFor(() => expect(files.dataOf("specimen.vtu")).toEqual(vtu));
    expect(files.names).toEqual(["specimen.vtu"]);
    await waitFor(() =>
      expect(solve().getAttribute("aria-disabled")).toBeNull(),
    );
    const note = screen.getByRole("status", { name: "Note" });
    expect(note.textContent).toContain(
      "Files of bar (1).felupe.zip that the project does not use were not opened:notes.txt",
    );

    // saved in its format, with the mesh files
    fireEvent.click(screen.getByRole("button", { name: "Save project" }));
    await waitFor(() => expect(download).toHaveBeenCalledTimes(1));
    const [name, blob] = download.mock.calls[0] as [string, Blob];
    expect(name).toBe("bar (1).felupe.zip");
    expect(blob.type).toBe("application/zip");
    const { readArchive } = await import("../core/archive");
    const saved = readArchive(new Uint8Array(await blob.arrayBuffer()));
    expect(saved.project?.name).toBe("bar (1).felupe.json");
    expect(JSON.parse(await saved.project!.text()).commands).toEqual(
      fixture.commands,
    );
    expect(saved.files.map((f) => f.name)).toEqual(["specimen.vtu"]);
    expect(new Uint8Array(await saved.files[0].arrayBuffer())).toEqual(vtu);
  });

  it("reports missing mesh files and opens mesh files to import", async () => {
    const store = new ModelStore();
    const files = meshFiles();
    const download = vi.fn();
    render(
      <App
        store={store}
        files={files}
        download={download}
        client={client(Promise.resolve(readyValue))}
      />,
    );
    open(new File([await archive([], projectText)], "bar.felupe.zip"));
    await waitFor(() => expect(store.commands).toEqual(fixture.commands));
    await waitFor(() =>
      expect(solve().title).toContain(
        "Load the mesh files of the model first.",
      ),
    );
    // saved without the missing file, with a note
    fireEvent.click(screen.getByRole("button", { name: "Save project" }));
    await waitFor(() => expect(download).toHaveBeenCalledTimes(1));
    expect(screen.getByRole("status", { name: "Note" }).textContent).toContain(
      "bar.felupe.zip was saved without the mesh files that are not loaded:specimen.vtu",
    );

    // an archive without a project: its mesh files are imported
    cleanup();
    render(<App store={new ModelStore()} files={meshFiles()} />);
    open(
      new File(
        [await archive([{ name: "specimen.vtu", data: vtu }])],
        "meshes.zip",
      ),
    );
    expect(
      await screen.findByRole("dialog", { name: /Import mesh/ }),
    ).toBeTruthy();
  });

  it("makes a new project an archive with its first mesh file (#150)", async () => {
    const store = new ModelStore();
    render(<App store={store} files={meshFiles()} />);
    const banner = () => screen.getByRole("banner").textContent;
    expect(banner()).toContain("untitled.felupe.json");
    act(() =>
      store.apply({
        type: "add",
        command: {
          command: "mesh.import",
          name: "specimen",
          file: "specimen.vtu",
        } as Command,
      }),
    );
    await waitFor(() => expect(banner()).toContain("untitled.felupe.zip"));
    // a mesh file that is not loaded is listed as missing
    fireEvent.keyDown(window, { key: "S", ctrlKey: true, shiftKey: true });
    const saveAs = screen.getByRole("dialog", { name: "Save project as" });
    expect(within(saveAs).getByLabelText("Mesh files").textContent).toContain(
      "specimen.vtu not loaded",
    );
    expect(within(saveAs).getByRole("note").textContent).toContain(
      "lacks the mesh files that are not loaded",
    );
    // without Python, no script
    expect(
      (
        within(saveAs).getByLabelText(
          /Include the Python script/,
        ) as HTMLInputElement
      ).disabled,
    ).toBe(true);
  });

  it("restores the format of the project from the session (#150)", async () => {
    const storage = new IndexedDBSession(new IDBFactory());
    await storage.save({
      project: projectText,
      fileName: "bar.felupe.zip",
      modified: false,
      files: [{ name: "specimen.vtu", data: vtu }],
    });
    const store = new ModelStore();
    const files = meshFiles();
    const download = vi.fn();
    render(
      <App store={store} files={files} session={storage} download={download} />,
    );
    await waitFor(() => expect(store.commands).toEqual(fixture.commands));
    await waitFor(() => expect(files.dataOf("specimen.vtu")).toEqual(vtu));
    expect(screen.getByRole("banner").textContent).toContain("bar.felupe.zip");
    fireEvent.click(screen.getByRole("button", { name: "Save project" }));
    await waitFor(() => expect(download).toHaveBeenCalledTimes(1));
    const [name, blob] = download.mock.calls[0] as [string, Blob];
    expect(name).toBe("bar.felupe.zip");
    expect(blob.type).toBe("application/zip");
  });

  it("keeps the model if an archive cannot be opened, and asks first", async () => {
    const store = new ModelStore(fixture as CommandList);
    render(<App store={store} files={meshFiles()} />);
    act(() => store.apply({ type: "remove", name: "job_1" }));
    const changed = store.commands;

    open(new File(["no zip"], "broken.felupe.zip"));
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain(
      "broken.felupe.zip could not be opened.",
    );
    expect(alert.textContent).toContain("This is not a ZIP file");
    const { zipSync } = await import("fflate");
    const text = new TextEncoder().encode(projectText);
    open(
      new File(
        [zipSync({ "a.felupe.json": text, "b.felupe.json": text })],
        "two.zip",
      ),
    );
    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toContain(
        "more than one project file",
      ),
    );
    expect(store.commands).toBe(changed);

    // unsaved changes: the project is opened after asking
    const zip = await archive(
      [{ name: "specimen.vtu", data: vtu }],
      projectText,
    );
    open(new File([zip], "bar.felupe.zip"));
    let dialog = await screen.findByRole("dialog", { name: "Open project" });
    expect(dialog.textContent).toContain(
      "Opening bar.felupe.zip discards them",
    );
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(store.commands).toBe(changed);
    open(new File([zip], "bar.felupe.zip"));
    dialog = await screen.findByRole("dialog", { name: "Open project" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Open" }));
    await waitFor(() => expect(store.commands).toEqual(fixture.commands));
    expect(screen.getByRole("banner").textContent).toContain("bar.felupe.zip");
  });
});

describe("session in the browser", () => {
  const inspector = async (name: string) => ({
    info: { file: name, points: 8, solids: [] },
  });
  const status = () => screen.getByRole("status").textContent ?? "";

  it("restores the last session after a reload", async () => {
    const storage = new IndexedDBSession(new IDBFactory());
    await storage.save({
      project: projectText,
      fileName: "specimen.felupe.json",
      modified: true,
      files: [{ name: "specimen.vtu", data: new Uint8Array([1, 2]) }],
    });
    const store = new ModelStore();
    const files = new MeshFiles(inspector);
    render(<App store={store} files={files} session={storage} />);
    await waitFor(() => expect(store.commands).toEqual(fixture.commands));
    expect(screen.getByRole("banner").textContent).toContain(
      "specimen.felupe.json",
    );
    // the restored project has unsaved changes
    expect(screen.getByLabelText("modified")).toBeTruthy();
    await waitFor(() =>
      expect(files.dataOf("specimen.vtu")).toEqual(new Uint8Array([1, 2])),
    );
    await waitFor(() => expect(status()).toContain("Kept in this browser"));
    expect(screen.getByText("Kept in this browser").title).toContain(
      "kept in this browser only",
    );
  });

  it("keeps the project and its mesh files after changes", async () => {
    const storage = new IndexedDBSession(new IDBFactory());
    const store = new ModelStore();
    const files = new MeshFiles(inspector);
    render(<App store={store} files={files} session={storage} />);
    await files.add("specimen.vtu", new Uint8Array([7]));
    await files.add("unused.vtu", new Uint8Array([8]));
    act(() => store.load(fixture as CommandList));
    await waitFor(
      async () => {
        const kept = await storage.load();
        expect(kept?.files).toEqual([
          { name: "specimen.vtu", data: new Uint8Array([7]) },
        ]);
        expect(JSON.parse(kept!.project).commands).toEqual(fixture.commands);
        // a new project with a mesh file is an archive (#150)
        expect(kept?.fileName).toBe("untitled.felupe.zip");
      },
      { timeout: 3000 },
    );

    // a new project (with a confirmation of the unsaved changes) clears it
    fileMenu("New project");
    const dialog = screen.getByRole("dialog", { name: "New project" });
    expect(dialog.textContent).toContain("discards them, also in this browser");
    fireEvent.click(
      within(dialog).getByRole("button", { name: "New project" }),
    );
    expect(store.commands).toEqual([]);
    expect(files.names).toEqual([]);
    await waitFor(async () => expect(await storage.load()).toBeUndefined(), {
      timeout: 3000,
    });
  });

  it("reports a storage that does not work", async () => {
    const broken: SessionStorage = {
      load: async () => undefined,
      clear: async () => {
        throw new Error("The storage is blocked.");
      },
      save: async () => {
        throw new Error("The storage is blocked.");
      },
    };
    const store = new ModelStore(fixture as CommandList);
    render(<App store={store} session={broken} />);
    await waitFor(
      () => expect(status()).toContain("Not kept in this browser"),
      {
        timeout: 3000,
      },
    );
    expect(screen.getByText("Not kept in this browser").title).toBe(
      "The storage is blocked.",
    );
    // without changes, a new project needs no confirmation
    fileMenu("New project");
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(store.commands).toEqual([]);
  });
});
