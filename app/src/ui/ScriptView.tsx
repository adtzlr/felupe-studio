// The script view (#130): the FElupe script of the model, as the app exports it,
// updated after every change. The lines of the selected object are highlighted, and a
// click on a line selects its object.
import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import { highlightPython } from "../core/highlight";
import type { ModelStore } from "../core/store";
import type { PyodideClient, ScriptView as View } from "../worker/client";
import type { Runtime } from "./hooks";

interface Props {
  store: ModelStore;
  client?: Pick<PyodideClient, "scriptView">;
  runtime: Runtime;
  /** The view is shown (the ribbon tab Script of the Model workspace). */
  active: boolean;
  selected?: string;
  onSelect: (name: string) => void;
  /** Download the script, like Export ▸ Python script. */
  onDownload: () => void;
  /** Wait this long after a change before the script is made again (ms). */
  delay?: number;
}

/** The objects of every line (from 1): the first one, or the selected one. */
function ownersOf(lines: View["lines"], selected?: string) {
  const owners = new Map<number, string>();
  for (const [name, ranges] of Object.entries(lines)) {
    for (const [first, last] of ranges) {
      for (let line = first; line <= last; line++) {
        if (!owners.has(line) || name === selected) owners.set(line, name);
      }
    }
  }
  return owners;
}

export function ScriptView({
  store,
  client,
  runtime,
  active,
  selected,
  onSelect,
  onDownload,
  delay = 250,
}: Props) {
  const [view, setView] = useState<View>();
  const [error, setError] = useState<string>();
  const [updating, setUpdating] = useState(false);
  const [copied, setCopied] = useState(false);
  const code = useRef<HTMLDivElement>(null);
  const ready = runtime.state === "ready";
  const issues = store.issues;

  // the script of the current commands, the latest request wins
  const commands = store.commands;
  useEffect(() => {
    if (!active || !ready || !client || issues.length) return;
    let current = true;
    setUpdating(true);
    const timer = setTimeout(async () => {
      try {
        const { serialize } = await import("../core/project");
        const next = await client.scriptView(serialize(store.document));
        if (!current) return;
        setView(next);
        setError(undefined);
      } catch (e) {
        if (current) setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (current) setUpdating(false);
      }
    }, delay);
    return () => {
      current = false;
      clearTimeout(timer);
    };
  }, [active, ready, client, commands, issues.length, store, delay]);

  const lines = useMemo(
    () => (view ? highlightPython(view.script) : []),
    [view],
  );
  const owners = useMemo(
    () => (view ? ownersOf(view.lines, selected) : new Map<number, string>()),
    [view, selected],
  );
  const highlighted = new Set(
    (selected &&
      view?.lines[selected]?.flatMap(([a, b]) =>
        Array.from({ length: b - a + 1 }, (_, i) => a + i),
      )) ||
      [],
  );

  // the first line of the selected object comes into view
  const first = selected && view?.lines[selected]?.[0]?.[0];
  useEffect(() => {
    if (!active || !first) return;
    code.current
      ?.querySelector(`[data-line="${first}"]`)
      ?.scrollIntoView?.({ block: "center" });
  }, [active, first, view]);

  const copy = async () => {
    if (!view) return;
    await navigator.clipboard?.writeText(view.script);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const message = !client
    ? "The script needs Python, which is not available here."
    : runtime.state === "loading"
      ? "Python is loading …"
      : runtime.state === "error"
        ? "Python could not be loaded."
        : issues.length
          ? "Fix the issues of the model first:"
          : error
            ? `The script could not be made: ${error}`
            : !view
              ? "Making the script …"
              : undefined;

  return (
    <main class="script-view" aria-label="Script" hidden={!active}>
      <div class="script-bar">
        <span class="muted" role="status">
          {view && !message
            ? `${lines.length} lines${updating ? " · updating …" : ""}`
            : ""}
        </span>
        <button
          type="button"
          class="button"
          disabled={!view || !!message}
          onClick={() => void copy()}
        >
          {copied ? "Copied" : "Copy"}
        </button>
        <button
          type="button"
          class="button"
          disabled={!view || !!message}
          onClick={onDownload}
        >
          Download
        </button>
      </div>
      {message ? (
        <div class="script-message">
          <p class="muted">{message}</p>
          {issues.length > 0 && (
            <ul class="issues">
              {issues.map((issue) => (
                <li key={`${issue.index}-${issue.message}`}>
                  <button
                    type="button"
                    class="link"
                    onClick={() => onSelect(issue.name)}
                  >
                    {issue.name}
                  </button>
                  : {issue.message.replace(/^commands\/\d+: /, "")}
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : (
        <div
          ref={code}
          class="script-code"
          role="region"
          aria-label="FElupe script"
          tabIndex={0}
        >
          {lines.map((tokens, i) => {
            const number = i + 1;
            const owner = owners.get(number);
            return (
              <div
                key={number}
                data-line={number}
                class={
                  highlighted.has(number)
                    ? "script-line selected"
                    : "script-line"
                }
                title={owner ? `Select ${owner}` : undefined}
                onClick={owner ? () => onSelect(owner) : undefined}
              >
                <span class="script-number" aria-hidden="true">
                  {number}
                </span>
                <code>
                  {tokens.map((token, j) =>
                    token.kind ? (
                      <span key={j} class={`py-${token.kind}`}>
                        {token.text}
                      </span>
                    ) : (
                      token.text
                    ),
                  )}
                </code>
              </div>
            );
          })}
        </div>
      )}
    </main>
  );
}
