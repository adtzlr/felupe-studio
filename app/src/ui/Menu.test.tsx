// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from "@testing-library/preact";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ContextMenu, Menu, type MenuSection, fitShift } from "./Menu";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const sections: MenuSection[] = [
  {
    items: [
      { id: "dark", label: "Dark", checked: true },
      { id: "light", label: "Light", checked: false },
    ],
  },
];

/** A window of `width` × `height`. */
function inWindow(width: number, height = 800) {
  vi.spyOn(window, "innerWidth", "get").mockReturnValue(width);
  vi.spyOn(window, "innerHeight", "get").mockReturnValue(height);
}

/**
 * The layout of a menu of `width` × `height`: below its button at `left` and `top`
 * of the window, moved by its transform, or at the place of its style.
 */
function layout(left: number, top: number, width = 340, height = 200) {
  const px = (value: string | undefined) => Number.parseFloat(value ?? "") || 0;
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
    function (this: HTMLElement) {
      const rect = (x: number, y: number, w: number, h: number) =>
        ({
          x,
          y,
          left: x,
          top: y,
          right: x + w,
          bottom: y + h,
          width: w,
          height: h,
        }) as DOMRect;
      if (this.getAttribute("role") !== "menu") return rect(0, 0, 0, 0);
      if (this.style.left)
        return rect(px(this.style.left), px(this.style.top), width, height);
      const shift = /translateX\((.+)px\)/.exec(this.style.transform)?.[1];
      return rect(left + px(shift), top, width, height);
    },
  );
}

const theme = () =>
  render(<Menu label="Theme" button="T" kind="icon" end sections={sections} />);
const open = (name: string) =>
  fireEvent.click(screen.getByRole("button", { name }));
const menu = () => screen.getByRole("menu");

describe("a menu stays in the window (#402)", () => {
  it("is shifted only where it starts or ends outside", () => {
    // fits: not moved
    expect(fitShift(8, 300, 390)).toBe(0);
    expect(fitShift(50, 382, 390)).toBe(0);
    // starts left of the window: to the right
    expect(fitShift(-43, 297, 390)).toBe(51);
    // ends right of the window: to the left
    expect(fitShift(100, 440, 390)).toBe(-58);
    // wider than the window: its start stays in it
    expect(fitShift(100, 600, 390)).toBe(-92);
  });

  it("moves the theme menu to the right on a phone", () => {
    // it opens to the left from its button at 297 px of a window of 390 px
    inWindow(390);
    layout(-43, 50);
    theme();
    open("Theme");
    expect(menu().classList.contains("menu-end")).toBe(true);
    expect(menu().style.transform).toBe("translateX(51px)");
  });

  it("moves a menu at the right edge to the left", () => {
    inWindow(360);
    layout(100, 50, 300);
    render(<Menu label="Help" button="Help" kind="text" sections={sections} />);
    open("Help");
    expect(menu().style.transform).toBe("translateX(-48px)");
  });

  it("does not move a menu that fits, e.g. on a desktop", () => {
    inWindow(1280);
    layout(900, 50);
    theme();
    open("Theme");
    expect(menu().style.transform).toBe("");
  });

  it("moves an open menu again when the window changes", () => {
    inWindow(1280);
    layout(900, 50);
    theme();
    open("Theme");
    expect(menu().style.transform).toBe("");
    // the window narrower, the button nearer: the rect of the menu without shift
    inWindow(390);
    layout(-43, 50);
    fireEvent(window, new Event("resize"));
    expect(menu().style.transform).toBe("translateX(51px)");
    // and wide again
    inWindow(1280);
    layout(900, 50);
    fireEvent(window, new Event("resize"));
    expect(menu().style.transform).toBe("");
  });

  it("keeps a context menu at a place inside, at every edge", () => {
    // at a row near the bottom right, and at a pointer left of the window
    inWindow(390, 600);
    layout(0, 0, 220, 160);
    const { unmount } = render(
      <ContextMenu
        label="umat"
        sections={sections}
        place={{ top: 500, left: 300 }}
        onClose={() => {}}
      />,
    );
    expect(menu().style.left).toBe("162px");
    expect(menu().style.top).toBe("432px");
    unmount();
    render(
      <ContextMenu
        label="umat"
        sections={sections}
        place={{ top: 4, left: -10 }}
        onClose={() => {}}
      />,
    );
    expect(menu().style.left).toBe("8px");
    expect(menu().style.top).toBe("8px");
  });
});
