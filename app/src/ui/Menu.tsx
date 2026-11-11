// A menu of the header (#126): a button that opens a list of actions and links, in
// sections. Keyboard: Enter, Space or ↓ open it on the first item, ↑ on the last;
// ↑/↓, Home and End move, Esc and Tab close it. The same list is the context menu
// of the browser (#138), at the pointer or at a row.
import { type ComponentChildren, Fragment } from "preact";
import { useEffect, useLayoutEffect, useRef, useState } from "preact/hooks";

export interface MenuItem {
  id: string;
  label: string;
  /** A second line, e.g. what an export contains. */
  hint?: string;
  /** Why the item cannot be used, if so; shown instead of the hint. */
  blocker?: string;
  /** The keyboard shortcut, e.g. "Ctrl+S", and its `aria-keyshortcuts` (#129). */
  shortcut?: { text: string; aria: string };
  /** An action, or a link opened in a new tab. */
  onSelect?: () => void;
  href?: string;
}

export interface MenuSection {
  /** A heading of the section, e.g. "Export". */
  label?: string;
  items: MenuItem[];
}

interface Props {
  /** The accessible name of the button and of the menu. */
  label: string;
  /** The content of the button: a text or an icon. */
  button: ComponentChildren;
  /** A tooltip of the button. */
  title?: string;
  /**
   * "text" for a menu of the menu bar, "icon" for an icon button, "ribbon" for a
   * button of the ribbon (#136), whose menu is placed in the window, as the ribbon
   * may scroll.
   */
  kind: "text" | "icon" | "ribbon";
  sections: MenuSection[];
  /** Show the hints of the items as a second line (otherwise as tooltips). */
  hints?: boolean;
}

/** A list of menu items in sections, open: focus, keyboard and closing. */
function MenuList({
  id,
  label,
  sections,
  hints,
  at,
  place,
  anchor,
  onClose,
}: {
  id: string;
  label: string;
  sections: MenuSection[];
  hints?: boolean;
  /** The item to focus first. */
  at: "first" | "last";
  /** A place in the window (fixed), or below the parent (absolute). */
  place?: { top: number; left: number };
  /** An element whose clicks do not close the menu, e.g. its button. */
  anchor?: { current: HTMLElement | null };
  /** Close the menu; `focus`: return the focus to where the menu was opened. */
  onClose: (focus: boolean) => void;
}) {
  const list = useRef<HTMLDivElement>(null);
  // a menu at a place stays in the window, e.g. at a row near the bottom
  const [shift, setShift] = useState({ top: 0, left: 0 });
  useLayoutEffect(() => {
    if (!place || !list.current) return;
    const rect = list.current.getBoundingClientRect();
    const margin = 8;
    setShift({
      top: Math.min(0, window.innerHeight - margin - rect.bottom),
      left: Math.min(0, window.innerWidth - margin - rect.right),
    });
  }, [place?.top, place?.left]);

  const items = () => [
    ...(list.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? []),
  ];

  useEffect(() => {
    const all = items();
    (at === "last" ? all.at(-1) : all[0])?.focus();
    const outside = (event: PointerEvent) => {
      const target = event.target as Node;
      if (list.current?.contains(target) || anchor?.current?.contains(target))
        return;
      onClose(false);
    };
    // Esc also closes the menu when the focus has left it, e.g. after a click
    const escape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault(); // not a shortcut of the app, e.g. clear the selection
      onClose(true);
    };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("keydown", escape);
    };
  }, []);

  const onMenuKey = (event: KeyboardEvent) => {
    const all = items();
    const index = all.indexOf(document.activeElement as HTMLElement);
    const move = (to: number) => all[(to + all.length) % all.length]?.focus();
    // the keys of the menu are not keys of its parent, e.g. of the tree
    event.stopPropagation();
    switch (event.key) {
      case "ArrowDown":
        move(index + 1);
        break;
      case "ArrowUp":
        move(index - 1);
        break;
      case "Home":
        move(0);
        break;
      case "End":
        move(all.length - 1);
        break;
      case "Escape":
        onClose(true);
        break;
      case "Tab":
        onClose(false);
        return;
      default:
        return;
    }
    event.preventDefault();
  };

  const select = (item: MenuItem) => {
    if (item.blocker) return;
    onClose(!item.href);
    item.onSelect?.();
  };

  return (
    <div
      ref={list}
      id={id}
      class={place ? "menu menu-fixed" : "menu"}
      style={
        place
          ? {
              top: `${Math.max(0, place.top + shift.top)}px`,
              left: `${Math.max(0, place.left + shift.left)}px`,
            }
          : undefined
      }
      role="menu"
      aria-label={label}
      onKeyDown={onMenuKey}
      // a click in the menu is not a click of its parent, e.g. of a tree row
      onClick={(event) => event.stopPropagation()}
      onContextMenu={(event) => event.preventDefault()}
    >
      {sections.map((section, s) => (
        <Fragment key={section.label ?? s}>
          {s > 0 && <div role="separator" class="menu-separator" />}
          <div role="group" aria-label={section.label}>
            {section.label && (
              <div class="menu-heading" aria-hidden="true">
                {section.label}
              </div>
            )}
            {section.items.map((item) => {
              const note = item.blocker ?? item.hint;
              const content = (
                <>
                  <span class="menu-label">{item.label}</span>
                  {item.shortcut && (
                    <kbd class="menu-shortcut" aria-hidden="true">
                      {item.shortcut.text}
                    </kbd>
                  )}
                  {hints && note && (
                    <span id={`${id}-${item.id}-hint`} class="menu-hint">
                      {note}
                    </span>
                  )}
                </>
              );
              const common = {
                role: "menuitem" as const,
                class: "menu-item",
                tabIndex: -1,
                title: hints ? undefined : note,
                "aria-disabled": item.blocker ? true : undefined,
                "aria-keyshortcuts": item.shortcut?.aria,
                "aria-describedby":
                  hints && note ? `${id}-${item.id}-hint` : undefined,
              };
              return item.href ? (
                <a
                  key={item.id}
                  {...common}
                  href={item.href}
                  target="_blank"
                  rel="noopener"
                  onClick={() => select(item)}
                >
                  {content}
                </a>
              ) : (
                <button
                  key={item.id}
                  type="button"
                  {...common}
                  onClick={() => select(item)}
                >
                  {content}
                </button>
              );
            })}
          </div>
        </Fragment>
      ))}
    </div>
  );
}

const menuId = (label: string) =>
  `menu-${label.toLowerCase().replace(/\W+/g, "-")}`;

export function Menu({ label, button, title, kind, sections, hints }: Props) {
  const [open, setOpen] = useState<false | "first" | "last">(false);
  const [place, setPlace] = useState<{ top: number; left: number }>();
  const trigger = useRef<HTMLButtonElement>(null);
  const id = menuId(label);

  /** Open the menu, below the button of the ribbon in the window. */
  const show = (at: "first" | "last") => {
    if (kind === "ribbon" && trigger.current) {
      const rect = trigger.current.getBoundingClientRect();
      setPlace({ top: rect.bottom + 6, left: rect.left });
    }
    setOpen(at);
  };

  const close = (focus = true) => {
    setOpen(false);
    if (focus) trigger.current?.focus();
  };

  const onButtonKey = (event: KeyboardEvent) => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      show(event.key === "ArrowDown" ? "first" : "last");
    }
  };

  return (
    <div class="menu-root">
      <button
        ref={trigger}
        type="button"
        class={
          kind === "icon"
            ? "icon-button"
            : kind === "ribbon"
              ? "ribbon-button"
              : "menu-button"
        }
        aria-label={kind === "icon" ? label : undefined}
        title={title}
        aria-haspopup="menu"
        aria-expanded={open !== false}
        aria-controls={open ? id : undefined}
        onClick={() => (open ? close(false) : show("first"))}
        onKeyDown={onButtonKey}
      >
        {button}
      </button>
      {open && (
        <MenuList
          id={id}
          label={label}
          sections={sections}
          hints={hints}
          at={open}
          place={kind === "ribbon" ? place : undefined}
          anchor={trigger}
          onClose={close}
        />
      )}
    </div>
  );
}

/**
 * A context menu at a place in the window (#138), e.g. at the pointer of a right
 * click or below a ⋯ button; `onClose` gets whether to return the focus.
 */
export function ContextMenu({
  label,
  sections,
  place,
  anchor,
  onClose,
}: {
  label: string;
  sections: MenuSection[];
  place: { top: number; left: number };
  anchor?: { current: HTMLElement | null };
  onClose: (focus: boolean) => void;
}) {
  return (
    <MenuList
      id={menuId(`context ${label}`)}
      label={label}
      sections={sections}
      at="first"
      place={place}
      anchor={anchor}
      onClose={onClose}
    />
  );
}
