// Command line with autocompletion (ARIA combobox) and a history of entered lines.
import { useState } from "preact/hooks";
import { accept, complete, type Result, runLine } from "../core/commandline";
import type { ModelStore } from "../core/store";
import type { CommandType } from "../core/validate";

interface Props {
  store: ModelStore;
  onSelect: (name: string) => void;
  onOpen: (type: CommandType) => void;
}

const MAX_SUGGESTIONS = 8;

export function CommandLine({ store, onSelect, onOpen }: Props) {
  const [line, setLine] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [result, setResult] = useState<Result | undefined>();
  const [entered, setEntered] = useState<string[]>([]);
  const [recall, setRecall] = useState<number | undefined>();
  const [busy, setBusy] = useState(false);

  const completion = complete(line, store.commands);
  const items = open ? completion.items.slice(0, MAX_SUGGESTIONS) : [];
  const optionId = (index: number) => `command-option-${index}`;

  const edit = (next: string) => {
    setLine(next);
    setOpen(true);
    setActive(-1);
    setRecall(undefined);
  };

  const choose = (index: number) =>
    edit(accept(line, completion, items[index]));

  const submit = async () => {
    const text = line.trim();
    if (!text || busy) return;
    setBusy(true);
    const outcome = await runLine(text, store);
    setBusy(false);
    setResult(outcome);
    setEntered((previous) => [...previous.filter((l) => l !== text), text]);
    setRecall(undefined);
    setOpen(false);
    if (outcome.ok) setLine("");
    if (outcome.select) onSelect(outcome.select);
    if (outcome.open) onOpen(outcome.open);
  };

  const onKeyDown = (event: KeyboardEvent) => {
    const count = items.length;
    switch (event.key) {
      case "ArrowDown":
        if (count) setActive((active + 1) % count);
        else if (recall !== undefined) {
          const next = recall + 1;
          setRecall(next < entered.length ? next : undefined);
          setLine(next < entered.length ? entered[next] : "");
        }
        break;
      case "ArrowUp":
        if (count) setActive(active <= 0 ? count - 1 : active - 1);
        else if (entered.length) {
          const previous = Math.max(0, (recall ?? entered.length) - 1);
          setRecall(previous);
          setLine(entered[previous]);
        }
        break;
      case "Tab":
        if (!count) return;
        choose(Math.max(active, 0));
        break;
      case "Enter":
        if (count && active >= 0) choose(active);
        else void submit();
        break;
      case "Escape":
        if (count) setOpen(false);
        else if (line) {
          setLine("");
          setRecall(undefined);
        } else return;
        break;
      default:
        return;
    }
    event.preventDefault();
  };

  return (
    <div class="command-box">
      <label for="command" class="prompt" title="Command line">
        ›
      </label>
      <div class="command-field">
        <input
          id="command"
          class="command-input"
          role="combobox"
          aria-label="Command"
          aria-autocomplete="list"
          aria-expanded={items.length > 0}
          aria-controls="command-suggestions"
          aria-activedescendant={active >= 0 ? optionId(active) : undefined}
          aria-describedby="command-message"
          autocomplete="off"
          spellcheck={false}
          placeholder='Type a command, e.g. material.add {"model": "NeoHooke"}, or help'
          value={line}
          onInput={(event) => edit(event.currentTarget.value)}
          onKeyDown={onKeyDown}
          onBlur={() => setOpen(false)}
        />
        {items.length > 0 && (
          <ul
            id="command-suggestions"
            role="listbox"
            aria-label="Suggestions"
            class="suggestions"
          >
            {items.map((item, index) => (
              <li
                key={item.value}
                id={optionId(index)}
                role="option"
                aria-selected={index === active}
                class={index === active ? "suggestion active" : "suggestion"}
                // keep the focus in the input
                onMouseDown={(event) => {
                  event.preventDefault();
                  choose(index);
                }}
              >
                <code>{item.label}</code>
                {item.detail && <span class="muted">{item.detail}</span>}
              </li>
            ))}
          </ul>
        )}
      </div>
      <span
        id="command-message"
        class={
          result && !result.ok ? "command-message error" : "command-message"
        }
        aria-live="polite"
      >
        {result?.message}
      </span>
    </div>
  );
}
