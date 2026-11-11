// A menu of the header (#126): a button that opens a list of actions and links, in
// sections. Keyboard: Enter, Space or ↓ open it on the first item, ↑ on the last;
// ↑/↓, Home and End move, Esc and Tab close it.
import { type ComponentChildren, Fragment } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";

export interface MenuItem {
  id: string;
  label: string;
  /** A second line, e.g. what an export contains. */
  hint?: string;
  /** Why the item cannot be used, if so; shown instead of the hint. */
  blocker?: string;
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
  /** "text" for a menu of the menu bar, "icon" for an icon button. */
  kind: "text" | "icon";
  sections: MenuSection[];
  /** Show the hints of the items as a second line (otherwise as tooltips). */
  hints?: boolean;
}

export function Menu({ label, button, title, kind, sections, hints }: Props) {
  const [open, setOpen] = useState<false | "first" | "last">(false);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const id = `menu-${label.toLowerCase().replace(/\W+/g, "-")}`;

  const items = () => [
    ...(list.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? []),
  ];

  const close = (focus = true) => {
    setOpen(false);
    if (focus) trigger.current?.focus();
  };

  useEffect(() => {
    if (!open) return;
    const all = items();
    (open === "last" ? all.at(-1) : all[0])?.focus();
    const outside = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    // Esc also closes the menu when the focus has left it, e.g. after a click
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("keydown", escape);
    };
  }, [open]);

  const onButtonKey = (event: KeyboardEvent) => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      setOpen(event.key === "ArrowDown" ? "first" : "last");
    }
  };

  const onMenuKey = (event: KeyboardEvent) => {
    const all = items();
    const index = all.indexOf(document.activeElement as HTMLElement);
    const move = (to: number) => all[(to + all.length) % all.length]?.focus();
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
        event.stopPropagation();
        close();
        break;
      case "Tab":
        close(false);
        return;
      default:
        return;
    }
    event.preventDefault();
  };

  const select = (item: MenuItem) => {
    if (item.blocker) return;
    close(!item.href);
    item.onSelect?.();
  };

  return (
    <div class="menu-root" ref={root}>
      <button
        ref={trigger}
        type="button"
        class={kind === "icon" ? "icon-button" : "menu-button"}
        aria-label={kind === "icon" ? label : undefined}
        title={title}
        aria-haspopup="menu"
        aria-expanded={open !== false}
        aria-controls={open ? id : undefined}
        onClick={() => (open ? close(false) : setOpen("first"))}
        onKeyDown={onButtonKey}
      >
        {button}
      </button>
      {open && (
        <div
          ref={list}
          id={id}
          class="menu"
          role="menu"
          aria-label={label}
          onKeyDown={onMenuKey}
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
      )}
    </div>
  );
}
