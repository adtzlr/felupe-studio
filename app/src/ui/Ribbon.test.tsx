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
      solids: [
        {
          cell_type: "hexahedron",
          cells: 192,
          bounds: [
            [0, 0, 0],
            [3, 1, 1],
          ] as [number[], number[]],
          tags: [],
        },
      ],
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
    const { tab, panel, command } = setup();
    const names = () =>
      within(panel())
        .getAllByRole("button")
        .map((b) => b.textContent);
    expect(names()).toEqual([
      "Import mesh",
      // the mesh tools in a menu (ADR 0019)
      "Primitives ▾",
      "Operations ▾",
      "Mesh script",
      "Merge points",
      "Cell set from tag",
      "Cell set of a mesh",
      "Point set",
      "Face set",
      "Model settings",
      "Parameter",
    ]);
    tab("Materials");
    // the models in menus of their kind, so the ribbon stays one row (#136, #259)
    expect(names()).toEqual([
      "Linear elasticity ▾",
      "Hyperelasticity ▾",
      "Strain-based elasticity ▾",
      // a material of a Python file (ADR 0025): of its kinds (#424)
      "User-defined ▾",
    ]);
    const hyperelasticity = command("Hyperelasticity");
    expect(hyperelasticity.getAttribute("aria-haspopup")).toBe("menu");
    fireEvent.click(hyperelasticity);
    const menu = screen.getByRole("menu", { name: "Hyperelasticity" });
    expect(
      within(menu)
        .getAllByRole("menuitem")
        .map((i) => i.textContent),
    ).toEqual([
      "Neo-Hooke",
      "Neo-Hooke (compressible)",
      "Mooney-Rivlin",
      "Yeoh",
      "Third-order deformation",
      "Ogden",
      "Arruda-Boyce",
      "Extended tube",
    ]);
    fireEvent.click(within(menu).getByRole("menuitem", { name: "Yeoh" }));
    expect(screen.queryByRole("menu")).toBeNull();
    expect(
      within(screen.getByRole("dialog")).getByLabelText("C₂₀"),
    ).toBeTruthy();
  });

  it("have the load cases and the constraints in menus (#454)", () => {
    const { tab, panel, command } = setup();
    tab("Loads & BCs");
    expect(
      within(panel())
        .getAllByRole("button")
        .map((b) => b.textContent),
    ).toEqual([
      "Boundary",
      "Load case ▾",
      "Symmetry",
      "Control point",
      "Rigid surface",
      "Constraints ▾",
      // a button of its own, for what comes of contacts
      "Contact",
      "Point load",
      "Pressure",
    ]);
    // the variants of one command, and three commands in one menu
    const labels = (name: string) => {
      fireEvent.click(command(name));
      const menu = screen.getByRole("menu", { name });
      return within(menu)
        .getAllByRole("menuitem")
        .map((i) => [
          i.querySelector(".menu-label")?.textContent,
          i.getAttribute("aria-disabled"),
        ]);
    };
    expect(labels("Load case")).toEqual([
      ["Uniaxial", null],
      ["Biaxial", null],
      ["Planar", null],
      ["Shear", null],
    ]);
    fireEvent.keyDown(screen.getByRole("menu"), { key: "Escape" });
    // a constraint that cannot be created yet is disabled, as a button is
    expect(labels("Constraints")).toEqual([
      ["Multi-point constraint", "true"],
      ["Cartesian constraint", "true"],
      ["Cylindrical constraint", "true"],
    ]);
    fireEvent.click(
      screen.getByRole("menuitem", { name: /^Cartesian constraint/ }),
    );
    expect(screen.queryByRole("dialog")).toBeNull();
    cleanup();

    const model = setup(new ModelStore(fixture as CommandList));
    model.tab("Loads & BCs");
    fireEvent.click(model.command("Constraints"));
    fireEvent.click(
      screen.getByRole("menuitem", { name: /^Cartesian constraint/ }),
    );
    expect(within(model.dialog()).getByRole("heading").textContent).toBe(
      "New Cartesian constraint",
    );
  });

  it("explain why a command is not available yet", () => {
    const { tab, command } = setup();
    const cells = command("Cell set of a mesh");
    expect(cells.getAttribute("aria-disabled")).toBe("true");
    expect(cells.getAttribute("title")).toBe("Create a mesh first.");
    fireEvent.click(cells);
    expect(screen.queryByRole("dialog")).toBeNull();
    tab("Sections");
    expect(command("Displacement (u)").getAttribute("title")).toBe(
      "Create a cell set and a material first.",
    );
  });

  it("open a dialog that creates and selects the object", () => {
    const { store, tab, command, dialog, field, create } = setup();
    tab("Materials");
    const opener = command("Hyperelasticity");
    opener.focus();
    fireEvent.click(opener);
    fireEvent.click(screen.getByRole("menuitem", { name: "Neo-Hooke" }));
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

  it("create a material of a script, whose file is chosen in its properties (ADR 0025)", () => {
    const { store, tab, command, dialog, field, create } = setup();
    tab("Materials");
    fireEvent.click(command("User-defined"));
    const menu = screen.getByRole("menu", { name: "User-defined" });
    expect(
      within(menu)
        .getAllByRole("menuitem")
        .map((i) => i.textContent),
    ).toEqual([
      "Constitutive model (Python)",
      // a strain energy function of a file (#424)
      "Strain energy function (Python)",
      // a strain-based function of a file (#425)
      "Strain-based function (Python)",
    ]);
    fireEvent.click(
      within(menu).getByRole("menuitem", {
        name: "Constitutive model (Python)",
      }),
    );
    expect(within(dialog()).getByRole("heading").textContent).toBe(
      "New material",
    );
    // by default with a volumetric part of its own
    expect(field("Volumetric part").checked).toBe(true);
    fireEvent.input(field("Script"), { target: { value: "soft.py" } });
    create();
    expect(store.commands).toEqual([
      {
        command: "material.script",
        name: "material_1",
        kind: "constitutive",
        file: "soft.py",
      },
    ]);
    const properties = screen.getByRole("region", { name: "Properties" });
    expect(properties.textContent).toContain("soft.py");
    expect(properties.textContent).toContain("not loaded");
    expect(
      within(properties).getByRole("button", { name: "Choose file…" }),
    ).toBeTruthy();
    // a minimal script to edit and choose (#423)
    expect(
      within(properties).getByRole("button", { name: "Download template" }),
    ).toBeTruthy();
  });

  it("create a strain energy function of a script (#424)", () => {
    const { store, tab, command, field, create } = setup();
    tab("Materials");
    fireEvent.click(command("User-defined"));
    fireEvent.click(
      screen.getByRole("menuitem", { name: "Strain energy function (Python)" }),
    );
    // the function of the file and the options of fem.Hyperelastic; its
    // arguments are fields once its file ran (#424)
    expect(field("Function").placeholder).toBe("strain_energy");
    expect(field("K")).toBeTruthy();
    expect(field("Mullins effect")).toBeTruthy();
    expect(field("State variables")).toBeTruthy();
    fireEvent.input(field("Script"), { target: { value: "soft.py" } });
    fireEvent.input(field("K"), { target: { value: "50" } });
    create();
    expect(store.commands).toEqual([
      {
        command: "material.script",
        name: "material_1",
        kind: "hyperelastic",
        file: "soft.py",
        bulk: 50,
      },
    ]);
    const properties = screen.getByRole("region", { name: "Properties" });
    expect(
      within(properties).getByRole("button", { name: "Download template" }),
    ).toBeTruthy();
  });

  it("create a section of the formulation of a button (ADR 0024)", () => {
    // the fixture without its sections: a linear-elastic and a NeoHooke material
    // without a bulk modulus, the latest
    const document = fixture as CommandList;
    const commands = document.commands.filter(
      (c) => c.command !== "section.add",
    );
    const { store, tab, command, dialog, field, create } = setup(
      new ModelStore({ ...document, commands: commands.slice(0, 5) }),
    );
    tab("Sections");
    // the ways of u-p-J in a menu (#420)
    fireEvent.click(command("Nearly incompressible"));
    const menu = screen.getByRole("menu", { name: "Nearly incompressible" });
    expect(
      within(menu)
        .getAllByRole("menuitem")
        .map((i) => i.textContent),
    ).toEqual([
      "Automatic",
      "Condensed per cell",
      "Mixed fields",
      "Three-field variation",
    ]);
    fireEvent.click(within(menu).getByRole("menuitem", { name: "Automatic" }));
    expect(field("Formulation").value).toBe("u-p-J");
    expect(field("Material").value).toBe("umat_soft");
    expect(field("Bulk modulus").value).toBe("5000");
    create();
    fireEvent.click(command("Displacement (u)"));
    // the latest material that the formulation takes
    expect(field("Material").value).toBe("umat_hard");
    expect(within(dialog()).queryByLabelText("Bulk modulus")).toBeNull();
    create();
    expect(store.commands.slice(5)).toEqual([
      {
        command: "section.add",
        name: "section_1",
        cellset: "hard",
        material: "umat_soft",
        formulation: "u-p-J",
        bulk: 5000,
      },
      {
        command: "section.add",
        name: "section_2",
        cellset: "soft",
        material: "umat_hard",
        formulation: "u",
      },
    ]);
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
      // a button of the ribbon, or an item of a menu of the ribbon (#136)
      const [menu, item] = button.split(" > ");
      fireEvent.click(command(menu));
      if (item) fireEvent.click(screen.getByRole("menuitem", { name: item }));
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
    add("Materials", "Hyperelasticity > Neo-Hooke (compressible)");
    add("Sections", "Displacement (u)");
    add("Loads & BCs", "Boundary", () =>
      fireEvent.change(field("Point set"), { target: { value: "points_1" } }),
    );
    add("Loads & BCs", "Boundary", () => {
      for (const axis of ["y", "z"]) fireEvent.click(field(axis));
    });
    add("Steps & Job", "Step", () => {
      fireEvent.click(field("Ramp"));
      fireEvent.input(field("End 1"), { target: { value: "0.5" } });
    });
    add("Steps & Job", "Job", () =>
      fireEvent.change(field("Curve"), {
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
      ramp: { num: 5, items: [{ target: "boundary_2", end: 0.5 }] },
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
