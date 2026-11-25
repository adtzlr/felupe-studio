// A Python script of an agent (#258, ADR 0015), of a mesh or of a material (ADR
// 0025): it runs with the rights of the user on this computer, so the user reads it
// and runs it, or not.
import { useState } from "preact/hooks";
import { Dialog } from "./Dialog";
import type { ScriptRequest } from "./useAgent";

export function ScriptConsent({ request }: { request: ScriptRequest }) {
  const [shown, setShown] = useState(false);
  return (
    <Dialog
      title="A Python script of the agent"
      onClose={() => request.answer(false)}
    >
      <div class="script-consent">
        <p>
          The agent wrote the Python script <code>{request.name}</code>. It runs
          on this computer with your rights, like a program that you start. Run
          it only if you trust what it does.
        </p>
        <button
          type="button"
          class="link"
          aria-expanded={shown}
          onClick={() => setShown(!shown)}
        >
          {shown ? "Hide the script" : "Show the script"}
        </button>
        {shown && <pre class="script-text">{request.content}</pre>}
        <div class="actions">
          <button
            type="button"
            class="button"
            onClick={() => request.answer(false)}
          >
            Do not run it
          </button>
          <button
            type="button"
            class="button primary"
            onClick={() => request.answer(true)}
          >
            Run it
          </button>
        </div>
      </div>
    </Dialog>
  );
}
