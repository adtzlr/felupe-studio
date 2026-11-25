// @vitest-environment happy-dom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/preact";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Command } from "../core/commands";
import { MeshFiles } from "../core/meshfiles";
import { ModelStore } from "../core/store";
import { ParametersDialog } from "./ParametersDialog";

const commands: Command[] = [
  {
    command: "model.settings",
    name: "settings",
    units: { length: "mm", force: "N" },
  },
  {
    command: "parameter.add",
    name: "radius",
    value: 50,
    quantity: "length",
    min: 10,
    max: 100,
    step: 5,
    description: "Radius of the disc",
  },
  {
    command: "parameter.add",
    name: "layers",
    value: 3,
    integer: true,
    min: 1,
    max: 10,
  },
  { command: "parameter.add", name: "gamma", value: 0.5 },
  { command: "mesh.script", name: "spring", file: "spring.py" },
];

afterEach(cleanup);

async function setup(
  opening = true,
  more: Command[] = [],
  local = false,
  base: Command[] = commands,
) {
  const store = new ModelStore({
    schema_version: 3,
    commands: [...base, ...more],
  });
  const files = new MeshFiles(undefined, { write: async () => {} });
  await files.add("spring.py", new TextEncoder().encode("mesh = None\n"));
  const onClose = vi.fn();
  render(
    <ParametersDialog
      store={store}
      files={files}
      project="spring.felupe.zip"
      opening={opening}
      local={local}
      onClose={onClose}
    />,
  );
  const dialog = screen.getByRole("dialog");
  return { store, onClose, dialog };
}

describe("the parameters of a project (#183)", () => {
  it("show their values with units, ranges and sliders", async () => {
    const { dialog } = await setup();
    const radius = within(dialog).getByRole("spinbutton", {
      name: /Radius of the disc/,
    }) as HTMLInputElement;
    expect(radius.value).toBe("50");
    expect(radius.step).toBe("5");
    expect(dialog.textContent).toContain("10 to 100 mm");
    expect(dialog.textContent).toContain("1 to 10, an integer");
    // a slider with a range, none without
    expect(
      within(dialog).getByLabelText("Radius of the disc (slider)"),
    ).toBeTruthy();
    expect(within(dialog).queryByLabelText("gamma (slider)")).toBeNull();
    // the slider sets the value
    fireEvent.input(within(dialog).getByLabelText("layers (slider)"), {
      target: { value: "5" },
    });
    expect(
      (
        within(dialog).getByRole("spinbutton", {
          name: /^layers/,
        }) as HTMLInputElement
      ).value,
    ).toBe("5");
  });

  it("show a derived parameter with its value, not a field (ADR 0021)", async () => {
    // a derived parameter is computed from the others, not set
    const { dialog } = await setup(true, [
      {
        command: "parameter.add",
        name: "total",
        value: "layers * radius",
        quantity: "length",
        description: "Total height",
      },
    ]);
    expect(
      within(dialog).queryByRole("spinbutton", { name: /^Total/ }),
    ).toBeNull();
    expect(within(dialog).getAllByRole("spinbutton")).toHaveLength(3);
    const derived = within(dialog).getByRole("group", {
      name: "Derived parameters",
    });
    const value = within(derived).getByRole("status", { name: "Total height" });
    expect(value.textContent).toBe("150 mm");
    expect(derived.textContent).toContain("= layers * radius");
    // its value follows the typed values of the free parameters
    fireEvent.input(within(dialog).getByLabelText("layers (slider)"), {
      target: { value: "5" },
    });
    expect(value.textContent).toBe("250 mm");
  });

  it("open with the changed values as one undo step", async () => {
    const { store, onClose, dialog } = await setup();
    fireEvent.input(
      within(dialog).getByRole("spinbutton", { name: /Radius of the disc/ }),
      {
        target: { value: "52" },
      },
    );
    fireEvent.input(
      within(dialog).getByRole("spinbutton", { name: /^layers/ }),
      {
        target: { value: "4" },
      },
    );
    fireEvent.click(within(dialog).getByRole("button", { name: "Open" }));
    expect(onClose).toHaveBeenCalled();
    // a value between the steps of the slider (5) is fine
    expect(store.get("radius")).toMatchObject({ value: 52 });
    expect(store.get("layers")).toMatchObject({ value: 4 });
    store.undo();
    expect(store.get("radius")).toMatchObject({ value: 50 });
    expect(store.get("layers")).toMatchObject({ value: 3 });
  });

  it("check the values before they are applied", async () => {
    const { store, dialog } = await setup();
    const layers = within(dialog).getByRole("spinbutton", { name: /^layers/ });
    const open = within(dialog).getByRole("button", { name: "Open" });
    fireEvent.input(layers, { target: { value: "2.5" } });
    expect(dialog.textContent).toContain(
      "the value of an integer parameter is an integer.",
    );
    expect((open as HTMLButtonElement).disabled).toBe(true);
    fireEvent.input(layers, { target: { value: "11" } });
    expect(dialog.textContent).toContain(
      "the value is larger than the maximum.",
    );
    fireEvent.input(layers, { target: { value: "" } });
    expect(dialog.textContent).toContain("Enter a number.");
    fireEvent.input(layers, { target: { value: "3" } });
    expect((open as HTMLButtonElement).disabled).toBe(false);
    // unchanged values change nothing
    fireEvent.click(open);
    expect(store.canUndo).toBe(false);
  });

  it("keep the saved values, or cancel later", async () => {
    const opened = await setup();
    fireEvent.input(
      within(opened.dialog).getByRole("spinbutton", { name: /^layers/ }),
      {
        target: { value: "4" },
      },
    );
    fireEvent.click(
      within(opened.dialog).getByRole("button", {
        name: "Keep the saved values",
      }),
    );
    expect(opened.onClose).toHaveBeenCalled();
    expect(opened.store.get("layers")).toMatchObject({ value: 3 });
  });

  it("say that the project runs its scripts, and show them", async () => {
    const { dialog } = await setup(false);
    const note = within(dialog).getByRole("note", {
      name: "Scripts of the project",
    });
    expect(note.textContent).toContain(
      "makes its meshes with a Python script, which runs in this browser",
    );
    fireEvent.click(within(note).getByRole("button", { name: "Show" }));
    expect(note.querySelector("pre")!.textContent).toBe("mesh = None\n");
    expect(within(dialog).getByRole("button", { name: "Apply" })).toBeTruthy();
    expect(within(dialog).getByRole("button", { name: "Cancel" })).toBeTruthy();
  });
});

describe("the scripts of the materials of a project (ADR 0025)", () => {
  it("are shown with the scripts of the meshes", async () => {
    const soft: Command = {
      command: "material.script",
      name: "soft",
      kind: "constitutive",
      file: "soft.py",
    };
    const { dialog } = await setup(false, [soft]);
    const note = within(dialog).getByRole("note", {
      name: "Scripts of the project",
    });
    expect(note.textContent).toContain(
      "makes its meshes and materials with Python scripts, which run in this browser",
    );
    // the script of the material is not loaded yet
    expect(note.textContent).toContain("soft.py not loaded");
  });
});

describe("the parameters and the expressions (#242)", () => {
  const more: Command[] = [
    {
      command: "pointset.add",
      name: "top",
      select: { axis: "z", value: "layers * 10" },
    },
    {
      command: "boundary.add",
      name: "move",
      pointset: "top",
      constrained: ["x"],
    },
    {
      command: "step.add",
      name: "step",
      ramp: { num: "2 * layers - 4", items: [{ target: "move", end: 1 }] },
    },
  ];

  it("show the objects that use a parameter", async () => {
    const { dialog } = await setup(false, more);
    expect(dialog.textContent).toContain(
      "1 to 10, an integer · used by top, step",
    );
    expect(dialog.textContent).not.toContain("used by top, step, ");
  });

  it("show the problems of the expressions with the typed values", async () => {
    const { store, dialog } = await setup(false, more);
    const layers = within(dialog).getByRole("spinbutton", { name: /^layers/ });
    fireEvent.input(layers, { target: { value: "2" } });
    const note = within(dialog).getByRole("note", {
      name: "Problems of the expressions",
    });
    expect(note.textContent).toContain(
      "'ramp.num' of 'step': '2 * layers - 4' is 0, it must be at least 1.",
    );
    fireEvent.input(layers, { target: { value: "4" } });
    expect(
      within(dialog).queryByRole("note", {
        name: "Problems of the expressions",
      }),
    ).toBeNull();
    // the problems do not keep the values from being applied
    fireEvent.input(layers, { target: { value: "2" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Apply" }));
    expect(store.get("layers")).toMatchObject({ value: 2 });
    expect(store.issues.map((i) => i.name)).toEqual(["step"]);
  });
});

describe("the scripts in the local runtime (#240)", () => {
  it("run on this computer", async () => {
    const { dialog } = await setup(true, [], true);
    expect(dialog.textContent).toContain(
      "on this computer with your rights, in the local Python of felupe-studio serve",
    );
  });

  it("are shown before they run, also without parameters", async () => {
    const scripts = commands.filter((c) => c.command !== "parameter.add");
    const { dialog, onClose } = await setup(true, [], true, scripts);
    expect(
      within(dialog).getByRole("heading", { name: "Open spring.felupe.zip" }),
    ).toBeTruthy();
    expect(dialog.textContent).not.toContain("Set the values");
    expect(
      within(dialog).queryByRole("button", { name: "Keep the saved values" }),
    ).toBeNull();
    fireEvent.click(within(dialog).getByRole("button", { name: "Open" }));
    expect(onClose).toHaveBeenCalled();
  });
});
