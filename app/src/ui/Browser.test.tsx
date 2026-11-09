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
  const properties = screen.getByRole("region", { name: "Properties" });
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
    expect(properties.textContent).toContain("job.add");
    fireEvent.keyDown(item("job_1"), { key: "Home" });
    expect(document.activeElement).toBe(item("Meshes"));
  });

  it("shows the properties of the selected object", () => {
    const { item, properties } = setup();
    expect(properties.textContent).toContain(
      "Select an object in the browser.",
    );
    fireEvent.click(item("umat_hard"));
    const field = (label: string) =>
      within(properties).getByLabelText(label) as HTMLInputElement;
    expect(field("Name").value).toBe("umat_hard");
    expect(field("Model").value).toBe("LinearElasticLargeStrain");
    expect(field("E").value).toBe("10");
    expect(properties.textContent).toContain("Used by section_hard");

    fireEvent.click(
      within(properties).getByRole("button", { name: "section_hard" }),
    );
    expect(item("section_hard").getAttribute("aria-selected")).toBe("true");
    expect(field("Formulation").value).toBe("u");
  });

  it("deletes unused objects only, with undo", () => {
    const { store, item, properties } = setup();
    fireEvent.click(item("umat_hard"));
    const remove = within(properties).getByRole("button", {
      name: /Delete/,
    }) as HTMLButtonElement;
    expect(remove.disabled).toBe(true);

    fireEvent.click(item("job_1"));
    fireEvent.click(within(properties).getByRole("button", { name: /Delete/ }));
    expect(store.get("job_1")).toBeUndefined();
    expect(properties.textContent).toContain(
      "Select an object in the browser.",
    );
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
    expect(
      within(properties).getByRole("list", { name: "Issues" }).textContent,
    ).toContain("unknown material 'missing'");
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
    expect(within(item("umat_soft")).queryByRole("button")).toBeNull();
  });
});
