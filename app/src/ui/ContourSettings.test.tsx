// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from "@testing-library/preact";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_CONTOUR } from "../core/contour";
import { ContourSettings } from "./ContourSettings";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("the popover of the contour settings", () => {
  it("stays inside the window", () => {
    // a narrow window, the button near its right edge, a popover of 320 px
    vi.spyOn(window, "innerWidth", "get").mockReturnValue(400);
    vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockReturnValue(320);
    render(<ContourSettings settings={DEFAULT_CONTOUR} onChange={() => {}} />);
    const button = screen.getByRole("button", { name: "Contour settings" });
    button.getBoundingClientRect = () =>
      ({ left: 350, bottom: 40, right: 380, top: 10 }) as DOMRect;
    fireEvent.click(button);
    const popover = screen.getByRole("dialog", { name: "Contour settings" });
    expect(popover.style.left).toBe("72px");
    expect(popover.style.top).toBe("46px");
  });
});

describe("the sections of an automatic range (#377)", () => {
  /** The popover with the sections of the results and a stored choice. */
  function open(chosen?: string[], settings = DEFAULT_CONTOUR) {
    const onChoose = vi.fn();
    const onChange = vi.fn();
    const view = render(
      <ContourSettings
        settings={settings}
        onChange={onChange}
        sections={["soft_body", "inner", "outer"]}
        chosen={chosen}
        onChoose={onChoose}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Contour settings" }));
    const box = (name: string) =>
      screen.getByRole("checkbox", { name }) as HTMLInputElement;
    return { onChoose, onChange, box, view };
  }

  it("are all sections by default, or the chosen ones", () => {
    const { onChoose, box } = open();
    expect(screen.getByRole("group", { name: "Range of" })).toBeTruthy();
    expect(box("All sections").checked).toBe(true);
    expect(box("soft_body").checked).toBe(false);
    fireEvent.click(box("soft_body"));
    expect(onChoose).toHaveBeenLastCalledWith(["soft_body"]);
    // all sections stay chosen until a section is
    fireEvent.click(box("All sections"));
    expect(box("All sections").checked).toBe(true);
    expect(onChoose).toHaveBeenCalledTimes(1);
  });

  it("add and remove a section, in the order of the model", () => {
    // a removed section of the stored choice is not shown as chosen
    const { onChoose, box } = open(["outer", "gone"]);
    expect(box("All sections").checked).toBe(false);
    expect(box("outer").checked).toBe(true);
    expect(
      screen.getByText(/values of the other sections outside of the range/),
    ).toBeTruthy();
    fireEvent.click(box("soft_body"));
    expect(onChoose).toHaveBeenLastCalledWith(["soft_body", "outer"]);
    fireEvent.click(box("outer"));
    // none left: all sections
    expect(onChoose).toHaveBeenLastCalledWith([]);
    fireEvent.click(box("All sections"));
    expect(onChoose).toHaveBeenLastCalledWith([]);
  });

  it("are all sections when all of them are chosen, and with Defaults", () => {
    const { onChoose, onChange, box } = open(["soft_body", "inner"]);
    fireEvent.click(box("outer"));
    expect(onChoose).toHaveBeenLastCalledWith([]);
    // a choice is a change: Defaults takes all sections again
    fireEvent.click(screen.getByRole("button", { name: "Defaults" }));
    expect(onChange).toHaveBeenLastCalledWith(DEFAULT_CONTOUR);
    expect(onChoose).toHaveBeenLastCalledWith([]);
  });

  it("are not offered for a manual range or a single section", () => {
    const manual = { ...DEFAULT_CONTOUR, range: "manual" as const };
    open(["inner"], manual);
    expect(screen.queryByRole("group", { name: "Range of" })).toBeNull();
    cleanup();
    render(
      <ContourSettings
        settings={DEFAULT_CONTOUR}
        onChange={() => {}}
        sections={["body"]}
        onChoose={() => {}}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Contour settings" }));
    expect(screen.queryByRole("group", { name: "Range of" })).toBeNull();
  });
});
