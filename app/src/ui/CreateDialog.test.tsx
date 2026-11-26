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
import { ribbonGroups } from "../core/ribbon";
import type { FileData, Save, SaveRequest } from "../core/save";
import { ModelStore } from "../core/store";
import { TEMPLATES } from "../core/templates";
import { CreateDialog } from "./CreateDialog";

afterEach(cleanup);

/** The item of the ribbon of a kind of a material of a file, e.g. `strain`. */
const itemOf = (id: string) => {
  const item = ribbonGroups("materials")
    .flat()
    .find((i) => i.id === id);
  if (!item) throw new Error(`no item ${id}`);
  return item;
};

/**
 * The dialog of a new object of a ribbon item, with a fake of the save dialog that
 * records the saved files and answers with the name of `chosen` (default the
 * suggested one), or with a cancelled dialog if `chosen` is null.
 */
function setup(id: string, chosen?: string | null) {
  const store = new ModelStore();
  const saved: { request: SaveRequest; text: string }[] = [];
  const save = vi.fn<Save>(async (request, make) => {
    if (chosen === null) return undefined;
    const name = chosen ?? request.name;
    const data: FileData = await make(name);
    saved.push({
      request,
      text: typeof data === "string" ? data : await data.text(),
    });
    return { name };
  });
  const onCreated = vi.fn();
  render(
    <CreateDialog
      item={itemOf(id)}
      store={store}
      onClose={() => {}}
      onCreated={onCreated}
      save={save}
    />,
  );
  const dialog = screen.getByRole("dialog");
  const field = (label: string) =>
    within(dialog).getByLabelText(label) as HTMLInputElement;
  const link = () =>
    within(dialog).getByRole("button", { name: "Download template" });
  return { store, save, saved, dialog, field, link };
}

describe("Download template in the dialog of a new material of a file (#453)", () => {
  it("is a link in the hint of Script, with material.py as the example", () => {
    const { field, link } = setup("material.script:strain");
    expect(field("Script").placeholder).toBe("e.g. material.py");
    const hint = document.getElementById(
      field("Script").getAttribute("aria-describedby") ?? "",
    );
    expect(hint?.textContent).toBe(
      "A Python file opened with the project, e.g. of Download template",
    );
    expect(hint?.contains(link())).toBe(true);
    expect(
      document.getElementById(
        field("Function").getAttribute("aria-describedby") ?? "",
      )?.textContent,
    ).toBe("The function of the file, e.g. of the template");
  });

  it("saves the template of the kind as material.py, which Script takes", async () => {
    const { store, saved, field, link, dialog } = setup(
      "material.script:strain",
    );
    fireEvent.click(link());
    await waitFor(() => expect(field("Script").value).toBe("material.py"));
    expect(saved).toEqual([
      {
        request: { name: "material.py", kind: "project" },
        text: TEMPLATES.strain,
      },
    ]);
    // the material refers to the saved file
    fireEvent.click(within(dialog).getByRole("button", { name: "Create" }));
    expect(store.commands).toEqual([
      {
        command: "material.script",
        name: "material_1",
        kind: "strain",
        file: "material.py",
      },
    ]);
  });

  it("saves the template of the chosen kind under the name in Script", async () => {
    const { saved, field, link } = setup("material.script:strain");
    fireEvent.input(field("Script"), { target: { value: "rubber.py" } });
    // another kind, another template; the name stays
    fireEvent.change(field("Kind"), { target: { value: "hyperelastic" } });
    fireEvent.click(link());
    await waitFor(() => expect(saved).toHaveLength(1));
    expect(saved[0]).toEqual({
      request: { name: "rubber.py", kind: "project" },
      text: TEMPLATES.hyperelastic,
    });
    expect(field("Script").value).toBe("rubber.py");
  });

  it("takes the name of the save dialog, and nothing of a cancelled one", async () => {
    const renamed = setup("material.script:constitutive", "soft_rubber.py");
    fireEvent.click(renamed.link());
    await waitFor(() =>
      expect(renamed.field("Script").value).toBe("soft_rubber.py"),
    );
    expect(renamed.saved[0].text).toBe(TEMPLATES.constitutive);
    cleanup();

    const cancelled = setup("material.script:constitutive", null);
    fireEvent.click(cancelled.link());
    await waitFor(() => expect(cancelled.save).toHaveBeenCalledOnce());
    expect(cancelled.field("Script").value).toBe("");
  });

  it("says why the template was not saved", async () => {
    const { save, field, link, dialog } = setup("material.script:strain");
    save.mockRejectedValueOnce(new Error("The disk is full."));
    fireEvent.click(link());
    await waitFor(() =>
      expect(dialog.textContent).toContain(
        "The template was not saved: The disk is full.",
      ),
    );
    expect(field("Script").value).toBe("");
  });

  it("is no link of another command", () => {
    const { dialog } = setup("material.add:NeoHooke");
    expect(
      within(dialog).queryByRole("button", { name: "Download template" }),
    ).toBeNull();
  });
});
