// The toggle **Nodes** of the view toolbars (#91): shows the nodes of the meshes, in
// the model and in the results.
import { useState } from "preact/hooks";

/**
 * Whether the nodes are shown: the value of the app if it passes one (shared by the
 * Model and the Results workspace), else a state of the component.
 */
export function useShowNodes(
  shown?: boolean,
  onChange?: (show: boolean) => void,
): [boolean, () => void] {
  const [own, setOwn] = useState(false);
  const value = shown ?? own;
  return [value, () => (onChange ?? setOwn)(!value)];
}

export function NodesButton({
  pressed,
  onToggle,
}: {
  pressed: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      title="Show the nodes of the meshes"
      onClick={onToggle}
    >
      Nodes
    </button>
  );
}
