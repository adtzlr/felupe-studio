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
