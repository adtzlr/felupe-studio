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
import { SaveAsDialog } from "./SaveAsDialog";

afterEach(cleanup);

describe("Save project as (#205)", () => {
  it("refuses a name of an archive whose script is a mesh script", () => {
    const commands = [
      { command: "mesh.script", name: "rubber", file: "bushing.py" },
    ] as Command[];
    const onSave = vi.fn();
    render(
      <SaveAsDialog
        fileName="bushing.felupe.zip"
        commands={commands}
        files={new MeshFiles()}
        scriptAvailable
        onSave={onSave}
        onClose={() => {}}
      />,
    );
    const dialog = screen.getByRole("dialog", { name: "Save project as" });
    const save = within(dialog).getByRole("button", {
      name: "Save",
    }) as HTMLButtonElement;
    // without the script, the archive has one file bushing.py
    expect(save.disabled).toBe(false);
    fireEvent.click(within(dialog).getByLabelText(/Include the Python script/));
    expect(dialog.textContent).toContain(
      "bushing.py is a mesh script of the project",
    );
    expect(save.disabled).toBe(true);
    fireEvent.input(within(dialog).getByLabelText("Name"), {
      target: { value: "bushing_radial" },
    });
    expect(save.disabled).toBe(false);
    fireEvent.click(save);
    expect(onSave).toHaveBeenCalledWith({
      name: "bushing_radial.felupe.zip",
      script: true,
    });
  });
});
