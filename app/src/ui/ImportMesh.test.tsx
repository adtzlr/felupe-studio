// @vitest-environment happy-dom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/preact";
import { afterEach, describe, expect, it, vi } from "vitest";
import projectText from "../../../tests/data/two_sections.felupe.json?raw";
import { MeshFiles } from "../core/meshfiles";
import { ModelStore } from "../core/store";
import { validate } from "../core/validate";
import type { MeshInfo } from "../worker/protocol";
import { App } from "./App";

afterEach(cleanup);

const INFO: Record<string, MeshInfo> = {
  "bar.vtu": {
    file: "bar.vtu",
    points: 325,
    blocks: [{ type: "hexahedron", cells: 192 }],
    cell_type: "hexahedron",
    cells: 192,
    ignored: [],
    bounds: [
      [0, 0, 0],
      [3, 1, 1],
    ],
    tags: [
      {
        name: "material",
        values: [
          { value: 1, cells: 96 },
          { value: 2, cells: 96 },
        ],
      },
    ],
  },
  "specimen.vtu": {
    file: "specimen.vtu",
    points: 325,
    cell_type: "hexahedron",
    cells: 192,
    tags: [
      {
        name: "material",
        values: [
          { value: 1, cells: 96 },
          { value: 2, cells: 96 },
        ],
      },
    ],
  },
  "plain.vtu": {
    file: "plain.vtu",
    points: 8,
    cell_type: "hexahedron",
    cells: 1,
    ignored: ["quad"],
    bounds: [
      [0, 0, 0],
      [1, 1, 1],
    ],
    tags: [],
  },
  "surface.vtu": {
    file: "surface.vtu",
    error: "The file needs one type of solid cells; found quad.",
  },
};

function setup(store = new ModelStore()) {
  let release: (() => void) | undefined;
  const inspector = vi.fn(async (name: string) => {
    if (name === "slow.vtu")
      await new Promise<void>((resolve) => (release = resolve));
    return INFO[name] ?? { ...INFO["plain.vtu"], file: name };
  });
  const files = new MeshFiles(inspector);
  render(<App store={store} files={files} />);
  const dialog = () => screen.getByRole("dialog");
  const pick = (...names: string[]) =>
    fireEvent.change(within(dialog()).getByTestId("file-picker"), {
      target: { files: names.map((n) => new File(["x"], n)) },
    });
  const importButton = () =>
    within(dialog()).getByRole("button", {
      name: "Import",
    }) as HTMLButtonElement;
  const open = (...list: File[]) =>
    fireEvent.change(screen.getByTestId("open-file"), {
      target: { files: list },
    });
  return {
    store,
    files,
    inspector,
    dialog,
    pick,
    importButton,
    open,
    release: () => release?.(),
  };
}

describe("import dialog", () => {
  it("shows the content of the file and creates the mesh with one cell set per tag", async () => {
    const { store, dialog, pick, importButton } = setup();
    fireEvent.click(screen.getByRole("button", { name: "Import mesh" }));
    expect(dialog().textContent).toContain("Drop a mesh file here");
    pick("bar.vtu");
    await waitFor(() => expect(importButton().disabled).toBe(false));

    expect(dialog().textContent).toContain("192 hexahedron cells · 325 points");
    expect(dialog().textContent).toContain("x 0 … 3, y 0 … 1, z 0 … 1");
    expect(
      (within(dialog()).getByLabelText("Name") as HTMLInputElement).value,
    ).toBe("bar");
    const plan = within(dialog()).getByLabelText("Will be created");
    expect(plan.textContent).toContain("mesh bar");
    expect(plan.textContent).toContain(
      "cell set material_1 material = 1, 96 cells",
    );

    fireEvent.click(importButton());
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(store.commands).toEqual([
      { command: "mesh.import", name: "bar", file: "bar.vtu", tag: "material" },
      {
        command: "cellset.from_tag",
        name: "material_1",
        mesh: "bar",
        value: 1,
      },
      {
        command: "cellset.from_tag",
        name: "material_2",
        mesh: "bar",
        value: 2,
      },
    ]);
    expect(validate(store.commands)).toEqual([]);
    // one undo step for the mesh and its cell sets
    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    expect(store.commands).toEqual([]);
  });

  it("offers all cells or no cell sets", async () => {
    const { store, dialog, pick, importButton } = setup();
    fireEvent.click(screen.getByRole("button", { name: "Import mesh" }));
    pick("plain.vtu");
    await waitFor(() => expect(importButton().disabled).toBe(false));
    expect(dialog().textContent).toContain("Ignored");
    expect(
      within(dialog()).queryByLabelText("One per value of the cell tag"),
    ).toBeNull();
    expect(
      (
        within(dialog()).getByLabelText(
          "One with all cells",
        ) as HTMLInputElement
      ).checked,
    ).toBe(true);
    fireEvent.click(
      within(dialog()).getByLabelText("None, I create them later"),
    );
    fireEvent.click(importButton());
    expect(store.commands).toEqual([
      { command: "mesh.import", name: "plain", file: "plain.vtu" },
    ]);
  });

  it("explains files that cannot be used and checks the name", async () => {
    const { store, dialog, pick, importButton } = setup();
    store.apply({
      type: "add",
      command: { command: "mesh.import", name: "bar", file: "x.vtu" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Import mesh" }));
    pick("surface.vtu");
    expect(await within(dialog()).findByRole("alert")).toBeTruthy();
    expect(dialog().textContent).toContain("needs one type of solid cells");
    expect(importButton().disabled).toBe(true);

    fireEvent.click(
      within(dialog()).getByRole("button", { name: "Choose another file" }),
    );
    pick("bar.vtu");
    await waitFor(() => expect(importButton().disabled).toBe(false));
    // the name of the file is taken already
    const name = within(dialog()).getByLabelText("Name") as HTMLInputElement;
    expect(name.value).toBe("bar_2");
    fireEvent.input(name, { target: { value: "bar" } });
    expect(dialog().textContent).toContain("The name 'bar' is already used.");
    expect(importButton().disabled).toBe(true);
  });

  it("shows that it waits for Python", async () => {
    const { dialog, pick, importButton, release } = setup();
    fireEvent.click(screen.getByRole("button", { name: "Import mesh" }));
    pick("slow.vtu");
    await waitFor(() =>
      expect(within(dialog()).getByRole("status").textContent).toContain(
        "Reading",
      ),
    );
    expect(importButton().disabled).toBe(true);
    release();
    await waitFor(() => expect(importButton().disabled).toBe(false));
  });
});

describe("opening files", () => {
  it("opens a single mesh file in the import dialog", async () => {
    const { dialog, open, importButton } = setup();
    open(new File(["x"], "plain.vtu"));
    await waitFor(() => expect(importButton().disabled).toBe(false));
    expect(dialog().textContent).toContain("plain.vtu");
  });

  it("opens a project together with its mesh files", async () => {
    const { store, files, open } = setup();
    open(
      new File([projectText], "bar.felupe.json"),
      new File(["x"], "specimen.vtu"),
    );
    await waitFor(() =>
      expect(files.get("specimen.vtu")?.status.state).toBe("ready"),
    );
    expect(store.commands).toHaveLength(13);
    expect(screen.queryByRole("dialog")).toBeNull();
    const tree = screen.getByRole("tree", { name: "Model" });
    expect(
      within(
        within(tree).getByRole("treeitem", { name: "specimen" }),
      ).queryByLabelText(/issue/),
    ).toBeNull();
  });

  it("asks for a missing mesh file and loads it from the properties", async () => {
    const { files, open } = setup();
    open(new File([projectText], "bar.felupe.json"));
    const tree = await screen.findByRole("tree", { name: "Model" });
    const row = within(tree).getByRole("treeitem", { name: "specimen" });
    expect(
      within(row).getByLabelText("1 issue").getAttribute("title"),
    ).toContain("The file 'specimen.vtu' is not loaded.");

    fireEvent.click(row);
    const properties = screen.getByRole("region", { name: "Properties" });
    expect(properties.textContent).toContain("not loaded");
    // the chosen file is stored under the name that the mesh references
    fireEvent.change(within(properties).getByTestId("mesh-file"), {
      target: { files: [new File(["x"], "Specimen (final).vtu")] },
    });
    await waitFor(() =>
      expect(files.get("specimen.vtu")?.status.state).toBe("ready"),
    );
    expect(properties.textContent).toContain(
      "192 hexahedron cells · 325 points",
    );
    expect(within(row).queryByLabelText("1 issue")).toBeNull();
  });

  it("offers loaded mesh files that are not used yet", async () => {
    const { dialog, open, importButton } = setup();
    open(new File(["x"], "a.vtu"), new File(["x"], "b.vtu"));
    await waitFor(() =>
      expect(
        within(dialog()).getByRole("button", { name: "b.vtu" }),
      ).toBeTruthy(),
    );
    fireEvent.click(within(dialog()).getByRole("button", { name: "b.vtu" }));
    await waitFor(() => expect(importButton().disabled).toBe(false));
    fireEvent.click(importButton());
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("opens dropped files", async () => {
    const { store } = setup();
    const shell = document.querySelector(".shell")!;
    const dataTransfer = {
      types: ["Files"],
      files: [new File([projectText], "bar.felupe.json")],
    };
    fireEvent.dragOver(shell, { dataTransfer });
    expect(shell.className).toContain("dragging");
    fireEvent.drop(shell, { dataTransfer });
    await waitFor(() => expect(store.commands).toHaveLength(13));
    expect(shell.className).not.toContain("dragging");
  });

  it("refuses two project files at once", async () => {
    const { open } = setup();
    open(new File(["{}"], "a.felupe.json"), new File(["{}"], "b.felupe.json"));
    expect((await screen.findByRole("alert")).textContent).toContain(
      "Open one project file at a time.",
    );
  });
});
