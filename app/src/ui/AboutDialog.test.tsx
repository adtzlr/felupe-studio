// @vitest-environment happy-dom
import { cleanup, render, screen } from "@testing-library/preact";
import { afterEach, describe, expect, it } from "vitest";
import { AboutDialog, wheelVersion } from "./AboutDialog";
import { type Runtime, runtimeText } from "./hooks";

afterEach(cleanup);

describe("about", () => {
  it("reads the versions of the wheels", () => {
    const wheels = [
      "wheels/felupe-12.0.0-py3-none-any.whl",
      "wheels/meshio-5.3.5-py3-none-any.whl",
    ];
    expect(wheelVersion("meshio", wheels)).toBe("5.3.5");
    expect(wheelVersion("tensortrax", wheels)).toBeUndefined();
    expect(wheelVersion("tensortrax")).toMatch(/^\d+\.\d+/);
  });
});

describe("the local runtime (#240)", () => {
  const local = (felupe_studio = __APP_VERSION__): Runtime => ({
    state: "ready",
    local: true,
    seconds: 1.25,
    ready: {
      versions: {
        python: "3.13.1",
        felupe: "12.1.0",
        numpy: "2.5",
        scipy: "1.18",
        felupe_studio,
        runtime: "python",
      },
      timings: { pyodide: 0, packages: 0, felupe: 1, total: 1 },
    },
  });

  it("is named in the status bar", () => {
    expect(runtimeText({ state: "loading", local: true })).toBe(
      "Starting the local Python …",
    );
    expect(runtimeText(local())).toBe(
      "FElupe 12.1.0 ready, local Python 3.13.1 (1.3 s)",
    );
    expect(runtimeText(local("0.0.1"))).toBe(
      `FElupe 12.1.0 ready, local Python 3.13.1 (1.3 s) · package 0.0.1, app ${__APP_VERSION__}`,
    );
    expect(
      runtimeText({ state: "error", local: true, message: "Not reachable." }),
    ).toBe("Not reachable.");
    expect(runtimeText({ state: "loading" })).toBe(
      "Loading Python and FElupe …",
    );
  });

  it("shows its versions, and a package of another version", () => {
    render(<AboutDialog runtime={local("0.0.1")} onClose={() => {}} />);
    const versions = screen.getByLabelText("Versions").textContent;
    expect(versions).toContain(
      "RuntimePython of this computer (felupe-studio serve)",
    );
    expect(versions).toContain("felupe-studio0.0.1");
    expect(versions).not.toContain("Pyodide");
    expect(screen.getByRole("note").textContent).toContain(
      "The package felupe-studio 0.0.1 of the runtime differs from this app",
    );
  });
});
