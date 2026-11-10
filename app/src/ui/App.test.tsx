// @vitest-environment happy-dom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/preact";
import { afterEach, describe, expect, it, vi } from "vitest";
import projectText from "../../../tests/data/two_sections.felupe.json?raw";
import fixture from "../../../tests/data/two_sections.json";
import type { CommandList } from "../core/commands";
import { ModelStore } from "../core/store";
import type { PyodideClient, Ready } from "../worker/client";
import { App } from "./App";

afterEach(cleanup);

const material = {
  command: "material.add",
  name: "rubber",
  model: "NeoHookeCompressible",
  parameters: { mu: 1, lmbda: 2 },
} as const;

function client(ready: Promise<Ready>) {
  return { ready } as unknown as PyodideClient;
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

describe("App shell", () => {
  it("has the regions of the layout", () => {
    render(<App store={new ModelStore()} />);
    expect(screen.getByRole("banner")).toBeTruthy();
    expect(screen.getByRole("group", { name: "Workspace" })).toBeTruthy();
    expect(screen.getByRole("tablist", { name: "Ribbon" })).toBeTruthy();
    expect(
      screen.getByRole("navigation", { name: "Model browser" }),
    ).toBeTruthy();
    expect(screen.getByRole("region", { name: "Properties" })).toBeTruthy();
    expect(screen.getByRole("main", { name: "Viewport" })).toBeTruthy();
    expect(screen.getByRole("contentinfo")).toBeTruthy();
    expect(
      screen.getByText(
        "No model yet. Import a mesh with the ribbon, drop a mesh file here, or open a project file.",
      ),
    ).toBeTruthy();
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
      (screen.getByRole("button", { name: /Solve/ }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
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
