// @vitest-environment happy-dom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/preact";
import { afterEach, describe, expect, it } from "vitest";
import fixture from "../../../tests/data/two_sections.json";
import type { CommandList, SectionAdd } from "../core/commands";
import { ModelStore } from "../core/store";
import { App } from "./App";

afterEach(cleanup);

function setup() {
  const store = new ModelStore(fixture as CommandList);
  render(<App store={store} />);
  const tree = screen.getByRole("tree", { name: "Model" });
  const item = (name: string) => within(tree).getByRole("treeitem", { name });
  // the properties panel opens when an object is selected (#83)
  const properties = () => screen.getByRole("region", { name: "Properties" });
  return { store, tree, item, properties };
}

const labels = (tree: HTMLElement) =>
  within(tree)
    .getAllByRole("treeitem")
    .map(
      (row) =>
        `${"  ".repeat(Number(row.getAttribute("aria-level")) - 1)}${row.getAttribute("aria-label")}`,
    );

describe("Browser", () => {
  it("shows the groups with their objects, cell sets below their mesh", () => {
    const { tree, item } = setup();
    expect(labels(tree)).toEqual([
      "Meshes",
      "  specimen",
      "    hard",
      "    soft",
      "Point Sets",
      "  left",
      "  right",
      "Materials",
      "  umat_hard",
      "  umat_soft",
      "Sections",
      "  section_hard",
      "  section_soft",
      "Boundaries",
      "  fixed",
      "  move",
      "Steps",
      "  step_1",
      "Jobs",
      "  job_1",
    ]);
    expect(item("Sections").textContent).toContain("2");
    expect(item("section_soft").textContent).toContain("umat_soft · u-p-J");
  });

  it("expands and collapses groups with the mouse and the keyboard", () => {
    const { tree, item } = setup();
    fireEvent.click(item("Materials"));
    expect(item("Materials").getAttribute("aria-expanded")).toBe("false");
    expect(
      within(tree).queryByRole("treeitem", { name: "umat_hard" }),
    ).toBeNull();

    fireEvent.keyDown(item("Materials"), { key: "ArrowRight" });
    expect(item("umat_hard")).toBeTruthy();
    fireEvent.keyDown(item("specimen"), { key: "ArrowLeft" });
    expect(within(tree).queryByRole("treeitem", { name: "hard" })).toBeNull();
    fireEvent.keyDown(item("specimen"), { key: "ArrowRight" });
    expect(item("hard")).toBeTruthy();
  });

  it("moves the focus with the arrow keys and selects with Enter", () => {
    const { item, properties } = setup();
    item("Meshes").focus();
    fireEvent.keyDown(item("Meshes"), { key: "ArrowDown" });
    expect(document.activeElement).toBe(item("specimen"));
    fireEvent.keyDown(item("specimen"), { key: "ArrowDown" });
    expect(document.activeElement).toBe(item("hard"));
    fireEvent.keyDown(item("hard"), { key: "ArrowLeft" });
    expect(document.activeElement).toBe(item("specimen"));
    fireEvent.keyDown(item("specimen"), { key: "End" });
    expect(document.activeElement).toBe(item("job_1"));
    fireEvent.keyDown(item("job_1"), { key: "Enter" });
    expect(item("job_1").getAttribute("aria-selected")).toBe("true");
    expect(properties().textContent).toContain("job.add");
    fireEvent.keyDown(item("job_1"), { key: "Home" });
    expect(document.activeElement).toBe(item("Meshes"));
  });

  it("shows the properties of the selected object", () => {
    const { item, properties } = setup();
    expect(screen.queryByRole("region", { name: "Properties" })).toBeNull();
    fireEvent.click(item("umat_hard"));
    const field = (label: string) =>
      within(properties()).getByLabelText(label) as HTMLInputElement;
    expect(field("Name").value).toBe("umat_hard");
    expect(field("Model").value).toBe("LinearElasticLargeStrain");
    expect(field("E").value).toBe("10");
    expect(properties().textContent).toContain("Used by section_hard");

    fireEvent.click(
      within(properties()).getByRole("button", { name: "section_hard" }),
    );
    expect(item("section_hard").getAttribute("aria-selected")).toBe("true");
    expect(field("Formulation").value).toBe("u");
  });

  it("deletes unused objects only, with undo", () => {
    const { store, item, properties } = setup();
    fireEvent.click(item("umat_hard"));
    const remove = within(properties()).getByRole("button", {
      name: /Delete/,
    }) as HTMLButtonElement;
    expect(remove.disabled).toBe(true);

    fireEvent.click(item("job_1"));
    fireEvent.click(
      within(properties()).getByRole("button", { name: /Delete/ }),
    );
    expect(store.get("job_1")).toBeUndefined();
    // nothing is selected: the panel is closed
    expect(screen.queryByRole("region", { name: "Properties" })).toBeNull();
    act(() => store.undo());
    expect(item("job_1")).toBeTruthy();
  });

  it("marks objects with issues and their groups", () => {
    const { store, item, properties } = setup();
    act(() =>
      store.apply({
        type: "update",
        name: "section_hard",
        command: {
          ...(store.get("section_hard") as SectionAdd),
          material: "missing",
        },
      }),
    );
    expect(within(item("section_hard")).getByLabelText("1 issue")).toBeTruthy();
    expect(within(item("Sections")).getByLabelText("1 issue")).toBeTruthy();
    fireEvent.click(item("section_hard"));
    // at the field of the reference (#137)
    expect(
      properties().querySelector("#field-material-error")!.textContent,
    ).toBe(
      "section.add 'section_hard' references unknown material 'missing' in 'material'.",
    );
  });

  it("toggles the visibility of objects", () => {
    const { item } = setup();
    const eye = within(item("section_soft")).getByRole("button", {
      name: "Hide section_soft",
    });
    expect(eye.getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(eye);
    const show = within(item("section_soft")).getByRole("button", {
      name: "Show section_soft",
    });
    expect(show.getAttribute("aria-pressed")).toBe("false");
    // toggling does not select
    expect(item("section_soft").getAttribute("aria-selected")).toBe("false");
    // a material has no visibility, only the button of its menu
    expect(
      within(item("umat_soft"))
        .getAllByRole("button")
        .map((b) => b.getAttribute("aria-label")),
    ).toEqual(["Actions of umat_soft"]);
  });
});

describe("context menu of an object (#138)", () => {
  const menu = () => screen.getByRole("menu");
  const entries = () =>
    within(menu())
      .getAllByRole("menuitem")
      .map(
        (i) =>
          `${i.querySelector(".menu-label")!.textContent}${i.getAttribute("aria-disabled") ? " (disabled)" : ""}`,
      );

  it("opens with a right click and duplicates an object after the original", () => {
    const { store, tree, item } = setup();
    fireEvent.contextMenu(item("umat_soft"), { clientX: 40, clientY: 200 });
    // the menu is at the pointer; the object is not selected by it
    expect(item("umat_soft").getAttribute("aria-selected")).toBe("false");
    expect(menu().style.top).toBe("200px");
    expect(entries()).toEqual(["Duplicate", "Rename", "Delete (disabled)"]);
    expect(
      within(menu())
        .getByRole("menuitem", { name: /Delete/ })
        .getAttribute("title"),
    ).toBe("Used by section_soft: delete these first.");
    expect(document.activeElement).toBe(
      within(menu()).getAllByRole("menuitem")[0],
    );

    fireEvent.click(
      within(menu()).getByRole("menuitem", { name: /Duplicate/ }),
    );
    expect(screen.queryByRole("menu")).toBeNull();
    const names = store.commands.map((c) => c.name);
    expect(names.indexOf("umat_soft_2")).toBe(names.indexOf("umat_soft") + 1);
    expect(store.get("umat_soft_2")).toEqual({
      ...store.get("umat_soft"),
      name: "umat_soft_2",
    });
    // references are not copied: the section keeps the original
    expect(store.get("section_soft")).toMatchObject({ material: "umat_soft" });
    expect(item("umat_soft_2").getAttribute("aria-selected")).toBe("true");
    expect(labels(tree)).toContain("  umat_soft_2");
    // one undo step
    act(() => store.undo());
    expect(store.get("umat_soft_2")).toBeUndefined();
  });

  it("hides, renames and deletes from the ⋯ button, closes with Esc", () => {
    const { store, item } = setup();
    const more = within(item("job_1")).getByRole("button", {
      name: "Actions of job_1",
    });
    expect(more.getAttribute("aria-haspopup")).toBe("menu");
    fireEvent.click(more);
    expect(entries()).toEqual(["Duplicate", "Rename", "Delete"]);
    fireEvent.keyDown(menu(), { key: "Escape" });
    expect(screen.queryByRole("menu")).toBeNull();
    expect(document.activeElement).toBe(item("job_1"));

    // show and hide an object with a visibility
    fireEvent.click(
      within(item("section_hard")).getByRole("button", {
        name: "Actions of section_hard",
      }),
    );
    fireEvent.click(within(menu()).getByRole("menuitem", { name: /Hide/ }));
    expect(
      within(item("section_hard")).getByRole("button", {
        name: "Show section_hard",
      }),
    ).toBeTruthy();

    // delete an object that nothing uses
    fireEvent.click(more);
    fireEvent.click(within(menu()).getByRole("menuitem", { name: /Delete/ }));
    expect(store.get("job_1")).toBeUndefined();
  });

  it("opens with Shift+F10 at the focused object and renames it", () => {
    const { item, properties } = setup();
    item("move").focus();
    fireEvent.keyDown(item("move"), { key: "F10", shiftKey: true });
    // the keys of the menu do not move in the tree
    fireEvent.keyDown(menu(), { key: "ArrowDown" });
    expect(document.activeElement?.textContent).toContain("Rename");
    fireEvent.click(document.activeElement!);
    expect(screen.queryByRole("menu")).toBeNull();
    expect(properties()).toBeTruthy();
  });

  it("duplicates the selected object with Ctrl+D and hides it with H", () => {
    const { store, item } = setup();
    fireEvent.click(item("fixed"));
    fireEvent.keyDown(window, { key: "d", ctrlKey: true });
    expect(store.get("fixed_2")).toMatchObject({
      command: "boundary.add",
      pointset: "left",
    });
    expect(item("fixed_2").getAttribute("aria-selected")).toBe("true");
    fireEvent.keyDown(window, { key: "h" });
    expect(
      within(item("fixed_2")).getByRole("button", { name: "Show fixed_2" }),
    ).toBeTruthy();
    fireEvent.keyDown(window, { key: "h" });
    expect(
      within(item("fixed_2")).getByRole("button", { name: "Hide fixed_2" }),
    ).toBeTruthy();
  });
});

describe("properties panel (#83)", () => {
  it("opens with a selection, closes and opens again", () => {
    const { item, properties } = setup();
    const panel = () => screen.queryByRole("region", { name: "Properties" });
    const body = () => document.querySelector(".body")!;
    expect(panel()).toBeNull();
    expect(body().classList.contains("inspecting")).toBe(false);

    fireEvent.click(item("umat_hard"));
    expect(properties().textContent).toContain("material.add");
    expect(body().classList.contains("inspecting")).toBe(true);
    // the browser has the left sidebar for itself
    expect(
      screen
        .getByRole("navigation", { name: "Model browser" })
        .closest(".sidebar")
        ?.querySelector(".properties"),
    ).toBeNull();

    fireEvent.click(
      within(properties()).getByRole("button", {
        name: "Close the properties",
      }),
    );
    expect(panel()).toBeNull();
    // the selection stays, a click on the object opens the panel again
    expect(item("umat_hard").getAttribute("aria-selected")).toBe("true");
    fireEvent.click(item("umat_hard"));
    expect(
      (within(properties()).getByLabelText("Name") as HTMLInputElement).value,
    ).toBe("umat_hard");

    // a click in the history bar selects and opens as well
    fireEvent.click(
      within(properties()).getByRole("button", {
        name: "Close the properties",
      }),
    );
    const history = screen.getByRole("region", { name: "History" });
    fireEvent.click(within(history).getByRole("button", { name: /job_1/ }));
    expect(properties().textContent).toContain("job.add");

    // the Results workspace has no properties panel
    fireEvent.click(screen.getByRole("button", { name: "Results" }));
    expect(panel()).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Model" }));
    expect(properties().textContent).toContain("job.add");
  });
});
