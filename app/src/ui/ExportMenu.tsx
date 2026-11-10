import { useEffect, useRef, useState } from "preact/hooks";
import { Icon } from "./icons";

export interface ExportItem {
  id: string;
  label: string;
  /** What the export contains. */
  hint: string;
  /** Why the export is not possible, if so. */
  blocker?: string;
  onSelect: () => void;
}

interface Props {
  items: ExportItem[];
}

/** The exports of the project in the header: a button with a list of exports. */
export function ExportMenu({ items }: Props) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
        button.current?.focus();
      }
    };
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", close);
      document.removeEventListener("keydown", escape);
    };
  }, [open]);

  return (
    <div class="export-menu" ref={root}>
      <button
        ref={button}
        type="button"
        class="icon-button"
        aria-label="Export"
        title="Export the script, the results or a picture"
        aria-expanded={open}
        aria-controls="export-list"
        onClick={() => setOpen(!open)}
      >
        <Icon name="export" />
      </button>
      {open && (
        <ul id="export-list" class="export-list" aria-label="Exports">
          {items.map((item) => (
            <li key={item.id}>
              <button
                type="button"
                aria-disabled={item.blocker ? true : undefined}
                aria-describedby={`export-${item.id}-hint`}
                onClick={() => {
                  if (item.blocker) return;
                  setOpen(false);
                  item.onSelect();
                }}
              >
                <span class="export-label">{item.label}</span>
                <span id={`export-${item.id}-hint`} class="export-hint">
                  {item.blocker ?? item.hint}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
