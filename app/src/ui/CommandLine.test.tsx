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
import { ModelStore } from "../core/store";
import { App } from "./App";

afterEach(cleanup);

function setup(store = new ModelStore(fixture as CommandList)) {
  render(<App store={store} />);
  const input = screen.getByRole("combobox", {
    name: "Command",
  }) as HTMLInputElement;
  const type = (text: string) =>
    fireEvent.input(input, { target: { value: text } });
  const key = (name: string) => fireEvent.keyDown(input, { key: name });
  const options = () =>
    screen
      .queryAllByRole("option")
      .map((option) => option.querySelector("code")?.textContent);
  const message = () => document.getElementById("command-message")!.textContent;
  const tree = screen.getByRole("tree", { name: "Model" });
  const selected = () =>
    within(tree)
      .getAllByRole("treeitem")
      .find((row) => row.getAttribute("aria-selected") === "true")
      ?.getAttribute("aria-label");
  return { store, input, type, key, options, message, selected };
}

describe("command line", () => {
  it("creates an object from JSON and selects it", async () => {
    const { store, input, type, key, message, selected } = setup();
    type(
      'material.add {"name": "rubber", "model": "NeoHooke", "parameters": {"mu": 0.5}}',
    );
    key("Enter");
    await waitFor(() => expect(message()).toBe("Created rubber."));
    expect(store.get("rubber")).toMatchObject({ parameters: { mu: 0.5 } });
    expect(input.value).toBe("");
    expect(selected()).toBe("rubber");
  });

  it("keeps a line with errors for correction", async () => {
    const { store, input, type, key, message } = setup();
    type('material.add {"parameters": {"mu": -1}}');
    key("Enter");
    await waitFor(() => expect(message()).toContain("Must be greater than 0."));
    expect(document.getElementById("command-message")!.className).toContain(
      "error",
    );
    expect(input.value).toBe('material.add {"parameters": {"mu": -1}}');
    expect(store.commands).toHaveLength(13);
  });

  it("completes with the arrow keys, Tab and Enter", () => {
    const { input, type, key, options } = setup();
    type("cell");
    expect(input.getAttribute("aria-expanded")).toBe("true");
    expect(options()).toEqual(["cellset.from_tag", "cellset.from_file"]);
    key("ArrowDown");
    key("ArrowDown");
    expect(input.getAttribute("aria-activedescendant")).toBe(
      "command-option-1",
    );
    key("Enter");
    expect(input.value).toBe("cellset.from_file ");
    // templates follow
    expect(options()).toEqual(['{"name":"cells_1","mesh":"specimen"}']);
    key("Tab");
    expect(input.value).toBe(
      'cellset.from_file {"name":"cells_1","mesh":"specimen"}',
    );
    expect(input.getAttribute("aria-expanded")).toBe("false");
    // Escape closes a list, or else clears the line
    type("cell");
    key("Escape");
    expect(input.getAttribute("aria-expanded")).toBe("false");
    expect(input.value).toBe("cell");
    key("Escape");
    expect(input.value).toBe("");
    expect(input.getAttribute("aria-expanded")).toBe("false");
  });

  it("selects a suggestion with the mouse", () => {
    const { input, type } = setup();
    type("select umat");
    fireEvent.mouseDown(screen.getByRole("option", { name: /umat_soft/ }));
    expect(input.value).toBe("select umat_soft");
  });

  it("opens the dialog of a command without JSON", async () => {
    const { type, key } = setup();
    type("section.add");
    key("Enter");
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByRole("heading").textContent).toBe("New section");
  });

  it("recalls entered lines with the arrow keys", async () => {
    const { input, type, key, message } = setup();
    type("select left");
    key("Enter");
    await waitFor(() => expect(message()).toBe("Selected left."));
    type("help");
    key("Enter");
    await waitFor(() => expect(message()).toContain("Tab completes"));
    key("ArrowUp");
    expect(input.value).toBe("help");
    key("ArrowUp");
    expect(input.value).toBe("select left");
    key("ArrowDown");
    expect(input.value).toBe("help");
    key("ArrowDown");
    expect(input.value).toBe("");
  });

  it("deletes and undoes", async () => {
    const { store, type, key, message } = setup();
    type("delete job_1");
    key("Enter");
    await waitFor(() => expect(message()).toBe("Deleted job_1."));
    expect(store.get("job_1")).toBeUndefined();
    type("undo");
    key("Enter");
    await waitFor(() => expect(message()).toBe("Undone."));
    expect(store.get("job_1")).toBeDefined();
  });
});

describe("history bar", () => {
  const history = () => screen.getByRole("region", { name: "History" });

  it("lists the commands and selects them", () => {
    setup();
    const items = within(history()).getAllByRole("button", { pressed: false });
    expect(items.map((b) => b.textContent)).toEqual([
      "specimen",
      "hard",
      "soft",
      "umat_hard",
      "umat_soft",
      "section_hard",
      "section_soft",
      "left",
      "right",
      "fixed",
      "move",
      "step_1",
      "job_1",
    ]);
    fireEvent.click(within(history()).getByRole("button", { name: "move" }));
    expect(
      within(history())
        .getByRole("button", { name: "move" })
        .getAttribute("aria-pressed"),
    ).toBe("true");
    const properties = screen.getByRole("region", { name: "Properties" });
    expect(
      (within(properties).getByLabelText("Name") as HTMLInputElement).value,
    ).toBe("move");
  });

  it("steps back and forward", () => {
    const { store } = setup();
    const back = within(history()).getByRole("button", {
      name: "Step back",
    }) as HTMLButtonElement;
    const forward = within(history()).getByRole("button", {
      name: "Step forward",
    }) as HTMLButtonElement;
    expect(back.disabled && forward.disabled).toBe(true);
    fireEvent.click(within(history()).getByRole("button", { name: "job_1" }));
    fireEvent.click(
      within(screen.getByRole("region", { name: "Properties" })).getByRole(
        "button",
        {
          name: /Delete/,
        },
      ),
    );
    expect(
      within(history()).queryByRole("button", { name: "job_1" }),
    ).toBeNull();
    fireEvent.click(back);
    expect(store.get("job_1")).toBeDefined();
    fireEvent.click(forward);
    expect(store.get("job_1")).toBeUndefined();
  });

  it("marks commands with issues", () => {
    const store = new ModelStore(fixture as CommandList);
    store.apply({ type: "remove", name: "umat_hard" });
    setup(store);
    const item = within(history()).getByRole("button", {
      name: /section_hard/,
    });
    expect(within(item).getByLabelText("has issues")).toBeTruthy();
  });
});
