// Help ▸ Keyboard shortcuts (#126): the shortcuts and mouse actions of the app.
import { formatKeys, SHORTCUTS } from "../core/shortcuts";
import { Dialog } from "./Dialog";

export function ShortcutsDialog({ onClose }: { onClose: () => void }) {
  return (
    <Dialog title="Keyboard shortcuts" onClose={onClose}>
      <div class="shortcuts">
        {SHORTCUTS.map((group) => (
          <section key={group.title} aria-label={group.title}>
            <h3>{group.title}</h3>
            <dl>
              {group.shortcuts.map((shortcut) => (
                <div key={shortcut.action} class="shortcut">
                  <dt>
                    {shortcut.keys.map((keys, i) => (
                      <>
                        {i > 0 && <span class="muted"> or </span>}
                        <kbd>{formatKeys(keys)}</kbd>
                      </>
                    ))}
                  </dt>
                  <dd>{shortcut.action}</dd>
                </div>
              ))}
            </dl>
          </section>
        ))}
      </div>
    </Dialog>
  );
}
