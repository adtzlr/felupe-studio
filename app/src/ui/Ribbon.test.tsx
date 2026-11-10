// @vitest-environment happy-dom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/preact";
import { afterEach, describe, expect, it } from "vitest";
import fixture from "../../../tests/data/two_sections.json";
import type { CommandList } from "../core/commands";
import { parse, serialize } from "../core/project";
import { MeshFiles } from "../core/meshfiles";
import { ModelStore } from "../core/store";
import { validate } from "../core/validate";
import { App } from "./App";

afterEach(cleanup);

function setup(store = new ModelStore()) {
  const files = new MeshFiles(async (name) => ({
    info: {
      file: name,
      points: 325,
      cell_type: "hexahedron",
      cells: 192,
      tags: [],
    },
  }));
  render(<App store={store} files={files} />);
  const tab = (name: string) =>
    fireEvent.click(screen.getByRole("tab", { name }));
  const panel = () => screen.getByRole("tabpanel");
  const command = (name: string) =>
    within(panel()).getByRole("button", { name });
  const dialog = () => screen.getByRole("dialog");
  const field = (label: string) =>
    within(dialog()).getByLabelText(label) as HTMLInputElement;
  const create = () =>
    fireEvent.click(within(dialog()).getByRole("button", { name: "Create" }));
  return { store, tab, panel, command, dialog, field, create };
}

describe("ribbon commands", () => {
  it("show the commands of the active tab", () => {
    const { tab, panel } = setup();
    const names = () =>
      within(panel())
        .getAllByRole("button")
        .map((b) => b.textContent);
    expect(names()).toEqual([
      "Import mesh",
      "Merge points",
      "Cell set from tag",
      "Cell set of a mesh",
      "Point set",
    ]);
    tab("Materials");
    expect(names()).toEqual([
      "Neo-Hooke",
      "Neo-Hooke (compressible)",
      "Linear elastic (large strain)",
    ]);
  });

  it("explain why a command is not available yet", () => {
    const { tab, command } = setup();
    const cells = command("Cell set of a mesh");
    expect(cells.getAttribute("aria-disabled")).toBe("true");
    expect(cells.getAttribute("title")).toBe("Create a mesh first.");
    fireEvent.click(cells);
    expect(screen.queryByRole("dialog")).toBeNull();
    tab("Sections");
    expect(command("Section").getAttribute("title")).toBe(
      "Create a cell set and a material first.",
    );
  });

  it("open a dialog that creates and selects the object", () => {
    const { store, tab, command, dialog, field, create } = setup();
    tab("Materials");
    const opener = command("Neo-Hooke");
    opener.focus();
    fireEvent.click(opener);
    expect(within(dialog()).getByRole("heading").textContent).toBe(
      "New material",
    );
    expect(document.activeElement).toBe(field("Name"));
    expect(field("Name").value).toBe("material_1");

    fireEvent.input(field("Name"), { target: { value: "" } });
    create();
    expect(dialog().textContent).toContain("Required.");
    expect(store.commands).toHaveLength(0);

    fireEvent.input(field("Name"), { target: { value: "rubber" } });
    create();
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(store.commands).toEqual([
      {
        command: "material.add",
        name: "rubber",
        model: "NeoHooke",
        parameters: { mu: 1 },
      },
    ]);
    const tree = screen.getByRole("tree", { name: "Model" });
    expect(
      within(tree)
        .getByRole("treeitem", { name: "rubber" })
        .getAttribute("aria-selected"),
    ).toBe("true");
    // creating is one undo step
    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    expect(store.commands).toHaveLength(0);
  });

  it("close the dialog with Cancel, Close and Escape and return the focus", () => {
    const { store, command, dialog } = setup();
    const opener = command("Import mesh");
    for (const close of [
      () =>
        fireEvent.click(
          within(dialog()).getByRole("button", { name: "Cancel" }),
        ),
      () =>
        fireEvent.click(
          within(dialog()).getByRole("button", { name: "Close" }),
        ),
      () => fireEvent.keyDown(dialog(), { key: "Escape" }),
    ]) {
      opener.focus();
      fireEvent.click(opener);
      close();
      expect(screen.queryByRole("dialog")).toBeNull();
      expect(document.activeElement).toBe(opener);
    }
    expect(store.commands).toHaveLength(0);
  });

  it("does not undo while the dialog is open", () => {
    const { store, command } = setup(new ModelStore(fixture as CommandList));
    fireEvent.click(command("Point set"));
    fireEvent.keyDown(window, { key: "z", ctrlKey: true });
    expect(store.commands).toHaveLength(13);
  });

  it("build a complete model from the ribbon", async () => {
    const { store, tab, command, dialog, field, create } = setup();
    const add = (
      tabName: string,
      button: string,
      fill: () => void = () => {},
    ) => {
      tab(tabName);
      fireEvent.click(command(button));
      fill();
      create();
      expect(screen.queryByRole("dialog"), button).toBeNull();
    };

    // the import dialog creates the mesh and a cell set with all cells
    tab("Mesh");
    fireEvent.click(command("Import mesh"));
    const picker = within(dialog()).getByTestId("file-picker");
    fireEvent.change(picker, {
      target: { files: [new File(["x"], "bar.vtu")] },
    });
    await waitFor(() =>
      expect(
        within(dialog()).getByRole("button", { name: "Import" }),
      ).toBeTruthy(),
    );
    await waitFor(() =>
      expect(
        (
          within(dialog()).getByRole("button", {
            name: "Import",
          }) as HTMLButtonElement
        ).disabled,
      ).toBe(false),
    );
    fireEvent.click(within(dialog()).getByRole("button", { name: "Import" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    add("Mesh", "Point set");
    add("Mesh", "Point set", () =>
      fireEvent.input(field("Coordinate"), { target: { value: "3" } }),
    );
    add("Materials", "Neo-Hooke (compressible)");
    add("Sections", "Section");
    add("Loads & BCs", "Boundary", () =>
      fireEvent.change(field("Point set"), { target: { value: "points_1" } }),
    );
    add("Loads & BCs", "Boundary", () => {
      for (const axis of ["y", "z"]) fireEvent.click(field(axis));
    });
    add("Steps & Job", "Step", () => {
      fireEvent.click(field("Ramp a boundary"));
      fireEvent.input(field("End"), { target: { value: "0.5" } });
    });
    add("Steps & Job", "Job", () =>
      fireEvent.change(field("Curve boundary"), {
        target: { value: "boundary_2" },
      }),
    );

    expect(validate(store.commands)).toEqual([]);
    expect(store.get("material_1")).toMatchObject({
      model: "NeoHookeCompressible",
    });
    expect(store.get("boundary_2")).toMatchObject({
      pointset: "points_2",
      constrained: ["x"],
    });
    expect(store.get("step_1")).toEqual({
      command: "step.add",
      name: "step_1",
      ramp: { boundary: "boundary_2", end: 0.5, num: 5 },
    });
    expect(store.get("job_1")).toMatchObject({
      steps: ["step_1"],
      curve: "boundary_2",
    });
    // the model is a valid project file
    expect(store.commands.slice(0, 2)).toEqual([
      { command: "mesh.import", name: "bar", file: "bar.vtu" },
      { command: "cellset.from_file", name: "bar_cells", mesh: "bar" },
    ]);
    expect(parse(serialize(store.document)).commands).toHaveLength(10);
    expect(screen.getByRole("status").textContent).toContain("0 issues");
  });
});
