// A drop zone with a "Choose file" button.
import { useRef, useState } from "preact/hooks";

interface Props {
  label: string;
  hint?: string;
  multiple?: boolean;
  onFiles: (files: File[]) => void;
}

export function FilePicker({ label, hint, multiple = false, onFiles }: Props) {
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  return (
    <div
      class={over ? "dropzone over" : "dropzone"}
      onDragOver={(event) => {
        event.preventDefault();
        event.stopPropagation();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(event) => {
        event.preventDefault();
        event.stopPropagation();
        setOver(false);
        const files = [...(event.dataTransfer?.files ?? [])];
        if (files.length) onFiles(multiple ? files : files.slice(0, 1));
      }}
    >
      <span>{label}</span>
      <button
        type="button"
        class="button"
        onClick={() => input.current?.click()}
      >
        Choose file…
      </button>
      {hint && <small class="muted">{hint}</small>}
      <input
        ref={input}
        type="file"
        hidden
        multiple={multiple}
        data-testid="file-picker"
        onChange={(event) => {
          const files = [...(event.currentTarget.files ?? [])];
          event.currentTarget.value = "";
          if (files.length) onFiles(files);
        }}
      />
    </div>
  );
}
