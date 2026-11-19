// @vitest-environment happy-dom
// The app of a brand (ADR 0020): its name, its links, its welcome text and its
// units, read from the JSON block of the page; based on FElupe Studio.
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/preact";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Brand } from "../brand";
import { ModelStore } from "../core/store";

const acme: Brand = {
  brand_version: 1,
  name: "ACME FEM",
  short_name: "ACME",
  welcome: "Simulate the rubber parts of ACME.",
  links: {
    help: "https://fem.acme.example/help",
    issues: "mailto:fem@acme.example",
    source: "https://gitlab.acme.example/fem/brand",
  },
  defaults: { units: { length: "mm", force: "N" } },
};

beforeEach(() => {
  // the JSON block that the build writes into index.html
  const block = document.createElement("script");
  block.type = "application/json";
  block.id = "brand";
  block.textContent = JSON.stringify(acme);
  document.head.append(block);
  vi.resetModules();
});

afterEach(() => {
  cleanup();
  document.getElementById("brand")?.remove();
  vi.resetModules();
});

/** The modules of the app with the brand of the page. */
async function app() {
  return {
    App: (await import("./App")).App,
    form: await import("../core/form"),
    project: await import("../core/project"),
    brand: await import("../brand"),
  };
}

const list = (async (url: string | URL | Request) =>
  String(url).endsWith("samples/index.json")
    ? new Response("[]")
    : new Response("", { status: 404 })) as typeof fetch;

describe("the app of a brand (ADR 0020)", () => {
  it("has the name, the links and the welcome text of the brand", async () => {
    const { App } = await app();
    render(<App store={new ModelStore()} fetchSample={list} />);
    const welcome = screen.getByRole("region", { name: "Welcome to ACME FEM" });
    expect(welcome.textContent).toContain(
      "Simulate the rubber parts of ACME. Python runs here in the browser",
    );
    expect(
      within(welcome).getByRole("link", { name: "User guide" }),
    ).toHaveProperty("href", "https://fem.acme.example/help");
    // a brand without a tutorial and a command reference has no links to them
    expect(
      within(welcome).queryByRole("link", { name: "Tutorial" }),
    ).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Help" }));
    const help = screen.getByRole("menu", { name: "Help" });
    const items = within(help)
      .getAllByRole("menuitem")
      .map((item) => item.querySelector(".menu-label")?.textContent);
    expect(items).not.toContain("Command reference");
    expect(items).toContain("About ACME FEM");

    fireEvent.click(screen.getByRole("menuitem", { name: "About ACME FEM" }));
    const about = screen.getByRole("dialog", { name: "ACME FEM" });
    // based on FElupe Studio, with its license; the source of the brand
    expect(about.textContent).toContain(
      `Based on FElupe Studio ${__APP_VERSION__}.`,
    );
    expect(
      within(about).getByRole("link", { name: "FElupe Studio" }),
    ).toHaveProperty("href", "https://github.com/adtzlr/felupe-studio");
    expect(
      within(about).getByRole("link", { name: "Source code" }),
    ).toHaveProperty("href", "https://gitlab.acme.example/fem/brand");
    expect(
      within(about).getByRole("link", { name: "GPL-3.0-or-later" }),
    ).toBeTruthy();
  });

  it("gives new model settings its units", async () => {
    const { form } = await app();
    const draft = form.initialDraft("model.settings", {
      commands: [],
    } as unknown as Parameters<typeof form.initialDraft>[1]);
    expect(draft.units).toEqual({ length: "mm", force: "N" });
  });

  it("names itself in the messages of a project of a newer version", async () => {
    const { project, brand } = await app();
    expect(brand.appName()).toBe("ACME FEM");
    expect(project.newerMessage(["`mesh.circle`"], "0.8.0")).toContain(
      "which ACME FEM 0.8.0 does not know",
    );
  });
});

describe("the default brand", () => {
  it("is FElupe Studio without a based on", async () => {
    document.getElementById("brand")?.remove();
    const { App } = await app();
    render(<App store={new ModelStore()} fetchSample={list} />);
    fireEvent.click(screen.getByRole("button", { name: "Help" }));
    fireEvent.click(
      screen.getByRole("menuitem", { name: "About FElupe Studio" }),
    );
    const about = screen.getByRole("dialog", { name: "FElupe Studio" });
    expect(about.textContent).not.toContain("Based on");
  });
});
