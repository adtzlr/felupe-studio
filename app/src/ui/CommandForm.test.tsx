// @vitest-environment happy-dom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/preact";
import { afterEach, describe, expect, it, vi } from "vitest";
import fixture from "../../../tests/data/two_sections.json";
import type { Command, CommandList } from "../core/commands";
import { initialDraft } from "../core/form";
import { ModelStore } from "../core/store";
import { App } from "./App";
import { CommandForm } from "./CommandForm";

afterEach(cleanup);

/** The app with the fixture, one object selected in the browser. */
function edit(name: string) {
  const store = new ModelStore(fixture as CommandList);
  render(<App store={store} />);
  const tree = screen.getByRole("tree", { name: "Model" });
  fireEvent.click(within(tree).getByRole("treeitem", { name }));
  const properties = screen.getByRole("region", { name: "Properties" });
  const field = <T extends HTMLElement = HTMLInputElement>(label: string) =>
    within(properties).getByLabelText(label) as T;
  const button = (label: string) =>
    within(properties).getByRole("button", {
      name: label,
    }) as HTMLButtonElement;
  const type = (label: string, text: string) =>
    fireEvent.input(field(label), { target: { value: text } });
  const choose = (label: string, value: string) =>
    fireEvent.change(field(label), { target: { value } });
  return { store, tree, properties, field, button, type, choose };
}

describe("editing in the properties panel", () => {
  it("applies a changed value as one undo step", () => {
    const { store, field, button, type } = edit("umat_hard");
    expect(button("Apply").disabled).toBe(true);

    type("E", "20.5");
    expect(button("Apply").disabled).toBe(false);
    fireEvent.click(button("Apply"));
    expect(store.get("umat_hard")).toMatchObject({
      parameters: { E: 20.5, nu: 0.3 },
    });
    expect(field("E").value).toBe("20.5");
    expect(button("Apply").disabled).toBe(true);

    act(() => store.undo());
    expect(field("E").value).toBe("10");
  });

  it("shows errors and does not apply invalid values", () => {
    const { store, properties, field, button, type } = edit("umat_hard");
    type("ν", "0.5");
    expect(properties.textContent).toContain("Must be less than 0.5.");
    expect(field("ν").getAttribute("aria-invalid")).toBe("true");
    fireEvent.click(button("Apply"));
    expect(store.get("umat_hard")).toMatchObject({ parameters: { nu: 0.3 } });
    expect(document.activeElement).toBe(field("ν"));

    type("ν", "0,3");
    expect(properties.textContent).toContain(
      "with a point as decimal separator",
    );
    type("ν", "");
    expect(properties.textContent).toContain("Required.");
    // partly typed numbers stay as typed
    type("ν", "1e-");
    expect(field("ν").value).toBe("1e-");
    type("ν", "1e-2");
    expect(properties.textContent).not.toContain("decimal separator");
    fireEvent.click(button("Apply"));
    expect(store.get("umat_hard")).toMatchObject({ parameters: { nu: 0.01 } });
  });

  it("resets the form", () => {
    const { field, button, type } = edit("umat_hard");
    type("E", "99");
    fireEvent.click(button("Reset"));
    expect(field("E").value).toBe("10");
    expect(button("Apply").disabled).toBe(true);
  });

  it("renames an object, its references and keeps it selected", () => {
    const { store, tree, properties, field, button, type } = edit("umat_hard");
    type("Name", "umat_soft");
    expect(properties.textContent).toContain(
      "The name 'umat_soft' is already used.",
    );
    type("Name", "steel");
    fireEvent.click(button("Apply"));

    expect(store.get("umat_hard")).toBeUndefined();
    expect(store.get("section_hard")).toMatchObject({ material: "steel" });
    expect(store.issues).toEqual([]);
    const row = within(tree).getByRole("treeitem", { name: "steel" });
    expect(row.getAttribute("aria-selected")).toBe("true");
    expect(field("Name").value).toBe("steel");

    act(() => store.undo());
    expect(store.get("section_hard")).toMatchObject({ material: "umat_hard" });
  });

  it("switches the material model and its parameters", () => {
    const { store, properties, field, button, choose } = edit("umat_soft");
    expect(field("K").value).toBe("");
    expect(field("K").placeholder).toBe("none");
    choose("Model", "NeoHookeCompressible");
    expect(field("μ").value).toBe("1");
    expect(field("λ").value).toBe("2");
    expect(within(properties).queryByLabelText("K")).toBeNull();
    fireEvent.click(button("Apply"));
    expect(store.get("umat_soft")).toEqual({
      command: "material.add",
      name: "umat_soft",
      model: "NeoHookeCompressible",
      parameters: { mu: 1, lmbda: 2 },
    });
  });

  it("shows the bulk modulus only for the mixed formulation", () => {
    const { store, properties, field, button, choose } = edit("section_soft");
    expect(field("Bulk modulus").value).toBe("5000");
    // the volumetric part of the strain energy (#134), default volume ratio
    const volumetric = field<HTMLSelectElement>("Volumetric part");
    expect([...volumetric.options].map((o) => o.textContent)).toEqual([
      "Volume ratio: K/2 (J − 1)² (default)",
      "Stretch: 9K/2 (J^⅓ − 1)²",
      "Logarithm: K/2 ln(J)²",
    ]);
    choose("Volumetric part", "log");
    fireEvent.click(button("Apply"));
    expect(store.get("section_soft")).toMatchObject({ volumetric: "log" });
    choose("Formulation", "u");
    expect(within(properties).queryByLabelText("Bulk modulus")).toBeNull();
    expect(within(properties).queryByLabelText("Volumetric part")).toBeNull();
    fireEvent.click(button("Apply"));
    expect(store.get("section_soft")).not.toHaveProperty("bulk");
    expect(store.get("section_soft")).not.toHaveProperty("volumetric");
    // NeoHooke without a bulk modulus now needs attention
    expect(
      within(properties).getByRole("list", { name: "Issues" }).textContent,
    ).toContain("without a bulk modulus");
  });

  it("offers the objects of a kind as references", () => {
    const { store, field, button, choose } = edit("section_hard");
    const options = [...field<HTMLSelectElement>("Material").options].map(
      (o) => o.value,
    );
    expect(options).toEqual(["umat_hard", "umat_soft"]);
    choose("Cell set", "soft");
    fireEvent.click(button("Apply"));
    expect(store.get("section_hard")).toMatchObject({ cellset: "soft" });
  });

  it("offers a material that was created later (#80)", () => {
    const { store, field, button, choose } = edit("section_hard");
    act(() =>
      store.apply({
        type: "add",
        command: {
          command: "material.add",
          name: "later",
          model: "NeoHooke",
          parameters: { mu: 2, bulk: 5000 },
        },
      }),
    );
    const options = [...field<HTMLSelectElement>("Material").options].map(
      (o) => o.value,
    );
    expect(options).toEqual(["umat_hard", "umat_soft", "later"]);
    choose("Material", "later");
    fireEvent.click(button("Apply"));
    expect(store.get("section_hard")).toMatchObject({ material: "later" });
    // the section moved behind the material; the model has no issues
    const names = store.commands.map((c) => c.name);
    expect(names.indexOf("section_hard")).toBeGreaterThan(
      names.indexOf("later"),
    );
    expect(store.issues).toEqual([]);
    expect(field<HTMLSelectElement>("Material").value).toBe("later");
    act(() => store.undo());
    expect(store.get("section_hard")).toMatchObject({ material: "umat_hard" });
  });

  it("edits checkbox groups, optional groups and variants", () => {
    const boundary = edit("fixed");
    fireEvent.click(boundary.field("y"));
    fireEvent.click(boundary.button("Apply"));
    expect(boundary.store.get("fixed")).toMatchObject({
      constrained: ["x", "z"],
    });
    for (const axis of ["x", "z"]) fireEvent.click(boundary.field(axis));
    expect(boundary.properties.textContent).toContain("Select at least one.");
    cleanup();

    const step = edit("step_1");
    expect(step.field("Increments").value).toBe("5");
    // the ramped items are rows: a new row takes the other boundary
    expect(step.field<HTMLSelectElement>("Item 1").value).toBe("move");
    expect(step.field("End 1").value).toBe("0.5");
    const add = step.button("+ Add row");
    fireEvent.click(add);
    expect(step.field<HTMLSelectElement>("Item 2").value).toBe("fixed");
    expect(add.disabled).toBe(true);
    // a boundary is offered in one row only
    const options = (label: string) =>
      [...step.field<HTMLSelectElement>(label).options].map((o) => o.value);
    expect(options("Item 1")).toEqual(["move"]);
    step.type("End 2", "-0.1");
    fireEvent.click(step.button("Apply"));
    expect(step.store.get("step_1")).toMatchObject({
      ramp: {
        num: 5,
        items: [
          { target: "move", start: 0, end: 0.5 },
          { target: "fixed", end: -0.1 },
        ],
      },
    });
    fireEvent.click(step.button("Remove row 1"));
    expect(step.button("Remove row 1").disabled).toBe(true);
    step.type("End 1", "");
    expect(step.properties.textContent).toContain("End 1: Required.");
    fireEvent.click(step.field("Ramp"));
    expect(within(step.properties).queryByLabelText("Increments")).toBeNull();
    fireEvent.click(step.field("section_soft"));
    fireEvent.click(step.button("Apply"));
    expect(step.store.get("step_1")).toEqual({
      command: "step.add",
      name: "step_1",
      sections: ["section_soft"],
    });
    cleanup();

    const points = edit("left");
    points.choose("Select", "ids");
    points.type("Point ids", "4, 8 15");
    fireEvent.click(points.button("Apply"));
    expect(points.store.get("left")).toMatchObject({
      select: { ids: [4, 8, 15] },
    });
    expect(points.field("Point ids").value).toBe("4, 8, 15");

    // nodes by their coordinates, one per line (#92)
    points.choose("Select", "points");
    const nodes = points.field<HTMLTextAreaElement>("Nodes");
    expect(nodes.tagName).toBe("TEXTAREA");
    points.type("Nodes", "0, 0, 0\n3 1");
    fireEvent.click(points.button("Apply"));
    expect(points.properties.textContent).toContain(
      "Line 2: enter three numbers x, y, z",
    );
    points.type("Nodes", "0, 0, 0\n3 1 1\n");
    fireEvent.click(points.button("Apply"));
    expect(points.store.get("left")).toMatchObject({
      select: {
        points: [
          [0, 0, 0],
          [3, 1, 1],
        ],
      },
    });
    expect(points.field("Nodes").value).toBe("0, 0, 0\n3, 1, 1");
  });
});

describe("the settings of a job (#133)", () => {
  it("switch the cutback and set its parameters", () => {
    const { store, properties, field, button, type } = edit("job_1");
    expect(field("Max. iterations").placeholder).toBe("16");
    // the parameters of the cutback only with the cutback
    expect(within(properties).queryByLabelText("Factor")).toBeNull();
    fireEvent.click(field("Cutback"));
    expect(properties.textContent).toContain(
      "Retries a substep that does not converge with smaller increments",
    );
    expect(field("Factor").placeholder).toBe("0.5");
    expect(field("Max. cutbacks").placeholder).toBe("10");
    expect(field("Growth").placeholder).toBe("2");
    fireEvent.click(button("Apply"));
    expect(store.get("job_1")).toMatchObject({ cutback: {} });

    type("Factor", "1");
    fireEvent.click(button("Apply"));
    expect(properties.textContent).toContain("Must be less than 1.");
    expect(store.get("job_1")).toMatchObject({ cutback: {} });
    type("Factor", "0.25");
    type("Max. cutbacks", "4");
    type("Max. iterations", "30");
    fireEvent.click(button("Apply"));
    expect(store.get("job_1")).toMatchObject({
      maxiter: 30,
      cutback: { factor: 0.25, max_cutbacks: 4 },
    });

    fireEvent.click(field("Cutback"));
    expect(within(properties).queryByLabelText("Factor")).toBeNull();
    fireEvent.click(button("Apply"));
    expect(store.get("job_1")).not.toHaveProperty("cutback");
  });
});

describe("units of the model (#132)", () => {
  it("are shown at the labels and the rows", () => {
    const settings = {
      command: "model.settings",
      name: "settings",
      units: { length: "mm", force: "N" },
    } as Command;
    const list = fixture as CommandList;
    const store = new ModelStore({
      ...list,
      commands: [settings, ...list.commands],
    });
    render(<App store={store} />);
    const tree = screen.getByRole("tree", { name: "Model" });
    const properties = () => screen.getByRole("region", { name: "Properties" });
    const select = (name: string) =>
      fireEvent.click(within(tree).getByRole("treeitem", { name }));
    select("umat_hard");
    expect(within(properties()).getByLabelText("E [MPa]")).toBeTruthy();
    expect(within(properties()).getByLabelText("ν")).toBeTruthy();
    select("left");
    expect(within(properties()).getByLabelText("Coordinate [mm]")).toBeTruthy();
    select("move");
    expect(within(properties()).getByLabelText("Value [mm]")).toBeTruthy();
    select("step_1");
    expect(
      [...properties().querySelectorAll(".unit")].map((u) => u.textContent),
    ).toEqual(["mm", "mm"]);

    // the units of the settings are those of the form, before applying
    select("settings");
    fireEvent.change(within(properties()).getByLabelText("Length"), {
      target: { value: "m" },
    });
    fireEvent.click(
      within(properties()).getByRole("button", { name: "Apply" }),
    );
    expect(store.get("settings")).toMatchObject({
      units: { length: "m", force: "N" },
    });
    select("umat_hard");
    expect(within(properties()).getByLabelText("E [Pa]")).toBeTruthy();
  });
});

describe("a form for a new object", () => {
  it("shows errors of untouched fields only after submitting", () => {
    const context = { commands: (fixture as CommandList).commands };
    const onSubmit = vi.fn();
    const onCancel = vi.fn();
    render(
      <CommandForm
        type="mesh.import"
        initial={initialDraft("mesh.import", context)}
        context={context}
        submitLabel="Create"
        onSubmit={onSubmit}
        onCancel={onCancel}
      />,
    );
    const form = screen.getByRole("form");
    expect((screen.getByLabelText("Name") as HTMLInputElement).value).toBe(
      "mesh_1",
    );
    expect(form.textContent).not.toContain("Required.");

    fireEvent.submit(form);
    expect(form.textContent).toContain("Required.");
    expect(onSubmit).not.toHaveBeenCalled();

    fireEvent.input(screen.getByLabelText("File"), {
      target: { value: "part.msh" },
    });
    fireEvent.submit(form);
    expect(onSubmit).toHaveBeenCalledWith({
      command: "mesh.import",
      name: "mesh_1",
      file: "part.msh",
    });
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onCancel).toHaveBeenCalled();
  });
});

describe("load cases", () => {
  it("are created with checkboxes for their flags", () => {
    const store = new ModelStore(fixture as CommandList);
    render(<App store={store} />);
    fireEvent.click(screen.getByRole("tab", { name: "Loads & BCs" }));
    fireEvent.click(screen.getByRole("button", { name: "Planar" }));
    const dialog = screen.getByRole("dialog");
    const symmetry = within(dialog).getByLabelText(
      "Symmetry planes",
    ) as HTMLInputElement;
    const clamped = within(dialog).getByLabelText(
      "Clamped",
    ) as HTMLInputElement;
    // the defaults of fem.dof
    expect(symmetry.checked).toBe(true);
    expect(clamped.checked).toBe(false);
    // the default axes are not listed twice
    const options = (label: string) =>
      [
        ...(within(dialog).getByLabelText(label) as HTMLSelectElement).options,
      ].map((o) => o.text);
    expect(options("Axis")).toEqual(["x (default)", "y", "z"]);
    expect(options("Second axis")).toEqual(["y (default)", "x", "z"]);
    fireEvent.click(clamped);
    fireEvent.click(symmetry);
    fireEvent.click(within(dialog).getByRole("button", { name: "Create" }));
    expect(store.commands.at(-1)).toEqual({
      command: "loadcase.add",
      name: "loadcase_1",
      type: "planar",
      clamped: true,
      symmetry: false,
    });
    const tree = screen.getByRole("tree", { name: "Model" });
    expect(
      within(tree).getByRole("treeitem", { name: /loadcase_1/ }).textContent,
    ).toContain("planar x, y · clamped · no symmetry");
  });
});
