// @vitest-environment happy-dom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/preact";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Command, MaterialScript } from "../core/commands";
import { inspectMaterials, MeshFiles } from "../core/meshfiles";
import type { Save } from "../core/save";
import { TEMPLATES } from "../core/templates";
import type { MaterialInfo } from "../worker/protocol";
import { FileStatus, madeMaterial } from "./FileStatus";

afterEach(cleanup);

const material: MaterialScript = {
  command: "material.script",
  name: "rubber",
  kind: "constitutive",
  file: "soft.py",
};
const commands: Command[] = [
  { command: "parameter.add", name: "mu", value: 1 },
  material,
];

/** The status of the material, its script run in a fake of Python. */
function setup(
  answer: MaterialInfo,
  save: Save = vi.fn(async () => undefined),
) {
  const files = new MeshFiles(undefined, {
    write: async () => {},
    inspect: async () => answer,
  });
  render(
    <FileStatus
      command={material}
      commands={commands}
      files={files}
      save={save}
    />,
  );
  // like the app, once the file is written
  const choose = async () => {
    await files.add("soft.py", new Uint8Array([1]));
    inspectMaterials(commands, files);
  };
  return { files, save, choose };
}

describe("the script of a material in its properties (#423)", () => {
  it("says what its umat is", () => {
    expect(madeMaterial({ file: "soft.py", type: "NeoHooke" })).toBe(
      "umat: NeoHooke · no state variables",
    );
    expect(
      madeMaterial({ file: "soft.py", type: "OgdenRoxburgh", statevars: 1 }),
    ).toBe("umat: OgdenRoxburgh · 1 state variable");
    expect(
      madeMaterial({
        file: "soft.py",
        type: "MaterialStrain(linear_elastic_plastic_isotropic_hardening)",
        statevars: 28,
      }),
    ).toBe(
      "umat: MaterialStrain(linear_elastic_plastic_isotropic_hardening) · 28 state variables",
    );
  });

  it("shows what its run with the parameters made", async () => {
    const { choose } = setup({
      file: "soft.py",
      type: "NeoHooke",
      statevars: 0,
    });
    expect(screen.getByText("not loaded")).toBeTruthy();
    await choose();
    await waitFor(() =>
      expect(
        screen.getByText("umat: NeoHooke · no state variables"),
      ).toBeTruthy(),
    );
    expect(screen.queryByText("not loaded")).toBeNull();
    expect(screen.getByRole("button", { name: "Replace file…" })).toBeTruthy();
  });

  it("shows the error of its run with the traceback of the script", async () => {
    const traceback =
      'Traceback (most recent call last):\n  File "soft.py", line 3, in <module>\n';
    const { choose } = setup({
      file: "soft.py",
      error: "NameError: name 'bulk' is not defined",
      traceback,
    });
    await choose();
    await waitFor(() =>
      expect(
        screen.getByText("NameError: name 'bulk' is not defined"),
      ).toBeTruthy(),
    );
    expect(screen.getByText("Traceback of the script")).toBeTruthy();
    expect(document.querySelector(".traceback pre")!.textContent).toBe(
      traceback,
    );
  });

  it("downloads its template under the name of its file", async () => {
    let content: string | undefined;
    const save = vi.fn<Save>(async (request, make) => {
      content = await (make(request.name) as Blob).text();
      return { name: request.name };
    });
    setup({ file: "soft.py", type: "NeoHooke" }, save);
    fireEvent.click(screen.getByRole("button", { name: "Download template" }));
    await waitFor(() => expect(save).toHaveBeenCalledOnce());
    expect(save.mock.calls[0][0]).toEqual({ name: "soft.py", kind: "project" });
    expect(content).toBe(TEMPLATES.constitutive);
    expect(content).toContain("umat = fem.NeoHooke(mu=mu, bulk=bulk)");
  });

  it.each([
    // a strain energy function (#424) and a strain-based function (#425)
    ["hyperelastic", "def strain_energy(C, mu):"],
    ["strain", "def material(dε, εn, σn, ζn, E, nu, **kwargs):"],
  ] as const)(
    "downloads the template of a function of the kind %s",
    async (kind, line) => {
      let content: string | undefined;
      const save = vi.fn<Save>(async (request, make) => {
        content = await (make(request.name) as Blob).text();
        return { name: request.name };
      });
      const files = new MeshFiles();
      render(
        <FileStatus
          command={{ ...material, kind }}
          commands={commands}
          files={files}
          save={save}
        />,
      );
      fireEvent.click(
        screen.getByRole("button", { name: "Download template" }),
      );
      await waitFor(() => expect(save).toHaveBeenCalledOnce());
      expect(content).toBe(TEMPLATES[kind]);
      expect(content).toContain(line);
    },
  );

  it("says why its template was not saved", async () => {
    const save = vi.fn<Save>(async () => {
      throw new Error("The disk is full.");
    });
    setup({ file: "soft.py", type: "NeoHooke" }, save);
    fireEvent.click(screen.getByRole("button", { name: "Download template" }));
    await waitFor(() =>
      expect(
        screen.getByText("The template was not saved: The disk is full."),
      ).toBeTruthy(),
    );
  });

  it("is not offered for a mesh", () => {
    const files = new MeshFiles();
    render(
      <FileStatus
        command={{ command: "mesh.script", name: "spring", file: "spring.py" }}
        commands={[]}
        files={files}
        save={vi.fn()}
      />,
    );
    expect(screen.getByRole("button", { name: "Choose file…" })).toBeTruthy();
    expect(
      screen.queryByRole("button", { name: "Download template" }),
    ).toBeNull();
  });
});
