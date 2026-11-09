// Modal dialog: keeps the focus inside, closes with Escape and returns the focus to
// the element that opened it.
import type { ComponentChildren } from "preact";
import { useEffect, useRef } from "preact/hooks";

interface Props {
  title: string;
  subtitle?: string;
  onClose: () => void;
  children: ComponentChildren;
}

const FOCUSABLE =
  'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [href], [tabindex]:not([tabindex="-1"])';

export function Dialog({ title, subtitle, onClose, children }: Props) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    const first = ref.current?.querySelector<HTMLElement>(
      "input:not([type=checkbox]), select, textarea",
    );
    (first ?? ref.current)?.focus();
    if (first instanceof HTMLInputElement) first.select();
    return () => opener?.focus?.();
  }, []);

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      onClose();
      return;
    }
    if (event.key !== "Tab" || !ref.current) return;
    const items = [...ref.current.querySelectorAll<HTMLElement>(FOCUSABLE)];
    if (items.length === 0) return;
    const first = items[0];
    const last = items[items.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  return (
    <div class="backdrop">
      <div
        ref={ref}
        class="dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="dialog-title"
        tabIndex={-1}
        onKeyDown={onKeyDown}
      >
        <div class="dialog-head">
          <div class="dialog-titles">
            <h2 id="dialog-title">{title}</h2>
            {subtitle && <span class="muted">{subtitle}</span>}
          </div>
          <button
            type="button"
            class="icon-button"
            aria-label="Close"
            onClick={onClose}
          >
            ×
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
